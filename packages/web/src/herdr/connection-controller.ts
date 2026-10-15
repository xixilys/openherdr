import { normalizeServer, parsePairing, type Connection, type Pairing } from './transport';

type ConnectionOperations = {
  initialize: () => Promise<void>;
  list: () => Connection[];
  redeem: (server: string, pairing: Pairing) => Promise<Connection>;
  save: (connection: Connection) => Promise<void>;
  probe: (connection: Connection) => Promise<'ready' | 'unauthorized'>;
  rename: (server: string, label: string) => Promise<void>;
  forget: (server: string) => Promise<void>;
};
type PairingIntent = { pairing: Pairing; server: string } | { error: string };
type ConnectionPhase = 'editing' | 'checking-storage' | 'redeeming' | 'saving' | 'save-failed' | 'probing' | 'renaming' | 'removing';
type ConnectionState = {
  server: string;
  pairingText: string;
  pairing: Pairing | null;
  phase: ConnectionPhase;
  error: string | null;
  saved: Connection[];
  intakeRevision: number;
  savingSaved: string | null;
  authRequiredServer: string | null;
};

/** Owns one-use redemption and the credential that must be saved afterward. */
export class HerdrConnectionController {
  private state: ConnectionState;
  private listeners = new Set<() => void>();
  private inFlight = false;
  private confirmed: Connection | null = null;
  private queuedIntent: PairingIntent | null = null;
  private active = true;
  private rejected = new Map<string, string>();

