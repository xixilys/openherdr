import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createHerdrServer } from './index.js';
import { ApiError } from './contracts.js';

const cleanups = [];
const binary = Buffer.from([0, 255, 13, 10, 195, 169, 0, 99, 128, 10]);
const version = 'stat-v1:' + 'a'.repeat(64);
const otherVersion = 'stat-v1:' + 'b'.repeat(64);
const target = { machine: 'local', pane_id: 'wFixture:p1', terminal_id: 'term_fixture', expectedRoot: '/owned/fixture' };
const assetBody = (path = 'image.png', fields = {}) => ({ ...target, path, purpose: 'preview', ...fields });

async function waitUntil(check, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(5);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return {
    release,
    async wait(signal) {
      signal?.throwIfAborted();
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
      });
      try { await Promise.race([promise, cancelled]); }
      finally { signal?.removeEventListener('abort', abort); }
    },
  };
}

function clock() {
  let now = Date.now();
  let next = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++next; tasks.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    async advance(ms) {
      now += ms;
      while (true) {
        const due = [...tasks].find(([, task]) => task.at <= now);
        if (!due) break;
        tasks.delete(due[0]); due[1].fn();
        await delay(0);
      }
      await delay(0);
    },
  };
}

// This bridge controls only the documented metadata/stream dependency. HTTP,
// admin pairing, credential storage, grant ownership and responses stay real.
function assetBridge() {
  const bridge = {
    state: { binding: 'owned-binding', root: target.expectedRoot, terminal: target.terminal_id, version, bytes: binary.length, sampleKind: 'binary' },
    describes: [], opens: [], yielded: 0, holds: new Set(),
    machines: async () => [{ id: 'local', label: 'Owned fixture' }],
    rpc: async () => assert.fail('Asset requests must use the dedicated bridge operations'),
    hold(name) { const value = gate(); bridge.holds.add(value); bridge[name] = value; return value; },
    releaseGates() { for (const value of bridge.holds) value.release(); },
  };
  const metadata = (request) => ({
    root: bridge.state.root, path: request.path, terminal_id: bridge.state.terminal,
    assetVersion: bridge.state.version, bytes: bridge.state.bytes, sampleKind: bridge.state.sampleKind,
    ...bridge.metadataPatch,
  });
  const verify = (request, options) => {
    if (request.expectedRoot !== bridge.state.root || request.terminal_id !== bridge.state.terminal ||
      (options.expectedBinding !== undefined && options.expectedBinding !== bridge.state.binding)) {
      throw new ApiError(409, 'target_changed', 'Selected target changed');
    }
    if (request.expectedAssetVersion !== undefined && request.expectedAssetVersion !== bridge.state.version) {
      throw new ApiError(409, 'asset_changed', 'Selected file changed');
    }
  };
  bridge.describeAsset = async (request, options = {}) => {
    const call = { request, ...options, finished: false };
    bridge.describes.push(call);
    try {
      assert.equal(request.operation, 'files.describe');
      if (bridge.describeGate) await bridge.describeGate.wait(bridge.ignoreDescribeAbort ? undefined : options.signal);
      if (!bridge.ignoreDescribeAbort) options.signal?.throwIfAborted();
      if (bridge.describeError) throw bridge.describeError;
      verify(request, options);
      return { binding: bridge.state.binding, metadata: metadata(request) };
    } finally { call.finished = true; }
  };
  bridge.openAsset = async (request, options = {}) => {
    const call = { request, ...options, returned: false, closed: false, closeFinished: false, bodyStarted: false, bodyFinished: false };
    bridge.opens.push(call);
    assert.equal(request.operation, 'files.raw');
    assert.equal(typeof options.expectedBinding, 'string');
    if (bridge.openGate) await bridge.openGate.wait(bridge.ignoreOpenAbort ? undefined : options.signal);
    if (!bridge.ignoreOpenAbort) options.signal?.throwIfAborted();
    if (bridge.openError) throw bridge.openError;
    verify(request, options);
    const resultMetadata = metadata(request);
    if (options.headOnly || bridge.state.bytes === 0) {
      if (bridge.completionGate) await bridge.completionGate.wait(options.signal);
      if (bridge.completionError) throw bridge.completionError;
    }
    let closing;
    const close = () => {
      closing ??= (async () => {
        call.closed = true;
        if (bridge.closeGate) await bridge.closeGate.wait();
        call.closeFinished = true;
      })();
      return closing;
    };
    call.returned = true;
    return {
      metadata: resultMetadata,
      close,
      body: (async function* () {
        call.bodyStarted = true;
        try {
          if (options.headOnly || bridge.state.bytes === 0) return;
          if (bridge.bodyGate) await bridge.bodyGate.wait(options.signal);
          options.signal?.throwIfAborted();
          const start = options.range?.start ?? 0;
          const end = options.range?.end ?? bridge.state.bytes - 1;
          const length = bridge.shortBy ? Math.max(0, end - start + 1 - bridge.shortBy) : end - start + 1;
          let offset = 0;
          while (offset < length) {
            options.signal?.throwIfAborted();
            const count = Math.min(64 * 1024, length - offset);
            const chunk = Buffer.alloc(count);
            for (let i = 0; i < count; i++) chunk[i] = binary[(start + offset + i) % binary.length];
            offset += count; bridge.yielded += count;
            yield chunk;
          }
          if (bridge.excess) yield Buffer.from([1]);
          if (bridge.completionGate) await bridge.completionGate.wait(options.signal);
          if (bridge.completionError) throw bridge.completionError;
        } finally { call.bodyFinished = true; }
      })(),
    };
  };
  return bridge;
}

