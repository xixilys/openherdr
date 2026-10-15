# OpenHerdr status

## Current goal and UI correction

Android is the primary deliverable. The latest human clarification prioritizes
viewing windows already open in each saved machine's Herdr service, including
their reported state and recent output. Navigation follows workspace, tab and
pane, including ordinary monitoring panes, and needs no Codex process binding.
Existing-window discovery and monitoring now
take priority over new conversations and further composer features. The complete
OpenChamber feature and UI experience remains in scope. The earlier Android screenshot
shows that the current standalone chat/composer still differs substantially.
Preserve original presentation and interaction fidelity while adapting the
existing-task monitoring flow. The reference image contains private chat text
and is kept outside published source. See OPENHERDR.md and UI_PARITY_MAP.md.

Cloudflare binding remains a required primary flow for access outside the local
network. The monitor continues through the paired HTTPS transport. Public-path
validation is required alongside local and saved-SSH reads. Quick Tunnel restart
changes its origin; persistent named-tunnel parity is still unfinished.

The current implementation is a functional integration increment. It does not
establish complete UI or feature parity. The original OpenChamber entrypoint
is retained. Public `xixilys/openherdr` hosts the development source. The first
published integration revision was `c1b07b395`. The current chat presentation
iteration follows that baseline; complete native interaction remains pending.
The shared tool/attachment/form source increment is `965f2f346`, verified on
public main. The file-navigation increment is published at `0d2415a30`. It serves
`herdr-BDGqP9Kp.js` in its historical APK. The expanded-composer increment used
`herdr-CF2mEnjj.js`. The previously published slash increment served and packaged
`herdr-CIO7wjLL.js`.

## Binary Files transport and previews

Files now describes the selected file before attempting a capped text read.
Images, media and fonts reuse the original presentation. PDF retains the original
iframe path, with its application-level rendering gap recorded below. Unknown
binary files and failed media show the original download fallback. The original
phone Files view has no application fullscreen button, so none was added.

Exact-file capabilities bind the issuing paired client, saved-machine profile,
pane terminal, canonical root and metadata version. The bearer stays out of
resource URLs. GET/HEAD support single ranges, bounded streaming, backpressure,
explicit release, expiry, device revocation and shutdown cancellation. A request
checks its captured target before headers and again before completing; this
detects ordinary edits and replacements without promising an immutable snapshot
or continuous pane polling. Browser downloads acquire a separate capability.
Native File/base64 sharing keeps the existing 8 MiB host limit.

The core transport suite passes 19 cases, the independent HTTP suite covers 30
cases, and existing server regression checks pass 37 cases. Independent UI checks
pass 41 cases; the retained Files/editor/text-preview checks, 7 asset-client
cases, 5 preview-leaf cases and 6 shared-media lifecycle cases also pass.
The final combined type/lint/Knip/anti-slop gate passes. Test logs retain the
initial failures and targeted corrections. A real SSH tail read exposed Node's
child-exit stdout auto-drain; the corrected reader preserves its readable
listener through final validation. The same saved WSL fixture then returned
exact tail, suffix and complete-font bytes. Evidence is in
`.tmp/asset-transport-maintenance.log`, `.tmp/binary-assets-http-final.log`,
`.tmp/binary-assets-http-deadline.log`, `.tmp/binary-assets-ui-test-final.log`,
`.tmp/binary-assets-ssh-evidence/followup.json` and
`.tmp/check-binary-assets-publication-final.log`.

A separate task-owned CF test service passed 63 serial HTTP checks across local
and saved-WSL files, including whole/range/HEAD/416 reads, MIME and safety headers,
expired/released/invalid capabilities and client revocation. The 412x915 CF
browser decoded local and WSL images, played a 180-second WAV larger than 8 MiB
on both hosts, sought the local WAV, decoded and played WebM, displayed a font
specimen, and showed broken-media and unsupported-binary fallbacks. Hiding Files
removed the active media elements; the shared media component additionally
pauses, clears src and releases its old element, including StrictMode ref replay.
These browser results establish neither native engine behavior nor completed
download saving. Private receipts and screenshots are under
`.tmp/binary-assets-public-http.json` and `.tmp/binary-assets-browser/`.

