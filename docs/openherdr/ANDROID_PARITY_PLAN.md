# Android feature-parity plan

## Goal and decision

The human has corrected the target: Android is the primary application, and development must continue toward the complete OpenChamber feature and UI experience with Herdr. The terminal baseline is an intermediate result. Browser and iOS builds support development but do not replace Android runtime acceptance. This plan supplements [OPENHERDR.md](../../OPENHERDR.md) and the source-level [UI parity map](UI_PARITY_MAP.md).

The latest priority is the existing-window monitoring flow described in
OPENHERDR.md. Reuse the machine selector and native workspace/tab/pane tree,
show the selected pane read-only, and keep conversation creation secondary.
The first monitoring increment needs no native Codex association or new agent.
The broader feature inventory below remains in scope after this flow works.

Keep the existing authenticated Herdr bridge, receipts, SSH transport and working terminal observation. Replace the simplified Android screen composition with the original mobile presentation as its data owners are adapted. Preserve the original OpenChamber entrypoint. Do not construct fake OpenCode responses or infer chat/tool/reasoning records from ANSI terminal output.

Use three concrete service boundaries:

1. **Herdr target control** owns machine, workspace, tab, pane, native-agent identity, lifecycle and terminal control.
2. **Host operations** own files, Git, worktrees, attachments and application preferences on the selected machine.
3. **Conversation and agent configuration drivers** own the selected engine's actual transcript, streamed items, approvals, model selection, history actions and configuration. OpenCode is the first full implementation, using the existing SDK. Codex and other engines receive explicit adapters.

This division lets Android layout, host operations and native integration proceed in parallel. It also keeps a missing engine-specific API from blocking unrelated file editing or Android Back behavior.

## What the source establishes

- `packages/ui/src/apps/MobileApp.tsx` owns the real header, session drawer, workspace drawer, archive, schedules, board, settings and usage surfaces. It also hardwires OpenCode initialization, `SyncProvider` and `SyncAppEffects`. Injecting `RuntimeAPIs` alone cannot substitute Herdr chat data.
- `packages/ui/src/lib/api/types.ts` already defines `FilesAPI`, `GitAPI`, `TerminalAPI`, settings, notifications and runtime contracts. Reuse those families for host capabilities. `lib/opencode/client.ts`, `model.ts`, `projection.ts` and `sync/` form a separate conversation boundary.
- `ChatMessage`, `MessageBody` and `ToolPart` still read OpenCode state and invoke session actions. Extract presentation plus explicit action callbacks before reuse. `AssistantTextPart`, Markdown, CodeMirror and diff rendering are smaller reusable leaves. Exact files and dependencies are in the UI parity map.
- The installed `herdr api schema --json`, protocol 22, exposes `PaneInfo.agent_session = {source, agent, kind: 'id' | 'path', value}`. It is a native restore/session reference, not a transcript protocol. `packages/web/src/herdr/transport.ts` preserves and validates it. The current default-session snapshot has no native reference on its 4 panes, so their Codex/OpenCode labels alone cannot establish a conversation association.
- Herdr already has `worktree.create/open/remove`, `server.agent_manifests`, `agent.start`, `agent.prompt` and agent lifecycle methods. The OpenHerdr allowlist currently exposes only part of that API. `agent.prompt` accepts text; it does not carry structured image/file parts.
- The original Android `MainActivity.java` registers `FileSharePlugin`, `ImagePastePlugin` and `PushKeyPlugin`, and loads a custom `OpenChamberWebView` for IME image paste. The dedicated OpenHerdr activity is a plain `BridgeActivity`. Native feature parity therefore requires real Java/resource/manifest work, not just repackaging web assets.

## Current integrated increment

The shared original header and drawers, real local OpenCode driver, local/saved-SSH
Files and Git, native worktree operations, app preferences and project Notes/Todo/
personal plans are implemented. The independent Herdr entry now imports without
starting the original OpenCode runtime. Notes require a native worktree repository
root or a trusted registered workspace root; ordinary workspace registration is
still pending. Tests, builds and actual Android interaction remain separate claims
in STATUS.md. The feature table below records the planning-time gaps and route,
not a blanket statement that every row remains unimplemented.

## Feature inventory and implementation route

