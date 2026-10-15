import type { z } from 'zod';
import { rankByQuery } from '@openchamber/ui/lib/search/fuzzySearch';
import type { snapshotSchema } from './transport';

export type WindowSnapshot = z.infer<typeof snapshotSchema>['snapshot'];
type Workspace = WindowSnapshot['workspaces'][number];
type Tab = WindowSnapshot['tabs'][number];
type Pane = WindowSnapshot['panes'][number];

export type WindowSelection =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'tab'; workspaceId: string; tabId: string }
  | { kind: 'pane'; workspaceId: string; tabId: string; paneId: string; terminalId: string };

export interface WindowTabBranch {
  tab: Tab;
  panes: Pane[];
}

export interface WindowWorkspaceBranch {
  workspace: Workspace;
  tabs: WindowTabBranch[];
}

interface TabMatch {
  workspace: Workspace;
  tab: Tab;
}

interface PaneMatch extends TabMatch {
  pane: Pane;
}

export interface WindowNavigation {
  tree: WindowWorkspaceBranch[];
  matches: { workspaces: Workspace[]; tabs: TabMatch[]; panes: PaneMatch[] } | null;
}

export function paneDisplayName(pane: Pane): string {
  return pane.label?.trim() || pane.title?.trim() || pane.terminal_title_stripped?.trim() || pane.pane_id;
}

/** The selected machine's parsed snapshot is the only discovery source. */
export function projectWindowNavigation(snapshot: WindowSnapshot | null, query: string): WindowNavigation {
  const tree: WindowWorkspaceBranch[] = [];
  const workspaces = new Map<string, WindowWorkspaceBranch>();
  const tabs = new Map<string, WindowTabBranch>();
  for (const workspace of snapshot?.workspaces ?? []) {
    const branch = { workspace, tabs: [] } satisfies WindowWorkspaceBranch;
    tree.push(branch);
    workspaces.set(workspace.workspace_id, branch);
  }
  for (const tab of snapshot?.tabs ?? []) {
    const parent = workspaces.get(tab.workspace_id);
    if (!parent) continue;
    const branch = { tab, panes: [] } satisfies WindowTabBranch;
    parent.tabs.push(branch);
    tabs.set(tab.tab_id, branch);
  }
  for (const pane of snapshot?.panes ?? []) {
    const parent = tabs.get(pane.tab_id);
    if (parent?.tab.workspace_id === pane.workspace_id) parent.panes.push(pane);
  }
  const search = query.trim();
  if (!search) return { tree, matches: null };
  const tabMatches: TabMatch[] = [];
  const paneMatches: PaneMatch[] = [];
  for (const { workspace, tabs } of tree) {
    for (const { tab, panes } of tabs) {
      tabMatches.push({ workspace, tab });
      for (const pane of panes) paneMatches.push({ workspace, tab, pane });
    }
  }
  return {
    tree,
    matches: {
      workspaces: rankByQuery(tree.map(({ workspace }) => workspace), search, workspace => [workspace.label, workspace.workspace_id]),
      tabs: rankByQuery(tabMatches, search, ({ workspace, tab }) => [tab.label, tab.tab_id, workspace.label, workspace.workspace_id]),
      panes: rankByQuery(paneMatches, search, ({ workspace, tab, pane }) => [paneDisplayName(pane), pane.title, pane.pane_id, pane.terminal_title_stripped, tab.label, tab.tab_id, workspace.label, workspace.workspace_id, pane.cwd, pane.foreground_cwd]),
    },
  };
}