PDF bytes and response headers match the owned valid two-page fixture over CF,
but the application iframe remains blank on local and WSL selections. A bounded
loopback A/B showed the same PDF pages with the frozen CSP and without it, and
the frozen-CSP version also displayed at phone width. This rules out treating
the CSP alone as the established cause. Source reviews found no PDF-specific
denial or normal polling-induced lease replacement. The actual cause remains
unknown; PDF application preview is unfinished and its CSP was retained.
The diagnostic process stopped after the comparison.

The existing default bridge/CF origin, user workers and fixed first phone-test
APK remain available. The new server contract is exercised on the isolated test
service; the default running backend has not been restarted into this revision.
Android PDF pages, codecs, seek, Back, sharing, process death and background
cleanup remain unverified. Active HTML, canvas and full original feature/UI
parity remain in scope.

Original Web, isolated Herdr Web and Android packaging pass. The final debug APK
is 42,312,910 bytes with `herdr-9BIfPY0f.js`; its HTML and entry bytes exactly
match the final Web output. It has not been installed or exercised on Android.
The paired browser reloaded that exact entry and decoded and played the saved
WSL WebM. Screenshots `assets/binary-image-wsl.png` and
`assets/binary-video-wsl.png` contain only task-owned fixtures. Final artifact
and preserved-default receipts are `.tmp/binary-assets-apk.json` and
`.tmp/binary-assets-runtime-final.json`. The first-phone prerelease remains the
older fixed APK. This new APK needs the matching new backend for its Files
contract; it is not a drop-in Files upgrade for the still-running old backend.

## Previous text artifact preview increment

Files now reuses the original Markdown, JSON/JSONC/GeoJSON, SVG, Mermaid and
CSV/TSV previews and controls. Each document retains its text draft and chosen
source/preview mode. Specialized previews show saved content; generic code
preview shows the current draft. JSON5 keeps the original strict-parser error.
Markdown includes rendered Find, safe raw HTML, heading navigation, picture/
srcset images and confined local-file links. Its host adapter captures the
paired server, machine, pane, canonical root and document. It never falls back
to the original file runtime or reads beyond the selected root.

Hidden, replaced and invalid-root previews cancel image reads and retire their
object URLs. Live identity checks also reject completions before passive
cleanup during an auth-transport replacement. A recovered image clears only
its matching obsolete error. The original runtime adapter keeps its existing
outside-workspace policy, deadline and size limit. The shared image viewer now
retains dimensions when a data-URL load finishes before its initialization
effect; the actual 480x240 SVG can zoom and return to Fit.

Generated Mermaid SVG is cleaned before entering the renderer cache. SVG
elements, references and CSS values are checked; external paint URLs, font
imports and active content are removed. Theme colors, mono text, chart styles,
markers and controls remain. All shared Markdown renderer callers use this
boundary, including original runtime callers. Display and download use the same
clean string. Independent source review found no remaining P1/P2 in this change.

There are 183 passing focused and retained cases: controller/editor/Files 78,
resource bindings and original adapter 16, confined source and host client 42,
generated SVG 23, JSON/raw-HTML/i18n 24. The final combined type/lint/Knip/
anti-slop gate passes. Earlier attempts exposed unsupported test assertion
declarations and a control-character regex lint error; equivalent typed
assertions and explicit character-code validation corrected them. Logs include
`.tmp/text-artifact-controller-final.log`,
`.tmp/text-artifact-bindings-live-scope-final.log`,
`.tmp/file-preview-source-typed-rejections-tests.log`,
`.tmp/mermaid-generated-svg-assertion-final.log` and
`.tmp/check-text-artifacts-final-freeze.log`.

The actual 412x915 paired CF browser passed rendered Markdown search with 30
matches, local pictures, heading/file navigation, full-text CRLF save readback,
JSONC error/save/recovery and quoted CSV editing. A table source draft stayed
out of its saved preview until Save; disk readback retained its BOM and CRLF.
A saved WSL machine supplied a Markdown image that decoded at 480x160 and a
relative Chinese CSV link through the same public connection. The task-owned
remote workspace and marked directory were removed after validation. Evidence
is under `.tmp/artifact-browser/` and `.tmp/artifact-ssh-setup.json`.

