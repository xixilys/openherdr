# OpenHerdr development

## Goal and ownership

The user requests an OpenChamber-derived app and native Herdr workflow plugin, with the OpenChamber UI, mobile remote control over Cloudflare, SSH or a suitable direct connection, and Git-based iterations. Work autonomously with dot/Astra. Preserve existing user sessions, agents, services and provider configuration. Repository root is `/Volumes/remote/project/openherdr` on the Mac.

The latest user correction makes the Android app the primary deliverable and
explicitly requests continued complete feature replication. The existing
terminal-controller baseline is an intermediate version. Web/PWA supports the
Android client and development; iOS work is auxiliary. Inventory the original
OpenChamber features, identify real Herdr/provider-session data, then implement
and exercise the Android flows. An unsupported-feature table does not complete
the requested work. Retain factual distinctions between implementation, emulator
execution and physical-phone execution.

The latest human clarification prioritizes reading existing Herdr windows across
Local, WSL, JP API and Kansas. Each configured machine points to its existing
Herdr service. The primary app flow follows machine, workspace, tab and pane,
including ordinary watch/dashboard panes, and displays their actual status and
output. It requires no association with a new Codex process or native conversation
ID. Codex conversations may appear as an additional source later. New conversation
creation and extra composer features are secondary. Preserve existing workers
and their ownership. The Codex integration
installation and normal hook trust are authorized, but remain unperformed while
the existing-task monitoring path is checked. The broader Android parity goal
remains in scope.

The human explicitly requires preserving Cloudflare binding for access away from
the local network. Cloudflare HTTPS, one-use pairing and saved authenticated
connections remain the primary connection flow. Window monitoring uses that
same transport for local and saved-machine Herdr services. Validate the actual
public HTTPS path. The current Quick Tunnel address changes after a tunnel
restart; persistent named-tunnel support from the original application remains
part of broader parity work.

The active host-connection unit maps the original explicit Cloudflare managed
modes into the OpenHerdr CLI. `--cf` keeps its Quick default; `--cf-mode` selects
`quick`, `managed-remote` or `managed-local`. Named modes use the existing
`--server` HTTPS origin plus an explicit `--cf-token-file` or `--cf-config`.
The CLI owns only its new connector process, awaits startup/exit and distinguishes
connector initialization from verified public routing. This unit adds no
profile store, secret copy, default credential discovery or client transport.
The implementation and owned-process tests pass. An isolated real Quick Tunnel
also passed public health, bearer rejection, pairing, an authenticated read-only
snapshot, client revocation and confirmed cleanup. The existing default bridge
and CF address stayed live. No real named-domain configuration was activated;
user credentials, DNS and ingress remain untouched. Named-domain activation
needs a separately authorized operator setup. STATUS.md records current evidence.

The connection increment restores the original Welcome connection presentation for
OpenHerdr, with saved server selection, manual one-use pairing and Android QR
intake. Pairing remains explicit and uses the existing authenticated CF origin.
The controller must preserve a confirmed credential across a failed vault write,
retry only that write, and prevent an old completion from replacing a newer
connection intent. This work adds no connection provider or tunnel mode. Android
camera, Back and secure-vault runtime acceptance remain separate from source and
browser checks. iOS scanner packaging stays unsupported if the existing plugin
cannot be registered without a package-manager migration.

The credential-recovery increment restores expired-device recovery through that
Welcome view. Only an HTTP 401 carrying OpenHerdr's `unauthorized` code rejects
the current credential. The app pauses private views, requires explicit pairing
or a different saved connection, and saves the replacement before activation.
Replacing a token on the same origin retains the selected window, chat draft and
pending delivery. Network failures and upstream conversation authorization errors
retain the existing connection. Browser/PWA, hosted mobile and the separate
Capacitor app share this flow. Original Electron and VS Code keep their existing
application and authentication behavior. Android secure-storage and system Back
acceptance remain separate from DOM fixtures and browser execution.

