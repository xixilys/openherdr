import { afterEach, describe, expect, test } from 'bun:test';
import { HerdrTransport, normalizeServer, parsePairing, snapshotSchema, TransportError, deliveryReceiptSchema, PendingDeliveryStore, parseNativePairing, ConnectionStore, probeConnection, renameConnection, saveConnection, forgetConnection, savedConnections, type PendingDelivery } from './transport';
import { order, rows } from './herdr.i18n';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('pairing and endpoint boundary', () => {
  test('decodes one-use pairing fragments without a bearer URL', () => {
    const payload = { pairingId: 'pair-1', secret: 'private-once', server: 'https://work.example' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(parsePairing(`https://work.example/#pairing=${encoded}`)).toEqual(payload);
    expect(() => parsePairing('https://work.example/?token=bad')).toThrow('invalidPairing');
    expect(() => parsePairing('#pairing=malformed')).toThrow('invalidPairing');
  });
  test('server identity is an origin and rejects embedded credentials and paths', () => {
    expect(normalizeServer('https://work.example/')).toBe('https://work.example');
    for (const value of ['https://user:pass@work.example', 'https://work.example/api', 'https://work.example/?token=secret', 'file:///tmp/local']) expect(() => normalizeServer(value)).toThrow();
  });
  test('manual localhost links retain HTTP support while origins must agree', () => {
    const payload = { pairingId: 'local-once', secret: 'fixture-secret', server: 'http://127.0.0.1:4318' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(parsePairing(`http://127.0.0.1:4318/#pairing=${encoded}`)).toEqual(payload);
    expect(() => parsePairing(`https://other.test/#pairing=${encoded}`)).toThrow('invalidServer');
    expect(() => parsePairing(`ftp://127.0.0.1/#pairing=${encoded}`)).toThrow('invalidPairing');
  });
  test('all supported translations have a complete scoped dictionary', () => {
    for (const translated of Object.values(rows)) { expect(translated).toHaveLength(order.length); expect(translated.every(value => value.length > 0)).toBe(true); }
  });
});

describe('authenticated Herdr requests', () => {
  test('only an explicit Herdr credential rejection requests authentication, including streams', async () => {
    const connection = { server: 'https://work.example', token: 'private-device' };
    const rejected: typeof connection[] = [];
    const transport = new HerdrTransport(connection, undefined, value => rejected.push(value));
    const responses = [
      Response.json({ error: { code: 'unauthorized', message: 'Rejected' } }, { status: 401 }),
      Response.json({ error: { code: 'conversation_request_refused', message: 'Upstream rejected' } }, { status: 401 }),
      new Response('<html>Unauthorized</html>', { status: 401 }),
      Response.json({ error: { code: 'unauthorized', message: 'Forbidden' } }, { status: 403 }),
      new Response('Cloudflare unavailable', { status: 530 }),
    ];
    for (const response of responses) {
      // SAFETY: The transport uses only fetch's callable request interface.
      globalThis.fetch = (async () => response) as typeof fetch;
      await expect(transport.request('/api/herdr/info', snapshotSchema)).rejects.toBeInstanceOf(TransportError);
    }
    expect(rejected).toEqual([connection]);
    // SAFETY: The stream request uses the same callable fetch interface.
    globalThis.fetch = (async () => Response.json({ error: { code: 'unauthorized', message: 'Rejected' } }, { status: 401 })) as typeof fetch;
    await expect(transport.streamResponse('/api/herdr/conversations/events', { signal: new AbortController().signal })).rejects.toBeInstanceOf(TransportError);
    expect(rejected).toEqual([connection, connection]);
  });
  test('an aborted owner cannot report a delayed credential rejection', async () => {
    const signal = new AbortController();
    let rejections = 0;
    // SAFETY: This deferred fixture only implements the callable fetch interface.
    globalThis.fetch = (async () => {
      signal.abort();
      return Response.json({ error: { code: 'unauthorized', message: 'Rejected' } }, { status: 401 });
    }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'old-device' }, undefined, () => { rejections += 1; });
    await expect(transport.request('/api/herdr/info', snapshotSchema, { signal: signal.signal })).rejects.toBeInstanceOf(TransportError);
    expect(rejections).toBe(0);
  });
  test('binds requests to the selected server with bearer headers and abort signal', async () => {
    let received: { url: string; init?: RequestInit } | undefined;
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      received = { url: String(input), init };
      return Response.json({ id: 'r1', result: { type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22, workspaces: [], tabs: [], panes: [], agents: [] } } });
    }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'private-device' });
    const controller = new AbortController();
    const result = await transport.rpc('remote-machine', 'session.snapshot', {}, snapshotSchema, controller.signal);
    expect(result.snapshot.workspaces).toEqual([]);
    expect(received?.url).toBe('https://work.example/api/herdr/rpc');
    expect(new Headers(received?.init?.headers).get('Authorization')).toBe('Bearer private-device');
    expect(received?.init?.signal).toBe(controller.signal);
    expect(received?.init?.body).toBe(JSON.stringify({ machine: 'remote-machine', method: 'session.snapshot', params: {} }));
  });
  test('invalid and failed reads remain failures', async () => {
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'private-device' });
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async () => Response.json({ id: 'r1', result: { type: 'session_snapshot', snapshot: {} } })) as typeof fetch;
    await expect(transport.rpc('local', 'session.snapshot', {}, snapshotSchema)).rejects.toThrow('Invalid Herdr response');
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async () => Response.json({ error: { code: 'OFFLINE', message: 'Machine unavailable' } }, { status: 503 })) as typeof fetch;
    await expect(transport.rpc('local', 'session.snapshot', {}, snapshotSchema)).rejects.toThrow('Machine unavailable');
  });
  test('mutation transport failure is unknown and is dispatched exactly once', async () => {
    let count = 0;
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async () => { count += 1; throw new Error('Connection reset'); }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'private-device' });
    try { await transport.mutate('local', { method: 'pane.send_input', params: { pane_id: 'pane-1', text: 'hello', keys: ['enter'] } }); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(TransportError); if (error instanceof TransportError) expect(error.uncertain).toBe(true); }
    expect(count).toBe(1);
  });
});

