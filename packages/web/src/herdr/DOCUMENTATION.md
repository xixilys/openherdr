# OpenHerdr browser client

`../herdr-main.tsx` mounts this app independently of the OpenCode application.
Shared Button, Input, Icon, dialog, typography and authored OpenChamber themes
provide its visual language. It does not mount App, SyncProvider or the theme
provider that loads server-side OpenCode settings.

## Transport and credentials

`transport.ts` owns server normalization, pairing, bearer requests and parsed
Herdr contracts. A server identity is an explicit HTTP/HTTPS origin. Pairing
links carry `{pairingId,secret,server?}` as base64url JSON in `#pairing=`. The
entrypoint removes the fragment synchronously before mounting. The user confirms
the displayed server before redemption. Each saved origin has its own bearer
credential. Browsers use local storage. Capacitor uses the native secure vault
through `packages/ui/src/lib/herdr-credentials.ts`, with iCloud synchronization
off and device-only access while unlocked. Device credentials never enter a
URL. A native vault failure blocks credential persistence and never falls back
to browser storage. Startup loads the vault before selecting a saved server.
Writes are awaited and serialized before the in-memory connection list changes.

Reads reject malformed responses and HTTP failures. A mutation is dispatched
once with a unique request ID. Before dispatch, a pending request ID and target are saved in session storage,
without command text or credentials. A network failure is shown as an unknown
outcome. The composer keeps its draft and further mutations stay blocked across
target switches and page reloads. Check delivery reads the recorded receipt
without resending. Complete/rejected receipts clear the block; an unknown result
requires an explicit acknowledgment that the terminal was checked. Dismissing
ordinary notices does not clear pending delivery. Mutations capture the selected machine and explicit pane,
tab or workspace. Late completion cannot clear a draft on another target.

## State ownership

The snapshot is the authority for workspace, tab, pane and agent metadata.
Selection is browser-local and never focuses or resizes the desktop session.
Only the selected pane receives output reads. Snapshot metadata refreshes every
3 seconds and active terminal output every 900 milliseconds. Reads run
sequentially, stop while the document is hidden, abort on target changes and
back off failures up to 15 seconds. A changed read owner cannot expose the
previous owner's data while React effects catch up. A same-owner read failure
preserves the previous data and displays an error.

The default terminal renders official read-only observation frames through the
shared Ghostty renderer. A failed observation switches to a bounded text snapshot
with its source revision. Observation never takes the exclusive terminal
controller or resizes desktop splits. These frames do not contain structured
assistant messages or historical chat.
Terminal sends combine text and the Enter key in one `pane.send_input` call.
Named agents use `agent.prompt` addressed by the authoritative pane ID.

The entrypoint registers the network-only service worker in a secure HTTP/HTTPS
browser. Capacitor skips the worker. It caches no page, credential or authenticated
response.

## Runtime behavior

| Runtime | Behavior |
| --- | --- |
| Browser/PWA | Dedicated responsive app, explicit server pairing and bearer HTTP |
| Hosted mobile | Same app with drawer navigation and terminal shortcut keys |
| Capacitor | Same app and server selector with native secure credential storage |
| Electron | Upstream app retained; this client runs in a separate browser |
| VS Code | Upstream extension retained; this client is not mounted in its webview |

`herdr.i18n.ts` contains scoped translations for all shared locales and derives
its current locale from `useI18n`. Shared actions reuse existing dictionary keys.
The scoped dictionary is intentionally not registered as a new upstream key
namespace. It can be migrated to the shared message registry if this client
becomes part of the upstream application.

## Validation

Run `bun test packages/web/src/herdr/transport.test.ts` for pairing, origin,
authenticated request, invalid response and single-dispatch mutation behavior.
The coordinator owns the combined build, type checks and real desktop/mobile
browser verification. Static and unit checks do not establish physical-phone,
Cloudflare, SSH or actual OS secure-storage behavior.
