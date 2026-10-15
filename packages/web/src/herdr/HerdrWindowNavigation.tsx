import { useMemo, useRef, useState } from 'react';
import { MobileSessionRowView } from '@openchamber/ui/apps/MobileSessionRowView';
import { MobileSessionsSearchResultsView } from '@openchamber/ui/apps/MobileSessionsSearchResultsView';
import { SessionSearchInput } from '@openchamber/ui/components/session/SessionSearchInput';
import { Button } from '@openchamber/ui/components/ui/button';
import { ScrollShadow } from '@openchamber/ui/components/ui/ScrollShadow';
import { Icon } from '@openchamber/ui/components/icon/Icon';
import { useI18n } from '@openchamber/ui/lib/i18n';
import { useHerdrText } from './herdr.i18n';
import { paneDisplayName, projectWindowNavigation, type WindowSelection, type WindowSnapshot } from './window-navigation';

type HerdrWindowNavigationProps = {
  snapshot: WindowSnapshot | null;
  workspaceId: string;
  tabId: string;
  paneId: string;
  active: boolean;
  disabled: boolean;
  loading: boolean;
  isMobile: boolean;
  onSelect: (selection: WindowSelection) => void;
};

/** Discovery changes local selection only; it never sends input or reads pane contents. */
export function HerdrWindowNavigation({ snapshot, workspaceId, tabId, paneId, active, disabled, loading, isMobile, onSelect }: HerdrWindowNavigationProps) {
  const { t } = useI18n();
  const h = useHerdrText();
  const [query, setQuery] = useState('');
  // The original drawer keeps its closing rows mounted. Hold that presentation
  // while hidden instead of projecting every background snapshot into it.
  const heldSnapshot = useRef(snapshot);
  if (active) heldSnapshot.current = snapshot;
  const presentedSnapshot = active ? snapshot : heldSnapshot.current;
  const navigation = useMemo(() => projectWindowNavigation(presentedSnapshot, query), [presentedSnapshot, query]);
  const unavailable = disabled || !active;
  const paneRow = (workspace: WindowSnapshot['workspaces'][number], tab: WindowSnapshot['tabs'][number], pane: WindowSnapshot['panes'][number], contextual: boolean) => (
    <MobileSessionRowView
      title={paneDisplayName(pane)} active={pane.pane_id === paneId && tab.tab_id === tabId && workspace.workspace_id === workspaceId}
      indent={contextual ? 12 : 36} disabled={unavailable}
      contextLabel={contextual ? [workspace.label, tab.label, pane.foreground_cwd ?? pane.cwd].filter(Boolean).join(' · ') : undefined}
      trailing={<i className={`herdr-status ${disabled ? 'unknown' : pane.agent_status}`} title={disabled ? undefined : pane.agent_status} />}
      onSelect={() => onSelect({ kind: 'pane', workspaceId: workspace.workspace_id, tabId: tab.tab_id, paneId: pane.pane_id, terminalId: pane.terminal_id })}
    />
  );
  const matches = navigation.matches;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-3 pb-2 pt-1">
      <SessionSearchInput value={query} onSearch={setQuery} placeholder={t('herdr.monitor.search')} clearLabel={t('sessions.sidebar.header.search.clear')} mobile={isMobile} active={active} />
    </div>
    <ScrollShadow className="min-h-0 flex-1 overflow-y-auto pb-3">
      <nav aria-label={h('workspaces')}>
        {matches && presentedSnapshot ? <>
          <MobileSessionsSearchResultsView sections={[
            { id: 'panes', label: t('herdr.monitor.panes'), count: matches.panes.length, rows: matches.panes.map(({ workspace, tab, pane }, index) => <div key={pane.pane_id} className={index > 0 ? 'border-t border-border/70' : undefined}>{paneRow(workspace, tab, pane, true)}</div>) },
            { id: 'tabs', label: t('herdr.monitor.tabs'), count: matches.tabs.length, rows: matches.tabs.map(({ workspace, tab }, index) => <div key={tab.tab_id} className={index > 0 ? 'border-t border-border/70' : undefined}><MobileSessionRowView title={tab.label} contextLabel={workspace.label} active={tab.tab_id === tabId && workspace.workspace_id === workspaceId} indent={12} disabled={unavailable} onSelect={() => onSelect({ kind: 'tab', workspaceId: workspace.workspace_id, tabId: tab.tab_id })} /></div>) },
            { id: 'workspaces', label: h('workspaces'), count: matches.workspaces.length, rows: matches.workspaces.map((workspace, index) => <div key={workspace.workspace_id} className={index > 0 ? 'border-t border-border/70' : undefined}><MobileSessionRowView title={workspace.label} active={workspace.workspace_id === workspaceId} indent={12} disabled={unavailable} onSelect={() => onSelect({ kind: 'workspace', workspaceId: workspace.workspace_id })} /></div>) },
          ]} />
          {matches.panes.length + matches.tabs.length + matches.workspaces.length === 0 ? <div className="px-6 py-8 text-center"><Icon name="search" className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="typography-ui-label">{t('mobile.sessions.empty.searchTitle')}</p><p className="mt-1 typography-meta text-muted-foreground">{t('mobile.sessions.empty.searchDescription')}</p></div> : null}
        </> : <div className="px-2">
          {navigation.tree.map(({ workspace, tabs }) => <div key={workspace.workspace_id}>
            <Button variant="ghost" className={`herdr-workspace ${workspaceId === workspace.workspace_id ? 'is-selected' : ''}`} aria-pressed={workspaceId === workspace.workspace_id} disabled={unavailable} onClick={() => onSelect({ kind: 'workspace', workspaceId: workspace.workspace_id })}><Icon name="folder" className="size-4" /><span dir="auto">{workspace.label}</span><i className={`herdr-status ${disabled ? 'unknown' : workspace.agent_status}`} title={disabled ? undefined : workspace.agent_status} /></Button>
            {workspaceId === workspace.workspace_id ? tabs.map(({ tab, panes }) => <div key={tab.tab_id} className="herdr-session-group">
              <Button variant="ghost" className="herdr-workspace" aria-pressed={tabId === tab.tab_id} disabled={unavailable} onClick={() => onSelect({ kind: 'tab', workspaceId: workspace.workspace_id, tabId: tab.tab_id })}><Icon name="terminal" className="size-4" /><span dir="auto">{tab.label}</span></Button>
              {panes.map(pane => <div key={pane.pane_id}>{paneRow(workspace, tab, pane, false)}</div>)}
            </div>) : null}
          </div>)}
        </div>}
        {loading && !presentedSnapshot ? <p className="px-3 py-2 typography-meta text-muted-foreground">{t('common.loading')}</p> : null}
        {!loading && !presentedSnapshot ? <p className="px-3 py-2 typography-meta text-muted-foreground">{t('herdr.monitor.waiting')}</p> : null}
        {presentedSnapshot && navigation.tree.length === 0 ? <p className="px-3 py-2 typography-meta text-muted-foreground">{h('noWorkspaces')}</p> : null}
      </nav>
    </ScrollShadow>
  </div>;
}
