import { afterEach, beforeEach, expect, test } from 'bun:test';
import { z } from 'zod';
import { HerdrTransport, loadPendingDelivery, clearPendingDelivery, TransportError, type PendingDelivery } from './transport';
import { trackConversationMutation } from './conversation-actions';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
const savedFetch = globalThis.fetch;
const savedLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const savedSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } } } });
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedLocal) Object.defineProperty(globalThis, 'localStorage', savedLocal); else Reflect.deleteProperty(globalThis, 'localStorage');
  if (savedSession) Object.defineProperty(globalThis, 'sessionStorage', savedSession); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
});
const target = { machine: 'local', paneId: 'w1:p1', identity: 'resolved-one' };
const schema = z.object({ accepted: z.literal(true), target: z.object({ machine: z.string(), paneId: z.string(), identity: z.string() }), sessionId: z.string(), action: z.string(), result: z.object({ sessionID: z.string() }) });
const accepted = { accepted: true, target, sessionId: 'ses_owned', action: 'prompt', result: { sessionID: 'ses_owned' } };
const request = { target, sessionId: 'ses_owned', action: 'prompt', input: { text: 'Actual prompt' } };
const record = (server: string, requestId: string): PendingDelivery => ({ server, requestId, machine: 'local', paneId: 'w1:p1', workspaceId: 'w1', tabId: 'w1:t1', session: 'owned-test', method: 'conversation.prompt' });
const gate = () => { let resolve = () => {}; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test('unknown conversation delivery blocks every later mutation without a retry', async () => {
  const server = 'https://unknown-conversation.example'; const transport = new HerdrTransport({ server, token: 'fixture-device' }); let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls += 1; throw new Error('Disconnected after dispatch'); }, savedFetch);
  let pending: PendingDelivery | null = null;
  await expect(trackConversationMutation({ transport, record: record(server, 'request-one'), path: '/api/herdr/conversations/act', request, schema, onPendingDelivery: (value) => { pending = value; } })).rejects.toThrow();
  expect(await loadPendingDelivery(server)).toMatchObject({ requestId: 'request-one' }); expect(pending).toMatchObject({ requestId: 'request-one' });
  const later = await trackConversationMutation({ transport, record: record(server, 'request-two'), path: '/api/herdr/conversations/act', request, schema });
  expect(later.kind).toBe('pending'); expect(calls).toBe(1);
});

test('a confirmed refusal clears only its delivery record', async () => {
  const server = 'https://refused-conversation.example'; const transport = new HerdrTransport({ server, token: 'fixture-device' });
  globalThis.fetch = Object.assign(async () => Response.json({ error: { code: 'conversation_target_changed', message: 'Target changed' } }, { status: 409 }), savedFetch);
  await expect(trackConversationMutation({ transport, record: record(server, 'request-refused'), path: '/api/herdr/conversations/act', request, schema })).rejects.toThrow('Target changed');
  expect(await loadPendingDelivery(server)).toBeNull();
});

test('late completion cannot clear a newer pending operation or its shared warning', async () => {
  const server = 'https://late-conversation.example'; const transport = new HerdrTransport({ server, token: 'fixture-device' });
  const firstStarted = gate(), releaseFirst = gate(), secondStarted = gate(), releaseSecond = gate();
  const envelope = z.object({ requestId: z.string() });
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, options?: RequestInit) => {
    const body = envelope.parse(JSON.parse(String(options?.body)));
    if (body.requestId === 'request-first') { firstStarted.resolve(); await releaseFirst.promise; }
    else { secondStarted.resolve(); await releaseSecond.promise; }
    return Response.json(accepted);
  }, savedFetch);
  let latest: PendingDelivery | null = null;
  const first = trackConversationMutation({ transport, record: record(server, 'request-first'), path: '/api/herdr/conversations/act', request, schema, onPendingDelivery: (value) => { latest = value; } });
  await firstStarted.promise;
  await clearPendingDelivery(server, 'request-first');
  const second = transport.trackedRequest(record(server, 'request-second'), '/api/herdr/conversations/act', request, schema);
  await secondStarted.promise; releaseFirst.resolve();
  expect((await first).kind).toBe('complete');
  expect(await loadPendingDelivery(server)).toMatchObject({ requestId: 'request-second' }); expect(latest).toMatchObject({ requestId: 'request-second' });
  releaseSecond.resolve(); await second; await clearPendingDelivery(server, 'request-second');
});

test('a response for another target, session or action preserves uncertain delivery', async () => {
  const mismatches = [
    { ...accepted, target: { ...target, identity: 'resolved-other' } },
    { ...accepted, target: { ...target, machine: 'other' } },
    { ...accepted, target: { ...target, paneId: 'w1:p2' } },
    { ...accepted, sessionId: 'ses_other' },
    { ...accepted, action: 'abort' },
    { ...accepted, result: { sessionID: 'ses_other' } },
  ];
  for (const [index, response] of mismatches.entries()) {
    const server = `https://mismatched-${index}.example`;
    const transport = new HerdrTransport({ server, token: 'fixture-device' });
    globalThis.fetch = Object.assign(async () => Response.json(response), savedFetch);
    let failure: Error | null = null;
    try { await trackConversationMutation({ transport, record: record(server, 'request-mismatched'), path: '/api/herdr/conversations/act', request, schema }); }
    catch (error) { if (error instanceof Error) failure = error; }
    expect(failure).toBeInstanceOf(TransportError);
    expect(failure).toMatchObject({ code: 'INVALID_RESPONSE', uncertain: true, requestId: 'request-mismatched' });
    expect(await loadPendingDelivery(server)).toMatchObject({ requestId: 'request-mismatched' });
  }
});

test('matching receipt clears the captured delivery', async () => {
  const server = 'https://accepted-conversation.example';
  const transport = new HerdrTransport({ server, token: 'fixture-device' });
  globalThis.fetch = Object.assign(async () => Response.json(accepted), savedFetch);
  const result = await trackConversationMutation({ transport, record: record(server, 'request-accepted'), path: '/api/herdr/conversations/act', request, schema });
  expect(result.kind).toBe('complete'); expect(await loadPendingDelivery(server)).toBeNull();
});