The cold-window increment restores the last viewed Monitor window on a cold launch,
matching the original mobile app's per-runtime session restoration. Save only
the origin-scoped machine/workspace/tab/pane and terminal identity. A successful
current machine list and snapshot must confirm the complete target before output
starts. Failed reads retain the hint; confirmed removal or terminal replacement
shows an unavailable target and requires explicit selection. New user navigation
wins over restoration. Restore no Terminal controls or pending input.

The actual 412x915 Cloudflare browser now reloads directly into the selected
Kansas task-overview window, and a later manual selection of the workers window
becomes the next restored view. The saved connection remains active without a
new pairing. Focused tests and the combined static gate pass; the rebuilt APK
packages this behavior. Android process-death and physical-phone execution
remain unverified. Current artifact details are in STATUS.md and native validation.

The human requested the first APK for a physical camera test. Keep
`packages/mobile/openherdr/build/openherdr-test1-726029ba6.apk` available while
future debug builds change. It is the supplied 726029ba6/D8G2xhGi build, not an
additional native acceptance result. No phone result has been received yet.

The human explicitly requested a corresponding GitHub APK download and a fresh
pairing code for scanning. The fixed first APK is now the public prerelease
`android-test1-726029ba6`, pinned to source 726029ba6. Its remote size and SHA-256
match the preserved file and the unauthenticated download returns 200. Pairing
codes/QR images remain private and expire after 10 minutes; they are never
release assets or repository content.

The connection-management increment restores the original saved-instance
list, local names, two-step local removal and explicit switching. A saved
connection must pass an authenticated read before its durable selection and
activation. Herdr credentials remain bound to their exact origin, so editing
changes only the local name; a different address uses the existing pairing
flow. Rename preserves list order. Removal preserves pending delivery records
and sends no server revocation. The existing default bridge, CF address and
fixed first test APK stay available while physical-phone testing is pending.
Focused and regression tests, independent source review and the combined static
gate pass. The actual CF browser exercised naming/reload, cancelled removal,
saved selection and return to the same Kansas window. The rebuilt Android APK
packages this flow; device execution remains unverified. STATUS.md and the native
validation document record the artifact and remaining limits.

The active Changes increment restores one complete working-tree flow using the
original file groups, phone diff detail and pinned multiline commit footer.
Files save, working/staged diff, stage/unstage and a local commit of the current
index use the existing host API. A commit does not capture an immutable index
snapshot and does not automatically stage working contents. Navigation and drafts
are scoped to the server, machine, pane terminal and canonical root. Hidden views
pause reads, and unknown mutations retain their durable record without replay.
Generate, push, discard and comparison controls require their own implemented
host capabilities and are absent from this flow. Existing Branches and History
remain reachable. The default CF service and first phone-test APK stay available.

The working-tree flow now passes independent DOM/source review, the combined
static gate, actual paired CF file-save/stage/unstage/commit/history/return checks,
and rebuilt web/Android packaging. Final asset and runtime details are in
STATUS.md. The default Kansas monitor still reads its existing worker window;
its current cwd is not a Git repository and is shown as such. No remote Git
write or physical Android execution is newly accepted. Complete original editor,
Git network/comparison and remaining UI features stay in scope for later units.

For this Changes increment, Herdr web/PWA and hosted mobile use the same host
controller and shared list/diff/footer presentation. Capacitor Android and iOS
bundle that controller with the existing Back and lifecycle bridge; native
execution remains separate acceptance. Original web and Electron retain their
existing Git controllers. Original VS Code retains its runtime bridge and Git
controller. Original hosted and Capacitor mobile retain their controllers around
the extracted presentation. The dedicated Herdr entrypoint remains available in
a browser on Electron and is not mounted in VS Code.

