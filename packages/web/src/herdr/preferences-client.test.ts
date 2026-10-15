import { expect, test } from 'bun:test';
import { HerdrPreferencesController, resolveHerdrPreferences, type PreferencesAPI, type PreferencesSnapshot, type PreferencesValues } from './preferences-client';
import { TransportError } from './transport';

const snapshot = (revision: number, values: PreferencesValues = {}): PreferencesSnapshot => ({ version: 1, revision, surface: 'mobile', values });
const deferred = <T>() => {
  let resolve: (value: T) => void = () => { throw new Error('Deferred was not initialized'); };
  let reject: (error: Error) => void = () => { throw new Error('Deferred was not initialized'); };
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('defaults retain upstream system appearance, system fonts, and unconfigured Enter behavior', () => {
  const values = resolveHerdrPreferences({ fontSize: 125 });
  expect(values.useSystemTheme).toBe(true);
  expect(values.uiFont).toBe('system');
  expect(values.monoFont).toBe('system-mono');
  expect(values.enterToSendConfigured).toBe(false);
  expect(values.expandReasoningWhileStreaming).toBe(false);
  expect(values.fontSize).toBe(125);
});

test('hydration preserves edits made after the read began', async () => {
  const reading = deferred<PreferencesSnapshot>();
  const writes: PreferencesValues[] = [];
  const api: PreferencesAPI = { read: () => reading.promise, update: async (revision, changes) => { writes.push(changes); return snapshot(revision + 1, changes); } };
  const controller = new HerdrPreferencesController(api);
  const loading = controller.refresh();
  controller.change({ fontSize: 135 });
  reading.resolve(snapshot(3, { fontSize: 80, uiFont: 'inter' }));
  await loading;
  expect(controller.getSnapshot().values.fontSize).toBe(135);
  expect(controller.getSnapshot().values.uiFont).toBe('inter');
  await controller.save();
  expect(writes).toEqual([{ fontSize: 135 }]);
});

test('rapid edits serialize saves and preserve the newer draft while the first write finishes', async () => {
  const writes: Array<{ revision: number; values: PreferencesValues; response: ReturnType<typeof deferred<PreferencesSnapshot>> }> = [];
  const api: PreferencesAPI = { read: async () => snapshot(0), update: (revision, values) => { const response = deferred<PreferencesSnapshot>(); writes.push({ revision, values, response }); return response.promise; } };
  const controller = new HerdrPreferencesController(api);
  await controller.refresh();
  controller.change({ fontSize: 110 });
  controller.change({ fontSize: 120, uiFont: 'inter' });
  expect(writes.length).toBe(1);
  writes[0].response.resolve(snapshot(1, { fontSize: 110 }));
  await tick();
  expect(controller.getSnapshot().values.fontSize).toBe(120);
  expect(writes.length).toBe(2);
  expect(writes[1].revision).toBe(1);
  expect(writes[1].values).toEqual({ fontSize: 120, uiFont: 'inter' });
  writes[1].response.resolve(snapshot(2, { fontSize: 120, uiFont: 'inter' }));
  await tick();
  expect(controller.getSnapshot().changes).toEqual({});
  expect(controller.getSnapshot().snapshot?.revision).toBe(2);
});

test('a read started before a successful save cannot restore the older revision', async () => {
  const older = deferred<PreferencesSnapshot>();
  let reads = 0;
  const api: PreferencesAPI = { read: () => ++reads === 1 ? Promise.resolve(snapshot(0)) : older.promise, update: async (revision, changes) => snapshot(revision + 1, changes) };
  const controller = new HerdrPreferencesController(api);
  await controller.refresh();
  const loading = controller.refresh();
  controller.change({ fontSize: 140 });
  await controller.save();
  older.resolve(snapshot(0, { fontSize: 70 }));
  await loading;
  expect(controller.getSnapshot().values.fontSize).toBe(140);
  expect(controller.getSnapshot().snapshot?.revision).toBe(1);
});

test('a newer authoritative read wins over an older delayed save response', async () => {
  const writing = deferred<PreferencesSnapshot>();
  let reads = 0;
  const api: PreferencesAPI = { read: async () => ++reads === 1 ? snapshot(0) : snapshot(2, { uiFont: 'roboto', fontSize: 140 }), update: () => writing.promise };
  const controller = new HerdrPreferencesController(api);
  await controller.refresh();
  controller.change({ fontSize: 140 });
  await controller.refresh();
  writing.resolve(snapshot(1, { fontSize: 140 }));
  await controller.save();
  expect(controller.getSnapshot().values.uiFont).toBe('roboto');
  expect(controller.getSnapshot().snapshot?.revision).toBe(2);
});

test('save failure retains draft and requires another deliberate attempt', async () => {
  let writes = 0;
  const api: PreferencesAPI = { read: async () => snapshot(0), update: async (revision, changes) => { if (++writes === 1) throw new Error('offline'); return snapshot(revision + 1, changes); } };
  const controller = new HerdrPreferencesController(api);
  await controller.refresh();
  controller.change({ fontSize: 150 });
  await controller.save();
  expect(controller.getSnapshot().failure).toBe('save');
  expect(controller.getSnapshot().changes).toEqual({ fontSize: 150 });
  expect(controller.getSnapshot().values.fontSize).toBe(150);
  await tick();
  expect(writes).toBe(1);
  await controller.save();
  expect(writes).toBe(2);
  expect(controller.getSnapshot().changes).toEqual({});
});

test('conflict preserves edits, blocks replay, and can be rebased only by refresh', async () => {
  let reads = 0;
  let writes = 0;
  const revisions: number[] = [];
  const api: PreferencesAPI = { read: async () => snapshot(++reads === 1 ? 0 : 4, { uiFont: 'roboto' }), update: async (revision, changes) => { revisions.push(revision); if (++writes === 1) throw new TransportError('preferences_conflict', 'stale'); return snapshot(revision + 1, { uiFont: 'roboto', ...changes }); } };
  const controller = new HerdrPreferencesController(api);
  await controller.refresh();
  controller.change({ fontSize: 150 });
  await controller.save();
  controller.change({ fontSize: 155 });
  await controller.save();
  expect(writes).toBe(1);
  expect(controller.getSnapshot().failure).toBe('conflict');
  await controller.refresh();
  controller.change({ monoFont: 'system-mono' });
  await controller.save();
  expect(controller.getSnapshot().failure).toBe('conflict');
  expect(writes).toBe(1);
  await controller.refresh({ explicit: true });
  expect(controller.getSnapshot().values.fontSize).toBe(155);
  expect(writes).toBe(1);
  await controller.save();
  expect(revisions).toEqual([0, 4]);
  expect(controller.getSnapshot().values.uiFont).toBe('roboto');
});

test('canceling a refresh allows StrictMode to mount again and accepted writes finish for their owner', async () => {
  const obsolete = deferred<PreferencesSnapshot>();
  const writing = deferred<PreferencesSnapshot>();
  let reads = 0;
  const api: PreferencesAPI = { read: () => ++reads === 1 ? obsolete.promise : Promise.resolve(snapshot(2)), update: () => writing.promise };
  const controller = new HerdrPreferencesController(api);
  const first = controller.refresh();
  controller.cancelRefresh();
  await controller.refresh();
  obsolete.resolve(snapshot(0, { fontSize: 60 }));
  await first;
  expect(controller.getSnapshot().snapshot?.revision).toBe(2);
  controller.change({ fontSize: 165 });
  const closing = controller.close();
  writing.resolve(snapshot(3, { fontSize: 165 }));
  await closing;
  expect(controller.getSnapshot().values.fontSize).toBe(165);
  expect(controller.getSnapshot().snapshot?.revision).toBe(3);
});