function rawRequest(f, route, { method = 'GET', headers = {} } = {}) {
  const state = { headersReceived: false, done: false, bytes: Buffer.alloc(0) };
  const request = http.request(f.url + route, { method, headers }, (response) => {
    state.headersReceived = true; state.response = response; state.status = response.statusCode; state.headers = response.headers;
    response.on('data', (chunk) => { state.bytes = Buffer.concat([state.bytes, chunk]); });
    response.once('error', (error) => { state.error = error; });
    response.once('close', () => { state.complete = response.complete; state.done = true; });
  });
  request.once('error', (error) => { state.error = error; state.done = true; });
  request.end();
  state.request = request;
  return state;
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  return body;
}

async function fixture(bridge, options = {}) {
  const stateDir = await fs.mkdtemp('/tmp/ohasset-');
  const assetClock = options.assetClock ?? clock();
  let policy = { enterpriseMode: false };
  const runtime = await createHerdrServer({ session: 'fixture', port: 0, stateDir, bridge, assetClock, readPolicy: () => policy, ...options });
  await runtime.listen();
  const url = runtime.address().baseUrl;
  const admin = (command, params = {}) => new Promise((resolve, reject) => {
    const socket = net.createConnection(runtime.adminSocketPath);
    let output = '';
    socket.on('connect', () => socket.write(JSON.stringify({ id: 'asset-test', command, params }) + '\n'));
    socket.on('error', reject);
    socket.on('data', (chunk) => { output += chunk; });
    socket.on('end', () => {
      try { const value = JSON.parse(output); value.error ? reject(new Error(value.error.message)) : resolve(value.result); }
      catch (error) { reject(error); }
    });
  });
  const request = (route, { token, origin, body, method = body === undefined ? 'GET' : 'POST', headers = {}, signal } = {}) => {
    const selected = { ...headers };
    if (token) selected.Authorization = `Bearer ${token}`;
    if (origin !== undefined) selected.Origin = origin;
    if (body !== undefined) selected['Content-Type'] = 'application/json';
    return fetch(url + route, { method, headers: selected, body: body === undefined ? undefined : JSON.stringify(body), signal });
  };
  const pair = async () => {
    const issued = await admin('pair', { label: 'Owned asset HTTP fixture' });
    const response = await request('/api/pairing/redeem', { body: { pairingId: issued.pairingId, secret: issued.secret } });
    assert.equal(response.status, 200); return response.json();
  };
  const f = {
    runtime, stateDir, url, admin, request, pair, clock: assetClock,
    policy(value) { policy = value; },
    async mint(token, body = assetBody()) {
      const response = await request('/api/herdr/assets', { token, body });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      return response.json();
    },
    async release(token, id) {
      return request('/api/herdr/assets/' + id, { token, method: 'DELETE' });
    },
    async renew(token, id) {
      return request('/api/herdr/assets/' + id + '/renew', { token, body: {} });
    },
  };
  cleanups.push(async () => {
    bridge.releaseGates?.();
    await runtime.close();
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  return f;
}

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('bearer mint publishes one opaque exact-file capability and leaves other APIs private', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  await expectError(await f.request('/api/herdr/assets', { body: assetBody() }), 401, 'unauthorized');
  for (const body of [assetBody('../outside.png'), assetBody('/absolute.png'), assetBody('line\r\nname.png'), assetBody('back\\slash.png'), assetBody('.git/config'), assetBody('image.png', { terminal_id: undefined }), assetBody('image.png', { extra: true })]) {
    await expectError(await f.request('/api/herdr/assets', { token: owner.token, body }), 400, 'invalid_asset_request');
  }
  assert.equal(bridge.describes.length, 0);
  const grant = await f.mint(owner.token);
  assert.match(grant.assetId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(grant.url, '/api/herdr/assets/' + grant.assetId);
  assert.deepEqual({ root: grant.root, path: grant.path, terminal_id: grant.terminal_id, assetVersion: grant.assetVersion, bytes: grant.bytes, sampleKind: grant.sampleKind }, {
    root: target.expectedRoot, path: 'image.png', terminal_id: target.terminal_id, assetVersion: version, bytes: binary.length, sampleKind: 'binary',
  });
  assert.equal(grant.expiresAt, f.clock.now() + 10 * 60 * 1000);
  assert.equal(grant.maxExpiresAt, f.clock.now() + 60 * 60 * 1000);
  assert.ok(!grant.url.includes(owner.token) && !grant.url.includes(target.expectedRoot) && !grant.url.includes('image.png'));
  const response = await f.request(grant.url);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);
  assert.equal(bridge.opens[0].request.expectedAssetVersion, version);
  assert.equal(bridge.opens[0].expectedBinding, 'owned-binding');
  await expectError(await f.request('/api/herdr/info'), 401, 'unauthorized');
  await expectError(await f.request(grant.url + '?token=' + owner.token), 400, 'query_forbidden');
  await expectError(await f.request('/api/herdr/assets/' + 'x'.repeat(43)), 403, 'asset_unavailable');
});

test('grant reads preserve exact Origins, CORS, current policy and no bearer-in-URL exception', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  await f.admin('origin.add', { origin: 'https://phone.example' });
  const grant = await f.mint(owner.token);
  for (const origin of [undefined, 'https://phone.example', 'capacitor://localhost', 'https://localhost']) {
    const response = await f.request(grant.url, { origin });
    assert.equal(response.status, 200); await response.arrayBuffer();
    if (origin) assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  for (const origin of ['null', 'https://evil.example', 'https://phone.example.evil']) {
    await expectError(await f.request(grant.url, { origin }), 403, 'origin_forbidden');
  }
  const cors = await f.request(grant.url, { method: 'OPTIONS', origin: 'capacitor://localhost', headers: { 'Access-Control-Request-Method': 'HEAD', 'Access-Control-Request-Headers': 'range,if-range' } });
  assert.equal(cors.status, 204);
  assert.match(cors.headers.get('access-control-allow-methods'), /HEAD/);
  assert.match(cors.headers.get('access-control-allow-headers').toLowerCase(), /range/);
  f.policy({ enterpriseMode: true, allowNetworkAccess: false });
  await expectError(await f.request(grant.url), 403, 'enterprise_mode');
  f.policy({ enterpriseMode: false });
  const usable = await f.request(grant.url); assert.equal(usable.status, 200); await usable.arrayBuffer();
});

test('preview and download use safe MIME, disposition, CSP and private-cache headers', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  for (const [path, purpose, mime, disposition] of [
    ['picture.png', 'preview', 'image/png', 'inline'],
    ['document.pdf', 'preview', 'application/pdf', 'inline'],
    ['diagram.svg', 'preview', 'application/octet-stream', 'attachment'],
    ['active.html', 'preview', 'application/octet-stream', 'attachment'],
    ['active.js', 'preview', 'application/octet-stream', 'attachment'],
    ['unknown.blob', 'preview', 'application/octet-stream', 'attachment'],
    ['picture.png', 'download', 'image/png', 'attachment'],
    ['引号"文档.png', 'download', 'image/png', 'attachment'],
  ]) {
    const grant = await f.mint(owner.token, assetBody(path, { purpose }));
    const response = await f.request(grant.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type').split(';')[0], mime, path);
    assert.match(response.headers.get('content-disposition'), new RegExp('^' + disposition + ';'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    const header = response.headers.get('content-disposition');
    assert.ok(!/[\r\n\\]/.test(header));
    if (path.includes('"')) { assert.match(header, /filename\*=UTF-8''/i); assert.match(header, /%E5%BC%95/i); }
    if (path.endsWith('.svg')) {
      const csp = response.headers.get('content-security-policy');
      assert.match(csp, /sandbox/); assert.match(csp, /default-src 'none'/);
      assert.ok(!csp.includes('allow-scripts') && !csp.includes('allow-same-origin'));
    }
    await response.arrayBuffer();
    assert.equal((await f.release(owner.token, grant.assetId)).status, 200);
  }
});

test('serves whole, suffix, open-ended, clamped and rejected ranges without altering bytes', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  const cases = [
    [undefined, 200, 0, 9, null],
    ['bytes=2-5', 206, 2, 5, 'bytes 2-5/10'],
    ['bytes=8-', 206, 8, 9, 'bytes 8-9/10'],
    ['bytes=-3', 206, 7, 9, 'bytes 7-9/10'],
    ['bytes=7-999', 206, 7, 9, 'bytes 7-9/10'],
    ['bytes=-999', 206, 0, 9, 'bytes 0-9/10'],
    ['garbage', 200, 0, 9, null],
    ['bytes=0-1,4-5', 200, 0, 9, null],
    ['bytes=-', 200, 0, 9, null],
  ];
  for (const [range, status, start, end, contentRange] of cases) {
    const response = await f.request(grant.url, { headers: range ? { Range: range } : {} });
    assert.equal(response.status, status, range);
    assert.equal(response.headers.get('content-range'), contentRange, range);
    assert.equal(Number(response.headers.get('content-length')), end - start + 1, range);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary.subarray(start, end + 1), range);
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0']) {
    const response = await f.request(grant.url, { headers: { Range: range } });
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */10');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    assert.equal(bridge.opens.at(-1).headOnly, true);
  }
  const head = await f.request(grant.url, { method: 'HEAD', headers: { Range: 'bytes=2-3' } });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-range'), null);
  assert.equal(head.headers.get('content-length'), '10'); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(bridge.opens.at(-1).headOnly, true); assert.equal(bridge.opens.at(-1).range, null);
  const ifRange = await f.request(grant.url, { headers: { Range: 'bytes=2-3', 'If-Range': '"different-validator"' } });
  assert.equal(ifRange.status, 200); assert.equal(ifRange.headers.get('content-range'), null);
  assert.deepEqual(Buffer.from(await ifRange.arrayBuffer()), binary);
  assert.equal(bridge.opens.at(-1).request.expectedAssetVersion, version);
  assert.equal(bridge.opens.at(-1).range, null);
});

test('far-tail reads above 8 MiB request only those raw bytes and never use buffered host APIs', async () => {
  const bridge = assetBridge(); bridge.state.bytes = 12 * 1024 * 1024 + 3;
  const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token, assetBody('movie.mp4'));
  for (const [start, end] of [[0, 3], [bridge.state.bytes - 16, bridge.state.bytes - 1]]) {
    const response = await f.request(grant.url, { headers: { Range: `bytes=${start}-${end}` } });
    assert.equal(response.status, 206);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, end - start + 1);
    for (let i = 0; i < bytes.length; i++) assert.equal(bytes[i], binary[(start + i) % binary.length]);
    assert.deepEqual(bridge.opens.at(-1).range, { start, end });
  }
  assert.equal(bridge.yielded, 20);
  assert.equal(bridge.describes.length, 1); assert.equal(bridge.opens.length, 2);
});