The active editor increment completes the existing UTF-8 code/text flow with
the original language/theme extensions, Find/Replace, line navigation, wrapping,
generic code preview and explicit file close. Drafts keep normalized full text
and the original preferred LF/CRLF style. Manual saves serialize at the host
boundary, retain revision checks and preserve edits made during a write. Closing
a dirty active or inactive document offers Save, Discard and Cancel; failed or
unknown saves keep the document open. No formatter, autosave or host API is added.
Markdown/HTML/JSON/media/canvas artifact previews remain separate parity work.

For this editor increment, Herdr web/PWA and hosted mobile share the host-owned
draft controller and original presentation. Herdr Capacitor Android/iOS bundle
that flow with the existing native lifecycle; native keyboard and Back execution
require separate device validation. Original web, Electron, hosted mobile and
Capacitor retain FilesView's controller while reusing the extracted editor
extensions and code preview. Original VS Code retains its own file bridge and
does not mount the Herdr editor. The shared CodeMirror read-only facet applies
to every existing caller. The default CF service and fixed first APK remain live.

The active text-artifact increment restores Markdown, JSON/JSONC/GeoJSON,
Mermaid, SVG and CSV/TSV as one complete Files flow. Use the original renderer,
controls and source/preview behavior. Specialized previews show the saved/base
content as in FilesView; the generic code preview continues to show the current
draft. Mode changes preserve the active editor and dirty text. Keep each open
document's chosen mode. JSON5 retains the original strict parser and visible
error; this does not add full JSON5 support. Excalidraw Markdown stays on its
separate canvas path. Markdown includes rendered search, safe raw HTML,
relative images/picture/srcset, app-theme picture selection, heading links and
navigation to confined local files. Its explicit Herdr presentation/asset source
uses the captured server, machine, pane, root and file. Hidden or superseded
previews cancel reads and revoke their object URLs. No request falls back to
OpenCode or permits reading outside the selected pane root.

For this text-artifact increment, Herdr web/PWA and hosted mobile use the same
confined host adapter and shared preview presentation. Herdr Capacitor Android
and iOS bundle that flow; touch, Back, IME and native lifecycle acceptance remain
separate. Original web and Electron keep FilesView's controller and runtime
file reader around shared presentation. Original hosted and Capacitor mobile
keep those same existing controllers. Original VS Code does not mount this file
viewer and retains its own runtime bridge. The Herdr entrypoint stays separate
from Electron and VS Code. No backend operation, dependency, provider, server
restart or credential change is included. Binary streaming/PDF, active HTML
grants, draw.io/canvas, comments, autosave and fullscreen remain explicit later
parity work. Preserve the default CF services and fixed first test APK.

This text family now passes 183 focused/retained cases, independent source
reviews, the combined static gate and Web/Android builds. The paired CF browser
exercised local source/preview/save, JSON error recovery, SVG/Mermaid controls,
and saved-WSL Markdown images/local CSV links. Generated Mermaid SVG is cleaned
before caching for every shared renderer caller, including original VS Code
chat. Actual Chrome cleaning and image decode are recorded; browser network
tracing, real download completion and native Android interaction remain
unverified. Default CF services and the first-phone APK remain unchanged. See
STATUS.md for current artifact details and limits.

The active binary Files increment restores the original raster-image, PDF,
audio/video, font and unsupported-binary viewing flow. This extends the existing
Files family with necessary metadata and raw/range reads. The earlier pause on
additional backend families was a development-stage choice; the original
complete-replication authorization covers this Files transport. Active HTML and
its separate resource tree remain later work. The original phone Files view has
no application fullscreen button, so this increment adds none.

Inspect metadata before attempting a capped text read. Browser-owned previews
use exact-file capabilities minted by the paired bearer API. Capabilities bind
the issuing client, resolved machine profile, pane terminal, canonical root and
file metadata version. The main bearer never appears in a URL. GET/HEAD use only
the opaque capability path, after exact Origin and current enterprise-policy
checks; Origin null stays refused. Other private API routes keep bearer auth.
HTML, JavaScript and SVG do not become active same-origin documents through this
route. Unknown formats use attachment/octet-stream.

