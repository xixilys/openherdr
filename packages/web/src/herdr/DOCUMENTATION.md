# OpenHerdr browser client

`../herdr-main.tsx` mounts this app independently of the OpenCode application.
It uses the original mobile header and drawer presentation through
`HerdrMobileShell`, shared editor/diff components and authored OpenChamber themes.
Its controller supplies real Herdr targets and source-driver results. It does
not mount the OpenCode application's global `SyncProvider` or impersonate its
stores. The original application keeps its own containers around the same
extracted presentation components.
Markdown and generated-result cards defer the original session containers until
they are used without an explicit presentation source. Importing this client or
rendering its conversation therefore does not bootstrap OpenCode location,
session-folder or settings requests against the mobile shell origin.

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
once with a unique request ID. Before dispatch, a pending request ID and target
are saved in the native secure vault or browser local storage, without command
text or credentials. The old browser session-storage record is migrated before
it is removed. Storage failure blocks dispatch. A network failure is shown as an unknown
outcome. The composer keeps its draft and further mutations stay blocked across
target switches and page reloads. Check delivery reads the recorded receipt
without resending. Complete/rejected receipts clear the block; an unknown result
requires an explicit acknowledgment that the affected terminal, files,
repository or conversation was checked. Clearing compares the exact captured
request ID. Dismissing
ordinary notices does not clear pending delivery. Mutations capture the selected machine and explicit pane,
tab or workspace. Late completion cannot clear a draft on another target.

Browser pending-store transactions use a Web Lock for each server so two tabs
cannot replace each other's unresolved request. A browser without Web Locks
blocks writes. HTTPS and localhost provide the supported browser contexts;
an insecure HTTP LAN origin may lack this capability. The Android shell uses
its native vault and the same lock when available, with one application WebView.
Conversation confirmations must also match the captured pane identity, session
and action. A mismatched confirmation preserves the pending delivery as unknown.

## State ownership

The snapshot is the authority for workspace, tab, pane and agent metadata.
Selection is browser-local and never focuses or resizes the desktop session.
Only the selected pane receives output reads. Snapshot metadata refreshes every
3 seconds and active terminal output every 900 milliseconds. Reads run
sequentially, stop while the document is hidden, abort on target changes and
back off failures up to 15 seconds. A changed read owner cannot expose the
previous owner's data while React effects catch up. A same-owner read failure
preserves the previous data and displays an error.

The main view shows structured conversations from the source driver. A native
session association requires an authoritative Herdr native reference; cwd or
a pane title does not establish that association. OpenHerdr-owned OpenCode
sessions use a separate verified binding and ownership marker. Saved history
survives pane closure; controlling it from a new pane requires explicit rebind.
The adapter under `packages/ui/src/lib/opencode/` owns wire parsing/projection.
See the server's `docs/openherdr/CONVERSATION_DRIVER.md` contract for source
ownership, pagination, approvals, attachments and stream resynchronization.
Hiding the conversation pauses reads and streaming while retaining loaded
history pages and scroll position. A session or verified pane identity change
resets the message view. Attachment preparation blocks sending for its draft
until all file bytes are ready; changing target or session cancels preparation.
The conversation takes its selected `Theme` and chat preferences explicitly.
Markdown code and diagrams use that theme; live reasoning follows the expansion
preference. The shared keyboard policy applies desktop Enter preferences while
mobile Enter keeps inserting a newline. These values do not update OpenCode's
global UI store.

The terminal workspace tab renders official read-only observation frames through the
shared Ghostty renderer. A failed observation switches to a bounded text snapshot
with its source revision. Observation never takes the exclusive terminal
controller or resizes desktop splits. These frames do not contain structured
assistant messages or historical chat.
Terminal sends combine text and the Enter key in one `pane.send_input` call.
Named agents use `agent.prompt` addressed by the authoritative pane ID.

Files and Changes use `host-client.ts` and the authenticated host route. File
drafts retain server, machine, pane, canonical root, relative path and revision.
Saving is manual and never overwrites a draft from a polling read. A changed
root or revision refuses the write. Files/Changes remain mounted after their
first visit, while hidden reads stop. Git operations retain actual error and
conflict results. A pending host write uses the same durable mutation record
as terminal and conversation operations.

`packages/ui/src/lib/herdr-native.ts` reuses native chrome, Back and lifecycle
helpers. Android Enter inserts a newline; Ctrl/Meta+Enter sends, with an IME
composition guard. Pairing intake accepts only the precise
`openherdr://connect` route, displays its server and requires Connect. It never
submits prompts or silently replaces the current connection.

The entrypoint registers the network-only service worker in a secure HTTP/HTTPS
browser. Capacitor skips the worker. It caches no page, credential or authenticated
response.

## Runtime behavior

| Runtime | Behavior |
| --- | --- |
| Browser/PWA | Dedicated responsive app, explicit server pairing and bearer HTTP |
| Hosted mobile | Original drawer presentation with explicit Herdr targets |
| Capacitor | Android-first app with native storage, Back, lifecycle and pairing intake |
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
`host-client.test.ts` covers root/revision ownership, durable dispatch and
preserving edits made while a save is in flight.
The coordinator owns the combined build, type checks and real desktop/mobile
browser verification. Static and unit checks do not establish physical-phone,
Cloudflare, SSH or actual OS secure-storage behavior.

## Settings and project context

The original Settings controls bind to `useHerdrPreferences`. Appearance applies
the selected real theme to the application, Markdown, diff and terminal. Android
retains Enter for a newline and Ctrl/Meta+Enter for sending; web obeys its stored
send preference. Streaming reasoning uses the stored expansion preference.
Remote fonts require a current successful info response allowing them.

The Context workspace tab reuses KnowledgeCard, KnowledgeEntryView and NoteEditor
with the typed project-context client. New and existing drafts include the
resolved project owner. Unknown project owners disable creation. A confirmed
write invalidates older outstanding reads of that same target. Hiding a panel
pauses reads, while stored drafts remain available when the owner returns.
