# Herdr mobile shell

`HerdrMobileShell` composes the original mobile header and drawer presentation
with controller-owned Herdr content. It performs no I/O and creates no OpenCode
session records. The existing OpenCode containers use the same extracted views.

## Shared presentation

- `../MobileHeaderView.tsx` owns the existing header markup. `MobileHeader.tsx`
  retains OpenCode session lookup, metadata, Space access and the recent-session
  switcher. The view accepts title content, disclosure state/callback/ref,
  sessions/workspace callbacks, and metadata/actions nodes.
- `../MobileWorkspaceDrawerView.tsx` owns the existing tabs, visited-panel
  retention, left/right edge swipe, Escape handling, slide and panel variant.
  `MobileWorkspaceDrawer.tsx` supplies the original five data-owning panels.
- `../MobileSessionsDrawerView.tsx` owns the existing sessions drawer gesture,
  transition, portal and closed-state retention. `MobileSessionsSheet.tsx`
  retains its original project/session/worktree content and row actions.

A workspace panel has `{id,label,icon?,content,contentKey?,ownsEscape?}`. IDs are
stable and unique. Changing `contentKey` remounts only that panel, as required
when opening a new per-file diff. The terminal panel sets `ownsEscape: true`.
The owner supplies active/visible flags to data-owning panel content; keeping a
visited view mounted does not authorize hidden polling.

## Controller contract

`types.ts` defines the exact input records:

- Target: `{machine,workspaceId,tabId,paneId,available}`.
- Workspace row: `{id,label,active}`.
- Session row: `{id,title,subtitle?,active,status?}`.

The controller resolves these records from authoritative data. An unavailable
selection remains unavailable until the user selects another row. The shell
never selects a sibling, rewrites IDs or manufactures activity, transcript or
usage metadata. Row callbacks receive only the supplied ID. A session selection
closes the sessions drawer; a workspace selection leaves its session list open.

`HerdrMobileShellProps` also supplies:

- `header: {title,metadata?,actions?}` and `children` for the main content.
- `sessionsOpen/onSessionsOpenChange` and `workspaceOpen/onWorkspaceOpenChange`.
- `onOpenSessions/onOpenWorkspace`, invoked by the original header controls.
  These controller actions open the requested drawer and close the other one.
- `workspaceTab/onWorkspaceTabChange/workspacePanels` for workspace content.
- Optional `sidebar` body and `sidebarFooter`. Without a body override, the
  shell renders the supplied workspace/session rows using existing mobile row
  typography and the shared selection tokens.
- `actions`, the existing `MobileAppActions` contract, passed unchanged through
  `DedicatedMobileAppProvider`.
- `fullscreen` and `overlay`, each either a controlled content record or null.
  They use the existing `MobileFullscreenSurface` and `MobileOverlayPanel`.

The shell registers open drawers and fullscreen content with `mobileBackLayers`.
The owning native root continues to use `useNativeAndroidBackButton` and checks
`closeTopmostBackLayer()` before minimizing. Nested dialogs and bottom sheets
retain their existing close handling. The shell does not add an App listener.

## Integration and validation

The shell is ready for the dedicated Herdr entrypoint to mount with real
controller nodes. It does not itself replace `HerdrApp`, implement Files/Git/chat
APIs, or claim complete feature parity. Its current composition is the phone
layout; the shared workspace view retains its inline panel variant for a later
tablet controller.

Focused server rendering checked header slots/disclosure and preserved an
unavailable target without selecting supplied sibling rows. Syntax and scoped
lint checked the extracted sources. Android rendering, edge gestures, native
Back, and the upstream OpenCode screen regression require the owning integrated
runtime. Static rendering does not establish those interactions.
