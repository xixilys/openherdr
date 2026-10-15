# OpenHerdr mobile UI parity map

## Decision supported by this inventory

The target is the original OpenChamber mobile application experience on Android,
with Herdr as the machine/session control layer. This inventory began with the
remote terminal client and records the original component dependencies at that
point. Current implementation and validation are tracked in STATUS.md.

Keep the separate OpenHerdr entrypoint and authenticated transport. Replace its content composition with the original mobile shell and original feature components as their data owners are adapted. Reusing `RuntimeAPIProvider` alone is insufficient: OpenChamber has a second, direct OpenCode session/sync dependency throughout its chat and navigation. That dependency must be made explicit rather than satisfied with fabricated OpenCode records.

The subsequent integration shares `HerdrMobileShell`, user bubbles/text,
tool summaries/descriptions, the pill composer, session switcher and
return-to-latest presentation with the original wrappers. Shell/diff output,
attachment/image views, stepped forms, the phone Files browser and floating
expanded composer now share their original presentation too. Herdr supplies real source records, confined asset
reads and isolated drafts. It has host Files/Git, project context, preferences
and an owned OpenCode conversation driver. This
inventory's route limitations describe its initial state, and do not replace
the current contracts in the owning module documentation. Full UI and feature
parity remains unfinished.

## Entrypoints and ownership

| Actual source | Current behavior | Adaptation mechanism |
| --- | --- | --- |
| `packages/web/src/mobile-main.tsx`, `packages/ui/src/apps/renderMobileApp.tsx` | Upstream mobile entry initializes shared appearance, device classes, widget bridge, theme, diff workers and authentication. | Keep original bootstrap and Android device/keyboard behavior. Supply the OpenHerdr authentication/server selection owner. Do not reuse the OpenCode auth gate as bearer pairing. |
| `packages/ui/src/apps/MobileApp.tsx` | `MobileShell` composes header, session drawer, workspace drawer and fullscreen surfaces. Root mounts `SyncProvider(opencodeClient.getSdkClient())`, `RuntimeAPIProvider`, `SyncAppEffects`, OpenCode compatibility/update controls and OpenCode-dependent initialization. | Extract the existing shell composition from its OpenCode lifecycle owner. Preserve its layout and transitions; accept feature nodes, selected-item presentation and navigation actions. The upstream wrapper supplies its existing OpenCode owners; the Herdr wrapper supplies Herdr session ownership and feature adapters. |
| `packages/ui/src/apps/mobileAppContext.tsx` | Existing `MobileAppActions` has `openChanges`, `openFiles`, `openSettings`, `openSourceBoard`. | Reuse this public navigation context. Extend only if a real Herdr screen needs a new action. It already decouples composer links from desktop navigation. |
| `packages/ui/src/apps/mobileNativeChrome.ts`, `packages/ui/src/lib/mobileBackLayers.ts`, `apps/useEdgeSwipe.ts`, `apps/MobileFullscreenSurface.tsx`, `components/ui/MobileOverlayPanel.tsx` | Android hardware back, safe areas, keyboard lifecycle, overlay stacks and gesture presentation. `MobileFullscreenSurface` accepts content/title/close props. | Reuse actual native and overlay infrastructure. Fullscreen/overlay components are close to direct reuse. Validate Android Back prioritizes dialogs, workspace drawer, session drawer, then app navigation. |
| `packages/web/src/herdr-main.tsx`, `src/herdr/HerdrApp.tsx`, `transport.ts`, `usePolling.ts`, `LiveTerminal.tsx`, `ContentPanel.tsx` | Separate pairing, bearer credentials, target-pinned mutations, receipt recovery, snapshot metadata, terminal frames, basic files/Git. | Retain transport, target safety and real terminal observation. Retire the simplified screen composition incrementally after original screens become functional. Do not discard the working remote terminal path while structured agents are added. |

