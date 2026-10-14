# OpenHerdr server

This module starts independently of the OpenCode server. It serves a named Herdr
session through the installed Herdr 0.9.3 protocol 22 JSON API. It imports only
the upstream client authentication, pairing and enterprise policy helpers.

## Entrypoints

`createHerdrServer(options)` creates the HTTP server, admin server and isolated
state. `startHerdrServer(options)` also awaits `listen()`. Both return
`{server, adminServer, adminSocketPath, stateDir, listen, close, setPublicOrigin,
address}`. `address()` returns the same metadata written to `server.json`.
`listen()` returns the actual address metadata, including an allocated port when
`port: 0` is used. `close()` closes only this runtime's servers and observer
children. It never stops a Herdr session.

Options:

| Option | Behavior |
| --- | --- |
| `session` | Explicit named local Herdr session. Required unless `socketPath` is given. |
| `socketPath` | Explicit local Herdr Unix API socket. Overrides session resolution. |
| `host` | HTTP listening address, default `127.0.0.1`. |
| `port` | HTTP listening port, default `4318`. |
| `stateDir` | Defaults to `~/.local/state/openherdr`. Mode 0700, owned by current user. |
| `publicOrigins` | Exact HTTP/HTTPS origins, without a trailing slash or path. |
| `nativeOrigins` | Subset of `capacitor://localhost` and `https://localhost`; both allowed by default. |
| `staticDir` | Optional built OpenHerdr assets. `/` serves `herdr.html`. |
| `herdrBinary` | Installed Herdr executable, default `herdr`. |
| `timeoutMs` | Default RPC timeout, 15000 ms. Agent startup uses its startup timeout. |
| `bridge`, `readPolicy` | Dependency injection for focused integration tests. |

The direct module entrypoint uses `OPENHERDR_SESSION`, default `default`, and
`OPENHERDR_PORT`, default `4318`. The owning CLI should pass explicit options.
It owns Cloudflare/SSH lifecycle and stale-instance recovery.

## Private admin socket

`stateDir/admin.sock` is a mode-0600 Unix socket. Existing sockets are never
unlinked during startup. A second server cannot reuse the same state directory.
Each connection accepts one newline-delimited JSON request and returns one
newline-delimited JSON response. Requests have `{id, command, params}`. Responses
have `{id,result}` or `{id,error:{code,message}}`.

| Command | Params | Result |
| --- | --- | --- |
| `status` | `{}` | App/version, PID, host/port, session, baseUrl, publicOrigins, adminSocketPath |
| `origin.add` | `{origin}` | Updated status metadata |
| `pair` | `{label?,server?}` | pairingId, secret, server, expiresAt, fingerprint, url |
| `stop` | `{}` | `{stopping:true}`, then this server closes |

Pairing URLs use `/#pairing=<base64url JSON>` with
`{pairingId,secret,server}`. The browser removes the fragment before redeeming.
A public server origin must be registered before issuance. Pairing issuance and
redeem share one in-process store owner. The CLI must never write clients.json
or pairing.json itself. Plain secrets and bearer tokens are returned only at
issuance and redeem, respectively. Files contain hashes and public metadata.
`server.json` contains no credentials and has mode 0600.

## HTTP routes

`GET /health` is public and returns only app/version/ok. Pairing redeem is public,
JSON-only, limited to 10 attempts per direct socket address per minute. Forwarded
IP headers are ignored. All other `/api/` routes require a client bearer header,
including loopback requests. Query strings are rejected. Browser Origins must
exactly match a registered origin or the loopback URL for the listening port.
The two native application origins `capacitor://localhost` and `https://localhost`
are also accepted. They identify a webview context and grant no authentication;
private API routes still require a bearer. The `null` Origin is refused.
There is no wildcard CORS and no URL bearer support.

The API in `OPENHERDR.md` is implemented, with these additional routes:

- `GET /api/herdr/receipts/:requestId` returns this client's persisted receipt.
- `POST /api/herdr/terminal` takes `{machine,pane_id,cols?,rows?}` and streams
  `application/x-ndjson` from `herdr terminal session observe`. Defaults are
  100 columns and 30 rows. The endpoint is read-only and does not resize desktop
  splits. Disconnect, revocation or shutdown terminates its observer child.