test('HEAD, empty GET and 416 wait for successful metadata-only completion before headers', async () => {
  for (const kind of ['head', 'empty', 'unsatisfiable']) {
    const bridge = assetBridge(); if (kind === 'empty') bridge.state.bytes = 0;
    const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
    const finish = bridge.hold('completionGate');
    const request = rawRequest(f, grant.url, { method: kind === 'head' ? 'HEAD' : 'GET', headers: kind === 'unsatisfiable' ? { Range: 'bytes=99-' } : { Range: 'bytes=0-1' } });
    await waitUntil(() => bridge.opens.length === 1, 'metadata-only raw prepare');
    await delay(20); assert.equal(request.headersReceived, false, kind);
    finish.release();
    await waitUntil(() => request.done, 'completed metadata response');
    assert.equal(request.status, kind === 'unsatisfiable' ? 416 : 200, kind);
    assert.equal(request.bytes.length, 0); assert.equal(bridge.yielded, 0);
    assert.equal(request.complete, true);
  }
});

test('failed metadata-only completion cannot become HEAD, empty or 416 success', async () => {
  for (const kind of ['head', 'empty', 'unsatisfiable']) {
    const bridge = assetBridge(); if (kind === 'empty') bridge.state.bytes = 0;
    const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
    bridge.completionError = new ApiError(502, 'asset_transport_failed', 'Owned completion failed');
    const response = await f.request(grant.url, { method: kind === 'head' ? 'HEAD' : 'GET', headers: kind === 'unsatisfiable' ? { Range: 'bytes=99-' } : {} });
    assert.equal(response.status, 502, kind);
    if (kind !== 'head') assert.equal((await response.json()).error.code, 'asset_transport_failed');
  }
});