The shared public host API is `packages/ui/src/lib/api/types.ts:RuntimeAPIs`, consumed through `contexts/RuntimeAPIProvider.tsx`, `hooks/useRuntimeAPIs.ts` and `contexts/runtimeAPIRegistry.ts`. It covers files, Git, terminal, settings, permissions, notifications and account integrations. It does **not** own the chat session protocol. `lib/opencode/client.ts`, `sync/sync-context.tsx`, `sync/session-actions.ts` and their stores own that protocol separately.

## Navigation and screen reuse

### Header, session drawer and workspace drawer

`apps/MobileHeader.tsx` already implements the intended mobile header, recent-session switcher, metadata popover and workspace activity marker. It reads `useSession`, `useSessionUIStore`, `useDirectoryStore`, `useGitStore`, multi-run state and `MobileSessionSwitcher`. Adding only a title prop will not remove those data reads. Split its presentation from the existing OpenCode container: title, subtitle/metadata, selected identity, activity, switcher items and callbacks must arrive from one selected-session owner.

`apps/MobileSessionsSheet.tsx` contains the actual project/worktree/session tree, search, swipe actions, pinning, ordering and worktree menus. It imports the OpenCode `Session` domain, live session sync, global sessions/history, session actions and project/worktree stores. Keep its rows and gestures. A Herdr tree uses real workspace/tab/pane identities and groups them by actual project/cwd metadata; do not label a pane as an archived conversation. Introduce an explicit row model and callbacks at this component boundary, preserving the OpenCode container as its first adapter.

`apps/MobileWorkspaceDrawer.tsx` already renders Changes, Files, Terminal, Notes and MCP with visited-tab retention and phone/tablet variants. Its current children and Notes/MCP state are hardwired. Extract the existing drawer into a tab-content host, with the upstream wrapper supplying its current children. OpenHerdr can then reuse the exact drawer and tabs while its Files/Git/Terminal implementations change underneath. `MobileFullscreenSurface` and `MobileOverlayPanel` need no new navigation framework.

### Chat and timeline

| Owning file | Data/actions it actually requires | Reuse path |
| --- | --- | --- |
| `components/views/ChatView.tsx` | OpenCode selected-session store and `ChatContainer`. | Keep wrapper for the OpenCode source. It is not a generic chat boundary today. |
| `components/chat/ChatContainer.tsx` | Session/message/part loaders and sync, live status, forms, permissions, streaming, parent sessions, directory, selections, draft materialization, prompt actions and occasional direct `opencodeClient` reads. | Separate conversation source/controller from timeline presentation. Preserve hydration, scrolling, pinned columns, form/permission docks and draft handling. A terminal-backed source remains terminal content, not an empty successful chat. |
| `components/chat/MessageList.tsx` | Receives records but also calls `useSessionPartsForMessages`; owns turn grouping, timeline virtualization and row composition. | Extract message/part subscription into the container; pass immutable records plus genuine active-turn state. Keep existing list/turn/scroll implementation. |
| `components/chat/ChatMessage.tsx` | `{info: Message, parts: Part[]}` plus theme/config/model selection, session lookup, link actions and direct session revert/fork methods. | Extract `ChatMessageView` presentation plus explicit action callbacks and action capabilities. The existing component remains its OpenCode controller. A props-only message signature does not make the current component portable. |
| `components/chat/message/MessageBody.tsx` | Parts plus session actions, review/multi-run, TTS, effective directory, provider/agent information, plans and native file sharing. | Split content renderers from action/controller integrations. Preserve visual rendering, but expose only actions backed by the selected conversation source. |
| `components/chat/message/parts/AssistantTextPart.tsx` | `part`, stable `messageId`, `streamPhase`, optional popup callback. It deliberately does not subscribe to session stores. | The best existing near-leaf boundary for real assistant text. Reuse with a parsed, source-proven text part; its Markdown renderer still needs the shared presentation providers. |
| `components/chat/message/parts/ReasoningPart.tsx` | Real reasoning text/timestamps, UI preferences and search reveal. | Reuse presentation with actual reasoning events only. A terminal status line is not reasoning. |
| `components/chat/message/parts/ToolPart.tsx` | Real tool call state, directory sync, session messages, background shell/task records, OpenCode cancellation and provider-specific tool semantics. | Extract tool presentation from executable actions. Map actual source tool input/result/attachments; implement shell/task actions only for sources that own those IDs. |
| `components/chat/MarkdownRenderer.tsx`, `components/ui/CodeMirrorEditor.tsx`, `components/views/PierreDiffViewer.tsx` | Presentation content, theme, workers/editor configuration. | Reuse original Markdown/code/diff presentation instead of replacing it with `<pre>` panels. |