The real Chrome renderer also removed a continuous script/iframe/form/input/
javascript-link fixture and the hostile Mermaid external paint/import fixture,
while retaining escaped labels and graph geometry. The combined HTML fixture
exposed a Happy DOM NodeIterator deletion defect, so DOM cases test each unsafe
element independently and the actual Chrome result covers their combination.
No browser network trace was available. Clicking Download SVG did not produce
a tool download event, and browser policy blocks the downloads page. Actual
download completion remains unverified; the real renderer integration tests
check the exact clean download Blob. Screenshots `assets/artifact-markdown-ssh.png`
and `assets/artifact-mermaid.png` contain only task-owned material.

Original Web, Herdr and Android builds pass. The new debug APK is 42,309,073
bytes and contains `herdr-Cz-DRZK5.js`. Its HTML and entry bytes exactly match
the Herdr build. Scanner and secure-storage registrations and 12 native
libraries remain present. Gradle passed in 9 seconds with 245 tasks, 27 executed
and 218 up-to-date. Receipts are `.tmp/text-artifact-apk.json`,
`.tmp/build-web-text-artifacts-release.log`,
`.tmp/build-herdr-text-artifacts-release.log` and
`.tmp/build-text-artifacts-android-final.log`.

Both existing bridge PIDs, ports and CF origins are unchanged. Their public
health routes return 200, unauthenticated private routes return 401, and both
serve the exact final entry bytes. The default page still reads the same Kansas
worker window with `readOnly=true` and `inputmode=none`. See
`.tmp/text-artifact-runtime-public-final.json` and
`.tmp/artifact-browser/default-monitor-identity.json`. No terminal input, model
request, Git mutation or remote file write was used for this browser flow.

This APK has not been installed or interactively tested. The fixed first-phone
APK and public prerelease remain unchanged. Android Back/IME, camera, KeyStore,
process death and physical-phone use remain unverified. Active HTML grants,
binary streaming/PDF/media, canvas/draw.io, fullscreen, comments, autosave and
the wider original feature/UI parity remain unfinished.

## Previous UTF-8 text and code editor increment

Files now shares the original language/theme extensions, Find/Replace, wrapping,
line navigation, open-file menu and full-text code preview. Multiple files keep
independent text drafts. Closing a dirty active or inactive file offers Save,
Discard and Cancel. Confirmed Save closes only the same unchanged document;
later edits, owner/root changes, failures and unknown delivery keep it open.
Drafts normalize to LF and serialize the original preferred LF/CRLF style on
manual Save. Existing revision checks remain in force. No formatter or autosave
is added. Markdown/HTML/JSON/media/canvas artifact previews and the remaining
original editor features stay unfinished.

The actual 412x915 paired CF browser exercised highlighted code, Find/Replace,
undo back to clean, redo, current-draft preview, manual Save, multiple dirty
files, Cancel/Discard/Save-and-close, fresh reopen and external-revision refusal.
The first save's disk readback preserved all 4 CRLF separators, Unicode and no
final newline. An explicit reload adopted the external revision and removed its
obsolete conflict message. File-specific errors stay with their document. A
276,053-byte, 6,002-line file was edited and saved with its complete original
prefix and exact new tail retained. Only the 3 task-owned fixture files changed;
no terminal input, model request or Git mutation was used in this flow.

The first real large-file preview exposed an installed Pierre renderer error
after React recreated an equivalent file object. The shared view now retains
that object until its inputs change and preserves queued connections while the
scroller is initially unavailable. The same complete file now renders, scrolls
to both tail markers, survives wrapping and Edit/Preview changes, and closes and
reopens without a new renderer error. It keeps full text and virtualization.
Arbitrary replacement of a scroller while the same preview stays mounted has
not been tested; current callers remove and recreate the preview with its
scrolling container.

The result is 113 passing cases: host client 26, CodeMirror/extensions/Shiki/
scroll position 19, retained Files 10, retained Changes 23, editor flow 32 and
actual installed Pierre preview 3. The final affected run passed 35 cases.
Independent source review found no remaining P1/P2 in the current caller paths.
The final type/lint/Knip/anti-slop gate passes. Its preceding attempt found only
an unsupported negative assertion type in the new test, corrected without
changing runtime code or assertions' behavior. Logs include
`.tmp/editor-preview-controller-final.log`,
`.tmp/editor-preview-identity-final-typing.log`,
`.tmp/check-editor-final-freeze.log` and `.tmp/editor-final-source-review.md`.

