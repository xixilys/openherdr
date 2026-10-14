import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
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
import { FilesPanel, ChangesPanel } from './ContentPanel';
import { LiveTerminal } from './LiveTerminal';
import { HerdrTransport, TransportError, clearPendingDelivery, deliveryReceiptSchema, loadPendingDelivery, storePendingDelivery, clientsSchema, credentialStorageKind, forgetConnection, infoSchema, machinesSchema, normalizeServer, parsePairing, readSchema, redeem, savedConnections, saveConnection, snapshotSchema, worktreesSchema, type Connection, type Mutation, type Pairing, type PendingDelivery } from './transport';
import './herdr.css';

type Panel = 'terminal' | 'worktrees' | 'devices' | 'files' | 'changes';
type Action = { kind: 'workspace.create' | 'workspace.rename' | 'tab.create' | 'tab.rename' | 'pane.rename' | 'agent.start'; title: string; target?: string; value: string } | { kind: 'workspace.close' | 'tab.close' | 'pane.close' | 'revoke'; title: string; target: string };
type DeliveryState = { kind: 'clear' } | { kind: 'pending'; record: PendingDelivery } | { kind: 'storageError' };
const lightTheme = requireTheme(lightDefinition);
const darkTheme = requireTheme(darkDefinition);

export function HerdrApp({ initialPairing, initialError }: { initialPairing: Pairing | null; initialError: string | null }) {
  const { t, locale, locales, label, setLocale } = useI18n();
  const h = useHerdrText();
  const [connection, setConnection] = useState<Connection | null>(() => initialError ? null : savedConnections()[0] ?? null);
  const [server, setServer] = useState(initialPairing?.server ?? (/^https?:$/.test(window.location.protocol) ? window.location.origin : ''));
  const [pairingLink, setPairingLink] = useState('');
  const [pairing, setPairing] = useState(initialPairing);
  const [loginError, setLoginError] = useState(initialError);
  const [connecting, setConnecting] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('openherdr.theme') !== 'light');
  useEffect(() => { new CSSVariableGenerator().apply(dark ? darkTheme : lightTheme); localStorage.setItem('openherdr.theme', dark ? 'dark' : 'light'); }, [dark]);

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setLoginError(null); setConnecting(true);
    try {
      const origin = normalizeServer(server);
      const payload = pairing ?? parsePairing(pairingLink);
      if (payload.server && normalizeServer(payload.server) !== origin) throw new Error('invalidServer');
      const result = await redeem(origin, payload);
      await saveConnection(result); setConnection(result); setPairing(null); setPairingLink('');
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'DISCONNECTED'); }
    finally { setConnecting(false); }
  };
  const commonControls = <><Button variant="ghost" size="icon" aria-label={t(dark ? 'contextPanel.browser.device.schemeLight' : 'contextPanel.browser.device.schemeDark')} onClick={() => setDark(!dark)}><Icon name={dark ? 'lightbulb' : 'flashlight'} className="size-4" /></Button><select className={dropdownTriggerVariants()} value={locale} onChange={event => { const next = locales.find(item => item === event.target.value); if (next) void setLocale(next); }} aria-label={t('settings.appearance.language.label')}>{locales.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></>;

  if (!connection || pairing) return <main className="herdr-connect"><header><span className="herdr-brand"><Icon name="code-box" className="size-6" />OpenHerdr</span><div className="herdr-row">{commonControls}</div></header><form className="herdr-connect-card" onSubmit={connect}><div className="herdr-connect-mark"><Icon name="computer" className="size-8" /></div><h1>{t('mobile.connect.connectButton')}</h1><p>{h('connectHint')}</p><label>{h('server')}<Input dir="ltr" type="url" required value={server} onChange={event => setServer(event.target.value)} /></label>{!pairing && <label>{h('pairing')}<Input dir="ltr" type="password" required value={pairingLink} onChange={event => { setPairingLink(event.target.value); try { const incoming = parsePairing(event.target.value); if (incoming.server) setServer(normalizeServer(incoming.server)); } catch { /* A partially pasted link stays editable. */ } }} /></label>}<p className="herdr-muted">{h('pairingHint')}</p>{loginError && <p className="herdr-error" role="alert">{loginError === 'invalidPairing' || loginError === 'invalidServer' || loginError === 'credentialStorage' ? h(loginError) : loginError}</p>}<Button type="submit" disabled={connecting}>{connecting ? t('common.loading') : t('mobile.connect.connectButton')}<Icon name="arrow-right" className="size-4" /></Button><p className="herdr-fine">{h(credentialStorageKind() === 'native' ? 'nativeCredential' : 'localCredential')}</p>{savedConnections().map(item => <Button key={item.server} variant="ghost" onClick={() => { setPairing(null); setConnection(item); }}>{item.server}</Button>)}</form></main>;
  return <ConnectedApp dark={dark} key={`${connection.server}:${connection.token}`} connection={connection} commonControls={commonControls} disconnect={async () => { await forgetConnection(connection.server); setConnection(null); }} changeServer={() => setConnection(null)} />;
}