describe('credential persistence', () => {
  test('legacy credentials load without rewriting and optional saved labels normalize on read', async () => {
    const raw = JSON.stringify([{ server: 'https://one.example', token: 'device-one' }, { server: 'https://two.example', token: 'device-two', label: '  Work Mac  ' }]);
    let writes = 0;
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write() { writes += 1; } });
    await store.initialize();
    expect(store.list()).toEqual([{ server: 'https://one.example', token: 'device-one' }, { server: 'https://two.example', token: 'device-two', label: 'Work Mac' }]);
    expect(writes).toBe(0);
  });
  test('rename waits for durable storage and preserves origin, token and saved order', async () => {
    const initial = [{ server: 'https://one.example', token: 'device-one' }, { server: 'https://two.example', token: 'device-two', label: 'Other' }];
    let raw = JSON.stringify(initial);
    const started = deferred<void>();
    const gate = deferred<void>();
    const storage = { kind: 'native' as const, async read() { return raw; }, async write(value: string) { started.resolve(); await gate.promise; raw = value; } };
    const store = new ConnectionStore(storage);
    await store.initialize();
    const renaming = store.rename('https://two.example', '  Desk  ');
    await started.promise;
    expect(store.list()).toEqual(initial);
    expect(JSON.parse(raw)).toEqual(initial);
    gate.resolve();
    await renaming;
    const expected = [initial[0], { ...initial[1], label: 'Desk' }];
    expect(store.list()).toEqual(expected);
    const reopened = new ConnectionStore(storage);
    await reopened.initialize();
    expect(reopened.list()).toEqual(expected);
  });
  test('failed rename leaves both copies unchanged and later writes can recover', async () => {
    const initial = [{ server: 'https://one.example', token: 'device-one', label: 'Original' }];
    let raw = JSON.stringify(initial);
    let rejectWrite = true;
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write(value) { if (rejectWrite) throw new Error('Vault locked'); raw = value; } });
    await store.initialize();
    await expect(store.rename('https://one.example', 'Replacement')).rejects.toThrow('Vault locked');
    expect(store.list()).toEqual(initial);
    expect(JSON.parse(raw)).toEqual(initial);
    rejectWrite = false;
    await store.rename('https://one.example', 'Replacement');
    expect(store.list()[0]).toEqual({ ...initial[0], label: 'Replacement' });
  });
  test('re-pairing preserves an omitted label and an explicit empty name restores origin fallback', async () => {
    let raw: string | null = null;
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write(value) { raw = value; } });
    await store.save({ server: 'https://one.example', token: 'old-device', label: '  Workstation  ' });
    await store.save({ server: 'https://two.example', token: 'other-device' });
    await store.save({ server: 'https://one.example', token: 'replacement-device' });
    expect(store.list()).toEqual([{ server: 'https://one.example', token: 'replacement-device', label: 'Workstation' }, { server: 'https://two.example', token: 'other-device' }]);
    await store.rename('https://one.example', '   ');
    expect(store.list()[0].label).toBeUndefined();
    expect(JSON.parse(raw ?? '[]')[0]).toEqual({ server: 'https://one.example', token: 'replacement-device' });
    await store.save({ server: 'https://one.example', token: 'next-device', label: 'New label' });
    await store.save({ server: 'https://one.example', token: 'last-device', label: '' });
    expect(store.list()[0].label).toBeUndefined();
    expect(store.list()[0].token).toBe('last-device');
  });
  test('bounded label validation rejects invalid updates without poisoning the write queue', async () => {
    let raw: string | null = null;
    let writes = 0;
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write(value) { writes += 1; raw = value; } });
    await expect(store.save({ server: 'https://one.example', token: 'device-one', label: 'x'.repeat(129) })).rejects.toThrow();
    expect(writes).toBe(0);
    await store.save({ server: 'https://one.example', token: 'device-one', label: `  ${'x'.repeat(128)}  ` });
    const before = raw;
    await expect(store.rename('https://one.example', 'x'.repeat(129))).rejects.toThrow();
    expect(raw).toBe(before);
    expect(store.list()[0].label).toHaveLength(128);
    await store.rename('https://missing.example', 'Unrelated');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].server).toBe('https://one.example');
  });
  test('rename, save and forget share the same persistence order through a pending write', async () => {
    const first = { server: 'https://one.example', token: 'device-one', label: 'Original' };
    const second = { server: 'https://two.example', token: 'device-two' };
    let raw = JSON.stringify([first, second]);
    const started = deferred<void>();
    const gate = deferred<void>();
    const writes: string[] = [];
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write(value) { writes.push(value); if (writes.length === 1) { started.resolve(); await gate.promise; } raw = value; } });
    await store.initialize();
    const rename = store.rename(first.server, 'Renamed');
    const rePair = store.save({ server: first.server, token: 'new-device' });
    const forget = store.forget(second.server);
    await started.promise;
    expect(writes).toHaveLength(1);
    expect(store.list()).toEqual([first, second]);
    gate.resolve();
    await Promise.all([rename, rePair, forget]);
    expect(writes.map(value => JSON.parse(value))).toEqual([
      [{ ...first, label: 'Renamed' }, second],
      [{ ...first, token: 'new-device', label: 'Renamed' }, second],
      [{ ...first, token: 'new-device', label: 'Renamed' }],
    ]);
    expect(store.list()).toEqual(JSON.parse(raw));
  });
  test('exported rename reports storage failure and forgetting credentials preserves pending delivery metadata', async () => {
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>();
    let failWrite = false;
    const storage: Storage = { get length() { return values.size; }, clear() { values.clear(); }, key(index) { return Array.from(values.keys())[index] ?? null; }, getItem(key) { return values.get(key) ?? null; }, removeItem(key) { values.delete(key); }, setItem(key, value) { if (failWrite) throw new Error('Storage blocked'); values.set(key, value); } };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    try {
      const server = 'https://wrapper.example';
      const pending = JSON.stringify({ ...pendingRecord(), server });
      values.set(`openherdr.pending.v1:${server}`, pending);
      await saveConnection({ server, token: 'fixture-device' });
      await renameConnection(server, '  Work  ');
      expect(savedConnections()).toEqual([{ server, token: 'fixture-device', label: 'Work' }]);
      failWrite = true;
      await expect(renameConnection(server, 'Blocked')).rejects.toThrow('credentialStorage');
      expect(savedConnections()[0].label).toBe('Work');
      failWrite = false;
      await forgetConnection(server);
      expect(savedConnections()).toEqual([]);
      expect(values.get(`openherdr.pending.v1:${server}`)).toBe(pending);
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
  test('native saves wait for the vault and keep failed writes out of memory', async () => {
    const { ConnectionStore } = await import('./transport');
    let raw: string | null = null;
    let rejectWrite = false;
    const store = new ConnectionStore({ kind: 'native', async read() { return raw; }, async write(value) { if (rejectWrite) throw new Error('Vault locked'); raw = value; } });
    await store.initialize();
    await store.save({ server: 'https://one.example', token: 'device-one' });
    expect(store.list()).toEqual([{ server: 'https://one.example', token: 'device-one' }]);
    rejectWrite = true;
    await expect(store.save({ server: 'https://two.example', token: 'device-two' })).rejects.toThrow('Vault locked');
    expect(store.list()).toHaveLength(1);
    rejectWrite = false;
    await store.forget('https://one.example');
    expect(store.list()).toEqual([]);
    expect(raw).toBe('[]');
  });
  test('native read failure never becomes empty writable storage', async () => {
    const { ConnectionStore } = await import('./transport');
    let writes = 0;
    const store = new ConnectionStore({ kind: 'native', async read() { throw new Error('Vault unavailable'); }, async write() { writes += 1; } });
    await expect(store.initialize()).rejects.toThrow('Vault unavailable');
    await expect(store.save({ server: 'https://one.example', token: 'device-one' })).rejects.toThrow('Vault unavailable');
    expect(writes).toBe(0);
    expect(store.list()).toEqual([]);
  });
  test('native malformed storage is rejected and browser malformed legacy data stays recoverable', async () => {
    const { ConnectionStore } = await import('./transport');
    const native = new ConnectionStore({ kind: 'native', async read() { return '{malformed'; }, async write() { throw new Error('Unexpected write'); } });
    await expect(native.initialize()).rejects.toThrow('credentialStorage');
    const browser = new ConnectionStore({ kind: 'browser', async read() { return '{malformed'; }, async write() {} });
    await browser.initialize();
    expect(browser.list()).toEqual([]);
  });
  test('concurrent persistence retains every origin and reloads from the saved value', async () => {
    const { ConnectionStore } = await import('./transport');
    let raw: string | null = null;
    const storage = { kind: 'native' as const, async read() { return raw; }, async write(value: string) { await Promise.resolve(); raw = value; } };
    const store = new ConnectionStore(storage);
    await Promise.all([store.save({ server: 'https://one.example', token: 'device-one' }), store.save({ server: 'https://two.example', token: 'device-two' })]);
    const reopened = new ConnectionStore(storage);
    await reopened.initialize();
    expect(reopened.list()).toHaveLength(2);
    await reopened.forget('https://one.example');
    expect(reopened.list()).toEqual([{ server: 'https://two.example', token: 'device-two' }]);
  });
});

function deferred<T>() {
  let resolve = (_value: T | PromiseLike<T>) => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('saved connection activation probe', () => {
  const connection = { server: 'https://probe.example', token: 'fixture-credential', label: 'Desk' };
  test('ready requires one authenticated read-only OpenHerdr info response with normal transport policy', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    // SAFETY: Only fetch's callable request interface is used; this fixture never performs network I/O.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ app: 'openherdr', version: '0.1.0', session: 'fixture' });
    }) as typeof fetch;
    expect(await probeConnection(connection)).toBe('ready');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://probe.example/api/herdr/info');
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer fixture-credential');
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.cache).toBe('no-store');
    expect(calls[0].init?.redirect).toBe('error');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
  test('only parsed OpenHerdr HTTP 401 unauthorized returns the rejection result', async () => {
    let calls = 0;
    // SAFETY: The request-only fixture returns a real Response without opening a network connection.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ error: { code: 'unauthorized', message: 'Device revoked' } }, { status: 401 }); }) as typeof fetch;
    expect(await probeConnection(connection)).toBe('unauthorized');
    expect(calls).toBe(1);
  });
  test('other status codes, error codes and invalid successful payloads remain failures without fallback', async () => {
    const responses = [
      Response.json({ error: { code: 'unauthorized', message: 'Forbidden' } }, { status: 403 }),
      Response.json({ error: { code: 'conversation_request_refused', message: 'Upstream auth' } }, { status: 401 }),
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 }),
      new Response('<html>Unauthorized</html>', { status: 401 }),
      Response.json({ app: 'openchamber', version: '0.1.0', session: null }),
      Response.json({ app: 'openherdr', version: '0.1.0' }),
      new Response('not JSON', { status: 200 }),
      Response.json({ error: { code: 'unavailable', message: 'Offline' } }, { status: 503 }),
    ];
    for (const response of responses) {
      let calls = 0;
      // SAFETY: The callable fetch fixture returns one controlled real HTTP Response.
      globalThis.fetch = (async () => { calls += 1; return response; }) as typeof fetch;
      await expect(probeConnection(connection)).rejects.toBeInstanceOf(TransportError);
      expect(calls).toBe(1);
    }
  });
  test('offline and network rejection cannot activate or reject the saved credential', async () => {
    let calls = 0;
    // SAFETY: This request-only fixture rejects locally; no network connection or fetch.preconnect is used.
    globalThis.fetch = (async () => { calls += 1; throw new TypeError('Offline'); }) as typeof fetch;
    let code: string | null = null;
    try { await probeConnection(connection); }
    catch (error) { if (error instanceof TransportError) code = error.code; }
    expect(code).toBe('DISCONNECTED');
    expect(calls).toBe(1);
  });
  test('the existing 20-second transport deadline still rejects a timed-out probe', async () => {
    const originalTimeout = AbortSignal.timeout;
    const timeouts: number[] = [];
    AbortSignal.timeout = milliseconds => { timeouts.push(milliseconds); return AbortSignal.abort(new DOMException('Fixture timeout', 'TimeoutError')); };
    try {
      // SAFETY: This callable fixture models fetch rejecting its supplied aborted signal without real waiting or I/O.
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        if (!init?.signal?.aborted) throw new Error('Expected the transport deadline');
        throw init.signal.reason;
      }) as typeof fetch;
      let code: string | null = null;
      try { await probeConnection(connection); }
      catch (error) { if (error instanceof TransportError) code = error.code; }
      expect(code).toBe('DISCONNECTED');
      expect(timeouts).toEqual([20000]);
    } finally { AbortSignal.timeout = originalTimeout; }
  });
});


