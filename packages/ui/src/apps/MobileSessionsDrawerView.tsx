import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { useEdgeSwipe } from './useEdgeSwipe';

const DRAWER_ROOT_ID = 'mobile-surface-root';
const DRAWER_ENTER_DELAY_MS = 16;
// Slightly long, decelerating slide — matches the workspace drawer so both
// sides feel like the same piece of chrome.
const DRAWER_ENTER_DURATION_MS = 320;
const DRAWER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Full-width left drawer for the phone sessions list: covers the whole app
    and slides in from the left edge. Closes via the header X, a right-edge
    swipe back toward the left (the mirror of the gesture that opened it),
    Escape, or the Android back button (handled by MobileShell).

    Stays MOUNTED while closed (parked off-screen, hidden): the sessions
    sheet's project/worktree state stays warm, so reopening shows the tree
    instantly instead of refetching from scratch — and the close slide can
    actually play instead of the drawer vanishing on unmount. */
export const MobileSessionsDrawerView: React.FC<{
  open: boolean;
  onClose: () => void;
  /** What the closing edge swipe does; the drawer's owner may want it to undo
      a lighter state first. Falls back to `onClose`. */
  onSwipeClose?: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}> = ({ open, onClose, onSwipeClose, ariaLabel, children }) => {
  const { direction } = useI18n();
  const rootRef = React.useRef<HTMLElement | null>(null);
  const drawerRef = React.useRef<HTMLElement>(null);
  const [entered, setEntered] = React.useState(false);
  // Kept visible through the exit slide; flipped to hidden once it finishes.
  const [visible, setVisible] = React.useState(open);
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const onSwipeCloseRef = React.useRef(onSwipeClose);
  React.useEffect(() => {
    onSwipeCloseRef.current = onSwipeClose;
  }, [onSwipeClose]);

  // Swipe from the drawer's end edge back toward its start = close, the
  // reverse of the start-edge swipe that opened it from the chat. Rows inside
  // reveal their actions in the opposite direction, so the two never fight.
  const closeFromEdge = () => (onSwipeCloseRef.current ?? onCloseRef.current)();
  useEdgeSwipe(drawerRef, {
    enabled: open,
    ...(direction === 'rtl' ? { onLeftEdgeSwipe: closeFromEdge } : { onRightEdgeSwipe: closeFromEdge }),
  });

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
      const id = window.setTimeout(() => setEntered(true), DRAWER_ENTER_DELAY_MS);
      return () => window.clearTimeout(id);
    }
    setEntered(false);
    const id = window.setTimeout(() => setVisible(false), DRAWER_ENTER_DURATION_MS + 40);
    return () => window.clearTimeout(id);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!rootRef.current) return null;

  return createPortal(
    <section
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-hidden={!open}
      className="oc-keyboard-inset-surface fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      style={{
        paddingTop: 'var(--oc-safe-area-top, 0px)',
        // Settled state drops the transform entirely so the drawer isn't kept
        // on a compositing layer (iOS clips those to the safe-area viewport).
        transform: entered ? 'none' : direction === 'rtl' ? 'translateX(100%)' : 'translateX(-100%)',
        transition: `transform ${DRAWER_ENTER_DURATION_MS}ms ${DRAWER_EASING}`,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        {children}
      </div>
    </section>,
    rootRef.current,
  );
};