Every row remains in the parity scope until implemented and verified, or an explicit product decision changes it. A temporary disabled control is not completion.

| Original feature family | Current OpenHerdr gap | Concrete route and useful acceptance |
| --- | --- | --- |
| Phone/tablet navigation, drawers, session tree, search, gestures, appearance | Separate terminal-oriented shell; original navigation and settings behavior absent | Extract the existing `MobileApp` shell, `MobileHeader`, `MobileSessionsSheet` and `MobileWorkspaceDrawer` presentation. Supply real target/session rows and callbacks. Reuse `MobileFullscreenSurface`, `mobileBackLayers`, `mobileNativeChrome` and theme/settings layouts. On Android, select a session, open each drawer, use Back and rotate without losing the target or draft. |
| Conversation timeline, Markdown, reasoning, tool cards, live status | Terminal frames and text snapshots only | Bind an engine session to a Herdr target; project actual records into a conversation view model with stable source/message/part IDs. Use the original renderers after extracting their action dependencies. Show only reasoning exposed by the engine; unavailable reasoning is absent data, never generated text. Verify tool start/update/result and interrupted/failed turns against native records. |
| History, archive, search, rename, fork, revert, resume | Pane lifetime is the only visible session lifetime | Native session identity survives pane closure. Page engine history and maintain an OpenHerdr index of bound conversations and app-only archive/pin metadata. Engine fork/revert/resume uses that engine's real operation; file rollback is a separate Git operation. Verify cold launch/history pagination and a fork whose new native ID is returned, not predicted. |
| Prompts, stop, steering, approval and question forms | Text/key input with delivery receipts | Keep receipts for terminal commands. Structured drivers use their native turn/request IDs and reply methods. Existing terminal-only agents retain explicit terminal controls until an approval adapter exists. An inferred `blocked` status is not an actionable approval object. Verify no duplicate turn after disconnect and no approval sent to a different session. |
| Files, editor tabs, search, preview, create/rename/delete, upload/download | Local read-only text/list subset; remote rejects | Implement existing `FilesAPI` against a server-resolved workspace owner. Reuse the original `MobileFilesSurface`/`FilesView` and editor after removing direct OpenCode directory reads. Extend host operations locally and through the fixed SSH helper for bounded file operations. Pin the root while editing; return a conflict if the file or target changed. Verify actual edits, binary/download handling, symlink confinement and remote-machine isolation. |
| Git changes/diff/hunks, stage/unstage, commit, branches, checkout, stash, merge/rebase, pull/push, PR review | Local read-only status/diff only | Reuse `GitAPI`, `server/lib/git/service.js` and the existing Git UI, especially `MobileChangesSurface`. Host adapters retain real Git error/conflict results and the existing network-operation design. Remote operations execute a fixed allowlisted operation with JSON inputs, not browser-authored shell. Exercise local and remote disposable repositories, including dirty checkout/conflict behavior. Shared credentials and provider configuration stay untouched. |
| Worktree create/open/remove and workspace association | List only | Extend typed Herdr methods using the installed schema and wire the original worktree controls. Use returned workspace/pane IDs. Preserve separate meanings of closing a workspace and removing a worktree. Validate dirty worktree refusal, explicit removal and independent existing panes. |
| Agents, model/effort selection, providers, MCP, skills, commands, plugins | Fixed agent-kind picker only | Read actual Herdr agent manifests for launches. Use engine-specific catalogs and configuration operations; OpenCode uses existing SDK/settings modules. App preferences are independent from provider settings. Existing live sessions cannot silently change engine/model or configuration. Test catalog accuracy, selected model readback and settings failure preserving drafts. Do not expose or mutate existing provider credentials during implementation. |
| Attachments, image paste, file picker, share/download | Text composer only; no native paste/share plugins | Reuse `ComposerAttachmentControls`, `sync/attachment-files.ts`, `document-attachments.ts`, `nativeImagePaste.ts` and `nativeFileShare.ts`. Port the original Android Java plugins and WebView under the OpenHerdr package. Upload into the selected host scope, then submit an actual native attachment reference. A file saved on disk alone does not prove model ingestion. Verify Android picker/paste, remote upload, actual agent receipt and native share. |
| Pairing, saved devices, secure credentials, reconnect, Android lifecycle | Build and initial screen checked; complete native flow unverified | Keep the secure vault and bearer transport. Reuse upstream mobile connection/reprobe behavior where it matches the OpenHerdr contract. Implement explicit QR/deep-link intake without automatic prompt submission. Verify on Android: pairing, process kill/relaunch, restored authenticated request, background/foreground, offline recovery and token revocation. Main owns emulator/device execution. |
| Notifications and voice | Missing | Original `server/lib/notifications/` can consume normalized lifecycle events; Android requires its permission, key and notification service wiring. Foreground/in-app notification behavior can reuse existing local machinery. Closed-app push requires a correctly configured application delivery channel; upstream central relay/FCM registration is not automatically valid for `dev.openherdr.mobile`. `server/lib/dictation/` and `tts/` are real implementations to adapt, retaining provider/permission controls. |
| Notes, plans, context, memory, schedules and source board | Missing | Reuse `project-context`, `session-knowledge`, project configuration and source-board components with an OpenHerdr project identity. `scheduled-tasks/runtime.js` has useful scheduling/occurrence claiming but directly constructs an OpenCode client and prompts it; inject a conversation execution operation before enabling schedules for other engines. Verify one scheduled occurrence, persisted results and project isolation. |
| Multi-run, isolated spaces, extension panels and integrations | Missing | Retain these explicit backlog rows. `lib/multirun/DOCUMENTATION.md`, `server/lib/spaces/`, `server/lib/guests/DOCUMENTATION.md`, `packages/sdk` and source-control modules own the actual behavior. Integrate through host/conversation operations after the core drivers work. An iframe, simulated run or hidden menu does not implement their execution/trust semantics. Existing external accounts and grants remain unchanged. |