function ConnectedApp({ dark, connection, commonControls, disconnect, changeServer }: { dark: boolean; connection: Connection; commonControls: React.ReactNode; disconnect: () => Promise<void>; changeServer: () => void }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const [transport] = useState(() => new HerdrTransport(connection));
  const [machine, setMachine] = useState('local');
  const [workspaceId, setWorkspaceId] = useState('');
  const [tabId, setTabId] = useState('');
  const [paneId, setPaneId] = useState('');
  const [panel, setPanel] = useState<Panel>('terminal');
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryState>(() => {
    try { const record = loadPendingDelivery(connection.server); return record ? { kind: 'pending', record } : { kind: 'clear' }; }
    catch { return { kind: 'storageError' }; }
  });
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
  const scope = `${machine}:${workspaceId}:${tabId}:${paneId}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const readMachines = useCallback((signal: AbortSignal) => transport.request('/api/herdr/machines', machinesSchema, { signal }), [transport]);
  const machines = usePolling(readMachines, true, 15000);
  const readInfo = useCallback((signal: AbortSignal) => transport.request('/api/herdr/info', infoSchema, { signal }), [transport]);
  const info = usePolling(readInfo, true, 30000);
  const readSnapshot = useCallback((signal: AbortSignal) => { void refresh; return transport.rpc(machine, 'session.snapshot', {}, snapshotSchema, signal).then(result => result.snapshot); }, [transport, machine, refresh]);
  const snapshot = usePolling(readSnapshot, true, 3000, machine);
  const workspaces = snapshot.data?.workspaces ?? [];
  const workspace = workspaces.find(item => item.workspace_id === workspaceId);
  const tabs = snapshot.data?.tabs.filter(item => item.workspace_id === workspace?.workspace_id) ?? [];
  const tab = tabs.find(item => item.tab_id === tabId);
  const panes = snapshot.data?.panes.filter(item => item.tab_id === tab?.tab_id) ?? [];
  const pane = panes.find(item => item.pane_id === paneId);
  useEffect(() => {
    if (!snapshot.data) return;
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
  }, [snapshot.data, workspaceId, tabId, paneId]);
  const agent = snapshot.data?.agents.find(item => item.pane_id === pane?.pane_id);
  const effectivePaneId = pane?.pane_id ?? '';
  const readOutput = useCallback((signal: AbortSignal) => transport.rpc(machine, 'pane.read', { pane_id: effectivePaneId, source: 'recent', format: 'text', strip_ansi: true, lines: 500 }, readSchema, signal).then(result => result.read), [transport, machine, effectivePaneId]);
  const terminal = usePolling(readOutput, panel === 'terminal' && !!effectivePaneId, 900);
  const cwd = pane?.foreground_cwd ?? pane?.cwd;
  const readWorktrees = useCallback((signal: AbortSignal) => transport.rpc(machine, 'worktree.list', { workspace_id: workspaceId }, worktreesSchema, signal), [transport, machine, workspaceId]);
  const worktrees = usePolling(readWorktrees, panel === 'worktrees' && !!workspace, 15000);
  const readClients = useCallback((signal: AbortSignal) => { void refresh; return transport.request('/api/herdr/clients', clientsSchema, { signal }); }, [transport, refresh]);
  const clients = usePolling(readClients, panel === 'devices', 15000, 'devices');
  const error = snapshot.error ?? machines.error ?? info.error;
  const validOutput = terminal.data?.pane_id === effectivePaneId ? terminal.data : null;
  useEffect(() => { if (follow && output.current) output.current.scrollTop = output.current.scrollHeight; }, [validOutput?.revision, follow]);
  const switchMachine = (next: string) => { setMachine(next); setWorkspaceId(''); setTabId(''); setPaneId(''); setDraft(''); setNotice(null); setAction(null); };
  const chooseWorkspace = (next: string) => { setWorkspaceId(next); setTabId(''); setPaneId(''); setDraft(''); setNotice(null); setDrawer(false); };
  const resolveDelivery = (): boolean => {
    try { clearPendingDelivery(connection.server); setDelivery({ kind: 'clear' }); return true; }
    catch { setNotice({ text: h('deliveryStorage'), uncertain: false }); return false; }
  };
  const checkDelivery = async () => {
    if (delivery.kind !== 'pending' || checkingDelivery) return;
    const requestId = delivery.record.requestId;
    setCheckingDelivery(true);
    try {
      const result = await transport.request(`/api/herdr/receipts/${encodeURIComponent(requestId)}`, deliveryReceiptSchema);
      if (result.receipt.requestId !== requestId) throw new Error('Invalid delivery receipt');
      if (result.receipt.status === 'unknown') setNotice({ text: h('outcomeUnknown'), uncertain: false });
      else if (resolveDelivery()) {
        setNotice({ text: h(result.receipt.status === 'complete' ? 'deliveryComplete' : 'deliveryRejected'), uncertain: false });
        setRefresh(value => value + 1);
      }
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : h('disconnected'), uncertain: false }); }
    finally { setCheckingDelivery(false); }
  };
  const mutate = async (mutation: Mutation, onSuccess?: () => void) => {
    if (mutationBlocked || mutationInFlight.current) return;
    const sentScope = scopeRef.current;
    const record: PendingDelivery = { requestId: crypto.randomUUID(), server: connection.server, machine, session: machine === 'local' ? info.data?.session ?? null : null, workspaceId, tabId, paneId, method: mutation.method };
    try { storePendingDelivery(record); }
    catch { setDelivery({ kind: 'storageError' }); setAction(null); setNotice({ text: h('deliveryStorage'), uncertain: false }); return; }
    mutationInFlight.current = true;
    setDelivery({ kind: 'pending', record });
    setBusy(true); setNotice(null);
    try {
      await transport.mutate(machine, mutation, record.requestId);
      resolveDelivery();
      if (scopeRef.current === sentScope) { onSuccess?.(); setRefresh(value => value + 1); }
    } catch (error) {
      const uncertain = !(error instanceof TransportError) || error.uncertain;
      if (uncertain) {
        setDelivery({ kind: 'pending', record }); setAction(null);
        setNotice({ text: h('outcomeUnknown'), uncertain: true });
      } else {
        resolveDelivery();
        if (scopeRef.current === sentScope) setNotice({ text: error instanceof Error ? error.message : h('disconnected'), uncertain: false });
      }
    } finally { mutationInFlight.current = false; setBusy(false); }
  };
  const send = () => {
    if (!pane || !draft.trim() || mutationBlocked || error) return;
    const sentText = draft;
    const mutation: Mutation = agent?.name ? { method: 'agent.prompt', params: { target: pane.pane_id, text: sentText } } : { method: 'pane.send_input', params: { pane_id: pane.pane_id, text: sentText, keys: ['enter'] } };
    void mutate(mutation, () => setDraft(current => current === sentText ? '' : current));
  };
  const openAction = (next: Action) => { setAction(next); setActionValue('value' in next ? next.value : ''); setActionCwd(''); };
  const submitAction = async (event: FormEvent) => {
    event.preventDefault(); if (!action || mutationBlocked) return;
    const name = actionValue.trim();
    switch (action.kind) {
      case 'workspace.create': {
        const params: Extract<Mutation, { method: 'workspace.create' }>['params'] = { label: name, focus: false };
        if (actionCwd.trim()) params.cwd = actionCwd.trim();
        await mutate({ method: action.kind, params }, () => setAction(null)); break;
      }
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
  const panelTitle = panel === 'terminal' ? t('layout.mainTab.terminal') : panel === 'worktrees' ? t('mobile.sessions.section.worktrees') : h('devices');
  const newWorkspace = () => openAction({ kind: 'workspace.create', title: h('newWorkspace'), value: '' });
  const destructive = action && ['workspace.close','tab.close','pane.close','revoke'].includes(action.kind);
  return <div className="herdr-shell">
    {drawer && <div className="herdr-drawer-shade" onClick={() => setDrawer(false)} aria-hidden="true" />}
    <aside className={`herdr-sidebar ${drawer ? 'is-open' : ''}`} aria-label={h('workspaces')}>
      <div className="herdr-sidebar-header"><span className="herdr-brand"><Icon name="code-box" className="size-5" />OpenHerdr</span><Button variant="ghost" size="icon" onClick={() => setDrawer(false)} className="herdr-mobile-only" aria-label={t('mobile.surface.closeAria')}><Icon name="close" className="size-4" /></Button></div>
      <div className="herdr-machine"><Icon name="computer" className="size-4" /><select className={dropdownTriggerVariants()} value={machine} onChange={event => switchMachine(event.target.value)} aria-label={h('machines')}><option value="local">{connection.server.replace(/^https?:\/\//, '')}</option>{machines.data?.machines.filter(item => item.id !== 'local').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <div className="herdr-sidebar-actions"><Button variant="outline" onClick={newWorkspace} disabled={mutationBlocked || !!error}><Icon name="add" className="size-4" />{h('newWorkspace')}</Button></div>
      <div className="herdr-search"><Icon name="search" className="size-4" /><Input inputSize="compact" value={query} onChange={event => setQuery(event.target.value)} aria-label={h('workspaces')} placeholder={h('workspaces')} /></div>
      <div className="herdr-section-label">{h('workspaces')}<span>{workspaces.length}</span></div>
      <nav className="herdr-workspace-list">{workspaces.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <Button key={item.workspace_id} variant="ghost" className={`herdr-workspace ${workspace?.workspace_id === item.workspace_id ? 'is-selected' : ''}`} aria-pressed={workspace?.workspace_id === item.workspace_id} onClick={() => chooseWorkspace(item.workspace_id)}><Icon name="folder" className="size-4" /><span dir="auto">{item.label}</span><i className={`herdr-status ${item.agent_status}`} title={item.agent_status} /></Button>)}{snapshot.loading && <p className="herdr-muted">{t('common.loading')}</p>}{!snapshot.loading && !snapshot.error && workspaces.length === 0 && <p className="herdr-muted">{h('noWorkspaces')}</p>}</nav>
      <footer className="herdr-sidebar-footer"><Button variant="ghost" aria-pressed={panel === 'devices'} onClick={() => { setPanel(panel === 'devices' ? 'terminal' : 'devices'); setDrawer(false); }}><Icon name="shield-check" className="size-4" />{h('devices')}</Button><div className="herdr-row">{commonControls}</div><Button variant="ghost" size="sm" onClick={changeServer}>{h('server')}</Button><Button variant="ghost" size="sm" onClick={() => { void disconnect().catch(() => setNotice({ text: h('credentialStorage'), uncertain: false })); }}>{h('disconnected')}</Button></footer>
    </aside>
    <main className="herdr-main"><header className="herdr-topbar"><div className="herdr-breadcrumb"><Button variant="ghost" size="icon" className="herdr-mobile-only" aria-label={h('workspaces')} aria-pressed={drawer} onClick={() => setDrawer(!drawer)}><Icon name="menu-2" className="size-4" /></Button><Icon name="folder-open" className="size-4 herdr-desktop-only" /><span dir="auto">{workspace?.label ?? 'OpenHerdr'}</span><span className="herdr-muted herdr-desktop-only">/</span><span className="herdr-muted herdr-desktop-only" dir="auto">{tab?.label}</span></div><div className="herdr-row"><span className={`herdr-connection ${error ? 'has-error' : ''}`}><i className={`herdr-status ${error ? 'blocked' : 'idle'}`} />{error ? h('disconnected') : snapshot.loading ? t('common.loading') : h('connected')}</span><Button variant="ghost" size="icon" onClick={() => setRefresh(value => value + 1)} aria-label={t('gitView.history.refresh')}><Icon name="refresh" className="size-4" /></Button></div></header>
      {error && <div className="herdr-banner herdr-error" role="alert">{error.message}</div>}
      {delivery.kind !== 'clear' && <div className="herdr-banner herdr-warning" role="alert"><div><p>{busy ? t('common.loading') : delivery.kind === 'storageError' ? h('deliveryStorage') : h('outcomeUnknown')}</p>{delivery.kind === 'pending' && <p className="herdr-fine" dir="ltr">{delivery.record.machine} · {delivery.record.session ?? t('common.unavailable')} · {delivery.record.workspaceId} · {delivery.record.tabId} · {delivery.record.paneId} · {delivery.record.method} · {delivery.record.requestId}</p>}<div className="herdr-row">{delivery.kind === 'pending' && <Button size="sm" variant="outline" onClick={() => { setMachine(delivery.record.machine); setWorkspaceId(delivery.record.workspaceId); setTabId(delivery.record.tabId); setPaneId(delivery.record.paneId); setDraft(''); setPanel('terminal'); }}>{t('layout.mainTab.terminal')}</Button>}{delivery.kind === 'pending' && <Button size="sm" variant="outline" disabled={busy || checkingDelivery} onClick={() => void checkDelivery()}>{checkingDelivery ? t('common.loading') : h('checkDelivery')}</Button>}<Button size="sm" variant="outline" disabled={busy || checkingDelivery} onClick={() => { if (resolveDelivery()) setNotice(null); }}>{h('reviewTerminal')}</Button></div></div></div>}
      {notice && <div className={`herdr-banner ${notice.uncertain ? 'herdr-warning' : 'herdr-error'}`} role="alert">{notice.uncertain ? h('outcomeUnknown') : notice.text}<Button variant="ghost" size="xs" onClick={() => setNotice(null)} aria-label={t('mobile.surface.closeAria')}><Icon name="close" className="size-4" /></Button></div>}
      <div className="herdr-view-tabs"><Button variant="ghost" size="sm" aria-pressed={panel === 'terminal'} onClick={() => setPanel('terminal')}><Icon name="terminal" className="size-4" />{t('layout.mainTab.terminal')}</Button><Button variant="ghost" size="sm" aria-pressed={panel === 'worktrees'} onClick={() => setPanel(panel === 'worktrees' ? 'terminal' : 'worktrees')}><Icon name="git-branch" className="size-4" />{t('mobile.sessions.section.worktrees')}</Button><Button variant="ghost" size="sm" aria-pressed={panel === 'files'} onClick={() => setPanel(panel === 'files' ? 'terminal' : 'files')}><Icon name="file-text" className="size-4" />{t('layout.mainTab.files')}</Button><Button variant="ghost" size="sm" aria-pressed={panel === 'changes'} onClick={() => setPanel(panel === 'changes' ? 'terminal' : 'changes')}><Icon name="git-commit" className="size-4" />{t('mobile.nav.changes')}</Button><span className="herdr-spacer" />{workspace && <><Button variant="ghost" size="icon" disabled={mutationBlocked} onClick={() => openAction({ kind: 'workspace.rename', title: t('sessions.sidebar.session.menu.rename'), target: workspace.workspace_id, value: workspace.label })} aria-label={t('sessions.sidebar.session.menu.rename')}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} onClick={() => openAction({ kind: 'workspace.close', title: workspace.label, target: workspace.workspace_id })} aria-label={t('mobile.surface.closeAria')}><Icon name="close" className="size-4" /></Button></>}</div>
      {panel === 'terminal' && <>
        <div className="herdr-terminal-tabs">{tabs.map(item => <Button key={item.tab_id} variant="ghost" size="sm" aria-pressed={tab?.tab_id === item.tab_id} onClick={() => { setTabId(item.tab_id); setPaneId(''); setDraft(''); setNotice(null); }}><Icon name="terminal" className="size-4" /><span dir="auto">{item.label}</span></Button>)}<Button variant="ghost" size="icon" disabled={!workspace || mutationBlocked || !!error} aria-label={t('terminalView.tabs.newTabTitle')} onClick={() => openAction({ kind: 'tab.create', title: t('terminalView.tabs.newTabTitle'), value: '' })}><Icon name="add" className="size-4" /></Button><span className="herdr-spacer" />{tab && <><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('terminalView.tabs.menu.rename')} onClick={() => openAction({ kind: 'tab.rename', title: t('terminalView.tabs.menu.rename'), target: tab.tab_id, value: tab.label })}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('contextPanel.tab.menu.close')} onClick={() => openAction({ kind: 'tab.close', title: tab.label, target: tab.tab_id })}><Icon name="close" className="size-4" /></Button></>}</div>
        <div className="herdr-pane-toolbar"><div className="herdr-row"><select className={dropdownTriggerVariants()} value={effectivePaneId} disabled={panes.length === 0} onChange={event => { setPaneId(event.target.value); setDraft(''); setNotice(null); }} aria-label={h('target')}>{!pane && <option value="" disabled>{t('common.unavailable')}</option>}{panes.map(item => <option key={item.pane_id} value={item.pane_id}>{item.label ?? item.title ?? item.terminal_title_stripped ?? item.pane_id}</option>)}</select>{pane && <span className="herdr-muted herdr-desktop-only">{pane.agent_status}</span>}</div><div className="herdr-row">{pane && <><Button variant="ghost" size="icon" disabled={mutationBlocked || !!error} title={h('split')} aria-label={h('split')} onClick={() => void mutate({ method: 'pane.split', params: { target_pane_id: pane.pane_id, direction: 'right', focus: false } })}><Icon name="layout-column" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('terminalView.tabs.menu.rename')} onClick={() => openAction({ kind: 'pane.rename', title: t('terminalView.tabs.menu.rename'), target: pane.pane_id, value: pane.label ?? '' })}><Icon name="edit" className="size-4" /></Button><Button variant="ghost" size="icon" disabled={mutationBlocked} aria-label={t('contextPanel.tab.menu.close')} onClick={() => openAction({ kind: 'pane.close', title: pane.label ?? pane.pane_id, target: pane.pane_id })}><Icon name="close" className="size-4" /></Button></>}</div></div>
        {terminal.error && <div className="herdr-banner herdr-error" role="alert">{terminal.error.message}</div>}
        <div className="herdr-terminal-body">{!pane ? <div className="herdr-empty"><Icon name="terminal" className="size-10" /><h2>{workspace ? h('noPane') : h('noWorkspaces')}</h2>{!workspace && !snapshot.loading && !error && <Button disabled={mutationBlocked} onClick={newWorkspace}><Icon name="add" className="size-4" />{h('newWorkspace')}</Button>}</div> : (frames ? <LiveTerminal key={`${machine}:${pane.pane_id}`} connection={transport.connection} machine={machine} paneId={pane.pane_id} theme={dark ? darkTheme : lightTheme} fallback={<div className="herdr-content"><p className="herdr-content-root">{h('snapshot')}</p><pre ref={output} className="herdr-output" style={{ flex: 1, minHeight: 0, height: 'auto' }} dir="ltr" tabIndex={0} aria-label={h('snapshot')} onScroll={event => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40); }}><code>{validOutput?.text || (terminal.loading ? t('common.loading') : h('noOutput'))}</code></pre></div>} /> : <pre ref={output} className="herdr-output" dir="ltr" tabIndex={0} aria-label={h('snapshot')} onScroll={event => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 40); }}><code>{validOutput?.text || (terminal.loading ? t('common.loading') : h('noOutput'))}</code></pre>)}</div>
        {validOutput?.truncated && <p className="herdr-truncated">{h('truncated')}</p>}
        <div className="herdr-terminal-status"><Button size="xs" variant="ghost" aria-pressed={!frames} onClick={() => setFrames(!frames)}>{h('snapshot')}</Button><span dir="ltr">{cwd ?? ''}</span><Button variant="ghost" size="xs" aria-pressed={follow} onClick={() => setFollow(!follow)}>{h('follow')}</Button><span>{validOutput ? `r${validOutput.revision}` : ''}</span></div>
        <div className="herdr-composer-area"><div className="herdr-target" dir="ltr">{h('target')} · {machine} · {machine === 'local' ? info.data?.session : machine} · {effectivePaneId || '...'}</div><div className="herdr-keybar" dir="ltr">{['Ctrl-C','Esc','Tab','↑','↓','←','→'].map((key, index) => <Button key={key} size="sm" variant="outline" disabled={!pane || mutationBlocked || !!error} onClick={() => pane && void mutate({ method: 'pane.send_keys', params: { pane_id: pane.pane_id, keys: [['ctrl-c'],['escape'],['tab'],['up'],['down'],['left'],['right']][index] } })}>{key}</Button>)}<span className="herdr-spacer" />{pane && !pane.agent && <Button size="sm" variant="ghost" disabled={mutationBlocked || !!error} onClick={() => openAction({ kind: 'agent.start', title: h('startAgent'), target: pane.pane_id, value: '' })}><Icon name="code-ai" className="size-4" /><span className="herdr-desktop-only">{h('startAgent')}</span></Button>}</div><form className="herdr-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea aria-label={agent?.name ? h('promptAgent') : h('composer')} placeholder={h('composer')} value={draft} disabled={!pane || delivery.kind !== 'clear' || !!error} maxLength={65536} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><div className="herdr-composer-footer"><span>{busy ? t('common.loading') : h('sendHint')}</span><Button type="submit" size="icon" disabled={!pane || mutationBlocked || !draft.trim() || !!error} aria-label={t('rightSidebar.contextNotesTodo.sendDialog.actions.send')}><Icon name="arrow-up" className="size-4" /></Button></div></form></div>
      </>}
      {panel === 'files' && <FilesPanel key={`${machine}:${effectivePaneId}`} transport={transport} machine={machine} paneId={effectivePaneId} />}
      {panel === 'changes' && <ChangesPanel key={`${machine}:${effectivePaneId}`} transport={transport} machine={machine} paneId={effectivePaneId} />}
      {panel === 'worktrees' && <section className="herdr-detail"><h1>{panelTitle}</h1>{!workspace ? <p className="herdr-muted">{h('noPane')}</p> : worktrees.error ? <p className="herdr-error" role="alert">{worktrees.error.message}</p> : worktrees.loading ? <p>{t('common.loading')}</p> : <>{worktrees.data?.worktrees.length === 0 && <p>{h('empty')}</p>}{worktrees.data?.worktrees.map(item => <article key={item.path} className="herdr-detail-card"><Icon name="git-branch" className="size-5" /><div><h2 dir="auto">{item.label}</h2><p dir="ltr">{item.path}</p><code dir="ltr">{item.branch ?? 'HEAD'}</code></div></article>)}</>}</section>}
      {panel === 'devices' && <section className="herdr-detail"><h1>{panelTitle}</h1>{clients.error ? <p className="herdr-error" role="alert">{clients.error.message}</p> : clients.loading ? <p>{t('common.loading')}</p> : <>{clients.data?.clients.length === 0 && <p>{h('empty')}</p>}{clients.data?.clients.map(item => <article key={item.id} className="herdr-detail-card"><Icon name="computer" className="size-5" /><div><h2 dir="auto">{item.deviceName ?? item.label ?? item.id}</h2><p dir="ltr">{item.id}</p></div><Button variant="destructive" size="sm" disabled={mutationBlocked || !!item.revokedAt} onClick={() => openAction({ kind: 'revoke', title: item.deviceName ?? item.id, target: item.id })}>{h('revoke')}</Button></article>)}</>}</section>}
    </main>
    <Dialog open={!!action} onOpenChange={open => { if (!open && !busy) setAction(null); }}><DialogContent className="herdr-dialog"><form onSubmit={event => void submitAction(event)}><DialogHeader><DialogTitle>{action?.title}</DialogTitle><DialogDescription>{destructive ? h(action?.kind === 'revoke' ? 'revokeConfirm' : 'closeConfirm') : h('target') + ' · ' + machine}</DialogDescription></DialogHeader>{!destructive && <label>{t('mobile.instances.label.label')}<Input required maxLength={action?.kind === 'agent.start' ? 32 : 128} pattern={action?.kind === 'agent.start' ? '[a-z][a-z0-9_-]{0,31}' : undefined} autoFocus value={actionValue} onChange={event => setActionValue(event.target.value)} /></label>}{action?.kind === 'workspace.create' && <label>{h('cwd')}<Input dir="ltr" value={actionCwd} onChange={event => setActionCwd(event.target.value)} /></label>}{action?.kind === 'agent.start' && <label>{t('sessions.scheduledTasks.editor.agent.label')}<select className={dropdownTriggerVariants()} value={agentKind} onChange={event => setAgentKind(event.target.value)}>{['codex','claude','opencode','gemini','kimi','grok','agy'].map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>}{notice && <p role="alert" className="herdr-error">{notice.uncertain ? h('outcomeUnknown') : notice.text}</p>}<DialogFooter><Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>{t('sessions.sidebar.dialogs.cancel')}</Button><Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={mutationBlocked || (!destructive && !actionValue.trim())}>{busy ? t('common.loading') : destructive ? t('mobile.surface.closeAria') : t('gitView.history.actions.createBranchConfirm')}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
