import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { z } from 'zod';
import { isCapacitorApp } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { CSSVariableGenerator } from '@/lib/theme/cssGenerator';
import { requireTheme } from '@/lib/theme/definition';
import lightDefinition from '@/lib/theme/themes/openchamber-light.json';
import darkDefinition from '@/lib/theme/themes/openchamber-dark.json';
import { useHerdrText } from './herdr.i18n';
import { usePolling } from './usePolling';
import { isHerdrForeground, useHerdrNative } from '@openchamber/ui/lib/herdr-native';
import { closeTopmostBackLayer } from '@/lib/mobileBackLayers';
import { shouldSubmitEnter } from '@/components/chat/composer/keyboardPolicy';
import { useDeviceInfo } from '@/lib/device';
import { FilesPanel, ChangesPanel } from './ContentPanel';
import { LiveTerminal } from './LiveTerminal';
import { PaneMonitor } from './PaneMonitor';
import { ConversationPanel } from './ConversationPanel';
import type { WorkspaceFileRequest } from './workspace-navigation';
import { PreferencesPanel } from './PreferencesPanel';
import { ProjectContextPanel } from './ProjectContextPanel';
import { useHerdrPreferences } from './useHerdrPreferences';
import { applyHerdrPreferencesAppearance, resolveHerdrTheme } from './preferences-appearance';
import { HerdrConnectionController } from './connection-controller';
import { ConnectionWelcome } from './ConnectionWelcome';
import { clearLastTarget, matchesLastTarget, readLastTarget, rememberLastTarget, type LastTarget } from './last-target';
import { HerdrMobileShell } from '@openchamber/ui/apps/herdr/HerdrMobileShell';
import { MobileWorkspaceDrawerView, type MobileWorkspacePanel } from '@/apps/MobileWorkspaceDrawerView';
import { HerdrTransport, TransportError, clearPendingDelivery, deliveryReceiptSchema, loadPendingDelivery, clientsSchema, credentialStorageKind, forgetConnection, infoSchema, machinesSchema, initializeConnections, readSchema, redeem, savedConnections, saveConnection, snapshotSchema, worktreesSchema, type Connection, type Mutation, type Pairing, type PendingDelivery, type NativeMutationResult } from './transport';
import './herdr.css';

type Panel = 'terminal' | 'worktrees' | 'devices' | 'files' | 'changes' | 'context';
type Action = { kind: 'workspace.create' | 'workspace.rename' | 'tab.create' | 'tab.rename' | 'pane.rename' | 'agent.start' | 'worktree.create' | 'worktree.open'; title: string; target?: string; value: string } | { kind: 'workspace.close' | 'tab.close' | 'pane.close' | 'revoke' | 'worktree.remove'; title: string; target: string };
type DeliveryState = { kind: 'loading' } | { kind: 'clear' } | { kind: 'pending'; record: PendingDelivery } | { kind: 'storageError' };
type TargetRestore = { kind: 'pending' | 'unavailable'; target: LastTarget };
const lightTheme = requireTheme(lightDefinition);
const darkTheme = requireTheme(darkDefinition);

export function HerdrApp({ initialPairing, initialError }: { initialPairing: Pairing | null; initialError: string | null }) {
  const { t, locale, locales, label, setLocale } = useI18n();
  const [connection, setConnection] = useState<Connection | null>(() => initialError ? null : savedConnections()[0] ?? null);
  const [connectOpen, setConnectOpen] = useState(!!initialPairing || !!initialError);
  const currentConnection = useRef(connection);
  currentConnection.current = connection;
  const [flow] = useState(() => new HerdrConnectionController({ initialize: initializeConnections, list: savedConnections, redeem, save: saveConnection }, result => {
    currentConnection.current = result;
    setConnection(result); setConnectOpen(false);
  }, {
    server: initialPairing?.server ?? (!isCapacitorApp() && /^https?:$/.test(window.location.protocol) ? window.location.origin : ''),
    pairing: initialPairing, error: initialError,
  }));
  useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  useEffect(() => { flow.setActive(true); return () => flow.setActive(false); }, [flow]);
  const backHandler = useRef<(() => boolean) | null>(null);
  const installBackHandler = useCallback((handler: (() => boolean) | null) => { backHandler.current = handler; }, []);
  const connectionPage = useRef({ open: connectOpen, connected: !!connection });
  connectionPage.current = { open: connectOpen, connected: !!connection };
  const closeConnection = useCallback(() => {
    if (currentConnection.current && flow.isRejected(currentConnection.current)) return;
    if (['editing', 'save-failed'].includes(flow.getSnapshot().phase)) { connectionPage.current.open = false; setConnectOpen(false); }
  }, [flow]);
  const nativeBack = useCallback(() => {
    if (closeTopmostBackLayer()) return true;
    if (connectionPage.current.open) {
      if (currentConnection.current && flow.isRejected(currentConnection.current)) return false;
      if (connectionPage.current.connected) { closeConnection(); return true; }
      return false;
    }
    return backHandler.current?.() || false;
  }, [closeConnection, flow]);
  const requireAuthentication = useCallback((rejected: Connection) => {
    const current = currentConnection.current;
    if (!current || current.server !== rejected.server || current.token !== rejected.token) return;
    flow.requireAuthentication(rejected, connectionPage.current.open);
    connectionPage.current.open = true;
    setConnectOpen(true);
  }, [flow]);
  const nativePairing = useCallback((url: string) => { connectionPage.current.open = true; flow.acceptLink(url); setConnectOpen(true); }, [flow]);
  useHerdrNative(nativeBack, nativePairing);
  const [dark, setDark] = useState(() => localStorage.getItem('openherdr.theme') !== 'light');
  useEffect(() => { if (connection) return; new CSSVariableGenerator().apply(dark ? darkTheme : lightTheme); localStorage.setItem('openherdr.theme', dark ? 'dark' : 'light'); }, [dark, connection]);
  const languageControls = <select className={dropdownTriggerVariants()} value={locale} onChange={event => { const next = locales.find(item => item === event.target.value); if (next) void setLocale(next); }} aria-label={t('settings.appearance.language.label')}>{locales.map(item => <option key={item} value={item}>{label(item)}</option>)}</select>;
  const commonControls = <><Button variant="ghost" size="icon" aria-label={t(dark ? 'contextPanel.browser.device.schemeLight' : 'contextPanel.browser.device.schemeDark')} onClick={() => setDark(!dark)}><Icon name={dark ? 'lightbulb' : 'flashlight'} className="size-4" /></Button>{languageControls}</>;

  const welcome = <ConnectionWelcome controller={flow} toolbar={connection ? languageControls : commonControls} onClose={connection && !flow.isRejected(connection) ? closeConnection : null} />;
  if (!connection) return welcome;
  return <><div hidden={connectOpen}><ConnectedApp visible={!connectOpen} installBackHandler={installBackHandler} key={connection.server} connection={connection} onAuthenticationRequired={requireAuthentication} languageControls={languageControls} disconnect={async () => { await forgetConnection(connection.server); flow.refreshSaved(); currentConnection.current = null; setConnection(null); }} changeServer={() => { connectionPage.current.open = true; flow.refreshSaved(); setConnectOpen(true); }} /></div>{connectOpen && welcome}</>;
}

