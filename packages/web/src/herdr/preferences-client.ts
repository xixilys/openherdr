import { z } from 'zod';
import { CODE_FONT_OPTIONS, DEFAULT_MONO_FONT, DEFAULT_UI_FONT, UI_FONT_OPTIONS } from '@/lib/fontOptions';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from '@/lib/theme/themes';
import { HerdrTransport, TransportError } from './transport';

const preferenceSurfaceSchema = z.enum(['web', 'desktop', 'vscode', 'mobile']);
export type PreferenceSurface = z.infer<typeof preferenceSurfaceSchema>;
const themeId = z.string().trim().min(1).max(128);
const preferencesValuesSchema = z.strictObject({
  themeId: themeId.optional(), useSystemTheme: z.boolean().optional(),
  lightThemeId: themeId.optional(), darkThemeId: themeId.optional(),
  fontSize: z.number().min(50).max(200).optional(),
  uiFont: z.enum(UI_FONT_OPTIONS.map(option => option.id)).optional(),
  monoFont: z.enum(CODE_FONT_OPTIONS.map(option => option.id)).optional(),
  enterToSend: z.boolean().optional(), enterToSendConfigured: z.boolean().optional(),
  expandReasoningWhileStreaming: z.boolean().optional(),
});
export type PreferencesValues = z.infer<typeof preferencesValuesSchema>;
export type ResolvedHerdrPreferences = Required<PreferencesValues>;
const preferencesSnapshotSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), surface: preferenceSurfaceSchema, values: preferencesValuesSchema,
});
export type PreferencesSnapshot = z.infer<typeof preferencesSnapshotSchema>;
export const HERDR_PREFERENCE_KEYS = ['themeId', 'useSystemTheme', 'lightThemeId', 'darkThemeId', 'fontSize', 'uiFont', 'monoFont', 'enterToSend', 'enterToSendConfigured', 'expandReasoningWhileStreaming'] as const;
const DEFAULTS: ResolvedHerdrPreferences = {
  themeId: DEFAULT_LIGHT_THEME_ID, useSystemTheme: true, lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID,
  fontSize: 100, uiFont: DEFAULT_UI_FONT, monoFont: DEFAULT_MONO_FONT,
  enterToSend: false, enterToSendConfigured: false, expandReasoningWhileStreaming: false,
};
export function resolveHerdrPreferences(values: PreferencesValues): ResolvedHerdrPreferences {
  const resolved = { ...DEFAULTS };
  for (const key of HERDR_PREFERENCE_KEYS) if (values[key] !== undefined) Object.assign(resolved, { [key]: values[key] });
  return resolved;
}
export interface PreferencesAPI {
  read: () => Promise<PreferencesSnapshot>;
  update: (expectedRevision: number, changes: PreferencesValues) => Promise<PreferencesSnapshot>;
}
export class HerdrPreferencesClient implements PreferencesAPI {
  constructor(private transport: HerdrTransport, readonly surface: PreferenceSurface) {}
  private async request(body: { operation: 'read'; surface: PreferenceSurface } | { operation: 'update'; surface: PreferenceSurface; expectedRevision: number; changes: PreferencesValues }) {
    const result = await this.transport.request('/api/herdr/preferences', preferencesSnapshotSchema, { method: 'POST', body: JSON.stringify(body) });
    if (result.surface !== this.surface) throw new TransportError('INVALID_RESPONSE', 'Invalid preference surface');
    return result;
  }
  read() { return this.request({ operation: 'read', surface: this.surface }); }
  update(expectedRevision: number, changes: PreferencesValues) { return this.request({ operation: 'update', surface: this.surface, expectedRevision, changes: preferencesValuesSchema.parse(changes) }); }
}
export type PreferencesView = {
  snapshot: PreferencesSnapshot | null;
  values: ResolvedHerdrPreferences;
  changes: PreferencesValues;
  loading: boolean;
  saving: boolean;
  failure: 'load' | 'save' | 'conflict' | null;
};
const hasChanges = (changes: PreferencesValues) => HERDR_PREFERENCE_KEYS.some(key => changes[key] !== undefined);

/** Owns one server and surface, including saves already sent when its view closes. */
export class HerdrPreferencesController {
  private state: PreferencesView = { snapshot: null, values: resolveHerdrPreferences({}), changes: {}, loading: false, saving: false, failure: null };
  private listeners = new Set<() => void>();
  private loadGeneration = 0;
  private activeSave: Promise<void> | null = null;
  private closed = false;
  constructor(private api: PreferencesAPI) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: PreferencesView) { this.state = state; for (const listener of this.listeners) listener(); }
  async refresh({ explicit = false }: { explicit?: boolean } = {}) {
    if (this.closed) return;
    const resolvingConflict = explicit && this.state.failure === 'conflict';
    const generation = ++this.loadGeneration;
    this.publish({ ...this.state, loading: true });
    try {
      const snapshot = await this.api.read();
      if (this.closed || generation !== this.loadGeneration) return;
      if (this.state.snapshot && snapshot.revision < this.state.snapshot.revision) { this.publish({ ...this.state, loading: false }); return; }
      const failure = this.state.failure === 'conflict' && !resolvingConflict ? 'conflict' : null;
      this.publish({ ...this.state, snapshot, loading: false, failure, values: resolveHerdrPreferences({ ...snapshot.values, ...this.state.changes }) });
    } catch {
      if (!this.closed && generation === this.loadGeneration) this.publish({ ...this.state, loading: false, failure: this.state.failure === 'conflict' ? 'conflict' : 'load' });
    }
  }
  change(changes: PreferencesValues) {
    if (this.closed) return;
    const patch = preferencesValuesSchema.parse(changes);
    const pending = { ...this.state.changes, ...patch };
    this.publish({ ...this.state, changes: pending, values: resolveHerdrPreferences({ ...this.state.values, ...patch }) });
    // A conflict requires an explicit refresh. Nothing automatically replays it.
    if (this.state.snapshot && this.state.failure !== 'conflict') void this.save();
  }
  save = (): Promise<void> => {
    if (this.closed || !this.state.snapshot || !hasChanges(this.state.changes) || this.state.failure === 'conflict') return Promise.resolve();
    if (this.activeSave) return this.activeSave;
    const changes = { ...this.state.changes };
    const expectedRevision = this.state.snapshot.revision;
    this.publish({ ...this.state, saving: true, failure: null });
    this.activeSave = this.api.update(expectedRevision, changes).then(snapshot => {
      const remaining = { ...this.state.changes };
      for (const key of HERDR_PREFERENCE_KEYS) if (changes[key] !== undefined && remaining[key] === changes[key]) delete remaining[key];
      const authoritative = this.state.snapshot && this.state.snapshot.revision > snapshot.revision ? this.state.snapshot : snapshot;
      this.publish({ ...this.state, snapshot: authoritative, changes: remaining, values: resolveHerdrPreferences({ ...authoritative.values, ...remaining }), failure: null });
    }).catch(error => {
      this.publish({ ...this.state, failure: error instanceof TransportError && error.code === 'preferences_conflict' ? 'conflict' : 'save' });
    }).finally(() => {
      this.activeSave = null;
      this.publish({ ...this.state, saving: false });
      if (!this.closed && !this.state.failure && hasChanges(this.state.changes)) void this.save();
    });
    return this.activeSave;
  };
  cancelRefresh() { this.loadGeneration++; }
  close() { this.closed = true; this.loadGeneration++; this.listeners.clear(); return this.activeSave ?? Promise.resolve(); }
}
