import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { McpIcon } from '@/components/icons/McpIcon';
import { McpDropdownContent } from '@/components/mcp/McpDropdown';
import { ProjectContextPanel } from '@/components/layout/RightSidebarTabs';
import { TerminalView } from '@/components/views/TerminalView';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ProjectRef } from '@/lib/projectContextApi';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useMcpConfigStore } from '@/stores/useMcpConfigStore';
import { useMcpStore } from '@/stores/useMcpStore';

import { MobileChangesSurface } from './MobileChangesSurface';
import { MobileFilesSurface } from './MobileFilesSurface';
import { MobileWorkspaceDrawerView, type MobileWorkspacePanel } from './MobileWorkspaceDrawerView';

export type MobileWorkspaceTab = 'changes' | 'files' | 'terminal' | 'notes' | 'mcp';

/** Quick MCP enable/disable toggles as a workspace pane, with its own slim
    action row (add server → settings, refresh) replacing the old fullscreen
    surface's header actions. */
const McpWorkspacePane: React.FC<{ onOpenMcpSettings: () => void; active: boolean }> = ({ onOpenMcpSettings, active }) => {
  const { t } = useI18n();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const refreshMcpStatus = useMcpStore((state) => state.refresh);
  const loadMcpConfigs = useMcpConfigStore((state) => state.loadMcpConfigs);

  const refresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const minSpinPromise = new Promise((resolve) => window.setTimeout(resolve, 500));
    void Promise.all([
      refreshMcpStatus({ directory: currentDirectory || null, silent: true }),
      loadMcpConfigs({ force: true }),
      minSpinPromise,
    ]).finally(() => setIsRefreshing(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 px-2 pt-1">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpenMcpSettings}
          aria-label={t('settings.mcp.sidebar.actions.addServerTitle')}
          title={t('settings.mcp.sidebar.actions.addServerTitle')}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="add" className="size-5" />
        </button>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label={t('mcpDropdown.actions.refreshAria')}
          title={t('mcpDropdown.actions.refreshAria')}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="refresh" className={cn('size-5', isRefreshing && 'animate-spin')} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <McpDropdownContent
          active={active}
          className="h-full"
          listClassName="max-h-none"
          hideHeader
          mobileListDensity
        />
      </div>
    </div>
  );
};

/** The workspace surfaces as tabs (Changes / Files / Terminal / Notes / MCP).

    Two hosts, same content and same state:
     - `drawer` (default) covers the app and slides in from the right edge —
       the phone, and a tablet in portrait where a side panel would leave no
       usable chat column;
     - `panel` renders inline so the caller can size it as a real sidebar
       beside the chat (tablet, landscape). The caller owns the width and the
       open/close animation there; this component only fills it.

    Closes via the header X, a left-edge swipe back toward the right (the
    mirror of the gesture that opened it), Escape (unless the terminal tab owns
    the keys), or the Android back button (handled by MobileShell). */
export const MobileWorkspaceDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  tab: MobileWorkspaceTab;
  onTabChange: (tab: MobileWorkspaceTab) => void;
  /** When set, the Changes tab opens directly into the per-file diff. */
  pendingChangesDiff: { path: string; staged: boolean } | null;
  /** Notes tab: opens a plan fullscreen (layered above the drawer). */
  onOpenPlan: (plan: { id: string; title: string; projectRef: ProjectRef }) => void;
  /** MCP tab: jump to the MCP settings page pre-seeded with a new server draft. */
  onOpenMcpSettings: () => void;
  variant?: 'drawer' | 'panel';
}> = ({ open, onClose, tab, onTabChange, pendingChangesDiff, onOpenPlan, onOpenMcpSettings, variant = 'drawer' }) => {
  const { t } = useI18n();
  const panels = [
    { id: 'changes', label: t('mobile.menu.git'), icon: <Icon name="git-branch" className="h-3.5 w-3.5" />, contentKey: pendingChangesDiff ? `changes:${pendingChangesDiff.path}:${pendingChangesDiff.staged}` : 'changes', content: <MobileChangesSurface visible={open && tab === 'changes'} initialDiff={pendingChangesDiff} onNavigatedToChat={onClose} /> },
    { id: 'files', label: t('mobile.menu.files'), icon: <Icon name="file-text" className="h-3.5 w-3.5" />, content: <MobileFilesSurface visible={open && tab === 'files'} /> },
    { id: 'terminal', label: t('mobile.menu.terminal'), icon: <Icon name="terminal" className="h-3.5 w-3.5" />, ownsEscape: true, content: <TerminalView visible={open && tab === 'terminal'} /> },
    { id: 'notes', label: t('contextRail.surface.notes'), icon: <Icon name="sticky-note" className="h-3.5 w-3.5" />, content: <ProjectContextPanel visible={open && tab === 'notes'} onActionComplete={onClose} onOpenPlan={onOpenPlan} /> },
    { id: 'mcp', label: t('mobile.menu.mcp'), icon: <McpIcon className="h-3.5 w-3.5" />, content: <McpWorkspacePane active={open && tab === 'mcp'} onOpenMcpSettings={onOpenMcpSettings} /> },
  ] satisfies MobileWorkspacePanel<MobileWorkspaceTab>[];
  return <MobileWorkspaceDrawerView open={open} onClose={onClose} tab={tab} onTabChange={onTabChange} panels={panels} variant={variant} />;
};