  constructor(private operations: ConnectionOperations, private onConnected: (connection: Connection) => void, initial: { server: string; pairing: Pairing | null; error: string | null }) {
    this.state = { ...initial, pairingText: '', phase: 'editing', saved: operations.list(), intakeRevision: 0, savingSaved: null, authRequiredServer: null };
  }
  getSnapshot = (): ConnectionState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  setActive(active: boolean): void { this.active = active; }
  private update(change: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...change };
    this.listeners.forEach(listener => listener());
  }
  private get locked(): boolean { return this.inFlight || this.confirmed !== null; }
  isRejected(connection: Connection): boolean { return this.rejected.get(connection.server) === connection.token; }
  requireAuthentication(connection: Connection, preserveIntent: boolean): void {
    if (this.isRejected(connection)) return;
    this.rejected.set(connection.server, connection.token);
    if (!this.locked && !preserveIntent) {
      this.update({ authRequiredServer: connection.server, server: connection.server, pairing: null, pairingText: '', error: null, intakeRevision: this.state.intakeRevision + 1 });
    } else this.update({ authRequiredServer: connection.server });
  }
  setServer(server: string): void { if (!this.locked) this.update({ server, error: null }); }
  startPairing(server = ''): boolean {
    if (this.locked) return false;
    this.update({ server, pairing: null, pairingText: '', error: null, intakeRevision: this.state.intakeRevision + 1 });
    return true;
  }
  setPairingText(pairingText: string): void {
    if (this.locked) return;
    let server = this.state.server;
    try { server = parsePairing(pairingText).server ?? server; } catch { /* Partial input remains editable. */ }
    this.update({ pairingText, pairing: null, server, error: null });
  }
  acceptLink(value: string): void {
    this.update({ intakeRevision: this.state.intakeRevision + 1 });
    let intent: PairingIntent;
    try {
      // Camera and OS links must carry their own HTTPS origin. Manual fragments
      // remain supported only in the explicit form with a separately typed URL.
      if (!/^(https:\/\/|openherdr:\/\/)/.test(value.trim())) throw new Error('invalidPairing');
      const pairing = parsePairing(value);
      if (!pairing.server || new URL(pairing.server).protocol !== 'https:') throw new Error('invalidServer');
      intent = { pairing, server: pairing.server };
    } catch (error) { intent = { error: error instanceof Error ? error.message : 'invalidPairing' }; }
    if (this.locked) { this.queuedIntent = intent; return; }
    this.applyIntent(intent);
  }
  private applyIntent(intent: PairingIntent): void {
    if ('error' in intent) this.update({ pairing: null, pairingText: '', error: intent.error });
    else this.update({ ...intent, pairingText: '', error: null });
  }
  async connect(): Promise<void> {
    if (this.inFlight) return;
    let server: string;
    let payload: Pairing | null = null;
    try {
      server = this.confirmed?.server ?? normalizeServer(this.state.server);
      if (!this.confirmed) {
        payload = this.state.pairing ?? parsePairing(this.state.pairingText);
        if (payload.server && normalizeServer(payload.server) !== server) throw new Error('invalidServer');
      }
    } catch (error) { this.update({ error: error instanceof Error ? error.message : 'invalidPairing' }); return; }
    this.inFlight = true;
    this.update({ phase: this.confirmed ? 'saving' : 'checking-storage', error: null });
    try {
      // Do not consume a one-use code while the credential store is unreadable.
      try { await this.operations.initialize(); } catch { throw new Error('credentialStorage'); }
      if (!this.confirmed && payload) {
        this.update({ phase: 'redeeming' });
        this.confirmed = await this.operations.redeem(server, payload);
      }
      if (!this.confirmed) throw new Error('invalidPairing');
      const connection = this.confirmed;
      this.update({ phase: 'saving' });
      await this.operations.save(connection);
      if (this.isRejected(connection)) throw new Error('unauthorized');
      this.confirmed = null;
      const next = this.queuedIntent;
      this.queuedIntent = null;
      this.update({ phase: 'editing', saved: this.operations.list(), pairing: null, pairingText: '', authRequiredServer: next ? this.state.authRequiredServer : null });
      if (next) this.applyIntent(next);
      else if (this.active) this.onConnected(connection);
    } catch (error) {
      this.update({ phase: this.confirmed ? 'save-failed' : 'editing', error: this.confirmed ? 'credentialSave' : error instanceof Error ? error.message : 'DISCONNECTED' });
      if (!this.confirmed && this.queuedIntent) {
        const next = this.queuedIntent;
        this.queuedIntent = null;
        this.applyIntent(next);
      }
    } finally { this.inFlight = false; }
  }
  async selectSaved(server: string): Promise<void> {
    if (this.locked) return;
    const connection = this.operations.list().find(item => item.server === server);
    if (!connection || this.isRejected(connection)) return;
    this.inFlight = true;
    this.update({ phase: 'probing', error: null, savingSaved: server });
    try {
      const result = await this.operations.probe(connection);
      if (result === 'unauthorized') {
        this.rejected.set(server, connection.token);
        this.update({ phase: 'editing', savingSaved: null, server, pairing: null, pairingText: '', authRequiredServer: server });
        if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
        return;
      }
      // A new pairing intent supersedes this switch before it can change MRU.
      if (this.queuedIntent || !this.active || this.isRejected(connection)) {
        this.update({ phase: 'editing', savingSaved: null });
        if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
        return;
      }
      this.update({ phase: 'saving' });
      await this.operations.save(connection);
      if (this.isRejected(connection)) {
        this.update({ phase: 'editing', savingSaved: null });
        if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
        return;
      }
      this.update({ phase: 'editing', saved: this.operations.list(), server, pairing: null, pairingText: '', savingSaved: null, authRequiredServer: null });
      const next = this.queuedIntent;
      this.queuedIntent = null;
      if (next) this.applyIntent(next);
      else if (this.active) this.onConnected(connection);
    } catch {
      this.update({ phase: 'editing', error: this.state.phase === 'probing' ? 'connectionUnavailable' : 'credentialStorage', savingSaved: null });
      if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
    }
    finally { this.inFlight = false; }
  }
  async renameSaved(server: string, label: string): Promise<boolean> {
    if (this.locked || !this.operations.list().some(item => item.server === server)) return false;
    this.inFlight = true;
    this.update({ phase: 'renaming', error: null });
    try {
      await this.operations.rename(server, label);
      this.update({ saved: this.operations.list() });
      return true;
    } catch { this.update({ error: 'credentialStorage' }); return false; }
    finally {
      this.inFlight = false;
      this.update({ phase: 'editing' });
      if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
    }
  }
  async removeSaved(server: string): Promise<Connection | null> {
    if (this.locked) return null;
    const connection = this.operations.list().find(item => item.server === server);
    if (!connection) return null;
    this.inFlight = true;
    this.update({ phase: 'removing', error: null });
    try {
      await this.operations.forget(server);
      this.update({ saved: this.operations.list(), authRequiredServer: this.state.authRequiredServer === server ? null : this.state.authRequiredServer });
      return connection;
    } catch { this.update({ error: 'credentialStorage' }); return null; }
    finally {
      this.inFlight = false;
      this.update({ phase: 'editing' });
      if (this.queuedIntent) { const next = this.queuedIntent; this.queuedIntent = null; this.applyIntent(next); }
    }
  }
  refreshSaved(): void { this.update({ saved: this.operations.list() }); }
}
