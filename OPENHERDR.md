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

Upstream OpenChamber is MIT licensed, baseline `c5b690df9`. Keep the license and original application. OpenHerdr is an independent entrypoint inside `packages/web`; sharing UI primitives does not require OpenCode to run. Existing OpenCode-specific functions remain part of the upstream application and must not be advertised as supported for arbitrary Herdr agents without an implementation.

Before resuming work, read this file and `docs/openherdr/STATUS.md`. Root AGENTS.md and the user's global instructions apply. The user explicitly authorizes Git iteration and autonomous implementation. The user now explicitly authorizes a public source repository. Store/app releases, changes to shared services or credentials, and stopping unrelated agents remain outside this task.

## Current UI correction and source publication

The user supplied an Android OpenChamber screenshot and explicitly noted that
the current UI differs too much. Visual and interaction fidelity is the current
priority. Keep functional adapters, but pause expansion into additional backend
feature families while the original chat, composer, session navigation and
workspace screens are restored. A shared header or primitive count does not
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

## Validation and safe experiments

The current monitor increment makes existing Herdr windows the default and
keeps CF pairing as its primary remote path. Real public HTTPS checks and a
412x915 browser read Local, WSL, JP API and Kansas, including ordinary Kansas
dashboards. The browser restored its saved binding on reload. A successful-frame
status/resize loop found in this flow was repaired and rechecked. The current
APK packages `herdr-BLLJAMLv.js`, with exact web HTML/entry readback, but has no
native interactive acceptance. Current evidence and limits are in STATUS.md
and `packages/mobile/openherdr/VALIDATION.md`.

Use a new named Herdr session `openherdr-test`, explicit returned IDs and an owned fixture directory. Never send input to existing user panes. Check actual phone-sized browser rendering and real HTTP input/output through the installed Herdr API. Verify unauthenticated rejection, invalid origin, one-use pairing, revoke, target switching and unknown mutation receipts. Test a real remote connection path when available. Native compile, simulator validation and physical-phone validation are distinct claims.
