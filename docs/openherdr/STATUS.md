# OpenHerdr status

## Current goal and UI correction

Android is the primary deliverable. The human requests the complete OpenChamber
feature and UI experience with Herdr. The latest supplied Android screenshot
shows that the current standalone chat/composer still differs substantially.
Original presentation and interaction fidelity now takes priority over adding
more backend feature families. The reference image contains private chat text
and is kept outside published source. See OPENHERDR.md and UI_PARITY_MAP.md.

The current implementation is a functional integration increment. It does not
establish complete UI or feature parity. The original OpenChamber entrypoint
is retained. Public `xixilys/openherdr` hosts the development source. The first
published integration revision was `c1b07b395`. The current chat presentation
iteration follows that baseline; complete native interaction remains pending.
The shared tool/attachment/form source increment is `965f2f346`, verified on
public main. The file-navigation increment is published at `0d2415a30`. It serves
`herdr-BDGqP9Kp.js` in its historical APK. The expanded-composer increment used
`herdr-CF2mEnjj.js`. The current slash increment serves and packages
`herdr-CIO7wjLL.js`.

## Integrated source

- Original mobile header/drawers, right-aligned user bubbles, two-line long
  message expansion, inline tool summaries, floating pill composer and title
  session popup are shared with the original OpenCode wrappers. The original
  CodeMirror composer and mobile keyboard hooks now provide tap-to-expand,
  multiline input, collapse and picker focus handoff. The original wrapper and
  Herdr share the same opaque editor frame; request docks move with its form. Herdr retains
  its own source controller and actual mutations. Themes, typography and native
  Back/lifecycle helpers remain shared. Full interaction fidelity is pending.
- Tool details reuse original shell input/output, scrolling, highlighting and
  multi-file diff views, including real progress output and failed partial
  results. Attachments reuse original chips, image strips and the image gallery.
  File references load only after a click, through the confined host client.
  Current disk content is labelled separately from inline historical bytes.
  The original stepped form flow retains answers across permission hiding and
  conversation navigation. Field changes invalidate old answers; a late reply
  cannot clear a newer draft after returning to the same conversation.
- The original mobile Files browser presentation now serves both wrappers. A
  bound chat tool can open its current project file, browse/search, edit and
  save manually, inspect Changes, then return to the same chat. File navigation
  captures the conversation and host identity and refuses stale or unrelated
  roots. Saved history cannot borrow the active pane.
- Local and saved-SSH Files/Git provide real manual editing, revision conflict
  refusal, uploads/downloads, status/diff, stage/unstage, commits, branches and
  checkout. Single untracked text files now show an addition patch in Changes.
  Native Herdr worktree create/open/remove is connected.
- The local OpenCode 2 driver supplies real messages, streaming, model/agent
  selection, permissions/forms, attachments, history and explicit rebind.
  Existing native sessions remain read-only when a verified binding exists.
  The current slash increment shares the original command-list presentation.
  Its registry is loaded on demand for the selected conversation and directory.
  Submission checks native commands, then skills, then ordinary text, keeping
  attachments, delivery and the captured draft revision. Required lookup
  failures preserve the draft. The separate `$` picker is not integrated yet.
- Application preferences retain profile/per-surface scope, actual selected
  themes, font settings and original Android send-key behavior. Passive
  refresh does not resolve a settings conflict. Remote fonts require a current
  successful policy response.
- Notes, Todo and personal plans persist in the private OpenHerdr state.
  Native worktrees share their repository context. Ordinary workspaces need
  a trusted registered project root and otherwise return an explicit error.
- Android includes file sharing/image paste, precise pairing-link intake and
  secure credential storage. Bridge logging is disabled to avoid logging
  secure-storage payloads. These source paths have separate runtime limits below.

## Current validation

- Real saved WSL SSH fixtures passed text/binary file operations, stale revision
  refusal and Git stage/unstage/commit/history/branch/checkout. Native local
  worktree create/open, dirty-removal refusal and removal passed.
- A real OpenCode 2.0.27 owned fixture passed one short model response, SSE,
  cold history recovery, permission and form operations. User panes and
  provider configuration were preserved. A matching cwd alone never established
  native session ownership.
- An isolated public HTTPS bridge passed bearer rejection, real Herdr pane
  resolution, file write/read, duplicate refusal, conversation create/history/
  rename/read and terminal input/output. The terminal marker appeared exactly
  once. Receipts exclude conversation and project-context content.
- Through the rendered browser editor, a fixture file was edited and saved;
  disk readback matched. The actual original diff renderer displayed the change.
  Latest mobile-width source now opens the original header and drawers.
- The restored chat ran one bounded real model request through the public HTTPS
  bridge. It displayed the actual shell marker, tool duration, Markdown table
  and code block. Tool details and long-message expansion/collapse were exercised.
  On the final web build, keyboard scrolling exposed the original return-to-latest
  action; clicking it returned to the measured end of the transcript.
  An isolated Herdr session restart required explicit history rebind; the saved
  conversation remained available. A transient event disconnect cleared after
  recovery. These are browser checks.
