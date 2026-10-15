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

## Existing Herdr windows

The connected app opens Monitor. It uses the saved paired origin and bearer
transport, including the existing Cloudflare HTTPS route for access away from
home. One-use pairing, saved server selection and the native credential vault
remain the connection flow. Monitor does not require an OpenCode runtime or a
Codex conversation identity.

The original mobile header and window drawer navigate machine, workspace, tab
and pane. Each selected machine reads its own existing Herdr service. Workspaces,
tabs and panes retain the source order, including ordinary dashboard/watch panes
without a recognized agent. Selecting a machine or a window returns to Monitor.
The mobile title shows the selected tab and its machine/workspace, and opens the
window tree. It does not open a conversation switcher in Monitor. Machine
selection remains available when a machine has no panes or a snapshot fails.

Monitor mounts no pane composer, key bar, agent launcher or window management
buttons. Creation, rename, close and split controls are in the explicit Terminal
controls workspace page, along with its existing tracked mutations. Files,
Changes and other workspace pages keep their explicit entries. These are
separate actions from selecting an existing window to read it.

`PaneMonitor` owns the selected occupant's read-only output. Its identity is the
paired server, machine, pane and `terminal_id`. A different owner immediately
withdraws the old output, including a matching pane ID on another machine or a
replacement terminal in the same pane. New snapshots of the same terminal keep
its output and read lifecycle. Snapshot revisions are not occupant identities.

Screen uses the official read-only Ghostty observer. Connecting or unavailable
screens display a `pane.read` fallback with `source: 'visible'`; the text is the
current visible pane, not scrollback. Successful empty output remains empty.
Only this pane is read. Text polling stops while screen frames are healthy, and
both paths stop while the view, document or native app is hidden or offline.
They resume against the selected owner. `LiveTerminal` sets its hidden textarea
to read-only with `inputMode='none'`, preserving selection/copy without offering
terminal input or acquiring exclusive control. Terminal controls retain their
separate recent-output fallback, labeled Recent terminal output.

Observation reports connecting only when its owner first mounts. Resize and
reconnect keep the previous live/unavailable state until a new frame or failure,
so status/footer layout changes do not repeatedly restart the stream. Each new
subscription waits at most 20 seconds for its first accepted frame, then enters
fallback and existing backoff. The timer stops after that frame; a static pane
has no idle timeout. Owner replacement, hiding and unmount cancel the old wait.

A failed snapshot keeps the same machine's known tree and labels its last
successful read time. An initial failure has no authoritative empty result.
Failed visible reads preserve the same occupant's previous text with the error
and that text's own successful read time. Screen failure and text failure remain
separate; a healthy visible fallback does not inherit an old screen timestamp.
An empty machine offers refresh and machine/window selection, without prompting
the user to create a new task.

Conversations is an explicit secondary entry. On the first Monitor visit,
`ConversationPanel` is not mounted and no conversation endpoint is requested.
After a deliberate chat visit, its hidden disabled instance keeps the selected
conversation, unsent draft and reading position on a return to Monitor. The
existing disabled lifecycle aborts and pauses its reads, catalog, history and
stream; it does not start a new runtime in the background. Target changes keep
the original source-scoped conversation and draft behavior.

`HerdrMonitor.vitest.tsx` exercises the actual app navigation and request path,
including default zero conversation/mutation calls, ordinary panes, repeated IDs
across machines, stale and failed snapshots, foreground cancellation and an
explicit chat round trip. `PaneMonitor.vitest.tsx` covers visible fallback,
retained failure data, occupant isolation, pause/recovery and successful empty
output. These are DOM/request checks. Real Cloudflare rendering and Android IME,
system Back and native lifecycle acceptance require their own runtime checks.

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