The metadata version detects ordinary edits and replacement between requests;
it is separate from the editor SHA-256 revision and promises no immutable
snapshot against external in-place writes. Every raw request verifies current
profile, terminal, root and version before success headers and checks the opened
file again on completion. It holds that confined descriptor for the response.
Known UI owner changes, grant release, device revocation and shutdown cancel
owned reads. There is no continuous server-side pane polling during a body.
Failures after headers truncate the response. No whole-file hash, base64 or
root-directory lock is required merely to seek.

Preview grants admit requests for 10 minutes, with bearer renewal every 5 minutes
only while the selected preview is visible. Renewal keeps its URL and is bounded
by a 1-hour absolute grant lifetime. Reacquisition at that boundary can remount the
viewer, as the original token-refresh path does. Capacity refuses new grants
rather than evicting an active viewer. Explicit browser downloads acquire a
separate attachment grant; an admitted download may finish after admission
expiry, while release, revocation and shutdown still cancel it. Native sharing
keeps the existing complete File/base64 path and 8 MiB host limit in this unit.
Large native streaming/share is not implemented by the preview endpoint.
Small native shares also read their dedicated version-pinned download grant
before invoking the existing File/base64 helper. Every admitted operation has
a 1-hour absolute deadline, including backpressure, so a disconnected remote
helper cannot retain its descriptor indefinitely.

Herdr web/PWA and hosted mobile share this selected-host contract. Herdr
Capacitor Android and iOS bundle it with existing lifecycle and Back handling;
actual PDF pages, codecs, seek, native sharing and background cleanup need device
validation. Original web, Electron, hosted mobile and Capacitor keep their
existing file controllers and authentication. Original VS Code retains its own
bridge and does not mount the Herdr file viewer. The default bridge/CF origin,
existing worker windows and fixed first APK remain available during this work.

This transport and image/media/font implementation now has independent core,
HTTP and UI checks, source review and a passing final static gate. Actual public
CF HTTP reads match local and saved-WSL fixtures; the phone-sized browser decodes
images, plays large WAV and WebM, seeks audio and shows font/error/binary views.
Its PDF iframe remains blank despite exact bytes and a successful loopback
CSP comparison. Keep PDF rendering unfinished, retain the current CSP and do
not advertise complete binary-family or native Android acceptance. New backend
behavior runs on a separate owned test service. The default bridge and its old
resources stay untouched. STATUS.md and native validation own final artifacts
and remaining work.

The deployment check connects that published backend and final isolated
Web build to the actual default Herdr socket, with a separate state directory
and an owned Quick Tunnel. The existing default bridge, origin and paired clients
stay live. Issued phone pairing is not modified; its normal expiry still applies.
Current CLI lifecycle does not transfer a
Quick Tunnel to another backend process; this check creates a second origin and
requires its own explicit pairing. It must not be described as an upgrade of
the old address. Validate actual Local and saved-machine window reads through
the new origin, old-client HTTP contracts, authentication and the matching
Files contract without sending input to existing panes. This deployment adds
no new application API, setting, command, provider or credential migration.
Independent public HTTP checks now confirm exact default-socket window identity,
read-only output, the older Files list shape and a real saved-WSL range read.
The phone-sized browser reads existing Local, Kansas, JP API and WSL windows,
decodes the owned WSL video and reloads into the same selected window. Keep its
live static directory separate from future builds. The phone has not been moved
to this new origin. Native connection acceptance remains pending because the
available Computer Use surfaces cannot operate the owned emulator, and no
physical-phone result has arrived. Resume that check when usable device access
or concrete phone feedback is available. PDF remains a documented unresolved
branch.

