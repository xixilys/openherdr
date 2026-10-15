import { z } from 'zod';
import { getHerdrNativeVault } from '@openchamber/ui/lib/herdr-credentials';

const id = z.string().min(1).max(256);
const status = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);
const agentSessionSchema = z.object({ source: z.string(), agent: z.string(), kind: z.enum(['id', 'path']), value: z.string() });
const pane = z.object({ agent_session: agentSessionSchema.nullable().optional(), pane_id: id, workspace_id: id, tab_id: id, terminal_id: id, focused: z.boolean(), revision: z.number().int().nonnegative(), agent_status: status, label: z.string().nullable().optional(), title: z.string().nullable().optional(), terminal_title_stripped: z.string().nullable().optional(), cwd: z.string().nullable().optional(), foreground_cwd: z.string().nullable().optional(), agent: z.string().nullable().optional(), display_agent: z.string().nullable().optional() });
const workspace = z.object({ workspace_id: id, label: z.string(), focused: z.boolean(), active_tab_id: id, agent_status: status, pane_count: z.number(), tab_count: z.number() });
const tab = z.object({ tab_id: id, workspace_id: id, label: z.string(), focused: z.boolean(), agent_status: status, pane_count: z.number() });
const agent = pane.extend({ name: z.string().nullable().optional(), interactive_ready: z.boolean().optional(), launch_pending: z.boolean().optional() });
export const snapshotSchema = z.object({ type: z.literal('session_snapshot'), snapshot: z.object({ version: z.string(), protocol: z.number(), workspaces: z.array(workspace).max(10000), tabs: z.array(tab).max(20000), panes: z.array(pane).max(20000), agents: z.array(agent).max(20000) }) });
export const readSchema = z.object({ type: z.literal('pane_read'), read: z.object({ pane_id: id, workspace_id: id, tab_id: id, source: z.string(), format: z.literal('text'), text: z.string().max(2_000_000), revision: z.number().int().nonnegative(), truncated: z.boolean() }) });
export const machinesSchema = z.object({ machines: z.array(z.object({ id, label: z.string() })), session: z.string().nullable() });
export const infoSchema = z.object({ app: z.literal('openherdr'), version: z.string(), session: z.string().nullable(), allowRemoteFonts: z.boolean().default(false) });
export const worktreesSchema = z.object({ type: z.literal('worktree_list'), worktrees: z.array(z.object({ path: z.string(), label: z.string(), branch: z.string().nullable().optional(), is_detached: z.boolean(), is_bare: z.boolean(), is_prunable: z.boolean(), is_linked_worktree: z.boolean() })) });
export const clientsSchema = z.object({ clients: z.array(z.object({ id, deviceName: z.string().nullable().optional(), label: z.string().nullable().optional(), revokedAt: z.string().nullable().optional(), createdAt: z.number().or(z.string()).optional(), lastUsedAt: z.number().or(z.string()).nullable().optional() })) });
export type Connection = { server: string; token: string };
const pairingSchema = z.object({ pairingId: id, secret: z.string().min(1).max(4096), server: z.string().optional() });
export type Pairing = z.infer<typeof pairingSchema>;
const connectionsSchema = z.array(z.object({ server: z.string(), token: z.string().min(1) })).max(50);
const storageKey = 'openherdr.connections.v1';

export function normalizeServer(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('invalidServer');
  return url.origin;
}

export function parsePairing(value: string): Pairing {
  const trimmed = value.trim();
  if (trimmed.startsWith('openherdr:')) return parseNativePairing(trimmed);
  let outerOrigin: string | null = null;
  let fragment = trimmed;
  if (!trimmed.startsWith('#')) {
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new Error('invalidPairing'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.pathname !== '/') throw new Error('invalidPairing');
    outerOrigin = url.origin;
    fragment = url.hash;
  }
  const encoded = new URLSearchParams(fragment.slice(1)).get('pairing');
  if (!encoded || encoded.length > 10000 || !/^[a-zA-Z0-9_-]+$/.test(encoded)) throw new Error('invalidPairing');
  let pairing: Pairing;
  try {
    pairing = pairingSchema.parse(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)))));
  } catch { throw new Error('invalidPairing'); }
  const server = pairing.server ? normalizeServer(pairing.server) : outerOrigin;
  if (outerOrigin && server !== outerOrigin) throw new Error('invalidServer');
  return server ? { ...pairing, server } : pairing;
}