test('possession reads only its file while renewal and release require the owning bearer', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const other = await f.pair();
  const grant = await f.mint(owner.token);
  await expectError(await f.renew(undefined, grant.assetId), 401, 'unauthorized');
  await expectError(await f.release(undefined, grant.assetId), 401, 'unauthorized');
  await expectError(await f.renew(other.token, grant.assetId), 404, 'asset_not_found');
  await expectError(await f.release(other.token, grant.assetId), 404, 'asset_not_found');
  const read = await f.request(grant.url, { token: other.token });
  assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), binary);
  assert.deepEqual(await (await f.release(owner.token, grant.assetId)).json(), { released: true });
  await expectError(await f.request(grant.url), 403, 'asset_unavailable');
  await expectError(await f.release(owner.token, grant.assetId), 404, 'asset_not_found');
  await expectError(await f.renew(owner.token, grant.assetId), 404, 'asset_not_found');
});

test('each read and renewal preserves the captured binding, terminal, root and metadata version', async () => {
  for (const field of ['binding', 'terminal', 'root', 'version']) {
    const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
    bridge.state[field] = field === 'version' ? otherVersion : 'changed-' + bridge.state[field];
    const code = field === 'version' ? 'asset_changed' : 'target_changed';
    await expectError(await f.request(grant.url), 409, code);
    await expectError(await f.renew(owner.token, grant.assetId), 409, code);
    assert.equal(bridge.yielded, 0);
  }
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody('image.png', { expectedAssetVersion: otherVersion }) }), 409, 'asset_changed');
});