`lib/opencode/model.ts` is a precise normalized OpenCode domain, not a generic lossless adapter type for every CLI. `Session` requires cost/tokens; `AssistantMessage` requires provider/model/agent IDs; tool parts require actual call IDs, state and timing. Setting unavailable fields to invented provider names, zero usage or fabricated timestamps would make source data false. A source-neutral presentation record must allow unknown/absent metadata, or a source can use the original model only when every required field is available and correct.

The normalized live contract is `lib/opencode/events.ts`. It includes `message.updated/patched/removed`, `message.part.updated/delta`, `message.tool.transition`, part replacement, session status/error/idle, permission asked/replied, form created/settled and shell started/ended. Herdr pane revision/activity events do not supply these message/tool/approval transitions. A conversation source adapter must prove which events it can produce from its real source.

The original actions in `sync/session-actions.ts` include create/delete/rename, prompt/abort, revert/fork, permission replies and form replies through `opencodeClient`. Reusing visual chat controls requires adapting these actions as well as loading historical text.

### Floating expanded input

Herdr `ConversationComposer` now uses the original `ComposerEditor`,
`useMobileComposerShell` and `useMobileViewportPin`. A phone tap expands the pill
into the floating editor and focuses it in that gesture. The extracted
`ComposerBoxView` supplies the same opaque box and shadow to the original
`ChatInput` and Herdr editor. The original wrapper keeps its editor children,
layout and state owner; the shared frame performs no source reads or submission.

Herdr retains editor selection across pill swaps and detaches the editor while
hidden. Its view owner includes server, machine, pane identity, session and
directory; changing owners destroys that view. Text and attachments stay in the
scoped draft store. Picker handoff and focus restoration respect visibility.
Idle send, running-turn queue and abort each require their actual capability;
unknown delivery continues to block mutations. Permission/form input moves with
the same positioned composer during viewport pinning.

The actual 412×915 HTTPS browser acceptance passed Unicode 2-line editing,
Enter inserting a newline, tap focus, model-picker close, collapse/reopen and
return from Files with draft and attachment controls retained. Opening the editor
preserved reader position at 601.5; a separate non-bottom Files round trip
preserved 80 → 80. One bounded real prompt produced
`OPENHERDR_EXPANDED_INPUT_OK`, with 1 user prompt and 1 response; its sent draft
cleared. These observations do not imply the viewport stayed fixed during the
new response. Arabic inspection confirmed actual `dir="rtl"`, model controls
on the right and agent controls on the left. English, the cleared test draft and
the normal viewport were restored afterward. The receipt is
`.tmp/expanded-composer-browser.json`; public browser captures are
`assets/composer-expanded.jpg` and `assets/composer-response.jpg`.

Focused regressions passed for the composer 9, shared box frame 1 and pure pill 6.
The original pill 8, conversation 1 and file-return 3 also passed. The final
combined gate is `.tmp/check-expanded-composer-release.log`; the original web
build passed. Fullscreen input, agent/command/file autocomplete, physical native
IME, system Back and native sharing remain unfinished or unverified.

### Files and editor

The original `apps/MobileFilesSurface.tsx` and Herdr `FilesPanel` now consume
`apps/MobileFilesView.tsx`. This extracted view owns the original phone browser,
header, search, file rows and browser/file route presentation. It reads no
OpenCode stores, effective directory or runtime APIs. The original wrapper keeps
its directory/search/upload subscriptions and lazy `FilesView` editor. Herdr
keeps its host client, revision-pinned drafts, manual Save and CodeMirror editor.
This shares the existing browser without replacing the full `FilesView` runtime.