Original Web and Herdr builds pass. The final debug APK is 42,305,988 bytes and
packages `herdr-CMDSuBJY.js`; its HTML and entry bytes exactly match the web build
in `.tmp/editor-apk.json`. Gradle passed in 10 seconds with 245 tasks, 27 executed
and 218 up-to-date, using the existing task cache and NDK 27.1. Logs are
`.tmp/build-web-editor-preview-final.log`,
`.tmp/build-herdr-editor-preview-fix.log` and
`.tmp/build-editor-preview-android-final.log`. The new APK has not been installed
or interactively tested. The fixed first-phone-test APK and public prerelease
remain unchanged.

The default CF page loads the final asset and still displays the same Kansas
Claude US worker window with a real read-only frame. Its terminal textarea has
`readOnly=true` and `inputmode=none`. Both existing bridge PIDs, ports and CF
origins are unchanged. Both public routes return health 200 and unauthenticated
private access 401, and serve the exact final entry bytes. Receipts are
`.tmp/editor-runtime-public-after.json` and
`.tmp/editor-browser/default-monitor-final.json`. Private worker output stays
outside published source. Public captures `assets/code-editor.png` and
`assets/code-preview-large.png` show only task-owned content.

This increment changes no backend operation, provider, remote SSH configuration
or managed Cloudflare setup. Actual Android Back/IME, camera, KeyStore, process
death and physical-phone use remain unverified. Full UI and feature parity
continues beyond this editor flow.

## Previous working-tree Changes increment

Changes now shares the original scrolling file groups, phone diff header,
whitespace control, loading/error/clean states and pinned multiline commit
footer. Working and staged routes stay distinct. Branches and History remain
available through the mode selector. Herdr supplies real host operations and
current-index commit semantics. Generate, Push and discard stay absent because
their host operations are not implemented. Missing line statistics no longer
appear as zeroes. Full editor, Git and original-feature parity remain unfinished.

Navigation, commit text and mutation feedback are scoped to the origin, machine,
pane terminal and canonical root. External diff requests wait for a successful
status read and matching visible owner. Hidden views pause reads and close mode
portals. Back/Escape inside a diff returns to its list. A root change requires
explicit reload. Old acknowledgements cannot refresh a different owner or clear
its draft. Failed and unknown mutations retain the established delivery behavior.

Independent review found a retained mode portal, false zero statistics and an
import-time OpenCode bootstrap through Pierre's comment barrel. Those are fixed.
The comments-enabled original viewer now loads its real session binding on demand;
read-only diffs import pure utilities and do not initialize the original runtime.
A later actual-browser check found that mode selection kept the menu open. It
now closes as in the original, with a targeted regression. Final source review
has no remaining P1/P2.

The result is 63 passing cases: independent Changes 23, shared presentation 8,
original comment binding 2, retained Files 10 and host-client/navigation 20.
The real installed Pierre worker renders both working and staged text in the
DOM suites, whose fetch assertions reject original runtime requests. Cases cover
owner/root collisions, deleted/binary files, hidden reads, mode portals, delayed
acknowledgements, failed and unknown mutations and preserved commit drafts.
The final type/lint/Knip/anti-slop gate passes. The first gate's sole failure was
the test harness's Fast Refresh scope, corrected without weakening assertions.
Logs are `.tmp/changes-panel-menu-release.log`, `.tmp/mobile-changes-view-v2.log`,
`.tmp/pierre-diff-binding-v2.log`, `.tmp/changes-files-regression.log`,
`.tmp/changes-host-client-regression.log` and `.tmp/check-changes-menu-release.log`.
Earlier browser-fixture failures remain in their original logs.

The real 412x915 test CF browser edited and saved one task-owned file, inspected
its working patch, staged it, inspected its staged patch, returned, unstaged and
staged again, then submitted a multiline local commit. Disk and Git readback
confirmed only that file was committed and the prior dirty files were preserved.
History displayed the new commit; returning to Files retained the same editor,
then closing the workspace returned to its read-only window. No terminal input,
agent start or conversation creation was used. The test connection's expired
browser access was explicitly paired again for this flow. The default bridge,
CF origin and fixed first-phone APK remain available. Private browser captures
and Git receipts stay under `.tmp/changes-browser/` and `.tmp/changes-git-result.json`.