The Android/hosted-mobile chat reuses the original `UserMessageBubble`,
`UserTextView`, `ToolSummaryView`, `MobilePillComposerView` and
`MobileSessionSwitcherView` and `ScrollToBottomView`. The original OpenCode wrappers consume these same
views. `ConversationPanel` retains Herdr session selection, mutations and draft
ownership. Its optional `navigation` contract publishes only the current title
and receives the header anchor and popup state. `HerdrApp` scopes title updates
by server, machine and pane. The title opens conversation history; the list
button opens Herdr workspaces and panes. Rename/fork/delete and pagination stay
in the conversation menu on mobile. Model/agent selection opens the original
mobile overlay presentation and operates on the selected owned conversation.

`ConversationComposer` owns the input presentation and reuses the original
`ComposerEditor`, `useMobileComposerShell` and `useMobileViewportPin`.
A phone tap commits the preview-to-editor swap before focusing in the same
gesture. The original native shell retains its own frame-timed focus behavior.
Blur, keyboard hide, Escape and the shared Back stack return to the preview.
Hardware keyboards and tablet size keep the editor expanded. The existing
mobile Enter/IME policy and desktop send preferences still apply.

The editor view is retained across pill swaps and hidden mobile panels, including
its selection. Hiding detaches it so a pending picker restore cannot focus it.
The view store is keyed by server, machine, pane identity, session and directory;
changing owners destroys that store. Text and attachments remain in the existing
scoped draft store. A native file picker holds expansion until change or cancel
and cancels keyboard restoration. Model/agent pickers use the original overlay
handoff. The permission/form dock is inside the same positioned form, so browser
viewport pinning moves its input and pending requests together. Native image paste
matches the focused CodeMirror element through its Herdr ancestor and retains the
existing writable/foreground checks. Send and queue are guarded separately from
abort availability and unknown-delivery mutation locks.

This increment covers the original floating expansion. Fullscreen editing,
agent/file autocomplete and voice remain separate work. The original
OpenCode web, Electron, VS Code and mobile wrappers keep their state and editor
behavior around the shared box. The Herdr browser, hosted mobile and Capacitor
client use this controller; Herdr remains outside the VS Code webview.

Live presentation requires both a fresh bound snapshot and a connected event
stream. A failed read, stream failure, hidden page or paused panel withdraws
activity, assistant streaming and reasoning animation while retaining transcript
data. Reconnection restores them after reading again. Stream errors are separate
from action/attachment errors and clear after a successful stream refresh.
Historical records supply no current activity. The floating composer measures
its own height to reserve transcript space. List resize and the native keyboard
settled event preserve following at the end or the reader's existing position.
The original return-to-latest action resumes following explicitly. Its pure view
keeps the original status controller out of the Herdr module graph. User text
parts report truncation to their message owner, which renders one expansion
control per message. The original floating frame displays permissions before
forms above the composer. Form editors remain mounted while hidden behind a
permission, preserving unfinished answers. Panel clearance is published only
to the small overlay and transcript-tail readers.