test('invalid returned metadata fails closed while explicit backend errors retain their code', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  for (const patch of [{ root: '/different-root' }, { path: 'different.png' }, { terminal_id: 'term_other' }, { assetVersion: otherVersion }, { bytes: binary.length + 1 }, { sampleKind: 'text' }, { bytes: Number.MAX_SAFE_INTEGER + 1 }]) {
    bridge.metadataPatch = patch;
    await expectError(await f.request(grant.url), 502, 'invalid_asset_response');
  }
  bridge.metadataPatch = undefined;
  for (const [status, code] of [[404, 'file_not_found'], [422, 'terminal_unavailable'], [403, 'path_forbidden'], [504, 'asset_timeout']]) {
    bridge.openError = new ApiError(status, code, 'Owned fixture refuses this file');
    await expectError(await f.request(grant.url), status, code);
  }
});

test('short, excessive and late-failed bodies cannot complete the declared binary response', async () => {
  for (const failure of ['short', 'excess', 'completion']) {
    const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
    if (failure === 'short') bridge.shortBy = 1;
    if (failure === 'excess') bridge.excess = true;
    if (failure === 'completion') bridge.completionError = new Error('Controlled transport completion failed');
    const response = rawRequest(f, grant.url);
    await waitUntil(() => response.done, 'failed stream closure');
    assert.ok(!response.complete, failure);
    assert.ok(response.bytes.length < binary.length, failure);
    assert.ok(!response.bytes.toString().includes('error'), failure);
    assert.equal(bridge.opens[0].closed, true); assert.equal(bridge.opens[0].closeFinished, true);
  }
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  bridge.completionError = new Error('One-byte range completion failed');
  const response = rawRequest(f, grant.url, { headers: { Range: 'bytes=0-0' } });
  await waitUntil(() => response.done, 'one-byte failed range');
  assert.ok(!response.complete); assert.equal(response.bytes.length, 0);
});

test('expiry is explicit, renewal keeps the URL and old expiry cannot cancel a renewed grant', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  await f.clock.advance(5 * 60 * 1000);
  const renewed = await (await f.renew(owner.token, grant.assetId)).json();
  assert.equal(renewed.assetId, grant.assetId); assert.equal(renewed.maxExpiresAt, grant.maxExpiresAt);
  assert.equal(renewed.expiresAt, f.clock.now() + 10 * 60 * 1000);
  await f.clock.advance(5 * 60 * 1000 + 1);
  const stillLive = await f.request(grant.url); assert.equal(stillLive.status, 200); await stillLive.arrayBuffer();
  await f.clock.advance(5 * 60 * 1000);
  await expectError(await f.request(grant.url), 403, 'asset_unavailable');
  assert.equal((await f.request('/api/herdr/info', { token: owner.token })).status, 200);
});

test('same-ID renewal cannot extend the one-hour absolute lifetime', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  for (let step = 0; step < 11; step++) {
    await f.clock.advance(5 * 60 * 1000);
    const response = await f.renew(owner.token, grant.assetId);
    assert.equal(response.status, 200);
    const renewed = await response.json();
    assert.equal(renewed.assetId, grant.assetId); assert.equal(renewed.maxExpiresAt, grant.maxExpiresAt);
    assert.ok(renewed.expiresAt <= grant.maxExpiresAt);
  }
  const atCap = await (await f.renew(owner.token, grant.assetId)).json();
  assert.equal(atCap.expiresAt, grant.maxExpiresAt);
  await f.clock.advance(5 * 60 * 1000 + 1);
  await expectError(await f.request(grant.url), 403, 'asset_unavailable');
  const next = await f.mint(owner.token, assetBody('image.png', { expectedAssetVersion: version }));
  assert.notEqual(next.assetId, grant.assetId);
});