Original Web and Herdr builds pass. The final Android debug APK is 42,298,812
bytes, packages `herdr--dPvpIpz.js`, and its HTML/entry bytes match the web build
in `.tmp/changes-apk.json`. Gradle passed in 10 seconds with 245 tasks, 27 executed
and 218 up-to-date, using the existing task cache and NDK 27.1. Logs are
`.tmp/build-web-changes-final.log`, `.tmp/build-herdr-changes-menu-final.log` and
`.tmp/build-changes-menu-android.log`. The first full browser write flow used
`herdr-CnNHHhHF.js`; the final menu-only correction was rebuilt and checked on
`herdr--dPvpIpz.js`, including actual History/menu closure and RTL. The new APK
has not been installed or interactively tested. The preserved first-phone-test
copy still matches its published digest and was not replaced.

The final default CF page restored the same Kansas worker window with a real
read-only frame. Its `/root/us-claude` directory is not a Git repository, and
Changes displayed that actual error with disabled commit, without a fake clean
list. No Git mutation was sent to that remote directory. Remote Git write
acceptance was not rerun for this UI increment; the prior owned-SSH host evidence
remains separate. Both existing bridge PIDs, ports and CF origins are unchanged.
Public health is 200 and unauthenticated private access is 401 for both origins
in `.tmp/changes-runtime-after.json`.

Actual Android Back/IME, camera, KeyStore, process death and physical phone use
remain unverified. This increment changes no backend Git operation,
provider configuration, remote SSH configuration or managed Cloudflare setup.

## Previous saved connection management increment

Instances now uses the original mobile list, edit framing, two-step local
removal and fullscreen/dialog presentation. Saved entries have optional local
names; old origin/token entries still load. Rename waits for durable storage,
keeps list order and leaves the origin/token unchanged. A replacement pairing
on the same origin retains the name. The saved address is read-only; Add instance
and expired-access recovery use the existing explicit pairing Welcome.

Switching checks only the selected saved origin with its captured bearer and
the authenticated info schema before saving MRU and activating. An exact parsed
OpenHerdr 401 rejects only that candidate credential. Other HTTP/network/schema
failures retain the previous active connection and saved order. Queued pairing
intents supersede old probe results. Delete waits for the local store, then
removing the active entry returns to Welcome without selecting another server.
It sends no revocation and preserves pending deliveries and target hints.

Independent source review found and root corrected a recovery bypass through
Instances. A rejected active credential now directly gates private visibility,
including after closing the manager. The actual-app regression checks this.
Browser validation also found a narrow-screen dialog mismatch; the manager now
uses the original short-side tablet rule for phone/rotated-phone fullscreen and
tablet dialog.

The focused result is 77 passing cases: transport 34, controller 21, shared/original
list 5 and independent actual-app/owner integration 17. The 43 retained Welcome,
auth-recovery and monitor/restoration cases pass. The initial static gate found
two unsupported test assertion typings; equivalent error-code checks pass the
final gate, including type-check, lint, Knip and no new anti-slop findings.
Logs are `.tmp/saved-connection-transport-final.log`,
`.tmp/saved-connection-controller-final.log`, `.tmp/mobile-instances-view-v1.log`,
`.tmp/connection-instances-dom-release.log`,
`.tmp/instances-connection-regressions-v2.log` and
`.tmp/check-instances-release.log`.

The real 412x915 browser through the existing default CF origin saved a temporary
name, retained it after reload, restored the original name, cancelled local
removal and explicitly selected the saved connection through the new probe.
It returned to the same Kansas worker window `w2:p4` with real read-only output.
Add instance opened the existing blank pairing form without redeeming anything.
Arabic RTL and local-editor Escape were checked; the original English locale was
restored. Browser captures and the DOM record stay under
`.tmp/saved-connections-browser/`. Only the safe instance-list capture is copied
to the public documentation. No terminal input, new pairing, agent start,
conversation creation, device revocation or actual saved-entry deletion occurred
in that live flow.

Original Web, Herdr and Android debug builds pass. The APK is 40,701,131 bytes,
packages `herdr-CpTmNVqs.js`, and its HTML/entry bytes match the web build in
`.tmp/instances-apk.json`. Gradle took 10 seconds with the existing task-owned
cache and NDK 27.1 selection. The fixed first phone-test APK and its public
prerelease remain unchanged. The default bridge remains PID 94594 on port 4318
with the same CF origin; public health returns 200 and unauthenticated private
access returns 401. No service was restarted. This new APK has not been installed
or interactively tested. Native camera, KeyStore, process-death and system Back,
real managed-domain routing and complete original-feature parity remain
unfinished.