The active bounded UI unit restores the original Settings navigation, search and
Appearance/Chat pages around the existing real Herdr preferences. Its complete
flow is existing window, Settings, an implemented control, persisted change and
authoritative readback, then return to the same window. Share the original
presentation while keeping original Provider/OpenCode stores in their existing
wrapper. Search must list only supported controls and reach their real anchors.
Preserve draft/conflict handling, automatic save after a change, explicit retry,
surface-specific Enter behavior
and mobile inner Back before closing Settings. Add no preference family,
provider page, default change or native workaround. Validate that round trip
through a separate owned build/runtime, preserving this live static directory,
the original default connection and the first phone-test APK. Full Settings
parity and native acceptance remain unfinished. The earlier planning phrase
"manual save" was incorrect: `HerdrPreferencesController.change` already starts
its serialized save. This unit preserves that behavior and the explicit
refresh required after a conflict.

Settings surface scope: the Herdr Web/PWA and hosted-mobile entrypoints share
the existing per-instance preferences owner and original navigation/search
presentation. Herdr Capacitor Android and iOS bundle the same controller with
their existing native Back/lifecycle integration; hardware Back and device
execution require separate acceptance. Original Web and Electron retain their
Settings domain stores, page dispatch and runtime APIs around the extracted
presentation. Original hosted and Capacitor mobile retain those controllers and
the existing mobile page stages. Original VS Code retains its runtime-specific
Settings controller and availability; the dedicated Herdr app is not mounted
there. This unit adds no server route, native bridge, credential store or
Provider configuration.

The Settings presentation and bounded preferences flow are implemented. The
original wrapper and Herdr adapter share `SettingsViewPresentation` and the pure
search index; original domain initialization stays with `SettingsView`. The
focused and retained checks pass 58 cases, the final combined static gate and
original Web/Herdr/Android builds pass, and 20 actual public HTTP requests verify
preference persistence, conflict refusal, restoration and default-socket window
identity. The new APK packages `herdr-CXWKWYR7.js`. Actual Settings browser
interaction remains unexecuted because Chrome returned `ERR_BLOCKED_BY_CLIENT`
for both the new public origin and its loopback address. Keep those browser
checks and native acceptance pending. Do not change browser protection or
substitute API results for UI acceptance. Existing CF instances, phone connection
and fixed first-test APK are preserved. Current evidence is in STATUS.md and
native validation; full feature/UI parity remains unfinished.

Runtime scope for this increment: browser and hosted mobile use manual pairing
and saved origins; OpenHerdr Capacitor Android also exposes the registered native
scanner and precise app-link intake. OpenHerdr Capacitor iOS keeps its vault and
app-link intake but has no scanner in its current SwiftPM build. The original
OpenChamber Capacitor wrappers retain their own protocol and scanner behavior.
Electron and VS Code retain the original application and do not acquire an
OpenHerdr credential or native scanner path. Existing server-side pairing and
enterprise network policy continue to enforce the same exposure boundary.

Upstream OpenChamber is MIT licensed, baseline `c5b690df9`. Keep the license and original application. OpenHerdr is an independent entrypoint inside `packages/web`; sharing UI primitives does not require OpenCode to run. Existing OpenCode-specific functions remain part of the upstream application and must not be advertised as supported for arbitrary Herdr agents without an implementation.

Before resuming work, read this file and `docs/openherdr/STATUS.md`. Root AGENTS.md and the user's global instructions apply. The user explicitly authorizes Git iteration and autonomous implementation. The user now explicitly authorizes a public source repository and the requested GitHub first-test APK prerelease. Store/stable app releases, changes to shared services or credentials, and stopping unrelated agents remain outside this task.

## Current UI correction and source publication

The user supplied an Android OpenChamber screenshot and explicitly noted that
the current UI differs too much. Visual and interaction fidelity is the current
priority. The initial pause on additional backend families protected restoration
of the original chat, composer, session navigation and workspace screens. These
core screens now have connected presentation; necessary Files metadata and raw
transport proceed inside the existing Files family. Keep the remaining parity
work focused on complete user flows. A shared header or primitive count does not
establish UI parity.

The reference shows the original compact session header, right-aligned user
bubbles with long-message expansion, unboxed assistant text, compact inline
tool summaries and a floating rounded composer containing active-turn status,
model/agent-mode controls and send/stop actions. Reuse/extract the original
presentation and maintain real source actions and unknown-state behavior.
Font appearance follows the app/system font preference; the screenshot's phone
status bar and unrelated OS overlay are not application controls.