test('preview expiry aborts an already active response', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  bridge.hold('completionGate');
  const response = rawRequest(f, grant.url);
  await waitUntil(() => response.bytes.length === binary.length - 1, 'preview body before final tail');
  await f.clock.advance(10 * 60 * 1000 + 1);
  await waitUntil(() => response.done, 'expired preview closure');
  assert.equal(bridge.opens[0].signal.aborted, true); assert.equal(bridge.opens[0].closeFinished, true);
  assert.equal(response.complete, false); assert.equal(response.bytes.length, binary.length - 1);
  await expectError(await f.request(grant.url), 403, 'asset_unavailable');
});

test('an admitted download may complete after admission expiry but cannot admit another request', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token, assetBody('image.png', { purpose: 'download' }));
  const finish = bridge.hold('completionGate');
  const response = rawRequest(f, grant.url);
  await waitUntil(() => response.bytes.length === binary.length - 1, 'download before final tail');
  await f.clock.advance(10 * 60 * 1000 + 1);
  assert.equal(bridge.opens[0].signal.aborted, false); assert.equal(response.done, false);
  await expectError(await f.request(grant.url), 403, 'asset_unavailable');
  finish.release();
  await waitUntil(() => response.done, 'admitted download finish');
  assert.equal(response.complete, true); assert.deepEqual(response.bytes, binary);
});

test('the one-hour operation deadline cancels expired admitted downloads and returns capacity', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  const grants = [await f.mint(owner.token, assetBody('first.png', { purpose: 'download' })), await f.mint(owner.token, assetBody('second.png', { purpose: 'download' }))];
  bridge.hold('completionGate');
  const responses = grants.flatMap((grant) => Array.from({ length: 4 }, () => rawRequest(f, grant.url)));
  await waitUntil(() => responses.every((response) => response.bytes.length === binary.length - 1), 'eight admitted downloads');
  assert.equal(bridge.opens.length, 8);
  await f.clock.advance(10 * 60 * 1000 + 1);
  assert.ok(bridge.opens.every((call) => !call.signal.aborted));
  assert.ok(responses.every((response) => !response.done));
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody('still-busy.png') }), 429, 'asset_capacity');
  await f.clock.advance(50 * 60 * 1000);
  await waitUntil(() => responses.every((response) => response.done) && bridge.opens.every((call) => call.closeFinished), 'absolute deadline cleanup');
  assert.ok(bridge.opens.every((call) => call.signal.aborted && call.signal.reason.code === 'asset_timeout'));
  assert.ok(responses.every((response) => !response.complete && response.bytes.length < binary.length));
  bridge.completionGate = undefined;
  const fresh = await f.mint(owner.token, assetBody('after-deadline.png'));
  const response = await f.request(fresh.url);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);
});

for (const action of ['release', 'revoke', 'server close']) {
  test(`${action} still cancels an admitted download after its grant expires`, async () => {
    const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token, assetBody('image.png', { purpose: 'download' }));
    bridge.hold('completionGate');
    const response = rawRequest(f, grant.url);
    await waitUntil(() => response.bytes.length === binary.length - 1, 'download admission');
    await f.clock.advance(10 * 60 * 1000 + 1);
    assert.equal(bridge.opens[0].signal.aborted, false);
    if (action === 'release') assert.equal((await f.release(owner.token, grant.assetId)).status, 200);
    else if (action === 'revoke') assert.equal((await f.request('/api/herdr/clients/' + owner.client.id, { token: owner.token, method: 'DELETE' })).status, 200);
    else await f.runtime.close();
    await waitUntil(() => response.done && bridge.opens[0].closeFinished, 'cancelled admitted download');
    assert.equal(bridge.opens[0].signal.aborted, true); assert.equal(response.complete, false);
    assert.ok(response.bytes.length < binary.length);
    if (action === 'revoke') await expectError(await f.request(grant.url), 403, 'asset_unavailable');
  });
}

test('release closes a late-created open handle and never returns its bytes', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  const prepare = bridge.hold('openGate'); bridge.ignoreOpenAbort = true;
  const response = rawRequest(f, grant.url);
  await waitUntil(() => bridge.opens.length === 1, 'pending open');
  assert.equal((await f.release(owner.token, grant.assetId)).status, 200);
  assert.equal(bridge.opens[0].signal.aborted, true);
  prepare.release();
  await waitUntil(() => response.done && bridge.opens[0].closeFinished, 'late open cleanup');
  assert.notEqual(response.status, 200); assert.notEqual(response.status, 206);
  assert.equal(bridge.yielded, 0);
});