- On the latest browser build, a new bounded request read and edited one
  disposable fixture file. The tool row displayed the actual before/after diff;
  unified and side-by-side modes both worked. Disk readback matched the new line.
  An unbound saved conversation opened its real inline text attachment without
  borrowing the active pane. Its marker rendered correctly. Clicking Download
  produced no application error, but the browser download event timed out and
  no file appeared in the known default Downloads directory. Download completion
  remains unknown; the action was not repeated.
- The latest HTTPS browser flow opened a file from a real owned-conversation
  tool record. An unsaved edit survived closing and reopening the workspace;
  disk bytes changed only after Save. Directory navigation/search and the
  untracked-file addition diff worked. Returning to chat retained its title,
  unsent draft and measured reading position of 533.5 pixels. Screenshots are
  `assets/file-browser.jpg`, `assets/file-editor.jpg` and `assets/file-changes.jpg`.
- A new disposable WSL workspace passed write/read and untracked-file diff
  through the saved SSH profile. Staged diff stayed empty. The exact workspace
  and marked temporary directory were removed afterward. Final local tests
  also compare owner/group/other executable bits against actual Git index modes.
- The file-navigation increment passes 22 UI tests across 4 suites, 24 tool/path
  helper tests with 92 assertions and 13 host-operation tests. Independent
  source review found no blocking issue; its executable-bit correction is
  included in the final host tests. These checks do not establish native UI use.
- The expanded-composer HTTPS browser flow passed tap focus, Unicode/multiline
  input, mobile Enter newline, model-picker return, collapse/reopen and workspace
  return with the draft retained. Reading old messages stayed at 80 pixels across
  workspace navigation. One bounded request returned `OPENHERDR_EXPANDED_INPUT_OK`;
  its prompt and reply each appeared once, and the sent draft cleared. Arabic
  RTL layout was checked and the original language/viewport restored. Public
  captures are `assets/composer-expanded.jpg` and `assets/composer-response.jpg`.
- The composer increment passes 9 controller tests, 1 shared-frame test, 6 pure
  pill tests, 8 original-pill tests and the existing conversation/files scenarios.
  Independent review caught an attachment callback retaining an old disabled
  state after returning from Files. Its new regression failed before the local
  callback correction and passed afterward. Final review has no remaining P1/P2.
- The current DOM integration check covers stream failure/recovery, viewport
  changes, reader position, return to latest, permission-before-form docking and
  retaining a form answer while a permission temporarily hides it. Shared
  composer checks separate running, queue and abort capability. Import checks
  reject accidental initialization of the original OpenCode runtime.
  The focused shared presentation suites pass 32 tests and 188 assertions.
- The current tool/form/attachment adapter and conversation integration run
  passes 29 tests across 4 suites. It covers source output, field updates,
  disabled/unknown response locks, same-owner draft recovery, attachment bytes,
  source changes, late results and zero legacy runtime initialization. Shared
  gallery tests cover Back-layer registration, image navigation through equal
  source refreshes and RTL keys. Fifty file-reference views issue no download
  on mount; clicking one issues one request, including repeated loading clicks.
  These are DOM and fixture checks, separate from the actual browser checks.
- Focused HTTP checks pass 35/35. New preference/project-context service and
  client checks pass, including same-pane project changes, draft retention and
  delayed reads after a confirmed write. Independent review verified those
  corrections. Standalone Herdr imports and real Markdown rendering issue no
  legacy OpenCode initialization requests.
- The slash backend passes 23 service tests and 36 HTTP tests. Independent
  review found a native-writer takeover during registry lookup; both affected
  send paths now recheck before dispatch and the regression confirms zero sends.
  An actual public HTTPS read found the fixture command in its owned session,
  omitted private skill fields, rejected a stale target and rejected a revoked
  temporary client. That read sent no model request or terminal input.
- The 412x915 HTTPS browser selected the native fixture command with
  Enter, retained draft/focus after Escape, and sent it once with an argument.
  The transcript contains one expanded native template and one actual
  `OPENHERDR_NATIVE_COMMAND_OK ARGUMENT_E2E_OK` response. The sent draft cleared.
  The editor label followed an Arabic/English round trip while retaining its
  draft; English, the empty draft and normal viewport were restored afterward.
  Captures are `assets/command-picker.png` and `assets/command-response.png`.
  Focused checks pass 14 composer, 17 slash-controller, 8 original command-ranking
  and 3 editor-property tests. Independent source review has no remaining P1/P2.
  The command executed on `herdr-CcyH2USZ.js`. After the final gate fixes,
  `herdr-CIO7wjLL.js` reloaded the same real reply and native candidate without
  another model request; its temporary draft was cleared.
- Combined type-check, lint, dead-code and anti-slop checks passed. The web
  build and Android debug build succeeded. The Android build command now
  rebuilds web source before copying it, so it cannot silently package an old UI.