function ConnectedApp({ visible, installBackHandler, connection, onAuthenticationRequired, languageControls, disconnect, changeServer }: { visible: boolean; installBackHandler: (handler: (() => boolean) | null) => void; connection: Connection; onAuthenticationRequired: (connection: Connection) => void; languageControls: React.ReactNode; disconnect: () => Promise<void>; changeServer: () => void }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const transport = useMemo(() => new HerdrTransport(connection, undefined, onAuthenticationRequired), [connection, onAuthenticationRequired]);
  const [restore, setRestore] = useState<TargetRestore | null>(() => {
    const target = readLastTarget(connection.server);
    return target ? { kind: 'pending', target } : null;
  });
  const restoreOwner = useRef(restore);
  restoreOwner.current = restore;
  const lastTargetAttempt = useRef(restore ? JSON.stringify(restore.target) : null);
  const cancelRestore = useCallback(() => { restoreOwner.current = null; setRestore(null); }, []);
  const [machine, setMachine] = useState(() => restore?.target.machine ?? 'local');
  const [workspaceId, setWorkspaceId] = useState(() => restore?.target.workspaceId ?? '');
  const [tabId, setTabId] = useState(() => restore?.target.tabId ?? '');
  const [paneId, setPaneId] = useState(() => restore?.target.paneId ?? '');
  const [panel, setPanel] = useState<Panel>('files');
  const [mainView, setMainView] = useState<'monitor' | 'chat'>('monitor');
  const [chatVisited, setChatVisited] = useState(false);
  const [nativeForeground, setForeground] = useState(() => isHerdrForeground() && navigator.onLine !== false);
  useEffect(() => {
    const changed = () => setForeground(isHerdrForeground() && navigator.onLine !== false);
    document.addEventListener('visibilitychange', changed);
    for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.addEventListener(event, changed);
    return () => { document.removeEventListener('visibilitychange', changed); for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.removeEventListener(event, changed); };
  }, []);
  const foreground = visible && nativeForeground;
  const [drawer, setDrawer] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationSwitcherOpen, setConversationSwitcherOpen] = useState(false);
  useEffect(() => {
    if (visible) return;
    setDrawer(false); setWorkspaceOpen(false); setSettingsOpen(false); setConversationSwitcherOpen(false);
  }, [visible]);
  const [conversationHeader, setConversationHeader] = useState<{ owner: string; title: string } | null>(null);
  const conversationTitleButton = useRef<HTMLButtonElement>(null);
  const conversationOwner = JSON.stringify([connection.server, machine, paneId]);
  const updateConversationTitle = useCallback((title: string | null) => {
    setConversationHeader(current => {
      if (title === null) return current?.owner === conversationOwner ? null : current;
      return current?.owner === conversationOwner && current.title === title ? current : { owner: conversationOwner, title };
    });
  }, [conversationOwner]);
  useEffect(() => { setConversationSwitcherOpen(false); }, [conversationOwner]);
  useEffect(() => { if (drawer || workspaceOpen || settingsOpen) setConversationSwitcherOpen(false); }, [drawer, settingsOpen, workspaceOpen]);
  const [worktreeBase, setWorktreeBase] = useState('');
  const [requestedFile, setRequestedFile] = useState<WorkspaceFileRequest | null>(null);
  useEffect(() => setRequestedFile(null), [machine, paneId]);
  const [requestedDiff, setRequestedDiff] = useState<{ path: string; staged?: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryState>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void loadPendingDelivery(connection.server).then(record => {
      if (live) setDelivery(record ? { kind: 'pending', record } : { kind: 'clear' });
    }).catch(() => { if (live) setDelivery({ kind: 'storageError' }); });
    return () => { live = false; };
  }, [connection.server]);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const mutationInFlight = useRef(false);
  const mutationBlocked = busy || delivery.kind !== 'clear';
  const [notice, setNotice] = useState<{ text: string; uncertain: boolean } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [actionCwd, setActionCwd] = useState('');
  const [agentKind, setAgentKind] = useState('codex');
  const [draft, setDraft] = useState('');
  const [follow, setFollow] = useState(true);
  const [frames, setFrames] = useState(true);
  const output = useRef<HTMLPreElement>(null);
  const { isMobile: mobileLayout, screenWidth } = useDeviceInfo();
  const isMobile = mobileLayout || screenWidth <= 720 || credentialStorageKind() === 'native';
  useEffect(() => {
    installBackHandler(() => {
      if (action) { if (!busy) setAction(null); return true; }
      if (drawer) { setDrawer(false); return true; }
      if (settingsOpen) { setSettingsOpen(false); return true; }
      if (workspaceOpen) { setWorkspaceOpen(false); return true; }
      return false;
    });
    return () => installBackHandler(null);
  }, [installBackHandler, action, busy, drawer, workspaceOpen, settingsOpen]);
  const scope = `${machine}:${workspaceId}:${tabId}:${paneId}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const readMachines = useCallback((signal: AbortSignal) => { void refresh; return transport.request('/api/herdr/machines', machinesSchema, { signal }); }, [transport, refresh]);
  const machines = usePolling(readMachines, visible, 15000);
  const readInfo = useCallback((signal: AbortSignal) => transport.request('/api/herdr/info', infoSchema, { signal }), [transport]);
  const info = usePolling(readInfo, visible, 30000);
  const preferences = useHerdrPreferences(transport, isMobile ? 'mobile' : 'web', visible);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setPrefersDark(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  const theme = useMemo(() => resolveHerdrTheme(preferences.state.values, prefersDark), [preferences.state.values, prefersDark]);
  const dark = theme.metadata.variant === 'dark';
  const allowRemoteFonts = !info.error && !info.loading && (info.data?.allowRemoteFonts ?? false);
  useEffect(() => { applyHerdrPreferencesAppearance(preferences.state.values, { prefersDark, allowRemoteFonts }); }, [preferences.state.values, prefersDark, allowRemoteFonts]);
  const commonControls = <><Button variant="ghost" size="icon" disabled={!preferences.state.snapshot || preferences.state.saving} aria-label={t(dark ? 'contextPanel.browser.device.schemeLight' : 'contextPanel.browser.device.schemeDark')} onClick={() => { preferences.controller.change({ useSystemTheme: false, themeId: dark ? preferences.state.values.lightThemeId : preferences.state.values.darkThemeId }); void preferences.controller.save(); }}><Icon name={dark ? 'lightbulb' : 'flashlight'} className="size-4" /></Button>{languageControls}</>;
  const settingsContent = <PreferencesPanel model={preferences} allowRemoteFonts={allowRemoteFonts} />;
  const knownMachine = !!machines.data && !machines.error && !machines.loading && machines.data.machines.some(item => item.id === machine);
  const readSnapshot = useCallback((signal: AbortSignal) => { void refresh; return transport.rpc(machine, 'session.snapshot', {}, snapshotSchema, signal).then(result => ({ ...result.snapshot, readAt: Date.now(), transport })); }, [transport, machine, refresh]);
  const snapshot = usePolling(readSnapshot, visible && (!restore || knownMachine), 3000, machine);
  const freshSnapshot = snapshot.data?.transport === transport && !snapshot.error && !snapshot.loading;
  const workspaces = snapshot.data?.workspaces ?? [];
  const workspace = workspaces.find(item => item.workspace_id === workspaceId);
  const tabs = snapshot.data?.tabs.filter(item => item.workspace_id === workspace?.workspace_id) ?? [];
  const tab = tabs.find(item => item.tab_id === tabId);
  const panes = snapshot.data?.panes.filter(item => item.tab_id === tab?.tab_id) ?? [];
  const pane = restore ? undefined : panes.find(item => item.pane_id === paneId);
  useEffect(() => {
    if (!restore || restore.kind !== 'pending' || restoreOwner.current !== restore || machine !== restore.target.machine) return;
    if (!machines.data || machines.error || machines.loading) return;
    if (knownMachine && (!snapshot.data || !freshSnapshot)) return;
    if (knownMachine && snapshot.data && matchesLastTarget(restore.target, machine, snapshot.data)) {
      restoreOwner.current = null;
      setRestore(null);
      return;
    }
    clearLastTarget(connection.server);
    lastTargetAttempt.current = null;
    const unavailable: TargetRestore = { kind: 'unavailable', target: restore.target };
    restoreOwner.current = unavailable;
    setRestore(unavailable);
  }, [restore, machine, machines.data, machines.error, machines.loading, knownMachine, snapshot.data, freshSnapshot, connection.server]);
  useEffect(() => {
    if (restore || !snapshot.data) return;
    // A receipt can predate parent metadata. Recover only the exact pane.
    if (paneId && (!workspaceId || !tabId)) {
      const exactPane = snapshot.data.panes.find(item => item.pane_id === paneId);
      const exactTab = exactPane && snapshot.data.tabs.find(item => item.tab_id === exactPane.tab_id);
      if (!exactTab || (workspaceId && exactTab.workspace_id !== workspaceId)) return;
      if (!workspaceId) setWorkspaceId(exactTab.workspace_id);
      if (!tabId) setTabId(exactTab.tab_id);
      return;
    }
    if (!workspaceId) {
      const first = snapshot.data.workspaces[0];
      if (first) setWorkspaceId(first.workspace_id);
      return;
    }
    const selectedWorkspace = snapshot.data.workspaces.find(item => item.workspace_id === workspaceId);
    if (!selectedWorkspace) return;
    if (!tabId) {
      const first = snapshot.data.tabs.find(item => item.workspace_id === workspaceId && item.tab_id === selectedWorkspace.active_tab_id) ?? snapshot.data.tabs.find(item => item.workspace_id === workspaceId);
      if (first) setTabId(first.tab_id);
      return;
    }
    if (!snapshot.data.tabs.some(item => item.tab_id === tabId && item.workspace_id === workspaceId)) return;
    if (!paneId) {
      const first = snapshot.data.panes.find(item => item.tab_id === tabId);
      if (first) setPaneId(first.pane_id);
    }
  }, [restore, snapshot.data, workspaceId, tabId, paneId]);
  useEffect(() => {
    if (restore || !pane || !snapshot.data || !freshSnapshot || !knownMachine || !foreground || mainView !== 'monitor' || workspaceOpen || drawer || settingsOpen) return;
    const target: LastTarget = { machine, workspaceId, tabId, paneId: pane.pane_id, terminalId: pane.terminal_id };
    if (!matchesLastTarget(target, machine, snapshot.data)) return;
    const key = JSON.stringify(target);
    if (lastTargetAttempt.current === key) return;
    lastTargetAttempt.current = key;
    rememberLastTarget(connection.server, target);
  }, [restore, pane, snapshot.data, freshSnapshot, knownMachine, foreground, mainView, workspaceOpen, drawer, settingsOpen, machine, workspaceId, tabId, connection.server]);
  const agent = snapshot.data?.agents.find(item => item.pane_id === pane?.pane_id);
  const effectivePaneId = pane?.pane_id ?? '';
  const readOutput = useCallback((signal: AbortSignal) => transport.rpc(machine, 'pane.read', { pane_id: effectivePaneId, source: 'recent', format: 'text', strip_ansi: true, lines: 500 }, readSchema, signal).then(result => ({ ...result.read, terminalId: pane?.terminal_id })), [transport, machine, effectivePaneId, pane?.terminal_id]);
  const terminal = usePolling(readOutput, visible && workspaceOpen && panel === 'terminal' && !!effectivePaneId, 900, JSON.stringify([connection.server, machine, effectivePaneId, pane?.terminal_id]));
  const cwd = pane?.foreground_cwd ?? pane?.cwd;
  const readWorktrees = useCallback((signal: AbortSignal) => transport.rpc(machine, 'worktree.list', { workspace_id: workspaceId }, worktreesSchema, signal), [transport, machine, workspaceId]);
  const worktrees = usePolling(readWorktrees, visible && workspaceOpen && panel === 'worktrees' && !!workspace, 15000);
  const readClients = useCallback((signal: AbortSignal) => { void refresh; return transport.request('/api/herdr/clients', clientsSchema, { signal }); }, [transport, refresh]);
  const clients = usePolling(readClients, visible && workspaceOpen && panel === 'devices', 15000, 'devices');
  const error = snapshot.error ?? machines.error ?? info.error;
  const validOutput = terminal.data?.pane_id === effectivePaneId && terminal.data.terminalId === pane?.terminal_id ? terminal.data : null;
  useEffect(() => { if (follow && output.current) output.current.scrollTop = output.current.scrollHeight; }, [validOutput?.revision, follow]);
  const openMonitor = () => { setMainView('monitor'); setPanel('files'); setWorkspaceOpen(false); setDrawer(false); setConversationSwitcherOpen(false); setAction(null); };
  const openChat = () => { setChatVisited(true); setMainView('chat'); setWorkspaceOpen(false); setDrawer(false); };
  const switchMachine = (next: string) => { cancelRestore(); openMonitor(); setMachine(next); setWorkspaceId(''); setTabId(''); setPaneId(''); setDraft(''); setNotice(null); setAction(null); };
  const chooseWorkspace = (next: string) => { cancelRestore(); setMainView('monitor'); setPanel('files'); setWorkspaceOpen(false); setWorkspaceId(next); setTabId(''); setPaneId(''); setDraft(''); setNotice(null); };
  const resolveDelivery = async (record: PendingDelivery): Promise<boolean> => {
    try {
      if (!await clearPendingDelivery(record.server, record.requestId)) {
        const current = await loadPendingDelivery(record.server);
        setDelivery(current ? { kind: 'pending', record: current } : { kind: 'clear' });
        return false;
      }
      setDelivery(current => current.kind === 'pending' && current.record.requestId === record.requestId ? { kind: 'clear' } : current);
      return true;
    } catch { setNotice({ text: h('deliveryStorage'), uncertain: false }); return false; }
  };
  const checkDelivery = async () => {
    if (checkingDelivery || busy) return;
    setCheckingDelivery(true);
    try {
      const record = delivery.kind === 'pending' ? delivery.record : await loadPendingDelivery(connection.server);
      if (!record) { setDelivery({ kind: 'clear' }); return; }
      setDelivery({ kind: 'pending', record });
      const result = await transport.request(`/api/herdr/receipts/${encodeURIComponent(record.requestId)}`, deliveryReceiptSchema);
      if (result.receipt.requestId !== record.requestId) throw new Error('Invalid delivery receipt');
      if (result.receipt.status === 'unknown') setNotice({ text: h(/^(files|git|conversation|context)\./.test(record.method) ? 'hostUnknown' : 'outcomeUnknown'), uncertain: false });
      else if (await resolveDelivery(record)) {
        setNotice(result.receipt.status === 'complete' ? null : { text: h('deliveryRejected'), uncertain: false });
        setRefresh(value => value + 1);
      }
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : h('disconnected'), uncertain: false }); }
    finally { setCheckingDelivery(false); }
  };
  const mutate = async (mutation: Mutation, onSuccess?: (value: NativeMutationResult) => void) => {
    if (mutationBlocked || mutationInFlight.current) return;
    const sentScope = scopeRef.current;
    const record: PendingDelivery = { requestId: crypto.randomUUID(), server: connection.server, machine, session: machine === 'local' ? info.data?.session ?? null : null, workspaceId, tabId, paneId, method: mutation.method };
    mutationInFlight.current = true;
    setDelivery({ kind: 'pending', record });
    setBusy(true); setNotice(null);
    try {
      const result = await transport.dispatchTrackedMutation(record, mutation);
      if (result.kind === 'pending') { setDelivery({ kind: 'pending', record: result.record }); setAction(null); return; }
      if (await resolveDelivery(record) && scopeRef.current === sentScope) { onSuccess?.(result.value); setRefresh(value => value + 1); }
    } catch (error) {
      if (error instanceof TransportError && error.code === 'DELIVERY_STORAGE') {
        setDelivery({ kind: 'storageError' }); setAction(null); setNotice({ text: h('deliveryStorage'), uncertain: false });
      } else {
        const uncertain = !(error instanceof TransportError) || error.uncertain;
        if (uncertain) { setDelivery({ kind: 'pending', record }); setAction(null); setNotice({ text: h('outcomeUnknown'), uncertain: true }); }
        else {
          await resolveDelivery(record);
          if (scopeRef.current === sentScope) setNotice({ text: error instanceof Error ? error.message : h('disconnected'), uncertain: false });
        }
      }
    } finally { mutationInFlight.current = false; setBusy(false); }
  };
  const send = () => {
    if (!pane || !draft.trim() || mutationBlocked || error) return;
    const sentText = draft;
    const mutation: Mutation = agent?.name ? { method: 'agent.prompt', params: { target: pane.pane_id, text: sentText } } : { method: 'pane.send_input', params: { pane_id: pane.pane_id, text: sentText, keys: ['enter'] } };
    void mutate(mutation, () => setDraft(current => current === sentText ? '' : current));
  };
  const openAction = (next: Action) => { setAction(next); setActionValue('value' in next ? next.value : ''); setActionCwd(''); setWorktreeBase(''); };
  const selectCreatedWorktree = (value: NativeMutationResult) => {
    setAction(null);
    if (!value.workspace || !value.tab || !value.root_pane) return;
    cancelRestore();
    setWorkspaceId(value.workspace.workspace_id);
    setTabId(value.tab.tab_id);
    setPaneId(value.root_pane.pane_id);
    setDraft('');
  };
  const submitAction = async (event: FormEvent) => {
    event.preventDefault(); if (!action || mutationBlocked) return;
    const name = actionValue.trim();
    switch (action.kind) {
      case 'workspace.create': {
        const params: Extract<Mutation, { method: 'workspace.create' }>['params'] = { label: name, focus: false };
        if (actionCwd.trim()) params.cwd = actionCwd.trim();
        await mutate({ method: action.kind, params }, () => setAction(null)); break;
      }
      case 'worktree.create': {
        if (!workspace) break;
        const params: Extract<Mutation, { method: 'worktree.create' }>['params'] = { workspace_id: workspace.workspace_id, branch: name, focus: false };
        if (worktreeBase.trim()) params.base = worktreeBase.trim();
        await mutate({ method: 'worktree.create', params }, selectCreatedWorktree); break;
      }
      case 'worktree.open': if (workspace) await mutate({ method: 'worktree.open', params: { workspace_id: workspace.workspace_id, branch: name, focus: false } }, selectCreatedWorktree); break;
      case 'worktree.remove': await mutate({ method: 'worktree.remove', params: { workspace_id: action.target, force: false } }, () => setAction(null)); break;
      case 'workspace.rename': if (action.target) await mutate({ method: action.kind, params: { workspace_id: action.target, label: name } }, () => setAction(null)); break;
      case 'tab.create': if (workspace) await mutate({ method: action.kind, params: { workspace_id: workspace.workspace_id, label: name, focus: false } }, () => setAction(null)); break;
      case 'tab.rename': if (action.target) await mutate({ method: action.kind, params: { tab_id: action.target, label: name } }, () => setAction(null)); break;
      case 'pane.rename': if (action.target) await mutate({ method: action.kind, params: { pane_id: action.target, label: name } }, () => setAction(null)); break;
      case 'agent.start': if (action.target) await mutate({ method: action.kind, params: { pane_id: action.target, name, kind: agentKind } }, () => setAction(null)); break;
      case 'workspace.close': await mutate({ method: action.kind, params: { workspace_id: action.target } }, () => setAction(null)); break;
      case 'tab.close': await mutate({ method: action.kind, params: { tab_id: action.target } }, () => setAction(null)); break;
      case 'pane.close': await mutate({ method: action.kind, params: { pane_id: action.target } }, () => setAction(null)); break;
      case 'revoke': {
        setBusy(true);
        try { await transport.request(`/api/herdr/clients/${encodeURIComponent(action.target)}`, z.object({ revoked: z.literal(true) }), { method: 'DELETE' }, true); setRefresh(value => value + 1); setAction(null); }
        catch (error) { setNotice({ text: error instanceof Error ? error.message : h('disconnected'), uncertain: true }); }
        finally { setBusy(false); }
      }
    }
  };

  const newWorkspace = () => openAction({ kind: 'workspace.create', title: h('newWorkspace'), value: '' });
  const destructive = action && ['workspace.close','tab.close','pane.close','revoke','worktree.remove'].includes(action.kind);
  const selectPane = (id: string) => {
    cancelRestore();
    const next = snapshot.data?.panes.find(item => item.pane_id === id);
    if (!next) return;
    const owner = snapshot.data?.tabs.find(item => item.tab_id === next.tab_id);
    if (!owner) return;
    openMonitor(); setWorkspaceId(owner.workspace_id); setTabId(owner.tab_id); setPaneId(id); setDraft(''); setNotice(null); setDrawer(false);
  };
  const pendingDelivery = useCallback((record: PendingDelivery | null) => {
    if (record) { setDelivery({ kind: 'pending', record }); return; }
    void loadPendingDelivery(connection.server).then(current => setDelivery(current ? { kind: 'pending', record: current } : { kind: 'clear' })).catch(() => setDelivery({ kind: 'storageError' }));
  }, [connection.server]);
  const openWorkspacePanel = (next: Panel) => { setPanel(next); setWorkspaceOpen(true); setDrawer(false); };
  const hostPending = delivery.kind === 'pending' && /^(files|git|conversation|context)\./.test(delivery.record.method);
  const inspectPending = () => {
    if (delivery.kind !== 'pending') return;
    cancelRestore();
    const record = delivery.record;
    setMachine(record.machine); setWorkspaceId(record.workspaceId); setTabId(record.tabId); setPaneId(record.paneId);
    if (record.method.startsWith('conversation.')) openChat();
    else openWorkspacePanel(record.method.startsWith('files.') ? 'files' : record.method.startsWith('git.') ? 'changes' : record.method.startsWith('context.') ? 'context' : 'terminal');
  };
  const banners = <>
    {error && <div className="herdr-banner herdr-error" role="alert">{error.message}</div>}
    {delivery.kind !== 'clear' && <div className="herdr-banner herdr-warning" role="alert"><div><p>{busy || delivery.kind === 'loading' ? t('common.loading') : delivery.kind === 'storageError' ? h('deliveryStorage') : h(hostPending ? 'hostUnknown' : 'outcomeUnknown')}</p>{delivery.kind === 'pending' && <p className="herdr-fine" dir="ltr">{delivery.record.machine} · {delivery.record.session ?? t('common.unavailable')} · {delivery.record.workspaceId} · {delivery.record.tabId} · {delivery.record.paneId} · {delivery.record.method} · {delivery.record.requestId}</p>}<div className="herdr-row herdr-wrap">{delivery.kind === 'pending' && <Button size="sm" variant="outline" onClick={inspectPending}>{delivery.record.method.startsWith('files.') ? t('layout.mainTab.files') : delivery.record.method.startsWith('git.') ? t('mobile.nav.changes') : delivery.record.method.startsWith('conversation.') ? h('conversations') : delivery.record.method.startsWith('context.') ? t('layout.rightSidebar.context') : t('layout.mainTab.terminal')}</Button>}{delivery.kind !== 'loading' && <Button size="sm" variant="outline" disabled={busy || checkingDelivery} onClick={() => void checkDelivery()}>{checkingDelivery ? t('common.loading') : h('checkDelivery')}</Button>}{delivery.kind === 'pending' && <Button size="sm" variant="outline" disabled={busy || checkingDelivery} onClick={() => { const record = delivery.record; setCheckingDelivery(true); void resolveDelivery(record).then(cleared => { if (cleared) setNotice(null); }).finally(() => setCheckingDelivery(false)); }}>{h(hostPending ? 'hostChecked' : 'reviewTerminal')}</Button>}</div></div></div>}
    {notice && <div className={`herdr-banner ${notice.uncertain ? 'herdr-warning' : 'herdr-error'}`} role="alert">{notice.uncertain ? h(hostPending ? 'hostUnknown' : 'outcomeUnknown') : notice.text}<Button variant="ghost" size="xs" onClick={() => setNotice(null)} aria-label={t('mobile.surface.closeAria')}><Icon name="close" className="size-4" /></Button></div>}
  </>;
  const footer = <><Button variant="ghost" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen(value => !value); setDrawer(false); setWorkspaceOpen(false); }}><Icon name="settings-3" className="size-4" />{t('mobile.settings.placeholder.title')}</Button><Button variant="ghost" aria-pressed={panel === 'devices' && workspaceOpen} onClick={() => openWorkspacePanel('devices')}><Icon name="shield-check" className="size-4" />{h('devices')}</Button><div className="herdr-row">{commonControls}</div><Button variant="ghost" size="sm" onClick={changeServer}>{h('server')}</Button><Button variant="ghost" size="sm" onClick={() => { void disconnect().catch(() => setNotice({ text: h('credentialStorage'), uncertain: false })); }}>{h('disconnected')}</Button></>;
  const machineLabel = machines.data?.machines.find(item => item.id === machine)?.label ?? machine;
  const snapshotStale = !!snapshot.data && (!!snapshot.error || !foreground);
  const selectedTitle = <span className="flex min-w-0 flex-col"><span dir="auto" className="truncate">{tab?.label ?? pane?.label ?? pane?.title ?? workspace?.label ?? t('herdr.monitor.title')}</span><span dir="auto" className="truncate typography-micro text-muted-foreground">{machineLabel}{workspace ? ` · ${workspace.label}` : ''}</span></span>;
  const sidebar = <div className="herdr-sidebar-body">
    <div className="herdr-machine"><Icon name="computer" className="size-4" /><select className={dropdownTriggerVariants()} value={machine} onChange={event => switchMachine(event.target.value)} aria-label={h('machines')}><option value="local">{machines.data?.machines.find(item => item.id === 'local')?.label ?? t('desktopHostSwitcher.instance.local')}</option>{machine !== 'local' && !machines.data?.machines.some(item => item.id === machine) && <option value={machine} disabled>{machine} · {t('common.unavailable')}</option>}{machines.data?.machines.filter(item => item.id !== 'local').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    <div className="herdr-sidebar-actions flex flex-col gap-1">
      <Button variant="ghost" aria-pressed={mainView === 'monitor' && !workspaceOpen} onClick={openMonitor}><Icon name="computer" className="size-4" />{t('herdr.monitor.title')}</Button>
      <Button variant="ghost" aria-pressed={mainView === 'chat' && !workspaceOpen} onClick={openChat}><Icon name="chat-1" className="size-4" />{h('conversations')}</Button>
      <Button variant="ghost" aria-pressed={workspaceOpen && panel === 'terminal'} onClick={() => openWorkspacePanel('terminal')}><Icon name="terminal" className="size-4" />{t('herdr.monitor.control')}</Button>
      <Button variant="ghost" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" />{t('gitView.history.refresh')}</Button>
    </div>
    {snapshotStale && snapshot.data ? <p className="herdr-banner herdr-warning" role="status">{t('herdr.monitor.stale', { time: new Date(snapshot.data.readAt).toLocaleString() })}</p> : null}
    <div className="herdr-search"><Icon name="search" className="size-4" /><Input inputSize="compact" value={query} onChange={event => setQuery(event.target.value)} aria-label={h('workspaces')} placeholder={h('workspaces')} /></div>
    <nav className="herdr-workspace-list">{workspaces.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <div key={item.workspace_id}><Button variant="ghost" className={`herdr-workspace ${workspaceId === item.workspace_id ? 'is-selected' : ''}`} aria-pressed={workspaceId === item.workspace_id} onClick={() => chooseWorkspace(item.workspace_id)}><Icon name="folder" className="size-4" /><span dir="auto">{item.label}</span><i className={`herdr-status ${item.agent_status}`} title={item.agent_status} /></Button>{workspaceId === item.workspace_id && snapshot.data?.tabs.filter(child => child.workspace_id === item.workspace_id).map(child => <div key={child.tab_id} className="herdr-session-group"><Button variant="ghost" className="herdr-workspace" aria-pressed={tabId === child.tab_id} onClick={() => { cancelRestore(); setMainView('monitor'); setPanel('files'); setWorkspaceOpen(false); setTabId(child.tab_id); setPaneId(''); setDraft(''); }}><Icon name="terminal" className="size-4" /><span dir="auto">{child.label}</span></Button>{snapshot.data?.panes.filter(row => row.tab_id === child.tab_id).map(row => <Button key={row.pane_id} variant="ghost" className={`herdr-workspace ${paneId === row.pane_id ? 'is-selected' : ''}`} aria-pressed={paneId === row.pane_id} onClick={() => selectPane(row.pane_id)}><Icon name="chat-1" className="size-4" /><span dir="auto">{row.label ?? row.title ?? row.pane_id}</span><i className={`herdr-status ${row.agent_status}`} title={row.agent_status} /></Button>)}</div>)}</div>)}{snapshot.loading && <p className="herdr-muted">{t('common.loading')}</p>}{!snapshot.loading && !snapshot.error && workspaces.length === 0 && <p className="herdr-muted">{h('noWorkspaces')}</p>}</nav>

  </div>;
  const terminalContent = visible && workspaceOpen && panel === 'terminal' ? <div className="herdr-panel-body">{banners}
    <div className="herdr-row flex-wrap px-3 py-2"><Button variant="outline" size="sm" onClick={newWorkspace} disabled={mutationBlocked || !!error}><Icon name="add" className="size-4" />{h('newWorkspace')}</Button></div>
    <div className="herdr-row flex-wrap px-3 py-2"><Button variant="ghost" size="sm" disabled={!workspace || mutationBlocked} onClick={() => workspace && openAction({ kind: 'workspace.rename', title: t('sessions.sidebar.session.menu.rename'), target: workspace.workspace_id, value: workspace.label })}><Icon name="edit" className="size-4" />{t('sessions.sidebar.session.menu.rename')}</Button><Button variant="ghost" size="sm" disabled={!workspace || mutationBlocked} onClick={() => workspace && openAction({ kind: 'workspace.close', title: workspace.label, target: workspace.workspace_id })}><Icon name="close" className="size-4" />{t('mobile.surface.closeAria')}</Button></div>        <div className="herdr-terminal-tabs">{tabs.map(item => <Button key={item.tab_id} variant="ghost" size="sm" aria-pressed={tab?.tab_id === item.tab_id} onClick={() => { cancelRestore(); setTabId(item.tab_id); setPaneId(''); setDraft(''); setNotice(null); }}><Icon name="terminal" className="size-4" /><span dir="auto">{item.label}</span></Button>)}<Button variant="ghost" size="icon" disabled={!workspace || mutationBlocked || !!error} aria-label={t('terminalView.tabs.newTabTitle')} onClick={() => openAction({ kind: 'tab.create', title: t('terminalView.tabs.newTabTitle'), value: '' })}><Icon name="add" className="size-4" /></Button><span className="herdr-spacer" />{tab && <><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('terminalView.tabs.menu.rename')} onClick={() => openAction({ kind: 'tab.rename', title: t('terminalView.tabs.menu.rename'), target: tab.tab_id, value: tab.label })}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('contextPanel.tab.menu.close')} onClick={() => openAction({ kind: 'tab.close', title: tab.label, target: tab.tab_id })}><Icon name="close" className="size-4" /></Button></>}</div>
        <div className="herdr-pane-toolbar"><div className="herdr-row"><select className={dropdownTriggerVariants()} value={effectivePaneId} disabled={panes.length === 0} onChange={event => { cancelRestore(); setPaneId(event.target.value); setDraft(''); setNotice(null); }} aria-label={h('target')}>{!pane && <option value="" disabled>{t('common.unavailable')}</option>}{panes.map(item => <option key={item.pane_id} value={item.pane_id}>{item.label ?? item.title ?? item.terminal_title_stripped ?? item.pane_id}</option>)}</select>{pane && <span className="herdr-muted herdr-desktop-only">{pane.agent_status}</span>}</div><div className="herdr-row">{pane && <><Button variant="ghost" size="icon" disabled={mutationBlocked || !!error} title={h('split')} aria-label={h('split')} onClick={() => void mutate({ method: 'pane.split', params: { target_pane_id: pane.pane_id, direction: 'right', focus: false } })}><Icon name="layout-column" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('terminalView.tabs.menu.rename')} onClick={() => openAction({ kind: 'pane.rename', title: t('terminalView.tabs.menu.rename'), target: pane.pane_id, value: pane.label ?? '' })}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('contextPanel.tab.menu.close')} onClick={() => openAction({ kind: 'pane.close', title: pane.label ?? pane.pane_id, target: pane.pane_id })}><Icon name="close" className="size-4" /></Button></>}</div></div>
        {terminal.error && <div className="herdr-banner herdr-error" role="alert">{terminal.error.message}</div>}
        <div className="herdr-terminal-body">{!pane ? <div className="herdr-empty"><Icon name="terminal" className="size-10" /><h2>{workspace ? h('noPane') : h('noWorkspaces')}</h2>{!workspace && !snapshot.loading && !error && <Button disabled={mutationBlocked} onClick={newWorkspace}><Icon name="add" className="size-4" />{h('newWorkspace')}</Button>}</div> : (frames && workspaceOpen && panel === 'terminal' ? <LiveTerminal key={JSON.stringify([connection.server, machine, pane.pane_id, pane.terminal_id])} connection={transport.connection} machine={machine} paneId={pane.pane_id} theme={theme} fallback={<div className="herdr-content"><p className="herdr-content-root">{t('herdr.monitor.recentText')}</p><pre ref={output} className="herdr-output" style={{ flex: 1, minHeight: 0, height: 'auto' }} dir="ltr" tabIndex={0} aria-label={t('herdr.monitor.recentText')} onScroll={event => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40); }}><code>{validOutput?.text || (terminal.loading ? t('common.loading') : h('noOutput'))}</code></pre></div>} /> : <pre ref={output} className="herdr-output" dir="ltr" tabIndex={0} aria-label={t('herdr.monitor.recentText')} onScroll={event => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40); }}><code>{validOutput?.text || (terminal.loading ? t('common.loading') : h('noOutput'))}</code></pre>)}</div>
        {validOutput?.truncated && <p className="herdr-truncated">{h('truncated')}</p>}
        <div className="herdr-terminal-status"><Button size="xs" variant="ghost" aria-pressed={!frames} onClick={() => setFrames(!frames)}>{t('herdr.monitor.recentText')}</Button><span dir="ltr">{cwd ?? ''}</span><Button variant="ghost" size="xs" aria-pressed={follow} onClick={() => setFollow(!follow)}>{h('follow')}</Button><span>{validOutput ? `r${validOutput.revision}` : ''}</span></div>
        <div className="herdr-composer-area"><div className="herdr-target" dir="ltr">{h('target')} · {machine} · {machine === 'local' ? info.data?.session : machine} · {effectivePaneId || '...'}</div><div className="herdr-keybar" dir="ltr">{['Ctrl-C','Esc','Tab','↑','↓','←','→'].map((key, index) => <Button key={key} size="sm" variant="outline" disabled={!pane || mutationBlocked || !!error} onClick={() => pane && void mutate({ method: 'pane.send_keys', params: { pane_id: pane.pane_id, keys: [['ctrl-c'],['escape'],['tab'],['up'],['down'],['left'],['right']][index] } })}>{key}</Button>)}<span className="herdr-spacer" />{pane && !pane.agent && <Button size="sm" variant="ghost" disabled={mutationBlocked || !!error} onClick={() => openAction({ kind: 'agent.start', title: h('startAgent'), target: pane.pane_id, value: '' })}><Icon name="code-ai" className="size-4" /><span className="herdr-desktop-only">{h('startAgent')}</span></Button>}</div><form className="herdr-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea aria-label={agent?.name ? h('promptAgent') : h('composer')} placeholder={h('composer')} value={draft} disabled={!pane || delivery.kind !== 'clear' || !!error} maxLength={65536} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && shouldSubmitEnter({ isMobile, isDesktopExpanded: false, enterToSend: preferences.state.values.enterToSend, enterToSendConfigured: preferences.state.values.enterToSendConfigured, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })) { event.preventDefault(); send(); } }} /><div className="herdr-composer-footer"><span>{busy ? t('common.loading') : h(isMobile ? 'mobileSendHint' : 'sendHint')}</span><Button type="submit" size="icon" disabled={!pane || mutationBlocked || !draft.trim() || !!error} aria-label={t('rightSidebar.contextNotesTodo.sendDialog.actions.send')}><Icon name="arrow-up" className="size-4" /></Button></div></form></div>
</div> : null;
  const workspacePanels: MobileWorkspacePanel<Panel>[] = [
    { id: 'files', label: t('layout.mainTab.files'), icon: <Icon name="file-text" className="size-4" />, content: <div className="herdr-panel-body">{banners}<FilesPanel isMobile={isMobile} requestedFile={requestedFile} transport={transport} machine={machine} paneId={paneId} disabled={!foreground || !workspaceOpen || panel !== 'files' || !pane || !!error} mutationBlocked={mutationBlocked} onPendingDelivery={pendingDelivery} /></div> },
    { id: 'changes', label: t('mobile.nav.changes'), icon: <Icon name="git-commit" className="size-4" />, content: <div className="herdr-panel-body">{banners}<ChangesPanel theme={theme} themeMode={dark ? 'dark' : 'light'} initialDiff={requestedDiff} transport={transport} machine={machine} paneId={paneId} disabled={!foreground || !workspaceOpen || panel !== 'changes' || !pane || !!error} mutationBlocked={mutationBlocked} onPendingDelivery={pendingDelivery} /></div> },
    { id: 'context', label: t('layout.rightSidebar.context'), icon: <Icon name="file-text" className="size-4" />, content: <div className="herdr-panel-body">{banners}<ProjectContextPanel transport={transport} machine={machine} paneId={paneId} active={foreground && workspaceOpen && panel === 'context'} disabled={!pane || !!error} mutationBlocked={mutationBlocked} onPendingDelivery={pendingDelivery} /></div> },
    { id: 'terminal', label: t('herdr.monitor.control'), icon: <Icon name="terminal" className="size-4" />, content: terminalContent, ownsEscape: true },
    { id: 'worktrees', label: t('mobile.sessions.section.worktrees'), icon: <Icon name="git-branch" className="size-4" />, content: <div className="herdr-panel-body">{banners}<section className="herdr-detail"><h1>{t('mobile.sessions.section.worktrees')}</h1><div className="herdr-row herdr-wrap"><Button size="sm" disabled={!workspace || mutationBlocked || !!error} onClick={() => openAction({ kind: 'worktree.create', title: t('session.newWorktree.title'), value: '' })}>{t('session.newWorktree.title')}</Button><Button size="sm" variant="outline" disabled={!workspace || mutationBlocked || !!error} onClick={() => openAction({ kind: 'worktree.open', title: t('session.newWorktree.mode.existingBranch'), value: '' })}>{t('session.newWorktree.mode.existingBranch')}</Button><Button size="sm" variant="destructive" disabled={!workspace || mutationBlocked || !!error} onClick={() => workspace && openAction({ kind: 'worktree.remove', title: workspace.label, target: workspace.workspace_id })}>{t('mobile.projectEdit.deleteWorktreeConfirmButton')}</Button></div>{!workspace ? <p className="herdr-muted">{h('noPane')}</p> : worktrees.error ? <p className="herdr-error" role="alert">{worktrees.error.message}</p> : worktrees.loading ? <p>{t('common.loading')}</p> : <>{worktrees.data?.worktrees.length === 0 && <p>{h('empty')}</p>}{worktrees.data?.worktrees.map(item => <article key={item.path} className="herdr-detail-card"><Icon name="git-branch" className="size-5" /><div><h2 dir="auto">{item.label}</h2><p dir="ltr">{item.path}</p><code dir="ltr">{item.branch ?? 'HEAD'}</code></div></article>)}</>}</section></div> },
    { id: 'devices', label: h('devices'), icon: <Icon name="shield-check" className="size-4" />, content: <div className="herdr-panel-body">{banners}<section className="herdr-detail"><h1>{h('devices')}</h1>{clients.error ? <p className="herdr-error" role="alert">{clients.error.message}</p> : clients.loading ? <p>{t('common.loading')}</p> : <>{clients.data?.clients.length === 0 && <p>{h('empty')}</p>}{clients.data?.clients.map(item => <article key={item.id} className="herdr-detail-card"><Icon name="computer" className="size-5" /><div><h2 dir="auto">{item.deviceName ?? item.label ?? item.id}</h2><p dir="ltr">{item.id}</p></div><Button variant="destructive" size="sm" disabled={mutationBlocked || !!item.revokedAt} onClick={() => openAction({ kind: 'revoke', title: item.deviceName ?? item.id, target: item.id })}>{h('revoke')}</Button></article>)}</>}</section></div> },
  ];
  const chat = chatVisited ? <div className="herdr-chat-body">{banners}<ConversationPanel onOpenFile={request => { setRequestedFile(request); openWorkspacePanel('files'); }} theme={theme} preferences={preferences.state.values} themeMode={dark ? 'dark' : 'light'} navigation={isMobile ? { open: visible && conversationSwitcherOpen, onOpenChange: setConversationSwitcherOpen, anchorRef: conversationTitleButton, onTitleChange: updateConversationTitle } : undefined} targetMetadata={{ workspaceId, tabId, session: machine === 'local' ? info.data?.session ?? null : null }} transport={transport} machine={machine} paneId={paneId} disabled={mainView !== 'chat' || !pane || !!error || workspaceOpen || !foreground} mutationBlocked={mutationBlocked} onPendingDelivery={pendingDelivery} /></div> : null;
  const monitor = <div className="herdr-panel-body">{banners}
    {snapshotStale && snapshot.data ? <p className="herdr-banner herdr-warning" role="status">{t('herdr.monitor.stale', { time: new Date(snapshot.data.readAt).toLocaleString() })}</p> : null}
    {pane ? <><div className="border-b border-border px-3 py-2 typography-meta text-muted-foreground" dir="auto">{workspace?.label} · {tab?.label} · {pane.label ?? pane.title ?? pane.terminal_title_stripped ?? pane.pane_id}</div><PaneMonitor transport={transport} machine={machine} pane={pane} theme={theme} active={mainView === 'monitor' && !workspaceOpen && !drawer && !settingsOpen && foreground} snapshotStale={snapshotStale} /></> : <div className="herdr-empty"><Icon name="computer" className="size-10" /><h2>{restore ? t(restore.kind === 'unavailable' || error ? 'common.unavailable' : 'herdr.monitor.waiting') : snapshot.loading ? t('common.loading') : !snapshot.data ? t('herdr.monitor.waiting') : snapshot.data.panes.length === 0 ? t('herdr.monitor.empty') : h('noPane')}</h2><Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" />{t('gitView.history.refresh')}</Button></div>}
  </div>;
  const mainContent = <><div hidden={mainView !== 'monitor' || workspaceOpen} className="herdr-panel-body">{monitor}</div><div hidden={mainView !== 'chat' || workspaceOpen} className="herdr-chat-body">{chat}</div></>;
  const connectionStatus = <span className={`herdr-connection ${error ? 'has-error' : ''}`}><i className={`herdr-status ${error ? 'blocked' : 'idle'}`} />{error ? h('disconnected') : snapshot.loading ? t('common.loading') : h('connected')}</span>;
  return <>
    {isMobile ? <HerdrMobileShell target={{ machine, workspaceId, tabId, paneId, available: !!pane && !error }} workspaces={workspaces.map(row => ({ id: row.workspace_id, label: row.label, active: workspaceId === row.workspace_id }))} sessions={panes.map(row => ({ id: row.pane_id, title: row.label ?? row.title ?? row.pane_id, active: paneId === row.pane_id, status: row.agent_status }))} onSelectWorkspace={chooseWorkspace} onSelectSession={selectPane} header={{ title: mainView === 'monitor' ? selectedTitle : conversationHeader?.owner === conversationOwner ? conversationHeader.title : h('newConversation'), titleExpanded: mainView === 'monitor' ? drawer : conversationSwitcherOpen, titleButtonRef: conversationTitleButton, onTitleClick: () => { if (mainView === 'monitor') { setDrawer(true); setWorkspaceOpen(false); } else { setConversationSwitcherOpen(value => !value); setDrawer(false); setWorkspaceOpen(false); } } }} sessionsOpen={visible && drawer} onSessionsOpenChange={setDrawer} onOpenSessions={() => { setDrawer(true); setWorkspaceOpen(false); }} workspaceOpen={visible && workspaceOpen} onWorkspaceOpenChange={setWorkspaceOpen} onOpenWorkspace={() => { setWorkspaceOpen(true); setDrawer(false); }} workspaceTab={panel} onWorkspaceTabChange={next => { const found = workspacePanels.find(item => item.id === next); if (found) setPanel(found.id); }} workspacePanels={workspacePanels} sidebar={sidebar} sidebarFooter={<div className="herdr-mobile-footer">{footer}</div>} actions={{ openChanges: options => { setRequestedDiff(options?.diffPath ? { path: options.diffPath, staged: options.staged } : null); openWorkspacePanel('changes'); }, openFiles: () => openWorkspacePanel('files'), openSettings: () => { setSettingsOpen(true); setDrawer(false); setWorkspaceOpen(false); }, openSourceBoard: () => setNotice({ text: t('common.unavailable'), uncertain: false }) }} fullscreen={null} overlay={{ open: visible && settingsOpen, onOpenChange: setSettingsOpen, title: t('mobile.settings.placeholder.title'), content: settingsContent }}>{mainContent}</HerdrMobileShell> : <div className="herdr-shell"><aside className="herdr-sidebar"><div className="herdr-sidebar-header"><span className="herdr-brand"><Icon name="code-box" className="size-5" />OpenHerdr</span></div>{sidebar}<footer className="herdr-sidebar-footer">{footer}</footer></aside><main className="herdr-main"><header className="herdr-topbar"><span className="min-w-0">{selectedTitle}</span><div className="herdr-row">{connectionStatus}<Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)} aria-label={t('gitView.history.refresh')}><Icon name="refresh" className="size-4" /></Button></div></header><div className="herdr-view-tabs"><Button size="sm" variant="ghost" aria-pressed={mainView === 'monitor' && !workspaceOpen} onClick={openMonitor}>{t('herdr.monitor.title')}</Button><Button size="sm" variant="ghost" aria-pressed={mainView === 'chat' && !workspaceOpen} onClick={openChat}>{h('conversations')}</Button>{workspacePanels.map(item => <Button key={item.id} size="sm" variant="ghost" aria-pressed={workspaceOpen && panel === item.id} onClick={() => openWorkspacePanel(item.id)}>{item.icon}{item.label}</Button>)}</div><div className="herdr-desktop-content">{mainContent}<div hidden={!workspaceOpen} className="herdr-panel-body"><MobileWorkspaceDrawerView variant="panel" open={visible && workspaceOpen} onClose={() => setWorkspaceOpen(false)} tab={panel} onTabChange={next => setPanel(next)} panels={workspacePanels} /></div></div></main></div>}
    <Dialog open={visible && !isMobile && settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="flex max-h-[90dvh] w-[min(95vw,60rem)] max-w-none flex-col overflow-hidden"><DialogHeader><DialogTitle>{t('mobile.settings.placeholder.title')}</DialogTitle></DialogHeader>{settingsContent}</DialogContent></Dialog>
    <Dialog open={visible && !!action} onOpenChange={open => { if (!open && !busy) setAction(null); }}><DialogContent className="herdr-dialog"><form onSubmit={event => void submitAction(event)}><DialogHeader><DialogTitle>{action?.title}</DialogTitle><DialogDescription>{destructive ? action?.kind === 'worktree.remove' ? t('sessions.sidebar.dialogs.worktreeDelete.descriptionNoLinked') : h(action?.kind === 'revoke' ? 'revokeConfirm' : 'closeConfirm') : h('target') + ' · ' + machine}</DialogDescription></DialogHeader>{!destructive && <label>{action?.kind === 'worktree.create' || action?.kind === 'worktree.open' ? t('session.newWorktree.branchName') : t('mobile.instances.label.label')}<Input required maxLength={action?.kind === 'agent.start' ? 32 : 128} pattern={action?.kind === 'agent.start' ? '[a-z][a-z0-9_-]{0,31}' : undefined} autoFocus value={actionValue} onChange={event => setActionValue(event.target.value)} /></label>}{action?.kind === 'workspace.create' && <label>{h('cwd')}<Input dir="ltr" value={actionCwd} onChange={event => setActionCwd(event.target.value)} /></label>}{action?.kind === 'worktree.create' && <label>{t('session.newWorktree.sourceBranch')}<Input dir="ltr" value={worktreeBase} onChange={event => setWorktreeBase(event.target.value)} /></label>}{action?.kind === 'agent.start' && <label>{t('sessions.scheduledTasks.editor.agent.label')}<select className={dropdownTriggerVariants()} value={agentKind} onChange={event => setAgentKind(event.target.value)}>{['codex','claude','opencode','gemini','kimi','grok','agy'].map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>}{notice && <p role="alert" className="herdr-error">{notice.uncertain ? h('outcomeUnknown') : notice.text}</p>}<DialogFooter><Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>{t('sessions.sidebar.dialogs.cancel')}</Button><Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={mutationBlocked || (!destructive && !actionValue.trim())}>{busy ? t('common.loading') : action?.kind === 'worktree.remove' ? t('mobile.projectEdit.deleteWorktreeConfirmButton') : destructive ? t('mobile.surface.closeAria') : t('gitView.history.actions.createBranchConfirm')}</Button></DialogFooter></form></DialogContent></Dialog>
  </>;
}