A real Read/Edit tool can open its current disk file through the captured
conversation target. Files checks the request's server, machine, pane, canonical
root and native identity before opening, then checks identity/root again after
reading before publishing the bytes. Current-file labels distinguish those bytes
from the historical tool result. Hidden reads stop, pending completions cannot
cross owners, and unfinished edits survive hiding. Inner Back returns from the
file to the browser, clears search and climbs directories before the shell closes.

The 2026-10-15 HTTPS browser acceptance used a 412×915 viewport and a genuine
existing Read/Edit result, with no new model request. Opening the current file,
closing/reopening the workspace with its draft, browsing/searching, manual Save
and disk readback all passed. Changes displayed the saved untracked file as a
2-line addition. Returning to the same chat preserved its title, unsent composer
draft and reader `scrollTop` of 533.5. The temporary composer marker was cleared
after recording this result. Receipts are
`.tmp/file-navigation-browser-validation.json` and `.tmp/file-flow-browser-state.json`.
Public screenshots are `assets/file-browser.jpg`, `assets/file-editor.jpg` and
`assets/file-changes.jpg`; these are browser captures, not Android captures.

Full editor parity still needs the remaining original `FilesView` capabilities
and runtime adaptations. `FilesView` depends on Git/config/file-tab state,
effective directory, inline review and raw-asset paths in addition to
`RuntimeAPIs.files`. Preserve encoding/line endings, syntax highlighting, search,
previews and attachment behavior as these paths are adapted. The implemented
host file service already supports confined listing/search, text/binary reads,
manual revision-checked writes, create/rename/delete, upload/download and explicit
mutation receipts. These capabilities do not establish every original editor
interaction or native file-picker/share behavior.

### Git and worktrees

`apps/MobileChangesSurface.tsx` is the actual mobile Changes screen, including per-file diffs, staging, branch/commit/PR comparisons, commit and network-operation controls. It consumes Git status/identity/branch stores, source-control account bindings, effective directory and optional session review flow. `components/views/GitView.tsx` is the desktop/full variant and has similar ownership.

The existing `GitAPI` is the host capability family for the remaining original
Git screen adaptations. The initial `/api/herdr/git` route returned text
status/full diff; the current host service supplies structured status, per-file
diff, stage/unstage, commit, branches/checkout and history. Network operations
and the full original screen remain unfinished. Preserve filename-safe parsing,
the authoritative repository root and the host execution policy when adapting
more controls. Avoid importing the OpenCode server lifecycle to obtain Git.

The file-navigation increment also fixes per-file untracked text diffs in the
host helper. A real saved WSL profile passed an owned fixture with
`-remote diff.txt`: status reported it untracked, the unstaged diff contained the
new-file patch and unique marker, the staged diff stayed empty, and content/revision
readback matched. The exact created workspace was closed and its marked temporary
directory removed. `.tmp/untracked-ssh-acceptance.json` records this SSH check.
It covered an ordinary 0644 file; final executable-mode handling has separate
local tests. This is a bounded Git capability, not full Git screen or native parity.

Reusable original presentation includes `components/views/git/ChangesPanel.tsx` with explicit `groups`, `diffStats` and per-file callbacks, `CommitSection`, `GitHeader`, `HistorySection`, branch pickers and `PierreDiffViewer`. Some children still use stores; trace each enabled child rather than assuming all descendants are pure.

Full Git parity also includes `SourceControlAPI`, `lib/source-control/repository-binding.ts`, `boundGitNetworkOperation.ts`, identity storage and operation recovery. A successful local commit does not prove push/PR/auth integration. Preserve the existing planned network-operation/grant design when exposing these controls.

Worktree ownership is in `components/sections/openchamber/WorktreeSectionContent.tsx`, `useProjectWorktrees.ts`, `components/session/NewWorktreeDialog.tsx`, `lib/worktrees/worktreeManager.ts`, `worktreeCreate.ts` and `worktreeRemovalFlow.ts`, plus session attachment/repair state. Herdr and the current OpenHerdr allowlist expose list/create/open/remove. The remaining original-screen adaptation must map those real worktree records and receipt handling to the original controls. Keep worktree deletion, attached panes and dirty state explicit. A workspace close must not silently substitute for worktree removal.