describe('mutation delivery inspection', () => {
  test('retains the dispatched request ID on an uncertain outcome', async () => {
    let dispatchedId = '';
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      dispatchedId = body.requestId;
      throw new Error('Lost connection after dispatch');
    }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'private-device' });
    try {
      await transport.mutate('remote', { method: 'pane.send_keys', params: { pane_id: 'w1:p1', keys: ['enter'] } });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(TransportError);
      if (error instanceof TransportError) { expect(error.uncertain).toBe(true); expect(error.requestId).toBe(dispatchedId); expect(error.requestId).toBeTruthy(); }
    }
  });
  test('receipt inspection is a separate GET and never resends input', async () => {
    const calls: string[] = [];
    // SAFETY: This stub accepts fetch inputs and returns a Response or rejection; the transport never calls Bun fetch.preconnect.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return Response.json({ receipt: { requestId: 'request-1', status: 'unknown' } });
    }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'private-device' });
    expect((await transport.request('/api/herdr/receipts/request-1', deliveryReceiptSchema)).receipt.status).toBe('unknown');
    expect(calls).toEqual(['GET https://work.example/api/herdr/receipts/request-1']);
  });
  test('pending targets survive a native process restart and only captured IDs clear', async () => {
    const values = new Map<string, string>();
    const createStore = () => new PendingDeliveryStore(server => ({ kind: 'native', async read() { return values.get(server) ?? null; }, async write(value) { values.set(server, value); } }));
    const pending = pendingRecord();
    await createStore().begin(pending);
    const restarted = createStore();
    expect(await restarted.load(pending.server)).toEqual(pending);
    expect(await restarted.load('https://other.example')).toBeNull();
    expect(Object.keys(JSON.parse(values.get(pending.server) ?? 'null')).sort()).toEqual(['machine','method','paneId','requestId','server','session','tabId','workspaceId']);
    expect(await restarted.clear(pending.server, 'different-request')).toBe(false);
    expect(await restarted.load(pending.server)).toEqual(pending);
    expect(await restarted.clear(pending.server, pending.requestId)).toBe(true);
    expect(await createStore().load(pending.server)).toBeNull();
  });
});