export function parseNativePairing(value: string): Pairing {
  const url = new URL(value);
  if (url.protocol !== 'openherdr:' || url.hostname !== 'connect' || (url.pathname !== '' && url.pathname !== '/') || url.username || url.password || url.port || url.search) throw new Error('invalidPairing');
  const pairing = parsePairing(url.hash);
  if (!pairing.server || new URL(normalizeServer(pairing.server)).protocol !== 'https:') throw new Error('invalidServer');
  return { ...pairing, server: normalizeServer(pairing.server) };
}

export function takeInitialPairing(): Pairing | null {
  const fragment = window.location.hash;
  if (!fragment) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return parsePairing(fragment);
}

export type ConnectionStorage = {
  kind: 'native' | 'browser';
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};

export class ConnectionStore {
  private connections: Connection[] = [];
  private initialized = false;
  private loading: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  constructor(private storage: ConnectionStorage) {}
  get kind(): ConnectionStorage['kind'] { return this.storage.kind; }
  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => { this.loading = null; });
    return this.loading;
  }
  private async load(): Promise<void> {
    const raw = await this.storage.read();
    const parsed = connectionsSchema.safeParse(raw === null ? [] : (() => {
      try { return JSON.parse(raw); } catch { return null; }
    })());
    if (!parsed.success && this.storage.kind === 'native') throw new Error('credentialStorage');
    this.connections = parsed.success ? parsed.data : [];
    this.initialized = true;
  }
  list(): Connection[] { return this.connections.map(connection => ({ ...connection })); }
  private update(change: (connections: Connection[]) => Connection[]): Promise<void> {
    const operation = this.writes.then(async () => {
      await this.initialize();
      const next = change(this.connections);
      await this.storage.write(JSON.stringify(next));
      this.connections = next;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
  save(connection: Connection): Promise<void> {
    return this.update(previous => [connection, ...previous.filter(item => item.server !== connection.server)]);
  }
  forget(server: string): Promise<void> {
    return this.update(previous => previous.filter(item => item.server !== server));
  }
}

let connectionStore: ConnectionStore | null = null;
export async function initializeConnections(): Promise<void> {
  if (!connectionStore) {
    const vault = getHerdrNativeVault();
    connectionStore = new ConnectionStore(vault ? { kind: 'native', ...vault } : {
      kind: 'browser',
      async read() { try { return localStorage.getItem(storageKey); } catch { return null; } },
      async write(value) { localStorage.setItem(storageKey, value); },
    });
  }
  await connectionStore.initialize();
}
export function credentialStorageKind(): ConnectionStorage['kind'] { return connectionStore?.kind ?? 'browser'; }
export function savedConnections(): Connection[] { return connectionStore?.list() ?? []; }
export async function saveConnection(connection: Connection): Promise<void> {
  try {
    await initializeConnections();
    if (!connectionStore) throw new Error('credentialStorage');
    await connectionStore.save(connection);
  } catch { throw new Error('credentialStorage'); }
}
export async function forgetConnection(server: string): Promise<void> {
  try {
    await initializeConnections();
    if (!connectionStore) throw new Error('credentialStorage');
    await connectionStore.forget(server);
  } catch { throw new Error('credentialStorage'); }
}

export class TransportError extends Error {
  constructor(public code: string, message: string, public uncertain = false, public requestId?: string) { super(message); }
}
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const envelopeSchema = z.object({ id: z.string().or(z.number()).nullable().optional(), result: z.unknown() });
export type Mutation =
  | { method: 'workspace.create'; params: { label: string; cwd?: string; focus: false } }
  | { method: 'workspace.rename'; params: { workspace_id: string; label: string } }
  | { method: 'workspace.close'; params: { workspace_id: string } }
  | { method: 'tab.create'; params: { workspace_id: string; label: string; focus: false } }
  | { method: 'tab.rename'; params: { tab_id: string; label: string } }
  | { method: 'tab.close'; params: { tab_id: string } }
  | { method: 'pane.rename'; params: { pane_id: string; label: string } }
  | { method: 'pane.split'; params: { target_pane_id: string; direction: 'right' | 'down'; focus: false } }
  | { method: 'pane.close'; params: { pane_id: string } }
  | { method: 'pane.send_input'; params: { pane_id: string; text: string; keys: string[] } }
  | { method: 'pane.send_keys'; params: { pane_id: string; keys: string[] } }
  | { method: 'agent.start'; params: { pane_id: string; name: string; kind: string } }
  | { method: 'agent.prompt'; params: { target: string; text: string } }
  | { method: 'worktree.create'; params: { workspace_id: string; branch: string; base?: string; label?: string; focus?: boolean } }
  | { method: 'worktree.open'; params: { workspace_id: string; branch: string; label?: string; focus?: boolean } }
  | { method: 'worktree.remove'; params: { workspace_id: string; force?: false } };

type ReadMethodParameters = {
  'session.snapshot': { workspace_id?: never; pane_id?: never };
  'pane.read': { pane_id: string; source: 'visible' | 'recent' | 'recent_unwrapped' | 'detection'; lines?: number; format?: 'text' | 'ansi'; strip_ansi?: boolean };
  'worktree.list': { workspace_id: string };
};

export type HerdrJsonValue = z.infer<ReturnType<typeof z.json>>;

type TrackedRequest =
  | { machine: string; pane_id: string; operation: string }
  | { target: { machine: string; paneId: string }; title?: string }
  | { target: { machine: string; paneId: string }; sessionId: string }
  | { target: { machine: string; paneId: string }; sessionId: string; action: string; input: HerdrJsonValue };

const nativeWorkspaceId = z.string().regex(/^w[A-Za-z0-9]+$/);
const nativeTabId = z.string().regex(/^w[A-Za-z0-9]+:t[A-Za-z0-9]+$/);
const nativePaneId = z.string().regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/);
const nativeWorkspace = workspace.extend({ workspace_id: nativeWorkspaceId, active_tab_id: nativeTabId });
const nativeTab = tab.extend({ tab_id: nativeTabId, workspace_id: nativeWorkspaceId });
const nativePane = pane.extend({ pane_id: nativePaneId, workspace_id: nativeWorkspaceId, tab_id: nativeTabId });
const nativeMutationSchema = z.object({ type: z.string(), workspace: nativeWorkspace.optional(), tab: nativeTab.optional(), root_pane: nativePane.optional(), workspace_id: nativeWorkspaceId.optional(), path: z.string().optional(), forced: z.boolean().optional(), already_open: z.boolean().optional() });
const worktreeCreated = z.object({ type: z.literal('worktree_created'), workspace: nativeWorkspace, tab: nativeTab, root_pane: nativePane });
const worktreeOpened = z.object({ type: z.literal('worktree_opened'), workspace: nativeWorkspace, tab: nativeTab, root_pane: nativePane, already_open: z.boolean() });
const linkedSelection = (result: Pick<z.infer<typeof worktreeCreated>, 'workspace' | 'tab' | 'root_pane'>) => result.workspace.workspace_id === result.tab.workspace_id && result.workspace.workspace_id === result.root_pane.workspace_id && result.tab.tab_id === result.root_pane.tab_id && result.workspace.active_tab_id === result.tab.tab_id && result.tab.tab_id.startsWith(result.workspace.workspace_id + ':') && result.root_pane.pane_id.startsWith(result.workspace.workspace_id + ':');
export type NativeMutationResult = z.infer<typeof nativeMutationSchema>;
type NativeDispatchResult = { kind: 'pending'; record: PendingDelivery } | { kind: 'stored'; value: NativeMutationResult };

export class HerdrTransport {
  constructor(readonly connection: Connection, private deliveries = pendingDeliveries, private onAuthenticationRequired?: (connection: Connection) => void) {}
  private async response(path: string, options: RequestInit, mutation: boolean): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.connection.server), { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.connection.token}`, ...options.headers }, signal: options.signal ?? AbortSignal.timeout(20000), cache: 'no-store', credentials: 'omit', redirect: 'error' });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new TransportError(mutation ? 'OUTCOME_UNKNOWN' : 'DISCONNECTED', 'Connection failed', mutation);
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsed = errorSchema.safeParse(body);
      if (response.status === 401 && parsed.success && parsed.data.error.code === 'unauthorized' && !options.signal?.aborted) {
        this.onAuthenticationRequired?.(this.connection);
      }
      throw new TransportError(parsed.success ? parsed.data.error.code : `HTTP_${response.status}`, parsed.success ? parsed.data.error.message : `HTTP ${response.status}`, mutation && (response.status >= 500 || (parsed.success && ['outcome_unknown', 'request_already_recorded'].includes(parsed.data.error.code))));
    }
    return response;
  }
  async request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}, mutation = false): Promise<T> {
    const response = await this.response(path, options, mutation);
    const body: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new TransportError('INVALID_RESPONSE', 'Invalid server response', mutation);
    return parsed.data;
  }
  async streamResponse(path: string, options: RequestInit & { signal: AbortSignal }): Promise<Response> {
    const response = await this.response(path, options, false);
    if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-ndjson' || !response.body) {
      await response.body?.cancel();
      throw new TransportError('INVALID_RESPONSE', 'Invalid server stream');
    }
    return response;
  }
  async rpc<T, Method extends keyof ReadMethodParameters>(machine: string, method: Method, params: ReadMethodParameters[Method], schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const response = await this.request('/api/herdr/rpc', envelopeSchema, { method: 'POST', body: JSON.stringify({ machine, method, params }), signal });
    const parsed = schema.safeParse(response.result);
    if (!parsed.success) throw new TransportError('INVALID_RESPONSE', 'Invalid Herdr response');
    return parsed.data;
  }
  async dispatchTrackedMutation(record: PendingDelivery, mutation: Mutation): Promise<NativeDispatchResult> {
    const params = mutation.params;
    const targetMatches = (!('pane_id' in params) || params.pane_id === record.paneId)
      && (!('target_pane_id' in params) || params.target_pane_id === record.paneId)
      && (!('target' in params) || params.target === record.paneId)
      && (!('workspace_id' in params) || params.workspace_id === record.workspaceId)
      && (!('tab_id' in params) || params.tab_id === record.tabId);
    if (!targetMatches || record.server !== this.connection.server || record.method !== mutation.method) throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId);
    let result: DeliveryBeginResult;
    try { result = await this.deliveries.begin(record); }
    catch { throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId); }
    if (result.kind === 'pending') return result;
    const value = await this.mutate(record.machine, mutation, record.requestId);
    return { kind: 'stored', value };
  }
  async trackedRequest<T>(record: PendingDelivery, path: string, request: TrackedRequest, schema: z.ZodType<T>): Promise<{ kind: 'pending'; record: PendingDelivery } | { kind: 'complete'; value: T }> {
    let matches = false;
    if ((path === '/api/herdr/host' || path === '/api/herdr/project-context') && 'machine' in request) {
      matches = record.machine === request.machine && record.paneId === request.pane_id && record.method === request.operation;
    } else if ('target' in request) {
      const action = path === '/api/herdr/conversations/create' ? 'create' : path === '/api/herdr/conversations/rebind' && 'sessionId' in request ? 'rebind' : path === '/api/herdr/conversations/act' && 'action' in request ? request.action : null;
      matches = action !== null && record.machine === request.target.machine && record.paneId === request.target.paneId && record.method === `conversation.${action}`;
    }
    if (!matches || record.server !== this.connection.server) throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId);
    let stored: DeliveryBeginResult;
    try { stored = await this.deliveries.begin(record); }
    catch { throw new TransportError('DELIVERY_STORAGE', 'deliveryStorage', false, record.requestId); }
    if (stored.kind === 'pending') return stored;
    try {
      const value = await this.request(path, schema, { method: 'POST', body: JSON.stringify({ request, requestId: record.requestId }), signal: AbortSignal.timeout(60000) }, true);
      return { kind: 'complete', value };
    } catch (error) {
      if (error instanceof TransportError) throw new TransportError(error.code, error.message, error.uncertain, record.requestId);
      throw new TransportError('OUTCOME_UNKNOWN', 'The host did not confirm this request', true, record.requestId);
    }
  }
  async mutate(machine: string, mutation: Mutation, requestId: string = crypto.randomUUID()): Promise<NativeMutationResult> {
    try {
      const result = await this.request('/api/herdr/rpc', envelopeSchema, { method: 'POST', body: JSON.stringify({ machine, ...mutation, requestId }), signal: AbortSignal.timeout(60000) }, true);
      const schema = mutation.method === 'worktree.create' ? worktreeCreated.refine(linkedSelection)
        : mutation.method === 'worktree.open' ? worktreeOpened.refine(linkedSelection)
        : mutation.method === 'worktree.remove' ? z.object({ type: z.literal('worktree_removed'), workspace_id: nativeWorkspaceId, path: z.string(), forced: z.literal(false) }).refine((value) => value.workspace_id === mutation.params.workspace_id)
        : nativeMutationSchema;
      const parsed = schema.safeParse(result.result);
      if (!parsed.success) throw new TransportError('INVALID_RESPONSE', 'Invalid mutation response', true);
      return parsed.data;
    } catch (error) {
      if (error instanceof TransportError) throw new TransportError(error.code, error.message, error.uncertain, requestId);
      throw new TransportError('OUTCOME_UNKNOWN', 'Herdr did not confirm delivery', true, requestId);
    }
  }

}
export const deliveryReceiptSchema = z.object({ receipt: z.object({ requestId: z.string(), status: z.enum(['unknown', 'complete', 'rejected']) }) });
const pendingDeliverySchema = z.object({ requestId: z.string().min(8).max(128), server: z.string(), machine: z.string(), session: z.string().nullable(), workspaceId: z.string(), tabId: z.string(), paneId: z.string(), method: z.string() });
export type PendingDelivery = z.infer<typeof pendingDeliverySchema>;
const deliveryKey = (server: string) => `openherdr.pending.v1:${server}`;
export type DeliveryBeginResult = { kind: 'stored' } | { kind: 'pending'; record: PendingDelivery };

type DeliveryLock = { request<T>(name: string, operation: () => Promise<T>): Promise<T> };

export class PendingDeliveryStore {
  private queues = new Map<string, Promise<void>>();
  constructor(private storageForServer: (server: string) => ConnectionStorage, private lock?: DeliveryLock | null) {}
  private serialized<T>(server: string, operation: (storage: ConnectionStorage) => Promise<T>): Promise<T> {
    const previous = this.queues.get(server) ?? Promise.resolve();
    const next = previous.then(() => {
      const storage = this.storageForServer(server);
      const lock = this.lock === undefined ? globalThis.navigator?.locks : this.lock;
      // The lock spans read, optional legacy migration, compare and write across tabs.
      if (lock) return lock.request(`openherdr.pending:${server}`, () => operation(storage));
      if (storage.kind === 'browser') throw new Error('deliveryStorage');
      return operation(storage);
    });
    this.queues.set(server, next.then(() => undefined, () => undefined));
    return next;
  }
  private async read(storage: ConnectionStorage, server: string): Promise<PendingDelivery | null> {
    const raw = await storage.read();
    if (raw === null) return null;
    try {
      const value = pendingDeliverySchema.nullable().parse(JSON.parse(raw));
      if (value && value.server !== server) throw new Error('deliveryStorage');
      return value;
    } catch { throw new Error('deliveryStorage'); }
  }
  load(server: string): Promise<PendingDelivery | null> {
    return this.serialized(server, storage => this.read(storage, server));
  }
  begin(record: PendingDelivery): Promise<DeliveryBeginResult> {
    const pending = pendingDeliverySchema.parse(record);
    return this.serialized<DeliveryBeginResult>(pending.server, async storage => {
      const existing = await this.read(storage, pending.server);
      if (existing) return { kind: 'pending', record: existing };
      await storage.write(JSON.stringify(pending));
      return { kind: 'stored' };
    });
  }
  clear(server: string, requestId: string): Promise<boolean> {
    return this.serialized(server, async storage => {
      const existing = await this.read(storage, server);
      if (!existing) return true;
      if (existing.requestId !== requestId) return false;
      await storage.write('null');
      return true;
    });
  }
}

const pendingDeliveries = new PendingDeliveryStore(server => {
  const key = deliveryKey(server);
  const vault = getHerdrNativeVault({ pendingServer: server });
  return {
    kind: vault ? 'native' : 'browser',
    async read() {
      const raw = vault ? await vault.read() : localStorage.getItem(key);
      if (raw !== null) return raw;
      // Preserve a still-open browser tab's pending mutation when upgrading
      // from the earlier session-only journal. Native migration writes the
      // vault before removing the old metadata.
      const legacy = sessionStorage.getItem(key);
      if (legacy === null) return null;
      const record = pendingDeliverySchema.parse(JSON.parse(legacy));
      if (record.server !== server) throw new Error('deliveryStorage');
      if (vault) await vault.write(JSON.stringify(record));
      else localStorage.setItem(key, JSON.stringify(record));
      sessionStorage.removeItem(key);
      return JSON.stringify(record);
    },
    async write(value) {
      if (vault) await vault.write(value);
      else localStorage.setItem(key, value);
    },
  };
});
export function loadPendingDelivery(server: string): Promise<PendingDelivery | null> { return pendingDeliveries.load(server); }
export function clearPendingDelivery(server: string, requestId: string): Promise<boolean> { return pendingDeliveries.clear(server, requestId); }

export async function redeem(server: string, pairing: Pairing): Promise<Connection> {
  const response = await fetch(new URL('/api/pairing/redeem', server), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairingId: pairing.pairingId, secret: pairing.secret, deviceName: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'OpenHerdr Mobile' : 'OpenHerdr Browser' }), signal: AbortSignal.timeout(20000), credentials: 'omit', redirect: 'error' });
  const body: unknown = await response.json();
  if (!response.ok) { const parsed = errorSchema.safeParse(body); throw new TransportError(parsed.success ? parsed.data.error.code : 'PAIRING_FAILED', parsed.success ? parsed.data.error.message : 'Pairing failed'); }
  const result = z.object({ token: z.string().min(1), client: z.object({ id }) }).parse(body);
  return { server, token: result.token };
}