## Previous managed Cloudflare lifecycle increment

The host CLI now supports the original explicit `managed-remote` and
`managed-local` modes alongside the unchanged Quick default. Named modes use
an HTTPS `--server` and an explicit token-file or config path. Operator inputs
stay read-only; there is no new profile store, secret copy, default credential
discovery, DNS change or phone transport. Original Electron and VS Code remain
unchanged. Browser, hosted mobile and Capacitor use the existing exact-origin
pairing/bearer contract. Operator commands are in [README.md](README.md#fixed-cloudflare-origin).

Startup waits for cloudflared's fresh first-connection PID file, matches the
owned child/serve launch and keeps configured origins separate from readiness.
Arbitrary output or a registered address cannot confirm startup. Status records
connector initialization separately from public routing. Startup cancellation
and stop join only their exact process handles. The CLI retains its admin
ownership until the connector and its receipt retire, including a pending
startup. An optional server stop callback keeps that ordering without importing
Cloudflare logic into the server. Existing server consumers keep their default
close behavior. Old running instances remain readable as unconfirmed and are
not restarted or adopted from a disk PID.

Helper tests pass 24/24 and independent real-CLI subprocess tests pass 21/21.
They cover all modes, strict flags/enterprise refusal, PID/output mismatches,
redaction, original file preservation, legacy instances, same-state restart,
retained/revoked pairing credentials and exact cleanup. Independent tests found
an early parent exit during cancellation; independent source review found an
overlapping stop/start receipt race. Both are corrected and the final source
review has no remaining P1/P2. Ready and pre-receipt overlap scenarios pass.
The original CLI suite passes 112/112 and the existing Herdr HTTP suite passes
37/37. The final combined type/lint/Knip/anti-slop gate passes in
`.tmp/check-managed-cf-final.log`. Logs are `.tmp/managed-cf-helper-v1.log`,
`.tmp/managed-cf-tests/vitest-final-v3.log`,
`.tmp/managed-cf-original-cli.log` and `.tmp/managed-cf-server-regression.log`.
The actual CLI 30-second timeout was source-reviewed; shorter helper deadlines
were executed. Controlled child fixtures do not establish Cloudflare routing.

The final source also ran a real installed cloudflared Quick connector in one
isolated bridge/state directory. Its new public HTTPS path returned health 200,
private-route rejection 401, successful one-use pairing and authenticated info
and read-only native snapshot 200. The exact temporary client was revoked and
then rejected with 401. Official stop confirmed the isolated bridge stopped;
the native process check found no process with its unique state path. No
terminal input, agent start or conversation creation occurred. The preexisting
default bridge remained PID 94594 on port 4318 with the same CF origin, whose
public health still returned 200. Receipts stay private in
`.tmp/managed-cf-quick-live.json`. No existing service was restarted.

Real managed-domain account/DNS/ingress and a phone using that deployment remain
unverified. No current CF credential/config was read or changed. Client/native
assets were unchanged, so this host-only increment did not rebuild or install
an APK. The ATkpLUV8 APK and fixed D8G2xhGi first phone-test copy remain available.
Android process death, KeyStore, camera and full original-feature parity remain
unfinished. Named profile storage and a tunnel Settings interface remain later
work.

## Previous cold-window restoration increment

Monitor remembers the last verified machine, workspace, tab, pane and terminal
for each server origin. It reads that hint before choosing a default machine,
then waits for a successful current machine list and matching snapshot before
opening output. Read failures retain the hint. Confirmed removal or a different
terminal clears the stale hint and leaves the view unavailable until explicit
selection. User navigation wins over late restoration. Credential replacement
on the same origin retains the running selection and does not reapply the hint.
The metadata contains no credential, output or draft; blocked storage does not
prevent navigation. Terminal controls and uncertain input are never restored.

Four pure tests pass. Twenty independent actual-app DOM cases pass across the
initial 19-case run and one added same-machine pending-inspection case. Existing
auth-recovery, monitor and pane tests pass 26/26. Coverage includes fresh-read
gating, colliding IDs, ancestry/terminal replacement, failed reads, different
origins, token replacement, blocked storage and no pending-mutation replay.
Independent source review found no remaining P1/P2. The final combined gate
passes type-check, lint, Knip and the anti-slop check in
`.tmp/check-cold-monitor-final.log`.

The actual 412x915 browser used the existing default Cloudflare origin and
saved credential. Reload restored Kansas / Claude US / task overview; after
manual selection, a second reload restored the workers window. Both displayed
real output through a read-only observer. No re-pairing, bridge/tunnel restart,
terminal input, agent start or conversation creation was performed. Private
captures and the browser record stay under `.tmp/cold-monitor/`.

The Herdr web build, asset preparation, Capacitor sync and Android debug build
passed. The APK is 40,701,131 bytes and packages `herdr-ATkpLUV8.js`; HTML and
entry bytes match the web build in `.tmp/cold-monitor-apk.json`. The preserved
first phone-test copy remains the D8G2xhGi build. The new APK has not been
installed or interactively tested. Native KeyStore, Android process death,
system Back and camera acceptance remain unverified. Full Android parity and
persistent named Cloudflare configuration remain unfinished.

## Previous expired-device recovery increment

Only HTTP 401 with OpenHerdr's parsed `unauthorized` error enters recovery.
Welcome pauses the current private views and their reads, explains that access
expired or was revoked, disables the rejected saved credential and offers no
Cancel back to private content. Explicit pairing saves the replacement before
activation; storage failure retains the confirmed result for save-only retry.
A newer link survives an older operation, and a late old request cannot replace
a newer connection. Same-origin token replacement retains the selected window,
chat draft and unknown delivery record without replaying a mutation.

Conversation/model dialogs, history/message menus, note confirmations and
attachment previews follow their owner's visibility. Hidden attachments reject
open/download and cancel pending reads. Original drawer exit animations retain
hidden, non-interactive DOM, without retaining the private attachment portal.

The focused result is 78 passing cases: 37 transport/controller, 12 independent
auth-recovery DOM, 14 attachment/chat regression and 15 existing Welcome/monitor
cases. The independent reviewer found persistence/intake and portal errors;
the final source resolves them. The initial static gate rejected a new conditional
empty-object spread. Its equivalent explicit branch passes the final gate,
including types, lint, Knip zero findings and no new anti-slop findings.

The actual 412x915 browser used the existing test Cloudflare origin. A pairing
record identified its exact owned client before revocation. The app showed the
expired notice, disabled saved credential, hid its prior window and offered no
Cancel. Explicit replacement pairing returned to Kansas workspace `w2`, pane
`w2:p2`, with a real canvas and read-only observer. No terminal input, agent start
or conversation creation occurred. This flow used `herdr-bYTF49Ox.js`, before
the behavior-preserving branch cleanup required by lint. The default bridge,
existing services, tunnel and user agents were preserved. Browser artifacts and
receipts stay private under `.tmp/auth-recovery/`.

The original Web build and Android build passed. The final APK is 40,701,131 bytes with `herdr-D8G2xhGi.js`;
its packaged HTML and entry match the web build exactly. The final rebuild
passed in 13 seconds. The actual final-asset browser reload restored the new
saved binding and a read-only canvas without pairing again. At that revision,
a full reload started at Local; this increment retained the selected pane across same-origin
credential replacement within the running app. Native KeyStore,
system Back, camera and physical-phone interaction remain unverified. Full
Android feature/UI parity and persistent named Cloudflare configuration remain
unfinished.

## Previous connection-flow increment

OpenHerdr now uses the original Welcome presentation for manual pairing and
saved origins. Its Server URL entry reopens that screen, pauses the underlying
monitor/content reads and closes shell portals. Cancel returns to the same
monitor. Android has the existing MLKit scanner registered; scanner/OS intake
previews the resolved HTTPS server and requires Connect. The OpenChamber
protocol wrapper keeps its original behavior around the same shared view.

The local controller prevents duplicate confirmation, captures each operation's
server/code, checks vault initialization before redemption and keeps a confirmed
credential for save-only retry. New intents cannot be overwritten by old
completion. A warm app-link event supersedes a late cold-launch URL. Saved
selection persists the chosen origin before activation without redemption.

Focused adapter/controller tests pass 50/50; shared view and actual Herdr app
DOM tests pass 15/15, and overlay Back/visibility cleanup passes 3/3. Independent
source review found and verified the old-portal correction, with no remaining
P1/P2. These are fixtures/source checks, including the successful redemption
and vault-failure paths; they do not establish native vault behavior.

The actual 412x915 CF browser showed the shared Welcome, rejected an OpenChamber
v2 link, switched Arabic/English, selected its existing saved origin, returned
to the real monitor and restored authentication on reload. Both old drawer
portals were hidden and non-interactive. No new pairing, model request or
terminal input was sent in that browser check. The screenshot is
`assets/connection-welcome.jpg`. A transient HTTP 530 appeared during the
check; subsequent public and local health checks returned 200 without restarting
the existing bridge or tunnel. This is not a long-term connectivity test.

The Android APK is 40,701,131 bytes and packages `herdr-4D0XehLa.js`. Its HTML
and entry match the web build exactly. The packaged registry contains the
scanner plugin and the APK includes the bundled barcode models and native
libraries. The first offline build lacked CameraX/MLKit cache artifacts; online
resolution in the task-owned cache succeeded. Gradle then encountered the
SDK's partial NDK 27.0 directory. Selecting the existing working NDK 27.1 through
a task-only init script produced a successful build. The final source rebuild passed in 12 seconds,
245 tasks, 27 executed and 218 up-to-date. Shared SDK and Gradle configuration were not
changed. Records use `.tmp/connection-*` and `.tmp/android-connection-*`.

This APK has not been installed or interactively accepted. Camera permission,
CameraX preview/scan, native Back, KeyStore write/relaunch and physical-phone
use remain unverified. iOS now declares the `openherdr` URL scheme in source;
its SwiftPM project still has no scanner plugin, and that scheme change was
not built or tested on iOS. Full feature/UI parity remains unfinished.

## Previous window-monitoring increment

The app now opens the existing-window monitor. Its machine, workspace, tab and
pane tree includes ordinary dashboards as well as agent terminals. Chat is an
explicit secondary entry. Returning from chat pauses its reads and retains its
draft. Window management and terminal input remain in Terminal controls.

Actual Cloudflare HTTPS checks read Local, WSL, JP API and Kansas through the
default bridge and their saved profiles. Kansas ordinary dashboards supplied
both a full frame and an incremental frame. A temporary HTTP client was revoked
and then rejected; these reads added no mutation receipts. The private receipt
is `.tmp/window-monitor/http-receipt.json`.

The actual 412x915 browser paired through that CF address, displayed all four
machines and read existing Codex, Claude and dashboard windows. Reloading the
same origin restored the saved binding without another pairing. The observer's
actual textarea is read-only with `inputmode="none"`. Screen and visible-text
selection were exercised. User-window captures remain private under
`.tmp/window-monitor/` and are excluded from public source.

The successful-frame path exposed a layout/reconnect loop missed by the DOM
fallback tests. Repeated connecting notifications are removed. A per-subscription
20-second first-frame deadline now enters fallback and existing backoff; an
accepted frame cancels it, so a static screen has no idle deadline. The final CF
browser retained a stable screen area after recovery. The deadline branch has
source review but no injected network-stall acceptance.

The final focused regression is 13/13 in
`.tmp/herdr-monitor-first-frame-tests.log`; independent source review found no
blocking P1/P2. `check:changed` passed on the final source in
`.tmp/check-window-monitor-final.log`. The original web build and Herdr Android
build passed. That increment's APK is 17,140,452 bytes and packages
`herdr-BLLJAMLv.js`; its HTML and entry asset match the web build exactly.
`.tmp/window-monitor-apk.json` records that comparison. The final isolated
offline Gradle build took 10 seconds, with 213 tasks, 27 executed and 186
up-to-date. This APK has not been installed or interactively accepted on Android.

The underlying Herdr services and existing agents continue in their original
processes. Terminal-occupant isolation takes effect when a new authoritative
snapshot reports `terminal_id`; the frame/read protocol does not carry that ID.
Native Back, IME, rotation, secure-vault write/relaunch and physical-phone use
remain unverified. This increment does not complete original-feature parity.

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
- A separate named Herdr fixture started one Codex 0.162.1 agent with read-only
  permissions and GPT-6-Luna medium. The human approved the repository trust
  prompt. Exactly one marker request completed and the terminal showed its real
  reply, but `agent.get` and `session.snapshot` still contained no `agent_session`.
  The owned session was stopped and its private records retained. The installed
  Codex integration reports not installed; this has not established the cause of
  the missing reference. No native history was associated or read, and no hook,
  Provider or credential configuration was changed. Codex history and Android
  rendering remain unimplemented.
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