Terminal events retain the installed Herdr wire format. Local observation uses
the configured session or the explicit socket inherited from a plugin. Saved
remote profiles supply their own session. The request uses bearer headers, so a
fetch streaming reader works across HTTPS tunnels.
No WebSocket or OpenChamber private relay is introduced here.

`contracts.js` owns the strict method and parameter allowlist. Arbitrary Herdr
methods, session/socket addresses, SSH targets and implicit pane/agent targets
are rejected. Existing IDs are machine scoped because every call names a
machine and resolves that machine independently. Agent targets use explicit
pane IDs. Creating a tab requires workspace_id; splitting requires an explicit
target_pane_id. Environment/provider changes, arbitrary layout application,
resize and server lifecycle methods are absent.

## Transport and failure behavior

Private status metadata records the actual resolved socket path. The CLI refuses
to reuse a running bridge for a different explicit or inherited socket.

Local requests use one NDJSON Unix socket connection per RPC. Remote requests
resolve an enabled saved machine ID from `herdr machine list --json`. Its target
and session are parsed from that saved profile. SSH uses the existing SSH config
with BatchMode enabled and runs one fixed Python3 program per request. Request
JSON travels on stdin, including literal text and key arrays. No browser input
is interpolated into a command or used as an SSH option.

The helper clears inherited Herdr socket/session context and invokes the remote
`herdr --session <saved-session> status server --json`. The installed Herdr
executable, found on PATH or the remote `HERDR_BIN_PATH`, owns config and socket
resolution. The helper requires both compatibility flags, integer protocol 22,
a matching running session and an absolute `socket` value. It never guesses a socket,
creates a session or falls back to CLI pane commands. Python3 must be on the
remote command PATH. No remote file, service or dependency is installed.

RPC requests and results retain the native JSON protocol, including revision
and truncation fields. Atomic `pane.send_input` preserves all text/key
combinations, multiline text, leading dashes and quotes. The SSH helper checks
response IDs and limits response bytes and time. A missing Python3 or unavailable
session returns an explicit unsupported error. Any failure after socket dispatch
keeps an unknown outcome. Nothing retries automatically. Read-only terminal
observation uses the verified remote executable and session over the SSH helper.
The helper runs the remote official `terminal session observe` command because
the local `--machine` option cannot execute that management command. Stream
closure terminates only its SSH/helper and observer child.

Mutations require a requestId. Before dispatch, a private append-only journal
writes and fsyncs an `unknown` receipt. Concurrent or later reuse of that ID by
the same client returns 409 and its receipt. This includes restarts and changed
request contents. A confirmed result records `complete`. Transport failures
keep `unknown`, since the process may have already changed the terminal. A
corrupt journal prevents startup. Clients inspect the receipt and current
terminal before choosing a new action; they must never retry input silently.
Failed reads remain failed HTTP responses and cannot erase a valid UI list.

Revocation prevents subsequent authentication and closes active observer
children for that device. An already dispatched mutation can still finish.
The journal stores mutation result data and public targeting metadata under
0700/0600 permissions; it never stores prompt or terminal input text.

## Enterprise policy and runtimes

Every network bind, public-origin registration and public pairing issuance
checks the existing enterprise policy. Exposure is refused when enterprise
mode disallows network access. Requests also check current policy whenever a
public origin is configured or the peer is remote, including Cloudflare's
loopback proxy path. A policy change may therefore refuse a local API request
until public origins are removed by restarting with local-only configuration.

| Runtime | Behavior |
| --- | --- |
| Web | Dedicated authenticated OpenHerdr HTTP app |
| Hosted mobile | Same API over registered direct or tunnel origin |
| Capacitor | Same HTTP contract with explicit native origin allowlist |
| Electron | Upstream app unchanged; OpenHerdr browser app is available separately |
| VS Code | Upstream app unchanged; dedicated API integration absent |

## Validation

`node --test packages/web/server/herdr/server.test.js` tests actual HTTP auth,
origin enforcement, pairing concurrency/rate limits, revocation, strict RPC
validation, durable unknown receipts and restart, enterprise policy and socket
RPC framing. It also checks remote argv without touching saved remote machines.
The coordinator owns actual local/SSH/Cloudflare/browser acceptance.

`schema.json` is the method-specific subset extracted from the installed
`herdr api schema --json` on 2026-10-14. It is protocol reference material;
`contracts.js` deliberately accepts a narrower set with explicit targets and
bounded payloads.
