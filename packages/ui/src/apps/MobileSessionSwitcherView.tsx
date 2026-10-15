import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useTabletLayout } from '@/lib/device';
import { useI18n } from '@/lib/i18n';
import { isInsideOpenPopup, isTopmostBackLayer, registerBackLayer } from '@/lib/mobileBackLayers';
import { cn } from '@/lib/utils';

export const MOBILE_SESSION_SWITCHER_EXIT_MS = 140;
/** Matches the metadata popover's width. */
const TABLET_POPOVER_WIDTH = 380;

export type MobileSessionSwitcherRow = {
  id: string;
  title: string;
  subtitle?: string;
  activity?: 'idle' | 'running' | 'unknown';
  /** Controller-owned live status and time, as used by the OpenCode wrapper. */
  trailing?: React.ReactNode;
};
export type MobileSessionSwitcherViewProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  rows: readonly MobileSessionSwitcherRow[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  createDisabled?: boolean;
  footer?: React.ReactNode;
};

/** Original mobile session popup with controller-owned rows and actions. */
export function MobileSessionSwitcherView({ open, onClose, anchorRef, rows, selectedId, onSelect, onCreate, createDisabled = false, footer }: MobileSessionSwitcherViewProps) {
  const { t } = useI18n();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = React.useState(open);
  const [isExiting, setIsExiting] = React.useState(false);
  const { enabled: isTabletLayout } = useTabletLayout();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [anchorLeft, setAnchorLeft] = React.useState<number | null>(null);
  const closeRef = React.useRef(onClose);
  React.useLayoutEffect(() => { closeRef.current = onClose; });
  const closeLayer = React.useCallback(() => closeRef.current(), []);

  // Fixed positioning is relative to the transformed chat column. These are
  // measured physical coordinates, including for an RTL title anchor.
  React.useLayoutEffect(() => {
    if (!open || !isTabletLayout || !shouldRender) return;
    const compute = () => {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!anchorRect || !wrapperRect) { setAnchorLeft(null); return; }
      const relativeLeft = anchorRect.left - wrapperRect.left;
      setAnchorLeft(Math.min(Math.max(relativeLeft, 8), Math.max(8, wrapperRect.width - TABLET_POPOVER_WIDTH - 8)));
    };
    compute();
    const wrapper = wrapperRef.current;
    if (!globalThis.ResizeObserver || !wrapper) return;
    const observer = new ResizeObserver(compute);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [anchorRef, isTabletLayout, open, shouldRender]);
  const isPopover = isTabletLayout && anchorLeft !== null;

  React.useEffect(() => {
    if (open) { setShouldRender(true); setIsExiting(false); return; }
    if (!shouldRender) return;
    setIsExiting(true);
    const timeoutId = window.setTimeout(() => { setShouldRender(false); setIsExiting(false); }, MOBILE_SESSION_SWITCHER_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, shouldRender]);

  React.useEffect(() => {
    if (!open) return;
    return registerBackLayer(closeLayer);
  }, [closeLayer, open]);
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && isTopmostBackLayer(closeLayer) && !isInsideOpenPopup(event.target)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeLayer, onClose, open]);
  React.useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) { onClose(); return; }
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', closeIfOutside, true);
    return () => document.removeEventListener('pointerdown', closeIfOutside, true);
  }, [anchorRef, onClose, open]);

  if (!shouldRender) return null;
  return <div ref={wrapperRef} className="fixed inset-s-0 inset-e-0 bottom-0 top-[calc(var(--oc-safe-area-top,0px)+var(--oc-header-height,56px))] z-20 pointer-events-none">
    <div ref={panelRef} role="dialog" aria-label={t('sessions.switcher.openAria')} className={cn(
      'oc-surface-elevated flex flex-col overflow-hidden rounded-[20px] border border-border/70 bg-surface-elevated p-2 shadow-[0_12px_32px_rgb(0_0_0_/_0.2)] will-change-transform',
      // The transform origin follows the measured physical anchor.
      isPopover ? 'absolute origin-top-left' : 'mx-3 mt-2',
      isExiting ? 'pointer-events-none' : 'pointer-events-auto',
    )} style={{
      animation: `${isExiting ? 'session-switcher-out' : 'session-switcher-in'} ${isExiting ? MOBILE_SESSION_SWITCHER_EXIT_MS : 170}ms cubic-bezier(0.32, 0.72, 0, 1) forwards`,
      maxHeight: 'min(72dvh, calc(100dvh - var(--oc-safe-area-top, 0px) - var(--oc-header-height, 56px) - 1rem))',
      ...(isPopover ? { top: 8, left: anchorLeft ?? 8, width: `min(${TABLET_POPOVER_WIDTH}px, calc(100% - 16px))` } : null),
    }}>
      <div className="oc-hide-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain">
        {rows.length === 0 ? <p className="px-3 py-6 text-center typography-small text-muted-foreground">{t('sessions.switcher.empty')}</p> : rows.map((row) => {
          const active = row.id === selectedId;
          return <button key={row.id} type="button" className={cn(
            'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition-colors active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            active && 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]',
          )} aria-pressed={active} onClick={() => { onSelect(row.id); onClose(); }} style={{ touchAction: 'manipulation' }}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span dir="auto" className={cn('block truncate oc-ui-start-align typography-ui-label', active ? 'text-primary' : 'text-foreground')}>{row.title.trim() || t('sessions.sidebar.session.untitled')}</span>
              {row.subtitle ? <span dir="auto" className="block truncate typography-micro text-muted-foreground">{row.subtitle}</span> : null}
            </span>
            {row.trailing !== undefined ? row.trailing : row.activity === 'running' ? <span className="inline-flex shrink-0 items-center justify-center" aria-label={t('sessions.sidebar.session.status.active')} title={t('sessions.sidebar.session.status.active')} data-session-activity-indicator="running"><Icon name="circle" className="size-3 text-status-info" /></span> : row.activity === 'unknown' ? <span className="shrink-0 typography-micro text-muted-foreground" data-session-activity-indicator="unknown">{t('desktopHostSwitcher.status.unknown')}</span> : null}
          </button>;
        })}
      </div>
      {onCreate ? <Button variant="ghost" className="mt-1 w-full justify-start gap-2" disabled={createDisabled} onClick={() => { onCreate(); onClose(); }}><Icon name="add" className="size-4" />{t('sessions.sidebar.header.actions.newSession')}</Button> : null}
      {footer}
    </div>
    <style>{`
      @keyframes session-switcher-in {
        from { opacity: 0; transform: translateY(-8px) scale(0.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes session-switcher-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-6px) scale(0.985); }
      }
    `}</style>
  </div>;
}
