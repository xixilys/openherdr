import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useI18n } from '@/lib/i18n';
import { registerBackLayer } from '@/lib/mobileBackLayers';
import { cn } from '@/lib/utils';
import { DedicatedMobileAppProvider } from '../mobileAppContext';
import { MobileHeaderView } from '../MobileHeaderView';
import { MobileSessionsDrawerView } from '../MobileSessionsDrawerView';
import { MobileWorkspaceDrawerView } from '../MobileWorkspaceDrawerView';
import { MobileFullscreenSurface } from '../MobileFullscreenSurface';
import { useEdgeSwipe } from '../useEdgeSwipe';
import type { HerdrMobileShellProps } from './types';

/** Original mobile chrome with controller-owned Herdr selection and content. */
export function HerdrMobileShell(props: HerdrMobileShellProps) {
  const { t, direction } = useI18n();
  const chatMainRef = React.useRef<HTMLElement>(null);
  const openSessionsFromEdge = () => { props.onWorkspaceOpenChange(false); props.onOpenSessions(); };
  const openWorkspaceFromEdge = () => { props.onSessionsOpenChange(false); props.onOpenWorkspace(); };
  useEdgeSwipe(chatMainRef, {
    enabled: !props.sessionsOpen && !props.workspaceOpen && !props.fullscreen?.open && !props.overlay?.open,
    onLeftEdgeSwipe: direction === 'rtl' ? openWorkspaceFromEdge : openSessionsFromEdge,
    onRightEdgeSwipe: direction === 'rtl' ? openSessionsFromEdge : openWorkspaceFromEdge,
  });
  const close = React.useRef({ sessions: props.onSessionsOpenChange, workspace: props.onWorkspaceOpenChange, fullscreen: props.fullscreen?.onOpenChange });
  React.useLayoutEffect(() => {
    close.current = { sessions: props.onSessionsOpenChange, workspace: props.onWorkspaceOpenChange, fullscreen: props.fullscreen?.onOpenChange };
  });
  // Native Back already consults this stack before the controller's fallback.
  // Register the shell in layout effects so a nested bottom sheet registers
  // above it in its own normal effect.
  React.useLayoutEffect(() => {
    if (!props.sessionsOpen) return;
    return registerBackLayer(() => close.current.sessions(false));
  }, [props.sessionsOpen]);
  React.useLayoutEffect(() => {
    if (!props.workspaceOpen) return;
    return registerBackLayer(() => close.current.workspace(false));
  }, [props.workspaceOpen]);
  React.useLayoutEffect(() => {
    if (!props.fullscreen?.open) return;
    return registerBackLayer(() => close.current.fullscreen?.(false));
  }, [props.fullscreen?.open]);

  return (
    <DedicatedMobileAppProvider actions={props.actions}>
      <div
        className="oc-mobile-app-shell main-content-safe-area flex h-[100dvh] flex-row bg-background text-foreground"
        data-page-scroll-lock="true"
        data-herdr-machine={props.target.machine}
        data-herdr-workspace={props.target.workspaceId}
        data-herdr-tab={props.target.tabId}
        data-herdr-pane={props.target.paneId}
        data-target-available={props.target.available}
      >
        <div className="flex h-full min-w-0 flex-1 flex-col" data-page-scroll-lock="true">
          <MobileHeaderView
            title={props.header.title}
            metadata={props.header.metadata}
            actions={props.header.actions}
            titleExpanded={props.header.titleExpanded ?? props.sessionsOpen}
            onTitleClick={props.header.onTitleClick ?? props.onOpenSessions}
            titleButtonRef={props.header.titleButtonRef}
            onOpenSessions={props.onOpenSessions}
            onOpenWorkspace={props.onOpenWorkspace}
          />
          {props.headerPopover}
          <main ref={chatMainRef} className="relative min-h-0 flex-1 overflow-hidden" data-page-scroll-lock="true">
            {props.children}
          </main>
        </div>
        <MobileSessionsDrawerView open={props.sessionsOpen} onClose={() => props.onSessionsOpenChange(false)} ariaLabel={t('mobile.sessions.sheet.title')}>
          <div className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3">
            <button
              type="button"
              className="-ms-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('mobile.surface.closeAria')}
              onClick={() => props.onSessionsOpenChange(false)}
              style={{ touchAction: 'manipulation' }}
            ><Icon name="close" className="size-5" /></button>
          </div>
          {props.sidebar ?? <>
            <ScrollShadow className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-1 px-2 pb-3">
                {props.workspaces.map(row => <Button key={row.id} variant="ghost" className="w-full justify-start gap-2.5" aria-pressed={row.active} onClick={() => props.onSelectWorkspace(row.id)}><Icon name="folder" className="size-4" /><span dir="auto" className="min-w-0 truncate oc-ui-start-align">{row.label}</span></Button>)}
                <p className="px-3 pb-1 pt-3 typography-micro text-muted-foreground">{t('mobile.sessions.search.section.sessions')}</p>
                {props.sessions.map(row => <button
                  key={row.id}
                  type="button"
                  className={cn('flex w-full min-w-0 items-center gap-2.5 pe-3.5 ps-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', row.subtitle ? 'min-h-10 py-1' : 'h-9', row.active && 'bg-interactive-selection text-interactive-selection-foreground')}
                  aria-pressed={row.active}
                  onClick={() => { props.onSelectSession(row.id); props.onSessionsOpenChange(false); }}
                  style={{ touchAction: 'manipulation' }}
                ><span className="flex min-w-0 flex-1 flex-col"><span dir="auto" className="block min-w-0 truncate oc-ui-start-align typography-ui-label">{row.title}</span>{row.subtitle && <span dir="auto" className="block truncate typography-micro text-muted-foreground">{row.subtitle}</span>}</span>{row.status && <span dir="auto" className="shrink-0 typography-micro text-muted-foreground">{row.status}</span>}</button>)}
              </div>
            </ScrollShadow>
          </>}
          {props.sidebarFooter && <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-2 pt-1.5" style={{ paddingBottom: 'calc(0.375rem + var(--oc-safe-area-bottom, 0px))' }}>{props.sidebarFooter}</div>}
        </MobileSessionsDrawerView>
        <MobileWorkspaceDrawerView open={props.workspaceOpen} onClose={() => props.onWorkspaceOpenChange(false)} tab={props.workspaceTab} onTabChange={props.onWorkspaceTabChange} panels={props.workspacePanels} />
        <MobileFullscreenSurface open={props.fullscreen?.open ?? false} onClose={() => props.fullscreen?.onOpenChange(false)} title={props.fullscreen?.title} ariaLabel={props.fullscreen?.ariaLabel} headerless={props.fullscreen?.headerless}>
          {props.fullscreen?.content}
        </MobileFullscreenSurface>
        <MobileOverlayPanel open={props.overlay?.open ?? false} onClose={() => props.overlay?.onOpenChange(false)} title={props.overlay?.title ?? ''} footer={props.overlay?.footer}>
          {props.overlay?.content}
        </MobileOverlayPanel>
      </div>
    </DedicatedMobileAppProvider>
  );
}
