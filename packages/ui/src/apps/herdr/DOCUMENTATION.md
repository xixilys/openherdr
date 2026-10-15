# Herdr mobile shell

`HerdrMobileShell` composes the original mobile header and drawer presentation
with controller-owned Herdr content. It performs no I/O and creates no OpenCode
session records. The existing OpenCode containers use the same extracted views.

## Shared presentation

- `../MobileHeaderView.tsx` owns the existing header markup. `MobileHeader.tsx`
  retains OpenCode session lookup, metadata, Space access and the recent-session
  switcher. The view accepts title content, disclosure state/callback/ref,
  sessions/workspace callbacks, and metadata/actions nodes.
- `../MobileSessionSwitcherView.tsx` owns the original title popup, phone/tablet
  positioning, entry/exit animation, row layout and outside/Escape/Back closure.
  It reads no OpenCode stores and performs no I/O. `MobileSessionSwitcher.tsx`
  retains the original recent-session ordering, refresh on open, project/session
  selection and leaf subscriptions for live activity, unread state and duration.
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

`../MobileFilesView.tsx` owns the original phone Files header, browser search,
file rows, loading/empty states and file back row. It receives a root, a browser
or file route, entries, search state and navigation callbacks. Entry action
nodes, browser actions, file-header actions and editor children are presentation
slots. It reads no OpenCode stores, effective directory or runtime APIs.
`MobileFilesSurface` retains the original directory, search, uploads, file-change
subscription, pending global file focus and lazy full editor. Herdr supplies its
host-owned directory and manual editor through the same view.

`../MobileConnectionWelcomeView.tsx` owns the original connection welcome
geometry, scan action, saved rows and collapsing manual section. It accepts
caller-supplied logo, title, notice, manual/replacement forms and toolbar, plus
scan state, saved display records and callbacks. It imports no connection store,
scanner or runtime bootstrap. The original `MobileConnectionWelcome` keeps its
connection hook, password flow, QR lifecycle, URL payload parsing and long-press
diagnostics. Herdr supplies its own pairing/confirmation owner through the same
view without exposing original connection or token records to the presentation.
The manual form remains mounted while collapsed; its owner controls hidden input
tab order and its own errors. The view shows its separate error only when manual
entry is closed. Replacement forms own their contents and error presentation.

`MobileConnectionWelcomeView.vitest.tsx` covers original phone geometry,
source-free view rendering, supplied manual/replacement forms, scan/saved/manual
callbacks, busy rows, and the original wrapper's saved metadata, notice, keyboard
attributes and logo diagnostics. It performs no server requests. Native scanning,
secure storage and actual pairing/recovery remain controller/runtime acceptance.

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

- `header: {title,metadata?,actions?,onTitleClick?,titleButtonRef?,titleExpanded?}`
  and `children` for the main content. The title callback controls conversation
  navigation independently of the left sessions button. Omitting the callback
  retains the previous target-drawer action. Optional `headerPopover` renders
  a controller-owned popup beside the header in the same chat column. A fixed
  `MobileSessionSwitcherView` may also render inside the main content with that
  shared title anchor, without a portal.
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

`MobileSessionSwitcherView` accepts `{open,onClose,anchorRef,rows,selectedId?,
onSelect,onCreate?,createDisabled?,footer?}`. Rows are
`{id,title,subtitle?,activity?:'idle'|'running'|'unknown',trailing?}`. The caller
owns order, pagination, permission to create and the source of live activity.
An explicit unknown state remains visible as unknown. The optional trailing
node carries the original OpenCode activity/time presentation. `onSelect(id)`
and enabled `onCreate()` each close the popup after invoking the callback.
The optional footer holds pagination or session actions outside row buttons.
The OpenCode wrapper supplies neither creation nor footer, preserving its
existing contents. Its rows stay subscribed through the 140 ms closing phase.

## Integration and validation

The shell is ready for the dedicated Herdr entrypoint to mount with real
controller nodes. It does not itself replace `HerdrApp`, implement Files/Git/chat
APIs, or claim complete feature parity. Its current composition is the phone
layout; the shared workspace view retains its inline panel variant for a later
tablet controller.

Focused component tests check pure import without legacy I/O, original phone
row geometry, tablet anchor clamping in English and Arabic, selection,
creation disablement, footer placement, outside/Escape/Back, exit retention,
the original OpenCode wrapper's recent limit and project/session selection,
and independent Herdr title/list callbacks with the real anchor ref.
Focused server rendering checked header slots/disclosure and preserved an
unavailable target without selecting supplied sibling rows. Syntax and scoped
lint checked the extracted sources. Android rendering, edge gestures, native
Back, and the upstream OpenCode screen regression require the owning integrated
runtime. Static rendering does not establish those interactions.

The dedicated conversation's floating composer uses the original CodeMirror
editor, mobile shell and viewport pin. `ConversationComposer.vitest.tsx` checks
actual DOM focus, preview/expanded transitions, selection/draft retention,
mobile Enter and IME guards, queue and mutation locks, picker handoffs, hidden
and changed owners, native cancel events, tablet expansion and Back-layer order.
The real conversation tests also retain permission/form priority, stream recovery
and chat-to-file reading position around this editor. Native keyboard, file
picker and Android system Back behavior still require device acceptance.

Native slash candidates use the original command view with explicit native
registry input. `ConversationComposer.vitest.tsx` covers lazy opening, original
ranking and geometry, arrows/Ctrl+N/P/Tab/Enter, IME, loading/error/empty states,
Back priority, picker handoff and stale-source cancellation. The actual
`ConversationPanel` in `ConversationSlash.vitest.tsx` verifies registry request
scope and freshness, native command and skill routing, preserved text/files/
delivery, no dispatch on lookup failure or changed drafts/owners, null command
receipts and durable unknown-delivery locks. These are DOM/request tests, not
Android runtime or provider acceptance.