## Conversation sources and ownership

### OpenCode

Prefer a verified association with the same OpenCode 2 server and session used by the selected Herdr pane. Installed `opencode --help` supports explicit `--server` and `--session`; do not infer its endpoint solely from cwd. The existing client implements session listing/creation, `message.list`, prompt, interrupt, model/agent switching, fork, revert, permission replies and forms. Its projection and event modules already preserve the original chat semantics.

Use the existing OpenCode adapter intact for this engine. An OpenHerdr capability endpoint can expose a verified engine binding, while server-side connection material remains private. For a newly created owned OpenCode conversation, associate the returned session ID with its Herdr pane. Do not create a second independent conversation merely to make the UI render.

### Codex

The installed CLI exposes app-server `daemon`, `proxy`, generated protocol bindings and stdio transport. Official [App Server documentation](https://learn.chatgpt.com/docs/app-server) provides stored-history reads, paginated turns/items, typed text/tool/reasoning events and approval requests. Use read-only `thread/read` and history pagination without resuming a live TUI merely to display it. Mutating operations require the same verified coordinator or an explicitly owned new conversation driver. Native model catalogs do not establish account entitlement.

Local source references exist in the separate checkout `../agent-orchestrator/backend/internal/adapters/chatdriver/codexappserver/`: `rpc.go`, `conversation.go`, `normalize.go`, `history.go` and their tests. They demonstrate concrete normalization and ownership issues, but target another integration/version. Inspect and reimplement the needed contract against the installed protocol; do not import that application or copy its account/provider setup.

### Claude and other engines

The separate checkout's `adapters/agent/claudecode/continuation.go` locates `<CLAUDE_CONFIG_DIR>/projects/<project>/<native-session-id>.jsonl`; its Codex counterpart uses the invocation's `CODEX_HOME` and active/archived session files. These are useful locator precedents, not evidence that a bare Herdr reference authorizes every file or defines its schema. Validate `source`, engine, reference kind, native ID and the selected process's actual state root. Path references must remain inside that verified provider state scope. Clear associations when the pane occupant/session reference changes.

Transcript readers can provide real historical text and tool records while the existing TUI remains the only writer. They cannot fabricate missing live approvals, resume controls or attachments. Add each engine's documented stream/ACP/SDK driver for those operations. The local `claude --help` currently fails because its launcher points to a missing Clawgod installation. No repair, provider change or credential change was made during this review. Claude runtime acceptance therefore needs a working explicitly selected installation before its adapter can be called complete.

All engines use a single conversation owner. The mapping should include server, machine, Herdr session, workspace, pane, observed agent reference and native conversation ID. The runtime must distinguish live, stored, disconnected, inaccessible and unsupported data. A screen-shaped approximation is not evidence for the underlying capability.

## Host operations and remote execution

Reuse local file/Git service logic where its dependencies can be injected without importing the full OpenCode startup. `server/lib/fs/routes.js` has real file operations and confinement logic, but its route registration expects project ownership dependencies. `GitAPI` and `server/lib/git/service.js` expose richer operations than the current `content.js` subset.

Resolve the target root on the server. A filename is relative to a pinned project/workspace owner; a pane changing cwd must not redirect an already open editor's save. Use existing content versions or expected bytes to report concurrent edits instead of overwriting them. Upload/download and authenticated assets must use the same selected server and credentials without long-lived tokens in URLs.

For remote machines, extend the already reviewed fixed SSH helper with a small typed host-operation family. Python and Git are explicit remote requirements; no background installation or shared service changes are implied. Keep inputs on stdin, root resolution on the target, limits/timeouts and unknown mutation results. Port only verified file/Git operations, with local/remote conformance cases; do not expose arbitrary `execCommands` as the implementation shortcut. The full upstream Git network/credential surface requires its own later adapter and existing authorization semantics.

## Bounded implementation units

Main owns the small shared identity/capability contract before these units split. Each worker changes only its assigned area and returns concrete Android-visible behavior plus the source that proves it.

| Unit | Owned area and prerequisite | Completion evidence |
| --- | --- | --- |
| Target and conversation binding | Herdr parsed schema, engine association registry and narrow conversation contract; no UI rewrite | Two machines with colliding pane IDs stay separate; an occupant change invalidates the old conversation; real native session reference survives parsing. |
| Android shell and navigation | Extract original mobile presentation in shared UI and compose the Herdr wrapper; consume target contract | Original navigation/visual behavior on Android, Back/keyboard/rotation and explicit stale-target behavior; original OpenChamber wrapper still works. |
| Local and remote Files/Git/worktrees | Server host operations, existing runtime adapters and content contracts; consume target contract | Same file-edit/Git/worktree flow on owned local and WSL fixtures; conflicts/errors are visible; no unrelated user data modified. |
| OpenCode conversation integration | Existing SDK/projection/sync binding and driver, chat action presentation seams | Android renders real history/tool cards, sends a turn, handles an actual approval/form and reconnects without duplicating it. |
| Codex and subsequent engine adapters | Provider-specific reader/driver modules and recorded protocol fixtures; consume conversation contract | Native-ID anchored history and typed live results, with single-writer behavior proved on owned sessions. Missing installed engines stay an explicit task, not a passing adapter. |
| Android native features | Dedicated Android Java/resources/manifest and existing native helper contracts | Pair/vault/relaunch first, then real file/image/paste/share and lifecycle tests. Main controls the emulator/device to avoid competing builds and gestures. |
| Remaining original features | Settings/config, notes/schedules, notifications/voice, multirun/spaces/extensions in their owning modules | Each inventory row gets an original-to-adapted scenario and actual results; no blanket completion from a successful build. |

The first meaningful integrated increment is Android with the original mobile navigation, a real structured conversation, editable local/remote files, Git stage/commit and worktree creation. Continue after that increment: it does not settle the remaining inventory or the full-replication request.

## Decisions and escalation

- Recommended default is real OpenCode semantics first for structured parity, while preserving and extending access to existing Herdr agents. This changes the implementation order, not the promised feature scope.
- Existing agents remain in their current processes. Attaching a new writer to an already active native session requires evidence that the engine coordinates ownership; otherwise restrict the new adapter to reading that session and create new owned sessions for interactive driver validation.
- Android is the acceptance surface. Browser success and iOS build success remain supporting checks only.
- Dot delivery callbacks remain delivery evidence. A substantive design/dispatch response is still a separate unfinished item.
- T4 review is sufficient for the source-backed plan above. Escalate the concrete question through the required Luna-to-Pro flow if the team cannot establish a safe native-session ownership mechanism, or if full parity would require migrating live agents or changing providers/shared services. Do not let that block independent Android shell and host-operation work.

This plan was written from source, installed CLI help/schema and the linked official protocol documentation. No production source, running agent, provider configuration, credential, build or emulator was changed during this review.
