import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icon/Icon';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SortableTabsStrip, type SortableTabsStripItem } from '@/components/ui/sortable-tabs-strip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isVimEditorEventTarget } from '@/lib/editorFocus';
import { useEdgeSwipe } from './useEdgeSwipe';

const DRAWER_ROOT_ID = 'mobile-surface-root';
const ENTER_DELAY_MS = 16;
// Slightly long, decelerating slide — matches the sessions drawer so both
// sides feel like the same piece of chrome.
const ENTER_DURATION_MS = 320;
const DRAWER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export type MobileWorkspacePanel<Tab extends string = string> = {
  id: Tab;
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
  /** A new content identity resets only that panel, such as a requested diff. */
  contentKey?: string;
  ownsEscape?: boolean;
};

export type MobileWorkspaceDrawerViewProps<Tab extends string> = {
  open: boolean;
  onClose: () => void;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  panels: readonly MobileWorkspacePanel<Tab>[];
  variant?: 'drawer' | 'panel';
};

export function MobileWorkspaceDrawerView<Tab extends string>({ open, onClose, tab, onTabChange, panels, variant = 'drawer' }: MobileWorkspaceDrawerViewProps<Tab>) {
  const { t, direction } = useI18n();
  const rootRef = React.useRef<HTMLElement | null>(null);
  const drawerRef = React.useRef<HTMLElement>(null);
  const [entered, setEntered] = React.useState(false);
  // Kept visible through the exit slide; flipped to hidden once it finishes.
  const [visible, setVisible] = React.useState(open);
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const escapeOwned = panels.find(panel => panel.id === tab)?.ownsEscape === true;
  const escapeOwnedRef = React.useRef(escapeOwned);
  React.useEffect(() => {
    escapeOwnedRef.current = escapeOwned;
  }, [escapeOwned]);

  // Swipe from the drawer's start edge back toward its end = close, the
  // reverse of the end-edge swipe that opened it from the chat. Only the
  // full-cover drawer has an edge to grab; the tablet panel is closed from the
  // header instead.
  const closeFromEdge = () => onCloseRef.current();
  useEdgeSwipe(drawerRef, {
    enabled: variant === 'drawer' && open,
    ...(direction === 'rtl' ? { onRightEdgeSwipe: closeFromEdge } : { onLeftEdgeSwipe: closeFromEdge }),
  });

  // Tabs the user has actually opened — their panes stay mounted afterwards.
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<Tab>>(() => new Set());
  React.useEffect(() => {
    if (!open) return;
    setVisitedTabs((current) => {
      if (current.has(tab)) return current;
      const next = new Set(current);
      next.add(tab);
      return next;
    });
  }, [open, tab]);

  if (globalThis.document && !rootRef.current) {
    let root = document.getElementById(DRAWER_ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = DRAWER_ROOT_ID;
      document.body.appendChild(root);
    }
    rootRef.current = root;
  }

  React.useEffect(() => {
    if (open) {
      setVisible(true);
      const id = window.setTimeout(() => setEntered(true), ENTER_DELAY_MS);
      return () => window.clearTimeout(id);
    }
    setEntered(false);
    const id = window.setTimeout(() => setVisible(false), ENTER_DURATION_MS + 40);
    return () => window.clearTimeout(id);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // Only the full-cover drawer owns the page scroll; the inline panel sits
    // inside the shell and must leave the chat beside it scrollable.
    const previousOverflow = document.body.style.overflow;
    if (variant === 'drawer') document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      // The terminal owns Escape (it goes to the PTY) — don't hijack it.
      // The same goes for the file editor on the Vim keymap, where Escape
      // leaves INSERT mode (hardware keyboards on tablets and phones).
      if (event.key !== 'Escape' || escapeOwnedRef.current) return;
      if (isVimEditorEventTarget(event.target)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (variant === 'drawer') document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, variant]);

  if (variant === 'drawer' && !rootRef.current) return null;

  const tabItems: SortableTabsStripItem[] = panels.map(panel => ({ id: panel.id, label: panel.label, icon: panel.icon }));

  const body = (
    <>
      <div className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3">
        <div className="flex h-9 min-w-0 flex-1 items-center">
          {/* Mounted only while shown; nonCompositedIndicator keeps the active
              pill off its own compositing layer — creating one inside the
              drawer's slide flickers in WKWebView. */}
          {visible ? (
            <SortableTabsStrip
              items={tabItems}
              activeId={tab}
              onSelect={(id) => { const selected = panels.find(panel => panel.id === id); if (selected) onTabChange(selected.id); }}
              layoutMode="fit"
              variant="active-pill"
              nonCompositedIndicator
              // Five tabs don't fit with labels — the active tab keeps
              // icon + label, the rest collapse to icons.
              inactiveTabsIconOnly
              className="h-full"
            />
          ) : null}
        </div>
        <button
          type="button"
          className="-me-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('mobile.surface.closeAria')}
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="close" className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Panes stay MOUNTED once visited (hidden when inactive/closed), so
            reopening the drawer lands exactly where the user left off — an
            open diff, an edited file, an attached terminal. */}
        {panels.map(panel => visitedTabs.has(panel.id) ? (
          <div key={panel.contentKey ?? panel.id} className={cn('h-full', tab !== panel.id && 'hidden')}>
            <ErrorBoundary>{panel.content}</ErrorBoundary>
          </div>
        ) : null)}
      </div>
    </>
  );

  if (variant === 'panel') {
    // The caller animates the width; the content itself is plain flow so it
    // never gets its own compositing layer (iOS clips those to the safe-area
    // viewport, which is exactly what the drawer's settled `transform: none`
    // avoids on the other host).
    return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">{body}</div>;
  }

  const portalRoot = rootRef.current;
  if (!portalRoot) return null;
  return createPortal(
    <section
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.header.openWorkspaceAria')}
      aria-hidden={!open}
      className="oc-keyboard-inset-surface oc-bottom-safe-surface fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      style={{
        paddingTop: 'var(--oc-safe-area-top, 0px)',
        // Settled state drops the transform entirely so the drawer isn't kept
        // on a compositing layer (iOS clips those to the safe-area viewport).
        transform: entered ? 'none' : direction === 'rtl' ? 'translateX(-100%)' : 'translateX(100%)',
        transition: `transform ${ENTER_DURATION_MS}ms ${DRAWER_EASING}`,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {body}
    </section>,
    portalRoot,
  );
}