test('revocation during mint preparation prevents late publication', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  const prepare = bridge.hold('describeGate'); bridge.ignoreDescribeAbort = true;
  const pending = f.request('/api/herdr/assets', { token: owner.token, body: assetBody() });
  await waitUntil(() => bridge.describes.length === 1, 'pending mint');
  assert.equal((await f.request('/api/herdr/clients/' + owner.client.id, { token: owner.token, method: 'DELETE' })).status, 200);
  assert.equal(bridge.describes[0].signal.aborted, true);
  prepare.release();
  const response = await pending; assert.notEqual(response.status, 200);
  const body = await response.json(); assert.ok(!body.assetId);
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody() }), 401, 'unauthorized');
});

test('a dropped pending read aborts preparation and closes a late result', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  const prepare = bridge.hold('openGate'); bridge.ignoreOpenAbort = true;
  const response = rawRequest(f, grant.url);
  await waitUntil(() => bridge.opens.length === 1, 'pending disconnected open');
  response.request.destroy();
  await waitUntil(() => bridge.opens[0].signal.aborted, 'disconnected request cancellation');
  prepare.release();
  await waitUntil(() => bridge.opens[0].closeFinished, 'disconnected late handle close');
  assert.equal(bridge.yielded, 0);
});

test('server close joins raw-handle cleanup rather than only requesting cancellation', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  bridge.hold('completionGate'); const releaseClose = bridge.hold('closeGate');
  const response = rawRequest(f, grant.url);
  await waitUntil(() => response.bytes.length === binary.length - 1, 'active body');
  let finished = false;
  const closing = f.runtime.close().then(() => { finished = true; });
  await waitUntil(() => bridge.opens[0].closed, 'owned raw close called');
  await delay(20); assert.equal(finished, false); assert.equal(bridge.opens[0].closeFinished, false);
  releaseClose.release(); await closing;
  assert.equal(bridge.opens[0].closeFinished, true); assert.equal(finished, true);
});

test('current enterprise policy is checked after preparation and before the final body byte', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  await f.admin('origin.add', { origin: 'https://phone.example' });
  const grant = await f.mint(owner.token);
  const prepare = bridge.hold('openGate');
  const pending = f.request(grant.url);
  await waitUntil(() => bridge.opens.length === 1, 'policy pending preparation');
  f.policy({ enterpriseMode: true, allowNetworkAccess: false }); prepare.release();
  await expectError(await pending, 403, 'enterprise_mode');
  assert.equal(bridge.yielded, 0);
  bridge.openGate = undefined;
  f.policy({ enterpriseMode: false }); const finish = bridge.hold('completionGate');
  const response = rawRequest(f, grant.url);
  await waitUntil(() => response.bytes.length === binary.length - 1, 'body before policy change');
  f.policy({ enterpriseMode: true, allowNetworkAccess: false }); finish.release();
  await waitUntil(() => response.done, 'policy-truncated body');
  assert.equal(response.complete, false); assert.ok(response.bytes.length < binary.length);
});

test('metadata-first host inspection returns metadata without consuming grant authority', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  const response = await f.request('/api/herdr/host', { token: owner.token, body: { request: { operation: 'files.describe', ...target, path: 'image.png' } } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { root: target.expectedRoot, path: 'image.png', terminal_id: target.terminal_id, assetVersion: version, bytes: binary.length, sampleKind: 'binary' });
  assert.equal(bridge.opens.length, 0);
  for (let i = 0; i < 16; i++) await f.mint(owner.token, assetBody(`item-${i}.png`));
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody('overflow.png') }), 429, 'asset_capacity');
  assert.equal(bridge.describes.length, 17);
});

test('pending host inspection shares the client work limit, aborts on disconnect and returns capacity', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  bridge.hold('describeGate');
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const pending = controllers.map((controller, i) => f.request('/api/herdr/host', {
    token: owner.token, body: { request: { operation: 'files.describe', ...target, path: `item-${i}.png` } }, signal: controller.signal,
  }).catch((error) => error));
  await waitUntil(() => bridge.describes.length === 8, 'eight pending inspections');
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody() }), 429, 'asset_capacity');
  assert.equal(bridge.describes.length, 8);
  controllers.forEach((controller) => controller.abort()); await Promise.all(pending);
  await waitUntil(() => bridge.describes.every((call) => call.signal.aborted && call.finished), 'inspection cancellation');
  bridge.describeGate = undefined;
  const grant = await f.mint(owner.token);
  const response = await f.request(grant.url); assert.equal(response.status, 200); await response.arrayBuffer();
});