### Settings, appearance and attachments

`components/views/SettingsView.tsx` already accepts `forceMobile`, `visiblePageSlugs`, `initialMobileStage` and `registerBackHandler`. Reuse its actual mobile navigation and `components/sections/shared/Settings*` layout. `visiblePageSlugs` is useful for staged integration, but hiding every unimplemented page is not completion of the requested parity.

Appearance preferences can use existing UI/settings state and `SettingsAPI.load/save`. `contexts/ThemeSystemContext.tsx` also accesses `/api/config/themes` for theme catalog/import/delete. Supply the settings/theme host contracts before mounting it in the Herdr app. Keep local appearance/language/keyboard controls independent from agent/provider configuration. OpenCode provider/MCP/skills/commands/plugin settings need corresponding real agent configuration adapters; a global Herdr agent-kind picker does not implement those settings.

`components/chat/composer/ui/ComposerAttachmentControls.tsx` is already callback-driven and supports `filesOnly`, mobile sheets and optional repository/Linear actions. Reuse this visual control and the existing attachment preparation in `sync/attachment-files.ts`, `document-attachments.ts` and the input store's draft lifecycle. The actual delivery contract must distinguish uploaded remote files, structured provider attachments and text references:

1. Pick a local Android file/photo through the real native/web picker.
2. Prepare/validate with existing attachment helpers.
3. Upload to the selected machine's confined file service, receiving a real path/reference.
4. Pass that reference to a source-specific prompt method that supports it, or explicitly send a user-approved text/path reference through a CLI with that documented behavior.
5. Preserve the attachment and draft on failure or unknown mutation outcome.

`agent.prompt` currently accepts text only. Do not manufacture image/file parts or claim model attachment ingestion merely because the file appeared on disk. `sync/session-actions.ts` currently sends OpenCode structured parts; that action needs the source adapter too.

## Required adapter contracts

The following are proposed boundaries, not implemented endpoints:

- **Selected target owner.** One authoritative `{server,machine,herdrSession,workspaceId,tabId,paneId,cwd,revision}` record. Remote IDs are scoped by server/machine/session. Pane disappearance leaves no valid target until an explicit selection. Host Files/Git/Terminal adapters capture this owner rather than accepting arbitrary client absolute cwd.
- **Host runtime adapter.** Implements existing `RuntimeAPIs` families using the selected target and host services. Files/Git/settings are agent-independent. Extend runtime URL/auth helpers so downloads/previews and native assets use the same selected endpoint and do not expose bearer credentials in URLs.
- **Conversation source adapter.** Announces a real source and supported operations, supplies stable session/message/part IDs, history cursor, ordered live changes, prompt/abort/permission/form/action results and attachment support. Feed existing OpenCode sync only through a deliberately compatible source; otherwise use a source-neutral controller/presentation boundary. Mutation receipts and unknown delivery remain first-class.
- **Agent configuration adapter.** Reads/writes the selected agent's documented models/providers/MCP/skills/commands settings. This is separate from machine control and host appearance.
- **Native shell adapter.** Owns Android Back, keyboard/insets, file/photo picker, deep-link intake, secure vault, share/download and notifications. Shared screens consume those existing capability contracts.

The current `src/herdr/transport.ts` pane/agent parsers also discard `agent_session`, so preserving the parsed reference is an early integration change before source selection can work.

The protocol inventory and socket documentation confirm `agent_session` is an optional stored native restore/session reference with `{source,agent,kind:'id'|'path',value}` reference. The `source`/`agent` pair can select a candidate reader. The documented restore hook and provider resume command establish identity, while Herdr does not define a universal transcript schema, API base URL or provider identity through that reference. Inspect and validate each supported source before using it. Do not read an arbitrary hinted path without ownership/path checks. No ANSI-to-chat heuristic is part of this plan.