The supplied reference contains private conversation text. Keep it in local
ignored validation materials and never include it in a public source commit.
The authorized public repository is `xixilys/openherdr`; verify its creation
and pushed branch before claiming published source. dot/Astra may review or
receive disjoint UI work through the already-authorized peer channel. Delivery
receipts remain separate from substantive agreement and actual dispatch.

## Architecture

- `packages/web/server/herdr/`: Herdr bridge, HTTP API and authentication. Its server starts independently of the OpenCode server.
- `packages/web/src/herdr/`: responsive UI and parsed transport contracts. Use the actual shared OpenChamber primitives, typography and theme tokens.
- `packages/web/herdr.html` and `vite.herdr.config.ts`: separate web/PWA build, output `packages/web/dist-herdr`.
- `packages/web/bin/openherdr.js`: CLI lifecycle, pairing, Cloudflare and SSH instructions/transport.
- `plugins/openherdr/`: native Herdr workflow plugin manifest/actions, following the installed Herdr protocol.
- Android is the primary app, using the separate Capacitor application identifier `dev.openherdr.mobile`. Reuse the original Android shell and native behavior where applicable. The browser app is a supporting runtime; existing iOS artifacts remain auxiliary.

## API contract for parallel implementation

Application JSON data routes use bearer authentication, including loopback.
Exact-file asset GET/HEAD additionally accept their narrow opaque capability
path; mint, renewal and release still require the owning bearer. Do not accept
bearer tokens in query strings. JSON errors have `{error:{code,message}}`. No
failed read becomes a valid empty list.

- `GET /health`: public minimal `{ok:true,app:"openherdr",version:"0.1.0"}`.
- `POST /api/pairing/redeem`: public JSON `{pairingId,secret,deviceName?}` -> `{token,client}`. Rate limited. A one-time secret arrives in the URL fragment and the UI removes it before exchanging it. Credentials are scoped to OpenHerdr's own state directory.
- `GET /api/herdr/info`: `{app,version,session,capabilities}`.
- `GET /api/herdr/machines`: `{machines:[{id,label}],session}`; local target is `{id:"local",label:"Local"}` and saved machine IDs come from `herdr machine list --json`.
- `POST /api/herdr/rpc`: `{machine:"local"|savedProfileId,method,params,requestId?}` -> upstream Herdr `{id,result}`. Strict server-side method/parameter allowlist. Mutation request IDs are required, recorded before dispatch, never replayed on unknown outcome. User-visible target is machine/session/pane together. Local uses the server-configured session; remote uses the saved profile's session. No browser-supplied SSH command, socket path or arbitrary session.
- Initial allowed methods: `session.snapshot`, workspace list/create/rename/close, tab list/create/rename/close, pane list/read/send_input/send_keys/split/close, agent list/start/prompt/rename, worktree list. Inspect installed schema for exact names/params before implementation. `pane.resize` changes desktop splits; do not map viewport changes to it.
- `GET /api/herdr/clients` and `DELETE /api/herdr/clients/:id`: device inspection/revocation. Credentials are never returned by list.
- Herdr output uses official read-only terminal observation frames rendered by Ghostty, with revisioned bounded text reads as fallback. Observation does not acquire the exclusive terminal controller. Poll only visible active pane, pause hidden views, cancel stale requests on machine/pane change, and back off failures.
- Main-thread follow-up may add pane-scoped read-only `/api/herdr/files` and `/api/herdr/git`; these must resolve authoritative pane cwd and confine file access to it. UI can add these after the contract is implemented.