`ConversationTool` adapts real source tool states to the shared shell output,
scrolling, code highlighting and multi-file diff presentation. Running shell
output comes from its actual progress metadata. Final and failed outputs use
the original terminal normalization and output bound. JSON uses the original
summary; subtask results reuse Markdown without inventing child controls.
Background-job and child-session actions still need their source ownership
contracts. Generic/read output retains the bounded source text; diagnostics,
persisted JSON display-mode controls are not copied yet. Completed read and
file-change tools can open a current project file. The action uses the tool's
actual path and optional read offset or first changed line. Each reported file
in a multi-file patch has its own action; unscoped patch text grants no file
access. Files re-resolves the captured conversation target, including its
native identity, before reading and before publishing the opened file.
Saved history has no bound target and
cannot borrow the selected pane. Historical patches retain their source bytes;
the editor labels its current file content separately.
Positive read offsets map directly to lines, following the one-based contract
in [OpenCode 2.0.29's read tool](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/tool/plugin/read.ts#L17-L24).

`ConversationForm` adapts the original `SteppedFormView`. Its page-lifetime
memory holds up to 50 drafts, evicting the least recently saved draft after
that limit. Server, machine, verified pane identity, session and form identify
each draft. Permission priority and session navigation retain answers. A
changed field definition starts fresh; failed or unknown replies retain the
draft. Confirmed reply or cancellation removes only its captured generation,
so a late completion cannot clear a newer owner or form definition.

`HerdrConversationAttachments` supplies the original attachment chips, image
strip and image preview. Inline data and host downloads share byte-size,
raster-signature and UTF-8 checks. SVG and HTML remain text or downloads.
File references are read only after a click through the authenticated host
client, with the captured directory and returned relative path checked.
History never borrows the selected pane for file reads. External HTTP links
open only on explicit activation and receive no bearer token. Preview resources
are scoped to transport, pane identity and session; changing owners hides old
previews in the first render and releases their object URLs. Browser downloads
release URLs after a delay; native downloads use the existing file-sharing API.
The image gallery preserves the selected URL through equivalent source updates
and registers a stable shared Back layer. This layer's DOM tests do not establish
actual Android system Back behavior.

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

Workspace file requests capture server, machine, pane identity, conversation,
canonical root, relative path and optional source line. Files consumes a request
only while visible and after a successful directory read matches its root. An
owner/root change rejects the request. Closing the workspace retains the chat
component, selected conversation, draft, attachments and reading position.

For this file-navigation increment, the dedicated Herdr browser/PWA, hosted
mobile and Capacitor mobile use the same explicit host operations. The original
web, Electron, VS Code, hosted-mobile and Capacitor entrypoints retain their
OpenCode controller around the shared Files presentation. Herdr remains a
separate browser application on Electron; it is not mounted in VS Code.

Mobile Files uses `MobileFilesView`, shared with the original mobile file
browser. `FilesPanel` keeps host operations, drafts and revision checks. Its
optional `requestedFile` captures server, machine, pane, conversation identity,
canonical root, relative path and an optional real line. The conversation owner
captures the verified pane identity and session in the request. Files waits
until visible/enabled and until a successful listing confirms the same canonical
root. A different target is ignored; a different root reports a changed target
without reading the file or changing roots. Requested navigation resolves the
captured pane identity before opening a file or selecting a retained draft, and
resolves it again after a text or binary read before displaying returned bytes.
Both resolves require the captured canonical root and identity. A failed or
changed source keeps existing drafts and displays an error. These extra resolves
apply only to conversation requests; manual file browsing keeps its host path.
The current request ID is consumed
once, so polling or a root refresh cannot reopen it. A later request replaces
the pending editor read. Owner changes, hiding and user navigation withdraw late
file completions. Requested line focus uses the existing CodeMirror view.

The editor labels host bytes as the current file, keeps manual Save and existing
binary preview/download behavior, and retains drafts while hidden. CodeMirror
detaches its DOM while disabled or hidden and restores its existing view and
scroll on return. The mobile Back layer first returns from a file to its browser,
then clears search, then moves up within the canonical root. The shell closes
only after those inner routes are exhausted. Creation, rename, delete, upload,
reload conflicts and downloaded files still use the existing host client.

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
| Browser/PWA | Dedicated responsive app, explicit pairing/bearer HTTP; compact chat composer and a desktop history toolbar |
| Hosted mobile | Shared original chat, composer, title popup and drawers with explicit Herdr owners |
| Capacitor | Same Android-first chat with native storage, Back, lifecycle and pairing intake; native interaction needs separate acceptance |
| Electron | Original OpenCode wrappers reuse the extracted views; the Herdr client runs in a separate browser |
| VS Code | Original OpenCode wrappers reuse the extracted views; Herdr is not mounted in the extension webview |

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
`packages/ui/src/apps/herdr/HerdrConversation.vitest.tsx` runs through the web
workspace's existing Vitest configuration for Vite worker assets. It exercises
the real conversation component against framed source fixtures, including
stream failure/recovery and viewport changes. These DOM checks do not measure
native keyboard or gesture behavior.

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

`packages/ui/src/apps/herdr/FilesPanel.vitest.tsx` covers the shared view without
source I/O, visible/root-scoped request consumption, real line focus, stale
owner replies, occupant replacement before or during file reads, draft and CodeMirror scroll retention, manual save ownership,
inner Back routing, binary fallback and failed-listing behavior. These DOM
checks do not establish physical Android Back, native file sharing, or the
integrated chat-to-Files-to-Changes return flow.

`packages/ui/src/apps/herdr/ConversationComposer.vitest.tsx` renders the real
CodeMirror editor and original shell hooks. It covers synchronous browser-tap
focus, draft/selection retention, mobile Enter and IME send guards, queue/lock
eligibility, picker restoration, keyboard-hide intent, hidden/changed owners,
file cancellation, tablet expansion and shared Back-layer order. These DOM
checks do not establish Android IME, real system Back, keyboard geometry,
native picker behavior or fullscreen/autocomplete parity.

## Native commands and inline skills

`ConversationComposer` passes only real native commands to the original
`CommandAutocompleteView`. Typing the original leading-slash trigger opens it;
restoring a draft or ordinary typing does not fetch a registry. Each opening
loads commands once. Query changes rank that result locally. Submission takes a
fresh command list, independently of the picker result, because a command may
have changed since selection. These reads use the selected target's verified
server, machine, pane identity and conversation. Opening a model or attachment
picker closes candidates and uses the existing keyboard handoff.

`ConversationPanel` reads `/api/herdr/conversations/registry` only for this
selected conversation. Prompts without a slash or inline `$name` token make no
registry request. A slash submit first matches the native command name with the original literal-space,
case-sensitive parser. A command match sends one `command` action with the
original arguments, files and queue delivery. Successful no-match then loads
skills by name; a match sends one prompt with the complete original text, files,
delivery and real skill ID. Successful no-match in both lists sends the original
plain prompt.

The `$` picker uses the original `SkillAutocompleteView`, trigger, ranking and
editor insertion. It reads native skills once per opening and filters that list
locally. Native IDs, names and descriptions are authoritative; the source provides
no scope/source metadata, so these badges are absent. Selection inserts `$name `
at the caret and preserves all other text. A restored draft opens no picker.
The original OpenCode wrapper retains its own directory store and full metadata.

Submission resolves inline `$name` tokens with the shared prefix grammar and
exact registered casing. A fresh native skills read maps names to real IDs,
including names whose skill folder has a different ID. Slash skill and inline
references merge in first-occurrence order, with the leading slash skill first;
duplicate native IDs are attached only once. At most 10 unique IDs are allowed.
Exceeding that limit shows an error and preserves the complete draft. Successful
unknown inline names remain ordinary text. Command routing keeps precedence
when a native command and skill share a name. Both command and prompt actions
carry the resolved IDs with unchanged text or arguments, files and queue delivery;
the server supplies command skill instructions before dispatching the command.
A failed necessary lookup shows the error, retains the draft and files and
dispatches nothing. There is no `skill` action or automatic mutation
retry.

Classification captures draft identity, revision, source identity and transport.
New typing, hiding, delivery locks or owner changes cancel it. Before dispatch,
the current owner, revision and write access must still match. A synchronous
submission controller prevents a second gesture from starting another lookup
or dispatch. Command actions accept their real null result, without inventing
an inbox user message or a queued-prompt notice. Confirmed completion refreshes
actual history and acknowledges only the captured draft revision for the same
source. Unknown delivery retains the existing durable mutation lock.

The original web, Electron, VS Code and mobile command containers retain their
existing built-in and extension behavior around the shared view. The dedicated
Herdr browser, hosted mobile and Capacitor composer use the native-only list;
Herdr remains outside the VS Code webview. DOM tests cover selection and Back
ordering, while real Android keyboard and system Back still require acceptance.
`ConversationSlash.vitest.tsx` checks actual controller requests and drafts,
including lazy counts, command/skill/plain routing, inline exact-case names and
IDs, slash/inline merging, the unique-ID limit, files/delivery, failures,
source and draft changes, fresh registry classification, null action replies
and unknown-delivery single dispatch.
