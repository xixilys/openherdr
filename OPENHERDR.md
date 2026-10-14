# OpenHerdr development

## Goal and ownership

The user requests an OpenChamber-derived app and native Herdr workflow plugin, with the OpenChamber UI, mobile remote control over Cloudflare, SSH or a suitable direct connection, and Git-based iterations. Work autonomously with dot/Astra. Preserve existing user sessions, agents, services and provider configuration. Repository root is `/Volumes/remote/project/openherdr` on the Mac.

Upstream OpenChamber is MIT licensed, baseline `c5b690df9`. Keep the license and original application. OpenHerdr is an independent entrypoint inside `packages/web`; sharing UI primitives does not require OpenCode to run. Existing OpenCode-specific functions remain part of the upstream application and must not be advertised as supported for arbitrary Herdr agents without an implementation.

Before resuming work, read this file and `docs/openherdr/STATUS.md`. Root AGENTS.md and the user's global instructions apply. The user explicitly authorizes Git iteration and autonomous implementation. Public release, changes to shared services or credentials, and stopping unrelated agents are outside this task.

## Architecture

- `packages/web/server/herdr/`: Herdr bridge, HTTP API and authentication. Its server starts independently of the OpenCode server.
- `packages/web/src/herdr/`: responsive UI and parsed transport contracts. Use the actual shared OpenChamber primitives, typography and theme tokens.
- `packages/web/herdr.html` and `vite.herdr.config.ts`: separate web/PWA build, output `packages/web/dist-herdr`.
- `packages/web/bin/openherdr.js`: CLI lifecycle, pairing, Cloudflare and SSH instructions/transport.
- `plugins/openherdr/`: native Herdr workflow plugin manifest/actions, following the installed Herdr protocol.
- Mobile web/PWA is the first runnable app. Reuse the Capacitor shell with a separate app identifier/build when feasible; report native builds separately from real-phone validation.

## API contract for parallel implementation

All application data routes use bearer authentication, including loopback. Do not accept bearer tokens in query strings. JSON errors have `{error:{code,message}}`. No failed read becomes a valid empty list.

- `GET /health`: public minimal `{ok:true,app:"openherdr",version:"0.1.0"}`.
- `POST /api/pairing/redeem`: public JSON `{pairingId,secret,deviceName?}` -> `{token,client}`. Rate limited. A one-time secret arrives in the URL fragment and the UI removes it before exchanging it. Credentials are scoped to OpenHerdr's own state directory.
- `GET /api/herdr/info`: `{app,version,session,capabilities}`.
- `GET /api/herdr/machines`: `{machines:[{id,label}],session}`; local target is `{id:"local",label:"Local"}` and saved machine IDs come from `herdr machine list --json`.
- `POST /api/herdr/rpc`: `{machine:"local"|savedProfileId,method,params,requestId?}` -> upstream Herdr `{id,result}`. Strict server-side method/parameter allowlist. Mutation request IDs are required, recorded before dispatch, never replayed on unknown outcome. User-visible target is machine/session/pane together. Local uses the server-configured session; remote uses the saved profile's session. No browser-supplied SSH command, socket path or arbitrary session.
- Initial allowed methods: `session.snapshot`, workspace list/create/rename/close, tab list/create/rename/close, pane list/read/send_input/send_keys/split/close, agent list/start/prompt/rename, worktree list. Inspect installed schema for exact names/params before implementation. `pane.resize` changes desktop splits; do not map viewport changes to it.
- `GET /api/herdr/clients` and `DELETE /api/herdr/clients/:id`: device inspection/revocation. Credentials are never returned by list.
- Herdr output uses official read-only terminal observation frames rendered by Ghostty, with revisioned bounded text reads as fallback. Observation does not acquire the exclusive terminal controller. Poll only visible active pane, pause hidden views, cancel stale requests on machine/pane change, and back off failures.
- Main-thread follow-up may add pane-scoped read-only `/api/herdr/files` and `/api/herdr/git`; these must resolve authoritative pane cwd and confine file access to it. UI can add these after the contract is implemented.

Pairing issuance uses a private mode-0600 Unix admin socket owned by this server. CLI asks the running server to create the pairing; CLI must not concurrently mutate the upstream JSON stores from a second process. Reuse `client-auth/remote-clients.js` and `pairing.js` with injected state paths. Do not import the full upstream server. Exact allowed origins, no wildcard CORS, no trust in arbitrary forwarded headers. Cloudflare's HTTPS endpoint requires explicit public origin registration before pairing. Enterprise policy applies to network exposure and tunnel creation.

## Runtime behavior

| Runtime | Behavior |
| --- | --- |
| Web/PWA | Dedicated Herdr app with bearer-authenticated direct/tunnel/SSH-forwarded API |
| Hosted mobile | Same responsive app with mobile terminal input controls |
| Capacitor | Separate OpenHerdr build; explicit stored server selection and bearer transport |
| Electron | Upstream application preserved; dedicated OpenHerdr web app usable in browser |
| VS Code | Upstream application preserved; Herdr entrypoint not integrated into extension |

## Current collaboration

Main Codex chat `01a13b81-92a9-7f52-95c6-ac4bb6ee6cc8`; MCP peer `codex-openherdr-20261014`. Dot peer `dot-dac-dse` was sent message `965751cb-b710-4711-9c7a-ebf037033f10` requesting UI review and agreement to dispatch independent cloud UI/QA. Delivery callback was received; substantive reply and dispatch agreement are pending. Do not call receipt an agreement. No private collaboration remote exists yet.

## Validation and safe experiments

Use a new named Herdr session `openherdr-test`, explicit returned IDs and an owned fixture directory. Never send input to existing user panes. Check actual phone-sized browser rendering and real HTTP input/output through the installed Herdr API. Verify unauthenticated rejection, invalid origin, one-use pairing, revoke, target switching and unknown mutation receipts. Test a real remote connection path when available. Native compile, simulator validation and physical-phone validation are distinct claims.