The current increment adds `POST /api/herdr/host` with a strict
`{request,requestId?}` envelope for Files/Git. Mutations require a unique request
ID, a pinned server-resolved root and the applicable file revision. Local and
saved SSH hosts use the same typed helper. The original read-only routes remain
available for older clients. `POST /api/herdr/conversations/*` implements the
local OpenCode source contract, including independent saved-history reads and
explicit rebind. Neither route accepts an engine URL, SSH command, credential
or browser-selected filesystem root. Detailed contracts and current validation
are in the owning server documentation and
`docs/openherdr/CONVERSATION_DRIVER.md`.

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

Main Codex chat `01a13b81-92a9-7f52-95c6-ac4bb6ee6cc8`; MCP peer
`codex-openherdr-20261014`. Dot peer `dot-dac-dse` explicitly accepted the
read-only cloud Android UI comparison and returned its substantive source review
in messages `ebcabf84-8e6d-46cf-9b8b-c2d34577e6eb` and
`2cdc1c8b-0a23-49cc-af21-d7c21ee77132`. It compared the published integration
with the original baseline. The actual reviewer model remains unconfirmed.
This was source review, with no Android runtime acceptance or overlapping writes.

The UI integration revision `556d2e9be` is committed locally on `openherdr/main`
and verified on public `xixilys/openherdr` main. The original `origin` still
points at OpenChamber; the public source remote is `openherdr`. Dot received
the repository/revision and the UI correction in message
`3ae575c8-b47c-4450-8a30-26ae598642c1`. Dot's returned findings informed the
shared presentation, request dock and composer-state corrections. Continue the
remaining original-presentation work before expanding backend feature families.
The current shared UI has real HTTPS browser validation, a rebuilt Android APK
and an observed native connection screen. The subsequent presentation increment
shares shell/diff output, attachment/image previews and the original stepped
form flow. Native connected-chat interaction, source-owned child controls,
diagnostic actions and full feature parity remain unfinished. Current-file
navigation has since passed the browser flow recorded below.
Dot was sent the prior source and validation limits in message
`d681f1e0-9177-42de-80b4-5903ee7fc2a4`; this follow-up is stored, with reading
unconfirmed. The owning default bridge was restarted on the current code and
its new HTTPS path passed health, bearer rejection and an authenticated default
Herdr snapshot. Only the verification client was revoked afterward.
The default runtime uses port 4318;
4310 belongs to QQ. `docs/openherdr/STATUS.md` records runtime validation and
remaining feature/native limits.

The shared tool, attachment and stepped-form increment is committed at
`965f2f346` and verified on public main. Its current browser build displayed a
real owned-fixture edit diff and a saved inline attachment. The rebuilt APK
displays Connect; connected native interaction remains unverified. Browser
download completion and exact native startup readiness remain unknown.
Dot received the source/validation update in message
`d4082711-b2cd-4bc8-8b0b-028522e32f15`; storage was accepted, reading is unconfirmed.

The current file-navigation increment connects a bound chat tool's current
project file to the original mobile Files browser presentation, existing manual
editor and Changes view. The actual HTTPS browser flow returned to the same
chat with its draft and reading position. The original wrapper retains its
OpenCode controller. Herdr file actions capture the server, machine, pane
identity, conversation, root and relative file path. Saved history and paths
outside that root cannot borrow the active pane. A real saved-SSH fixture also
verified the corrected untracked-file addition diff. The rebuilt APK packages
`herdr-BDGqP9Kp.js` and has not received native interaction acceptance.
Complete editor and Git parity remain later work.

The file-navigation source is committed at `0d2415a30` and verified on public
main. Dot's update `bb75e874-dd29-4305-a958-a61fc7eec032` was stored; reading and
another review are unconfirmed. The refreshed default bridge serves the current
asset, passed authenticated snapshot/revocation checks, and sent no terminal input.