For a real OpenCode-backed pane, a configured and verified OpenCode 2 API/session association can retain the original SDK and sync implementation. It must identify the correct live process, endpoint, session and directory first; this inventory did not establish that such an endpoint is discoverable for every existing pane. Other agents need their real transcript/control adapters. Unknown sources continue to expose genuine terminal control while their adapter is implemented; that is an interim state, not full parity.

## Bounded implementation sequence and parallel work

The root should settle target identity, source capability semantics and unknown-data handling with the architect before splitting implementation. Thereafter the following work can proceed independently with non-overlapping ownership.

| Work unit | Initial write boundary | Depends on | Concrete acceptance |
| --- | --- | --- | --- |
| Original mobile shell reuse | `apps/MobileApp.tsx`, `MobileHeader.tsx`, `MobileWorkspaceDrawer.tsx`, `MobileSessionsSheet.tsx` presentation/controller split; new Herdr shell wrapper | Selected target/row contracts | Android renders original header/drawers/fullscreen settings at phone and tablet sizes; correct gestures/Back; upstream OpenCode wrapper behaves the same. No OpenCode bootstrap against a Herdr-only server. |
| Files runtime and editor | Host files owning modules, `HerdrFilesAPI`, `MobileFilesSurface.tsx`, direct runtime bypasses in `FilesView.tsx` | Target owner + host API | Original browser/editor performs text edit/save/conflict, binary preview, search, upload/download and rename with actual local and SSH data. Failures preserve draft. |
| Git and worktree runtime | Host Git/worktree owning modules, Herdr Git adapter; original mobile Changes/worktree controllers | Target owner + exact installed worktree schemas | Original change tree/per-file diff/stage/unstage/commit/history and create/open/remove worktree work on fixtures; dirty/delete/conflict failures preserve source state. Network/PR actions accepted separately through real account bindings. |
| Structured agent source | New source readers/controllers; chat presentation seams and session actions | Actual per-agent source evidence | Read an existing native session, preserve stable IDs, paginate/reconnect without duplicated parts, send one prompt, show actual output/tools, abort and handle real permissions. Unsupported source fields stay unknown. Start with one verified agent, then repeat for others. |
| Settings and configuration | Host SettingsAPI/theme routes; `SettingsView` page composition; selected-agent configuration adapter | Source/config capabilities | Original appearance/navigation works and persists; each agent configuration page round-trips its actual owner. No writes to unrelated Provider/config. |
| Android integration and independent acceptance | Native shell plus existing shared native capability modules; QA fixtures/screenshots | Can run alongside all above | Keyboard/composer and Back stack, device rotation, files, deep links, secure credential write/relaunch, public HTTPS and SSH target switching; compare original-screen screenshots and interactions. Physical phone remains a separate check. |

Do not expand all units into one shared-store rewrite. The shell and host Files/Git adapters can proceed while the source reader is being proven. Avoid concurrent edits to `RuntimeAPIs`/selected-target contracts and shared settings stores; the root owns those interfaces and schedules each integration.

Full parity should be accepted by original feature and actual user flow, not by the count of copied components. The current read-only panels are useful working references and recovery routes. They should not become the permanent substitute for the original files editor, Changes screen, session/chat UI, settings or attachment flows.

## Current artifact and remaining acceptance

The expanded-composer debug APK is 15,738,094 bytes and contains
`herdr-CF2mEnjj.js`; its bundled HTML exactly matches the built web HTML.
`.tmp/expanded-composer-apk.json` records the artifact. The normal full mobile
command encountered a native filesystem-enumeration hang. The successful APK
came from an isolated Gradle invocation with its own home/project cache and
read-only copied dependencies, with filesystem watching and the daemon disabled.
The log `.tmp/android-expanded-composer-isolated-online.log` reports
`BUILD SUCCESSFUL in 2m 49s`, with all 213 tasks executed.

This latest APK has not been installed or tested interactively on Android.
The preceding file-navigation artifact used `herdr-BDGqP9Kp.js`; the older
`herdr-BEKetIzv.js` build supplies the native Connect and cold-start observations
in `packages/mobile/openherdr/VALIDATION.md`. Fullscreen/autocomplete input,
complete editor/Git behavior, connected native interaction and the wider original
application parity remain unfinished.