test('pending mints reserve grant slots and a dropped late mint cannot consume a hidden grant', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair();
  const prepare = bridge.hold('describeGate'); bridge.ignoreDescribeAbort = true;
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const pending = controllers.map((controller, i) => f.request('/api/herdr/assets', {
    token: owner.token, body: assetBody(`pending-${i}.png`), signal: controller.signal,
  }).catch((error) => error));
  await waitUntil(() => bridge.describes.length === 8, 'eight pending mints');
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody() }), 429, 'asset_capacity');
  assert.equal(bridge.describes.length, 8);
  controllers.forEach((controller) => controller.abort()); await Promise.all(pending);
  await waitUntil(() => bridge.describes.every((call) => call.signal.aborted), 'mint cancellation');
  prepare.release();
  await waitUntil(() => bridge.describes.every((call) => call.finished), 'late mint descriptions');
  bridge.describeGate = undefined; bridge.ignoreDescribeAbort = false;
  const grants = [];
  for (let i = 0; i < 15; i++) grants.push(await f.mint(owner.token, assetBody(`item-${i}.png`)));
  const lastPrepare = bridge.hold('describeGate');
  const before = bridge.describes.length;
  const finalMint = f.request('/api/herdr/assets', { token: owner.token, body: assetBody('sixteenth.png') });
  await waitUntil(() => bridge.describes.length === before + 1, 'sixteenth reserved grant');
  await expectError(await f.request('/api/herdr/assets', { token: owner.token, body: assetBody('overflow.png') }), 429, 'asset_capacity');
  assert.equal(bridge.describes.length, before + 1);
  lastPrepare.release();
  const finalResponse = await finalMint; assert.equal(finalResponse.status, 200); grants.push(await finalResponse.json());
  bridge.describeGate = undefined;
  const first = await f.request(grants[0].url); assert.equal(first.status, 200); await first.arrayBuffer();
  assert.equal((await f.release(owner.token, grants[0].assetId)).status, 200);
  await f.mint(owner.token, assetBody('after-release.png'));
});

test('server grant capacity refuses before prepare and preserves existing owners', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge);
  const clients = []; const grants = [];
  for (let clientIndex = 0; clientIndex < 8; clientIndex++) {
    const owner = await f.pair(); clients.push(owner);
    for (let i = 0; i < 16; i++) grants.push(await f.mint(owner.token, assetBody(`client-${clientIndex}-${i}.png`)));
  }
  const extra = await f.pair();
  assert.equal(bridge.describes.length, 128);
  await expectError(await f.request('/api/herdr/assets', { token: extra.token, body: assetBody() }), 429, 'asset_capacity');
  assert.equal(bridge.describes.length, 128);
  const first = await f.request(grants[0].url); assert.equal(first.status, 200); await first.arrayBuffer();
  assert.equal((await f.release(clients[0].token, grants[0].assetId)).status, 200);
  await f.mint(extra.token);
});

test('one grant permits four pending reads and refuses renewal before another prepare', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const owner = await f.pair(); const grant = await f.mint(owner.token);
  bridge.hold('openGate');
  const pending = Array.from({ length: 4 }, () => rawRequest(f, grant.url));
  await waitUntil(() => bridge.opens.length === 4, 'four pending reads');
  await expectError(await f.request(grant.url), 429, 'asset_capacity');
  await expectError(await f.renew(owner.token, grant.assetId), 429, 'asset_capacity');
  assert.equal(bridge.opens.length, 4); assert.equal(bridge.describes.length, 1);
  pending.forEach((response) => response.request.destroy());
  await waitUntil(() => bridge.opens.every((call) => call.signal.aborted), 'pending read abort');
  await waitUntil(() => pending.every((response) => response.done), 'pending client close');
  bridge.openGate = undefined;
  assert.equal((await f.renew(owner.token, grant.assetId)).status, 200);
});

test('the server reserves at most 32 pending reads across clients before bridge work', async () => {
  const bridge = assetBridge(); const f = await fixture(bridge); const groups = [];
  for (let i = 0; i < 5; i++) {
    const owner = await f.pair();
    groups.push([await f.mint(owner.token, assetBody(`client-${i}-a.png`)), await f.mint(owner.token, assetBody(`client-${i}-b.png`))]);
  }
  bridge.hold('openGate');
  const pending = groups.slice(0, 4).flatMap((group) => group.flatMap((grant) => Array.from({ length: 4 }, () => rawRequest(f, grant.url))));
  await waitUntil(() => bridge.opens.length === 32, '32 reserved reads');
  await expectError(await f.request(groups[4][0].url), 429, 'asset_capacity');
  assert.equal(bridge.opens.length, 32);
  pending.forEach((response) => response.request.destroy());
  await waitUntil(() => bridge.opens.every((call) => call.signal.aborted), 'server-capacity cancellation');
  await waitUntil(() => pending.every((response) => response.done), 'server-capacity client close');
  bridge.openGate = undefined;
  const response = await f.request(groups[4][0].url); assert.equal(response.status, 200); await response.arrayBuffer();
});