The expanded-composer source now shares the original CodeMirror editor, mobile
keyboard shell, viewport pin and frame. Its actual browser flow includes
multiline input, collapse/return, one real response and preserved old-message
reading position. The rebuilt APK packages `herdr-CF2mEnjj.js` with no native
interactive acceptance yet. Fullscreen editing and autocomplete remain in scope.
The current increment restores native `/` command selection and submission
through the original autocomplete presentation. Load commands only when the
picker or slash submission needs them, using the selected conversation's real
coordinator and directory. Submission checks commands first, then skills, then
ordinary text, preserving attachments, delivery and the captured draft revision.
Failed registry reads retain the draft. Unknown mutation outcomes remain locked.
The actual 412x915 HTTPS browser selected and executed one harmless native command
with an argument, showed its expanded template and one real reply, and cleared
the sent draft. The current APK packages `herdr-CIO7wjLL.js`; it has no native
interactive acceptance. The separate `$` picker and other original composer
actions remain in scope.

Native conversation identity and read-only Codex history remain required, but
the current Herdr panes expose no verified session reference. A matching cwd
does not authorize a binding. Resume that branch when an authoritative reference
or an explicitly owned native fixture is available. Original mobile source has
no fullscreen control in its footer, so do not add one by guessing. Keep this
work tied to the full Android experience; do not extend the tool-detail branch
into an open-ended series of small display tests.

The bounded native Codex fixture on 2026-10-15 started one new agent in a separate
named Herdr session. The human explicitly approved Codex's repository trust
prompt. One short marker request completed, but neither `agent.get` nor
`session.snapshot` published `agent_session`. The owned session was then stopped.
The installed Codex integration reports not installed. Its bundled v8 hook
reports the real `SessionStart.session_id` to Herdr and requires a non-empty
`transcript_path`; compatibility with this Codex version remains untested.
The official script and installation effects have been prepared for review,
and the existing user configuration has a private backup. The human separately
authorized installation and normal hook trust. They remain deferred while the
existing-task monitoring path is checked. Keep the transcript reader
unimplemented until a real identity is available.

The expired-device recovery follow-up uses the shared Welcome notice and keeps
same-origin window/chat state while replacing its transport. Real test CF
revocation and explicit pairing returned to Kansas `w2:p2`; the final asset
`herdr-D8G2xhGi.js` restored its saved binding on reload. It passes 78 focused
cases and the final static gate. The rebuilt APK has exact web-asset readback,
with native interaction still unverified. Details and per-build limits are in
STATUS.md and the native validation document. That revision started at Local
after a cold page reload. The current cold-window increment adds persisted
target selection independently of credential recovery.

## Validation and safe experiments

The current monitor increment makes existing Herdr windows the default and
keeps CF pairing as its primary remote path. Real public HTTPS checks and a
412x915 browser read Local, WSL, JP API and Kansas, including ordinary Kansas
dashboards. The browser restored its saved binding on reload. A successful-frame
status/resize loop found in this flow was repaired and rechecked. The current
monitoring APK packaged `herdr-BLLJAMLv.js`, with exact web HTML/entry readback, but had no
native interactive acceptance. Current evidence and limits are in STATUS.md
and `packages/mobile/openherdr/VALIDATION.md`.

The following connection increment shares the original Welcome and saved rows,
adds explicit Android scan intake and repairs confirmation/persistence races.
Actual CF browser re-entry, invalid protocol, locale, saved selection, Cancel
and reload checks passed without issuing another credential or sending input.
The APK now packages `herdr-4D0XehLa.js`, 40,701,131 bytes, with bundled scanner
models and exact web asset readback. Building used the existing working NDK
27.1 via a task-owned init script because the default NDK 27.0 is partial.
Camera and native vault/Back acceptance remain unperformed; iOS scanner remains
unsupported in its SwiftPM project. Continue the broader Android goal from
these limits, keeping existing-window monitoring and CF binding primary.

Use a new named Herdr session `openherdr-test`, explicit returned IDs and an owned fixture directory. Never send input to existing user panes. Check actual phone-sized browser rendering and real HTTP input/output through the installed Herdr API. Verify unauthenticated rejection, invalid origin, one-use pairing, revoke, target switching and unknown mutation receipts. Test a real remote connection path when available. Native compile, simulator validation and physical-phone validation are distinct claims.