function pendingRecord(requestId = 'request-1'): PendingDelivery {
  return { requestId, server: 'https://work.example', machine: 'remote', session: 'fixture-session', workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', method: 'pane.send_input' };
}

describe('durable mutation dispatch', () => {
  test('waits for successful native persistence before dispatch', async () => {
    let raw: string | null = null;
    let calls = 0;
    let release: (() => void) | undefined;
    let markStarted = () => {};
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store = new PendingDeliveryStore(() => ({ kind: 'native', async read() { return raw; }, async write(value) { markStarted(); await gate; raw = value; } }));
    // SAFETY: This Response-returning stub covers the transport's fetch call; Bun fetch.preconnect is never used.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ id: 'r1', result: { type: 'ok' } }); }) as typeof fetch;
    const transport = new HerdrTransport({ server: 'https://work.example', token: 'device-credential' }, store);
    const record = pendingRecord();
    const dispatched = transport.dispatchTrackedMutation(record, { method: 'pane.send_input', params: { pane_id: record.paneId, text: 'private prompt', keys: ['enter'] } });
    await started;
    expect(calls).toBe(0);
    release?.();
    expect(await dispatched).toEqual({ kind: 'stored', value: { type: 'ok' } });
    expect(calls).toBe(1);
    expect(raw).not.toContain('private prompt');
    expect(raw).not.toContain('device-credential');
  });
  test('native read, malformed data and write failures all prevent dispatch', async () => {
    let calls = 0;
    // SAFETY: This Response-returning stub covers the transport's fetch call; Bun fetch.preconnect is never used.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ id: 'r1', result: { type: 'ok' } }); }) as typeof fetch;
    for (const failure of ['read', 'malformed', 'write']) {
      const store = new PendingDeliveryStore(() => ({ kind: 'native', async read() { if (failure === 'read') throw new Error('Vault locked'); return failure === 'malformed' ? '{broken' : null; }, async write() { throw new Error('Vault write failed'); } }));
      const transport = new HerdrTransport({ server: 'https://work.example', token: 'device-credential' }, store);
      await expect(transport.dispatchTrackedMutation(pendingRecord(), { method: 'pane.send_input', params: { pane_id: 'w1:p1', text: 'private prompt', keys: ['enter'] } })).rejects.toThrow('deliveryStorage');
    }
    expect(calls).toBe(0);
  });
  test('unknown outcomes block another dispatch after reopening the native store', async () => {
    let raw: string | null = null;
    let calls = 0;
    const createStore = () => new PendingDeliveryStore(() => ({ kind: 'native', async read() { return raw; }, async write(value) { raw = value; } }));
    // SAFETY: This rejecting stub covers the transport's fetch call; Bun fetch.preconnect is never used.
    globalThis.fetch = (async () => { calls += 1; throw new Error('Network disappeared after dispatch'); }) as typeof fetch;
    const connection = { server: 'https://work.example', token: 'device-credential' };
    const mutation = { method: 'pane.send_input', params: { pane_id: 'w1:p1', text: 'private prompt', keys: ['enter'] } } as const;
    const first = new HerdrTransport(connection, createStore());
    await expect(first.dispatchTrackedMutation(pendingRecord(), { ...mutation, params: { ...mutation.params, keys: ['enter'] } })).rejects.toThrow();
    const restartedStore = createStore();
    const restarted = new HerdrTransport(connection, restartedStore);
    expect(await restarted.dispatchTrackedMutation(pendingRecord('request-2'), { ...mutation, params: { ...mutation.params, keys: ['enter'] } })).toEqual({ kind: 'pending', record: pendingRecord() });
    expect(calls).toBe(1);
    expect(await restartedStore.clear(connection.server, 'request-2')).toBe(false);
    expect(await restartedStore.load(connection.server)).toEqual(pendingRecord());
  });
  test('a failed clear preserves the pending record and concurrent begins serialize', async () => {
    let raw: string | null = null;
    let rejectClear = false;
    const store = new PendingDeliveryStore(() => ({ kind: 'native', async read() { return raw; }, async write(value) { if (rejectClear && value === 'null') throw new Error('Vault locked'); raw = value; } }));
    const results = await Promise.all([store.begin(pendingRecord()), store.begin(pendingRecord('request-2'))]);
    expect(results[0]).toEqual({ kind: 'stored' });
    expect(results[1]).toEqual({ kind: 'pending', record: pendingRecord() });
    rejectClear = true;
    await expect(store.clear('https://work.example', 'request-1')).rejects.toThrow('Vault locked');
    expect(await store.load('https://work.example')).toEqual(pendingRecord());
  });
});

describe('native pairing and session provenance', () => {
  test('native links contain a validated HTTPS server and never redeem by parsing', () => {
    const value = { pairingId: 'pair-1', secret: 'one-use', server: 'https://work.example' };
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(parseNativePairing(`openherdr://connect#pairing=${encoded}`)).toEqual(value);
    for (const link of [`openherdr://other#pairing=${encoded}`, `https://connect#pairing=${encoded}`, `openherdr://connect?token=secret#pairing=${encoded}`]) expect(() => parseNativePairing(link)).toThrow();
    const insecure = Buffer.from(JSON.stringify({ ...value, server: 'http://work.example' })).toString('base64url');
    expect(() => parseNativePairing(`openherdr://connect#pairing=${insecure}`)).toThrow('invalidServer');
  });
  test('snapshot retains real native session references without adding transcript data', () => {
    const reference = { source: 'herdr:codex', agent: 'codex', kind: 'id', value: 'native-session-id' };
    const pane = { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: 'terminal-1', focused: false, revision: 1, agent_status: 'idle', agent_session: reference };
    const result = snapshotSchema.parse({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22, workspaces: [], tabs: [], panes: [pane], agents: [pane] } });
    expect(result.snapshot.panes[0].agent_session).toEqual(reference);
    expect(result.snapshot.agents[0].agent_session).toEqual(reference);
    expect(result.snapshot.panes[0]).not.toHaveProperty('messages');
  });
});