- The owned Android API 36 emulator installed and launched versionCode 2. The
  actual connection screen showed a blank server field. The Android 15+
  system-bar backdrop/contrast correction has source review and a rebuilt APK.
  Latest runtime screenshots and remaining interaction checks are recorded in
  packages/mobile/openherdr/VALIDATION.md.
  That native sample used `herdr-BEKetIzv.js`. The latest file-navigation APK
  packages `herdr-BDGqP9Kp.js`; its HTML matches the web build byte for byte.
  That file-navigation APK was not installed or interactively tested on Android.
  The previous expanded-composer APK packaged `herdr-CF2mEnjj.js` at 15,738,094
  bytes. The current slash APK packages `herdr-CIO7wjLL.js` at 17,136,001 bytes;
  its HTML and entry asset exactly match the current web build. It has not been
  installed or interactively accepted on Android. Web build, native asset
  preparation and Capacitor sync passed. Reusing the isolated Gradle home,
  project cache and copied read-only dependency cache built offline in 10 seconds,
  with 213 tasks, 27 executed and 186 up-to-date. No shared cache or mount changed.
  The earlier filesystem-enumeration hang and shared-cache failure remain in
  the expanded-composer build logs.
  One cold-start sample of the older build returned Activity success in 5.246 seconds, still showed
  a blank loading frame at 7.573 seconds, and displayed Connect in a later capture
  within 29 seconds. The exact visible-ready time and cause remain unknown.

Computer Use cannot currently operate the emulator's standalone Qt window.
The official Android Studio route did not expose it. Only task-created IDE
instances were stopped. Native pairing, secure-vault write/relaunch, Back,
keyboard, rotation, reconnect and sharing have not passed interactive acceptance.
Browser checks and APK compilation do not replace that acceptance.

## Remaining work

The current UI iteration validates the restored chat/composer and session
interaction against the human's reference. Browser checks have exercised
actual model/agent selection, title popup, new-session creation and long-message
collapse. A catalog-enabled Luna selection was rejected by the provider group;
that failure remains in its owned fixture. The configured default model then
completed the bounded tool/Markdown check. Chrome's extension lacks file-URL
access, so its actual attachment upload remains blocked. No private reference image or
synthetic transcript is used as functional proof.
The latest historical inline attachment preview passed; the latest browser
download has no confirmed disk receipt. Native sharing remains unverified.

Remote structured drivers, Codex/Claude adapters, ordinary project registration,
provider/MCP/plugin configuration, schedules/agent memory, notifications/voice,
multirun, isolated spaces, extensions and source-control review remain in scope.
Claude's selected local launcher is currently unavailable and was not repaired
by changing providers or credentials. Full native/physical-phone validation,
release signing and store distribution remain unverified or unperformed.

Dot accepted the read-only cloud Android UI comparison and returned substantive
source findings against the published integration. They cover composer state,
selected-conversation navigation, message expansion, tool presentation, request
docks and native interaction. The current integration addresses navigation,
message-level expansion, independent running/queue/abort controls and dock
priority. Native interaction and the remaining tool-specific views still need
work. Shared shell/diff output, attachment previews and stepped forms have since
been integrated, and current-file navigation now has actual browser acceptance.
Source-owned child/background controls, diagnostics and persistent JSON display
choices remain unfinished. Full editor and Git interaction parity also remains. The reviewer's actual model is unconfirmed; no Android runtime acceptance
was claimed by that review.

The historical terminal baseline was committed at `9991c6f8d`; its validations
remain in validation.json. It is not the current full-replication result. The
default owned bridge remains distinct from the isolated acceptance instance.
Existing user Herdr panes, agents and unrelated services remain preserved.
The default bridge now runs the current server code on port 4318. Its renewed
Cloudflare path passed public health, unauthenticated rejection and an
authenticated snapshot of the real default Herdr session. This check sent no
terminal input; its temporary client was revoked and a subsequent request with
that token returned 401. The current web asset was fetched through the public
path. Source review and UI findings
were reported back to dot with revision `556d2e9be`; receipt of that follow-up
does not establish a further review.
The subsequent tool/attachment/form source and validation limits were sent in
message `d4082711-b2cd-4bc8-8b0b-028522e32f15`. Storage acceptance is confirmed;
reading and another review are unconfirmed.

The file-navigation source and runtime limits were sent to dot in message
`bb75e874-dd29-4305-a958-a61fc7eec032`. Storage acceptance is confirmed;
reading and another review are unconfirmed. The current UI increment restores
the original pill-to-expanded composer interaction, with shared input editing
and presentation. The slash increment now adds native command autocomplete and
the original command/skill/plain send routing. The separate `$` picker, agent
and file autocomplete, remaining original editing actions and native connected
interaction remain unfinished.

The old task Gradle daemon remained in the operating system's exiting state
and retained its shared journal lock after cancellation. The successful build
used isolated caches. The build logs and process diagnostics are retained in
`.tmp/`; no claim is made that the original Gradle environment recovered.

The slash increment's final combined gate passed in
`.tmp/check-slash-release-v3.log`. The first runs found test typing/lint issues,
two new code-rule findings and a damaged shared Knip cache. The source issues
were corrected; the same pinned Knip 5.80.0 ran from a task-owned temporary cache.
No project dependency or shared cache was changed. The current default bridge
serves `herdr-CIO7wjLL.js` on port 4318 and passed public health, bearer rejection,
authenticated snapshot, temporary-client revocation and post-revocation rejection.
That check sent no terminal input.
