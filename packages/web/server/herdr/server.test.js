import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ApiError } from './contracts.js';
import http from 'node:http';
import { startHerdrServer } from './index.js';
import { createHerdrBridge, herdrRpcError } from './bridge.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const policyOff = () => ({ enterpriseMode: false });
async function fixture(rpc = async () => ({ id: 'upstream', result: { type: 'ok' } }), extra = {}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-'));
  cleanup.push(() => fs.rm(stateDir, { recursive: true, force: true }));
  let count = 0;
  const runtime = await startHerdrServer({ session: 'fixture', port: 0, stateDir, readPolicy: policyOff, bridge: { machines: async () => [{ id: 'local', label: 'Local' }, { id: 'saved', label: 'Saved' }], rpc: async (...args) => { count++; return rpc(...args); } }, ...extra });
  cleanup.push(() => runtime.close());
  const url = runtime.address().baseUrl;
  const admin = (command, params = {}) => new Promise((resolve, reject) => {
    const socket = net.createConnection(runtime.adminSocketPath); let buffer = '';
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 'admin-test', command, params })}\n`));
    socket.on('error', reject);
    socket.on('data', (chunk) => { buffer += chunk; });
    socket.on('end', () => { const response = JSON.parse(buffer); response.error ? reject(new Error(response.error.message)) : resolve(response.result); });
  });
  const request = (route, { token, origin, body, method = body ? 'POST' : 'GET', headers = {} } = {}) => {
    const requestHeaders = {};
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (origin) requestHeaders.Origin = origin;
    if (body) requestHeaders['Content-Type'] = 'application/json';
    Object.assign(requestHeaders, headers);
    const init = { method, headers: requestHeaders };
    if (body) init.body = JSON.stringify(body);
    return fetch(`${url}${route}`, init);
  };
  const pair = async () => {
    const issued = await admin('pair', { label: 'Test phone' });
    const response = await request('/api/pairing/redeem', { body: { pairingId: issued.pairingId, secret: issued.secret } });
    assert.equal(response.status, 200); return response.json();
  };
  return { runtime, url, stateDir, admin, request, pair, count: () => count };
}

test('private HTTP requires bearer, rejects unregistered origins and query credentials', async () => {
  const f = await fixture();
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/api/herdr/info')).status, 401);
  const { token } = await f.pair();
  assert.equal((await f.request('/api/herdr/info', { token })).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'capacitor://localhost' })).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'https://localhost' })).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'null' })).status, 403);
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/herdr/info?token=secret', { token })).status, 400);
  assert.equal((await f.request('/api/herdr/rpc', { token, method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await fs.stat(f.runtime.adminSocketPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(f.stateDir, 'server.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(f.stateDir, 'clients.json'))).mode & 0o777, 0o600);
});

test('pairing is single use under concurrent requests; secrets are hashed on disk', async () => {
  const f = await fixture(); const issued = await f.admin('pair');
  const body = { pairingId: issued.pairingId, secret: issued.secret };
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request('/api/pairing/redeem', { body })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400, 400, 400, 400]);
  const token = (await responses.find((r) => r.status === 200).json()).token;
  assert.ok(!(await fs.readFile(path.join(f.stateDir, 'pairing.json'), 'utf8')).includes(issued.secret));
  assert.ok(!(await fs.readFile(path.join(f.stateDir, 'clients.json'), 'utf8')).includes(token));
  for (let i = 0; i < 5; i++) await f.request('/api/pairing/redeem', { body });
  assert.equal((await f.request('/api/pairing/redeem', { body })).status, 429);
});

test('origin registration is exact and client revocation rejects future calls', async () => {
  const f = await fixture(); const { token, client } = await f.pair();
  await f.admin('origin.add', { origin: 'https://phone.example' });
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'https://phone.example' })).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token, origin: 'https://phone.example.evil' })).status, 403);
  const listing = await (await f.request('/api/herdr/clients', { token })).json();
  assert.equal(listing.clients[0].id, client.id);
  assert.ok(!JSON.stringify(listing).includes(token));
  assert.equal((await f.request(`/api/herdr/clients/${client.id}`, { token, method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token })).status, 401);
});

test('RPC rejects unknown fields, implicit targets, unsafe methods and unsaved machines', async () => {
  const f = await fixture(); const { token } = await f.pair();
  const cases = [
    [{ machine: 'local', method: 'server.stop', params: {}, requestId: 'request-1' }, 403],
    [{ machine: 'local', method: 'pane.send_input', params: { pane_id: 'w1:p1', text: 'echo safe', socket: '/other' }, requestId: 'request-1' }, 400],
    [{ machine: 'local', method: 'pane.split', params: { direction: 'right' }, requestId: 'request-1' }, 400],
    [{ machine: 'local', method: 'agent.prompt', params: { target: 'user-agent', text: 'Hi' }, requestId: 'request-1' }, 400],
    [{ machine: 'ssh-root', method: 'session.snapshot', params: {} }, 400],
    [{ machine: 'local', method: 'pane.send_input', params: { pane_id: 'w1:p1', text: 'echo safe' } }, 400],
  ];
  for (const [body, status] of cases) assert.equal((await f.request('/api/herdr/rpc', { token, body })).status, status);
  assert.equal(f.count(), 0);
});

test('mutation is journaled before dispatch, concurrent duplicates dispatch once and unknown survives restart', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture(async () => { await gate; throw new Error('Disconnected'); });
  const { token } = await f.pair();
  const body = { machine: 'local', method: 'pane.send_input', params: { pane_id: 'w1:p1', text: 'echo safe', keys: ['Enter'] }, requestId: 'request-unknown' };
  const pending = f.request('/api/herdr/rpc', { token, body });
  let receipt;
  for (let i = 0; i < 30; i++) {
    const response = await f.request('/api/herdr/receipts/request-unknown', { token });
    if (response.status === 200) { receipt = (await response.json()).receipt; break; }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(receipt.status, 'unknown');
  assert.ok((await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8')).includes('request-unknown'));
  const duplicate = await f.request('/api/herdr/rpc', { token, body }); assert.equal(duplicate.status, 409);
  release();
  const failed = await pending; assert.equal(failed.status, 502); assert.equal((await failed.json()).error.code, 'outcome_unknown');
  assert.equal(f.count(), 1);
  await f.runtime.close();
  const restarted = await startHerdrServer({ session: 'fixture', port: 0, stateDir: f.stateDir, readPolicy: policyOff, bridge: { machines: async () => [], rpc: async () => assert.fail('Must not replay') } });
  cleanup.push(() => restarted.close());
  const response = await fetch(`${restarted.address().baseUrl}/api/herdr/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.receipt.status, 'unknown');
});

test('upstream read failure stays an error and completed mutations have receipts', async () => {
  const f = await fixture(async (_machine, method) => { if (method === 'session.snapshot') throw new Error('Offline'); return { id: '1', result: { type: 'ok' } }; });
  const { token } = await f.pair();
  assert.equal((await f.request('/api/herdr/rpc', { token, body: { machine: 'local', method: 'session.snapshot', params: {} } })).status, 502);
  const body = { machine: 'local', method: 'pane.send_keys', params: { pane_id: 'w1:p1', keys: ['Ctrl-c'] }, requestId: 'request-complete' };
  assert.equal((await f.request('/api/herdr/rpc', { token, body })).status, 200);
  assert.equal((await (await f.request('/api/herdr/receipts/request-complete', { token })).json()).receipt.status, 'complete');
});

test('enterprise policy refuses exposure at startup and after policy changes', async () => {
  let enabled = false;
  const f = await fixture(undefined, { readPolicy: () => ({ enterpriseMode: enabled, allowNetworkAccess: false }) });
  enabled = true;
  await assert.rejects(f.admin('origin.add', { origin: 'https://phone.example' }), /Enterprise policy/);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-')); cleanup.push(() => fs.rm(stateDir, { recursive: true, force: true }));
  await assert.rejects(startHerdrServer({ session: 'fixture', host: '0.0.0.0', port: 0, stateDir, readPolicy: () => ({ enterpriseMode: true }) }), /Enterprise policy/);
});

test('local bridge uses NDJSON Unix RPC and rejects unsaved remote targets', async () => {
  const f = await fixture();
  const socketPath = path.join(f.stateDir, 'mock.sock');
  const requests = [];
  const upstream = net.createServer((connection) => {
    let buffer = '';
    connection.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer); requests.push(request);
      connection.end(`${JSON.stringify({ id: request.id, result: { type: 'ok' } })}\n`);
    });
  });
  await new Promise((resolve) => upstream.listen(socketPath, resolve));
  cleanup.push(() => new Promise((resolve) => upstream.close(resolve)));
  const argv = [];
  const bridge = createHerdrBridge({ socketPath, execute: async (_binary, args) => { argv.push(args); return { stdout: JSON.stringify(args[0] === 'machine' ? [{ id: 'saved', label: 'Saved', target: 'saved-alias', session: 'fixture', enabled: true }] : { id: 'remote', result: { type: 'ok' } }) }; } });
  await bridge.rpc('local', 'pane.send_input', { pane_id: 'w1:p1', text: 'printf safe', keys: ['Enter'] });
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'pane.send_input');
  await assert.rejects(bridge.rpc('attacker', 'session.snapshot', {}), /saved/);
});


test('terminal observer uses bearer POST and revocation closes the owned observer process', async () => {
  let child;
  const f = await fixture(undefined, { bridge: {
    machines: async () => [{ id: 'local', label: 'Local' }],
    rpc: async () => ({ id: 'unused', result: {} }),
    observe: async () => {
      child = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({type:"terminal.frame",data:"aGk="})+"\\n"); setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
      return child;
    },
  } });
  const { token, client } = await f.pair();
  const body = { machine: 'local', pane_id: 'w1:p1', cols: 80, rows: 24 };
  assert.equal((await f.request('/api/herdr/terminal', { body })).status, 401);
  const response = await f.request('/api/herdr/terminal', { token, body });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const frame = await reader.read();
  assert.equal(JSON.parse(new TextDecoder().decode(frame.value)).type, 'terminal.frame');
  const stopped = new Promise((resolve) => child.once('close', resolve));
  assert.equal((await f.request(`/api/herdr/clients/${client.id}`, { token, method: 'DELETE' })).status, 200);
  await stopped;
  assert.equal((await reader.read()).done, true);
});


test('missing observer executable returns an HTTP error and the server stays alive', async () => {
  const bridge = createHerdrBridge({ session: 'fixture', herdrBinary: '/nonexistent/openherdr-test-missing-binary' });
  const f = await fixture(undefined, { bridge });
  const { token } = await f.pair();
  const response = await f.request('/api/herdr/terminal', { token, body: { machine: 'local', pane_id: 'w1:p1' } });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('/nonexistent/'));
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/api/herdr/info', { token })).status, 200);
});

test('early observer process exit drains frames and reports failure without hanging', async () => {
  const f = await fixture(undefined, { bridge: {
    machines: async () => [], rpc: async () => ({}),
    observe: async () => spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({type:"terminal.frame",data:"aGk="})+"\\n"); process.exitCode=1'], { stdio: ['ignore', 'pipe', 'pipe'] }),
  } });
  const { token } = await f.pair();
  const response = await f.request('/api/herdr/terminal', { token, body: { machine: 'local', pane_id: 'w1:p1' } });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events[0].type, 'terminal.frame');
  assert.equal(events.at(-1).type, 'terminal.error');
});

test('confirmed invalid pane is rejected while partial agent startup and transport outcomes stay unknown', async () => {
  const f = await fixture(async (_machine, method) => {
    throw herdrRpcError(method, { code: 'invalid_pane', message: 'private input must not leak' });
  });
  const { token } = await f.pair();
  for (const [method, params, expected, code] of [
    ['pane.send_input', { pane_id: 'w1:p99', text: 'hello' }, 'rejected', 'invalid_pane'],
    ['agent.start', { pane_id: 'w1:p99', name: 'test', kind: 'codex' }, 'unknown', 'outcome_unknown'],
  ]) {
    const requestId = `receipt-${expected}`;
    const response = await f.request('/api/herdr/rpc', { token, body: { machine: 'local', method, params, requestId } });
    assert.equal(response.status, 502);
    const error = (await response.json()).error;
    assert.equal(error.code, code);
    assert.ok(!JSON.stringify(error).includes('private input'));
    const receipt = await (await f.request(`/api/herdr/receipts/${requestId}`, { token })).json();
    assert.equal(receipt.receipt.status, expected);
  }
  const socketPath = path.join(f.stateDir, 'refusal.sock');
  const upstream = net.createServer((connection) => {
    connection.once('data', (chunk) => {
      const request = JSON.parse(chunk);
      connection.end(`${JSON.stringify({ id: request.id, error: { code: 'invalid_pane', message: 'private error text' } })}\n`);
    });
  });
  await new Promise((resolve) => upstream.listen(socketPath, resolve));
  cleanup.push(() => new Promise((resolve) => upstream.close(resolve)));
  const bridge = createHerdrBridge({ socketPath });
  await assert.rejects(bridge.rpc('local', 'pane.send_input', { pane_id: 'w1:p99', text: 'hello' }), (error) => error.code === 'invalid_pane' && error.confirmedNoEffect === true && !error.message.includes('private'));
});

test('CLI machine forwarding clears inherited Herdr socket selection', async () => {
  const inherited = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = '/private/other-session.sock';
  const calls = [];
  try {
    const bridge = createHerdrBridge({ session: 'fixture', execute: async (_binary, args, options) => {
      calls.push({ args, options });
      return { stdout: JSON.stringify(args[0] === 'machine' ? [{ id: 'saved', label: 'Saved', target: 'saved-alias', session: 'fixture' }] : { id: '1', result: {} }) };
    } });
    await bridge.machines();
    assert.equal(calls.length, 1);
    for (const call of calls) assert.equal(call.options.env.HERDR_SOCKET_PATH, undefined);
  } finally {
    if (inherited === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = inherited;
  }
});

test('disconnect while observer creation is pending kills the late owned process', async () => {
  let observed; const started = new Promise((resolve) => { observed = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let stopped;
  const f = await fixture(undefined, { bridge: {
    machines: async () => [], rpc: async () => ({}),
    observe: async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
      stopped = new Promise((resolve) => child.once('close', resolve));
      observed(); await gate; return child;
    },
  } });
  const { token } = await f.pair();
  const controller = new AbortController();
  const response = fetch(`${f.url}/api/herdr/terminal`, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ machine: 'local', pane_id: 'w1:p1' }) });
  await started;
  controller.abort();
  await assert.rejects(response, (error) => error.name === 'AbortError');
  release(); await stopped;
  assert.equal((await f.request('/health')).status, 200);
});

test('Herdr opaque alphanumeric workspace, tab and pane IDs remain valid', async () => {
  const observed = [];
  const f = await fixture(async (_machine, method, params) => { observed.push({ method, params }); return { id: '1', result: { type: 'ok' } }; });
  const { token } = await f.pair();
  for (const [method, params] of [
    ['workspace.rename', { workspace_id: 'wP', label: 'Renamed' }],
    ['tab.rename', { tab_id: 'wP:tA0', label: 'Renamed' }],
    ['pane.send_input', { pane_id: 'wP:pA0B1', text: 'hello', keys: ['enter'] }],
  ]) {
    const response = await f.request('/api/herdr/rpc', { token, body: { machine: 'local', method, params, requestId: `alphabetic-${observed.length}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(observed.at(-1), { method, params });
  }
});


test('private admin state identifies the resolved bridge socket while public health stays minimal', async () => {
  const bridge = createHerdrBridge({ socketPath: './owned-fixture.sock' });
  const f = await fixture(undefined, { bridge });
  const expected = path.resolve('./owned-fixture.sock');
  assert.equal(bridge.socketPath, expected);
  assert.equal((await f.admin('status')).socketPath, expected);
  assert.equal(f.runtime.address().socketPath, expected);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDir, 'server.json'), 'utf8')).socketPath, expected);
  assert.deepEqual(await (await f.request('/health')).json(), { ok: true, app: 'openherdr', version: '0.1.0' });
});

test('injected bridge state uses explicit socket fallback and keeps absent target metadata null', async () => {
  const explicit = await fixture(undefined, { socketPath: '/owned/explicit.sock' });
  assert.equal((await explicit.admin('status')).socketPath, '/owned/explicit.sock');
  const absent = await fixture();
  assert.equal((await absent.admin('status')).socketPath, null);
});


test('host HTTP enforces bearer, origin, operation schema and saved-machine selection', async () => {
  const calls = [];
  const bridge = { machines: async () => [{ id: 'saved', label: 'Saved' }], host: async (request) => { calls.push(request); return { root: '/owned', path: request.path, content: 'hello', bytes: 5, revision: createHash('sha256').update('hello').digest('hex') }; } };
  const f = await fixture(undefined, { bridge });
  const body = { request: { machine: 'local', pane_id: 'wP:p1', operation: 'files.read', path: 'hello.txt' } };
  assert.equal((await f.request('/api/herdr/host', { body })).status, 401);
  const { token } = await f.pair();
  assert.equal((await f.request('/api/herdr/host', { token, body, origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/herdr/host', { token, body: { request: { ...body.request, machine: 'attacker' } } })).status, 400);
  assert.equal((await f.request('/api/herdr/host', { token, body: { request: { ...body.request, socket: '/other' } } })).status, 400);
  assert.equal(calls.length, 0);
  const read = await f.request('/api/herdr/host', { token, body: { request: { ...body.request, machine: 'saved' } } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, 'hello');
  assert.equal(calls[0].machine, 'saved');
  await assert.rejects(fs.stat(path.join(f.stateDir, 'receipts.jsonl')), (error) => error.code === 'ENOENT');
  const info = await (await f.request('/api/herdr/info', { token })).json();
  assert.ok(info.capabilities.hostOperations.includes('files.write'));
  assert.ok(info.capabilities.hostOperations.includes('git.commit'));
});

test('host writes require a durable receipt before dispatch and return the actual operation result', async () => {
  let writes = 0;
  const bridge = { host: async (request) => {
    writes++;
    const journal = await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8');
    assert.equal(JSON.parse(journal.trim()).status, 'unknown');
    await fs.writeFile(path.join(f.stateDir, request.path), request.content);
    return { root: f.stateDir, path: request.path, success: true, revision: createHash('sha256').update(request.content).digest('hex') };
  } };
  const f = await fixture(undefined, { bridge });
  const { token } = await f.pair();
  const request = { machine: 'local', pane_id: 'wP:p1', operation: 'files.write', path: 'owned.txt', expectedRoot: f.stateDir, expectedRevision: null, content: 'owned HTTP edit' };
  assert.equal((await f.request('/api/herdr/host', { token, body: { request } })).status, 400);
  assert.equal(writes, 0);
  const response = await f.request('/api/herdr/host', { token, body: { request, requestId: 'host-write-once' } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(await fs.readFile(path.join(f.stateDir, 'owned.txt'), 'utf8'), request.content);
  const receipt = (await (await f.request('/api/herdr/receipts/host-write-once', { token })).json()).receipt;
  assert.equal(receipt.method, 'files.write');
  assert.equal(receipt.machine, 'local');
  assert.equal(receipt.status, 'complete');
  assert.deepEqual(receipt.response, { id: 'host-write-once', result });
  assert.equal((await f.request('/api/herdr/host', { token, body: { request, requestId: 'host-write-once' } })).status, 409);
  assert.equal(writes, 1);
  assert.equal((await f.request('/api/herdr/rpc', { token, body: { machine: 'local', method: 'pane.send_keys', params: { pane_id: 'wP:p1', keys: ['Enter'] }, requestId: 'host-write-once' } })).status, 409);
  assert.ok(!(await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8')).includes(request.content));
});

test('host mutation failures only become rejected with confirmed no-effect evidence', async () => {
  let failure;
  let dispatches = 0;
  const f = await fixture(undefined, { bridge: { host: async () => { dispatches++; throw failure; } } });
  const { token } = await f.pair();
  const request = { machine: 'local', pane_id: 'wP:p1', operation: 'files.mkdir', path: 'owned', expectedRoot: f.stateDir };
  const cases = [
    ['unconfirmed', new ApiError(409, 'uncertain_conflict', 'An operation may have changed files'), 'unknown'],
    ['disconnected', new Error('SSH disconnected'), 'unknown'],
    ['confirmed', Object.assign(new ApiError(409, 'file_conflict', 'The file changed'), { confirmedNoEffect: true }), 'rejected'],
  ];
  for (const [name, error, status] of cases) {
    failure = error;
    const requestId = `host-${name}`;
    const body = { request, requestId };
    const response = await f.request('/api/herdr/host', { token, body });
    assert.equal(response.status, status === 'unknown' ? 502 : 409);
    const receipt = (await (await f.request(`/api/herdr/receipts/${requestId}`, { token })).json()).receipt;
    assert.equal(receipt.status, status);
    const beforeDuplicate = dispatches;
    assert.equal((await f.request('/api/herdr/host', { token, body })).status, 409);
    assert.equal(dispatches, beforeDuplicate);
  }
});

test('host route accepts larger uploads while other routes retain the 128 KiB limit', async () => {
  let bytes = 0;
  const f = await fixture(undefined, { bridge: { host: async (request) => { bytes = Buffer.byteLength(request.content); return { root: '/owned', path: request.path, success: true }; } } });
  const { token } = await f.pair();
  const request = { machine: 'local', pane_id: 'wP:p1', operation: 'files.write', path: 'large.txt', content: 'x'.repeat(256 * 1024), expectedRoot: '/owned', expectedRevision: null };
  const accepted = await f.request('/api/herdr/host', { token, body: { request, requestId: 'host-large-write' } });
  assert.equal(accepted.status, 200);
  assert.equal(bytes, 256 * 1024);
  assert.equal((await f.request('/api/herdr/rpc', { token, body: { padding: request.content } })).status, 413);
  const exceeded = await f.request('/api/herdr/host', { token, body: { padding: 'x'.repeat(16 * 1024 * 1024) } });
  assert.equal(exceeded.status, 413);
  assert.equal(bytes, 256 * 1024);
});

test('host requests retain the current enterprise policy gate', async () => {
  let enabled = false;
  let calls = 0;
  const f = await fixture(undefined, { publicOrigins: ['https://owned.example'], readPolicy: () => ({ enterpriseMode: enabled, allowNetworkAccess: false }), bridge: { host: async () => { calls++; return { root: '/owned', path: '', isFile: false, isDirectory: true, size: 0, mtimeMs: 1 }; } } });
  const { token } = await f.pair();
  enabled = true;
  const response = await f.request('/api/herdr/host', { token, body: { request: { machine: 'local', pane_id: 'wP:p1', operation: 'files.stat' } } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'enterprise_mode');
  assert.equal(calls, 0);
});


test('host authoritative read failures remain errors without a mutation receipt', async () => {
  const f = await fixture(undefined, { bridge: { host: async () => { throw new ApiError(503, 'host_offline', 'The selected host is offline'); } } });
  const { token } = await f.pair();
  const response = await f.request('/api/herdr/host', { token, body: { request: { machine: 'local', pane_id: 'wP:p1', operation: 'files.list' } } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'host_offline');
  await assert.rejects(fs.stat(path.join(f.stateDir, 'receipts.jsonl')), (error) => error.code === 'ENOENT');
});

const conversationTarget = { machine: 'local', paneId: 'wP:p1', expectedAgentSession: null, identity: 'a'.repeat(64) };
const conversationSession = { id: 'session-owned-1', location: { directory: '/owned' }, time: { created: 1, updated: 2 } };
const conversationProtocol = 'opencode-v2';
const conversationsWith = (overrides = {}) => ({
  resolve: async () => ({ protocol: conversationProtocol, target: conversationTarget, native: null, directory: '/owned' }),
  list: async () => ({ protocol: conversationProtocol, target: conversationTarget, sessions: [conversationSession], complete: true, failures: [] }),
  read: async () => ({ protocol: conversationProtocol, target: conversationTarget, session: conversationSession, messages: { data: [], cursor: {} } }),
  catalog: async () => ({ protocol: conversationProtocol, target: conversationTarget, models: [], agents: [], authoritative: false }),
  create: async () => ({ protocol: conversationProtocol, target: conversationTarget, session: conversationSession }),
  act: async ({ sessionId, action }) => ({ protocol: conversationProtocol, target: conversationTarget, sessionId, action, result: null }),
  async *events() { yield { protocol: conversationProtocol, type: 'conversation.resync', target: conversationTarget, sessionId: conversationSession.id }; },
  close: async () => {},
  ...overrides,
});

test('conversation HTTP applies bearer, strict request scope and Origin before service calls', async () => {
  let calls = 0;
  const conversations = conversationsWith({ resolve: async () => { calls++; return { protocol: conversationProtocol, target: conversationTarget, native: null }; } });
  const f = await fixture(undefined, { conversations });
  const body = { request: { target: conversationTarget } };
  assert.equal((await f.request('/api/herdr/conversations/resolve', { body })).status, 401);
  const { token } = await f.pair();
  assert.equal((await f.request('/api/herdr/conversations/resolve', { token, body, origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/api/herdr/conversations/resolve', { token, body: { request: { target: conversationTarget, url: 'http://other' } } })).status, 400);
  assert.equal((await f.request('/api/herdr/conversations/resolve', { token, body: { request: { target: { ...conversationTarget, machine: 'attacker' } } } })).status, 400);
  assert.equal(calls, 0);
  const response = await f.request('/api/herdr/conversations/resolve', { token, body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { protocol: conversationProtocol, target: conversationTarget, native: null });
  assert.equal(calls, 1);
});

test('conversation create and actions return full results but persist only minimal receipt metadata', async () => {
  const secret = 'private-prompt-files-and-assistant-text';
  let creates = 0; let actions = 0;
  const conversations = conversationsWith({
    create: async () => {
      creates++;
      assert.equal(JSON.parse((await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8')).trim()).status, 'unknown');
      return { protocol: conversationProtocol, target: conversationTarget, session: { ...conversationSession, title: secret, metadata: { private: secret } } };
    },
    act: async ({ sessionId, action, input }) => { actions++; assert.equal(input.text, secret); return { protocol: conversationProtocol, target: conversationTarget, sessionId, action, result: { id: 'inbox-actual', sessionID: sessionId, type: 'inbox', time: { created: 42 }, delivery: 'queue', text: secret, files: [secret] } }; },
  });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  const request = { target: conversationTarget, title: secret };
  assert.equal((await f.request('/api/herdr/conversations/create', { token, body: { request } })).status, 400);
  const created = await f.request('/api/herdr/conversations/create', { token, body: { request, requestId: 'conversation-create' } });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).session.metadata.private, secret);
  const act = { target: conversationTarget, sessionId: conversationSession.id, action: 'prompt', input: { text: secret, files: [{ uri: 'data:text/plain;base64,cHJpdmF0ZQ==', name: 'private.txt' }] } };
  assert.equal((await f.request('/api/herdr/conversations/act', { token, body: { request: act } })).status, 400);
  const sent = await f.request('/api/herdr/conversations/act', { token, body: { request: act, requestId: 'conversation-prompt' } });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).result.id, 'inbox-actual');
  for (const [requestId, action] of [['conversation-create', 'create'], ['conversation-prompt', 'prompt']]) {
    const receipt = (await (await f.request(`/api/herdr/receipts/${requestId}`, { token })).json()).receipt;
    assert.equal(receipt.status, 'complete');
    assert.deepEqual(receipt.response.result, { protocol: conversationProtocol, target: conversationTarget, sessionId: conversationSession.id, action });
    assert.equal(receipt.method, `conversation.${action}`);
  }
  assert.equal((await f.request('/api/herdr/conversations/act', { token, body: { request: act, requestId: 'conversation-prompt' } })).status, 409);
  assert.equal(creates, 1); assert.equal(actions, 1);
  const journal = await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8');
  assert.ok(!journal.includes(secret)); assert.ok(!journal.includes('cHJpdmF0ZQ==')); assert.ok(!journal.includes('inbox-actual'));
});

test('conversation post-dispatch conflicts remain unknown unless explicitly confirmed without effect', async () => {
  let failure;
  const conversations = conversationsWith({ act: async () => { throw failure; } });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  const request = { target: conversationTarget, sessionId: conversationSession.id, action: 'abort', input: {} };
  for (const [name, error, expected] of [
    ['conflict', new ApiError(409, 'target_changed', 'Target changed after dispatch'), 'unknown'],
    ['transport', new Error('Disconnected'), 'unknown'],
    ['before', Object.assign(new ApiError(409, 'target_changed', 'Target changed before dispatch'), { confirmedNoEffect: true }), 'rejected'],
  ]) {
    failure = error;
    const requestId = `conversation-${name}`;
    const response = await f.request('/api/herdr/conversations/act', { token, body: { request, requestId } });
    assert.equal(response.status, expected === 'unknown' ? 502 : 409);
    const receipt = (await (await f.request(`/api/herdr/receipts/${requestId}`, { token })).json()).receipt;
    assert.equal(receipt.status, expected);
  }
});

test('conversation events expose early scope errors as HTTP failures and reject empty sources', async () => {
  let empty = false;
  const conversations = conversationsWith({ async *events() { if (!empty) throw new ApiError(403, 'conversation_scope_forbidden', 'The session is not in this scope'); } });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  const body = { request: { target: conversationTarget, sessionId: conversationSession.id } };
  const forbidden = await f.request('/api/herdr/conversations/events', { token, body });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, 'conversation_scope_forbidden');
  empty = true;
  const ended = await f.request('/api/herdr/conversations/events', { token, body });
  assert.equal(ended.status, 502);
  assert.equal((await ended.json()).error.code, 'conversation_stream_empty');
});

test('conversation events emit typed errors after a genuine first frame', async () => {
  let cleaned = 0;
  const conversations = conversationsWith({ async *events() { try { yield { protocol: conversationProtocol, type: 'conversation.resync', target: conversationTarget, sessionId: conversationSession.id }; throw new ApiError(409, 'target_changed', 'The pane occupant changed'); } finally { cleaned++; } } });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  const response = await f.request('/api/herdr/conversations/events', { token, body: { request: { target: conversationTarget, sessionId: conversationSession.id } } });
  assert.equal(response.status, 200);
  const frames = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(frames.map((frame) => frame.type), ['conversation.resync', 'conversation.error']);
  assert.equal(frames[1].error.code, 'target_changed');
  assert.equal(cleaned, 1);
});

test('conversation stream disconnect, revocation and server close abort subscriptions and await service close', async () => {
  let cleaned = 0; let closed = 0; const signals = [];
  const conversations = conversationsWith({
    async *events({ signal }) {
      signals.push(signal);
      try {
        yield { protocol: conversationProtocol, type: 'conversation.resync', target: conversationTarget, sessionId: conversationSession.id };
        await new Promise((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      } finally { cleaned++; }
    },
    close: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); closed++; },
  });
  const f = await fixture(undefined, { conversations });
  const first = await f.pair(); const second = await f.pair();
  const body = { request: { target: conversationTarget, sessionId: conversationSession.id } };
  const response = await f.request('/api/herdr/conversations/events', { token: first.token, body });
  const reader = response.body.getReader(); await reader.read(); await reader.cancel();
  for (let i = 0; i < 30 && cleaned < 1; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cleaned, 1); assert.equal(signals[0].aborted, true);
  const revoked = await f.request('/api/herdr/conversations/events', { token: first.token, body });
  const revokedReader = revoked.body.getReader(); await revokedReader.read();
  assert.equal((await f.request(`/api/herdr/clients/${first.client.id}`, { token: second.token, method: 'DELETE' })).status, 200);
  assert.equal((await revokedReader.read()).done, true);
  assert.equal(signals[1].aborted, true);
  const stopped = await f.request('/api/herdr/conversations/events', { token: second.token, body });
  const stoppedReader = stopped.body.getReader(); await stoppedReader.read();
  await f.runtime.close();
  assert.equal((await stoppedReader.read()).done, true);
  assert.equal(signals[2].aborted, true);
  assert.equal(cleaned, 3); assert.equal(closed, 1);
});

test('conversation act alone accepts large attachment bodies and ordinary server startup stays lazy', async () => {
  const lazy = await fixture();
  assert.equal((await lazy.request('/health')).status, 200);
  await assert.rejects(fs.stat(path.join(lazy.stateDir, 'conversations')), (error) => error.code === 'ENOENT');
  const f = await fixture(undefined, { conversations: conversationsWith() });
  const { token } = await f.pair();
  const act = { target: conversationTarget, sessionId: conversationSession.id, action: 'prompt', input: { text: 'large attachment', files: [{ uri: `data:text/plain;base64,${Buffer.alloc(200 * 1024, 'x').toString('base64')}`, name: 'owned.txt' }] } };
  assert.equal((await f.request('/api/herdr/conversations/act', { token, body: { request: act, requestId: 'conversation-large-attachment' } })).status, 200);
  assert.equal((await f.request('/api/herdr/conversations/create', { token, body: { request: act, requestId: 'conversation-too-large-create' } })).status, 413);
});


test('conversation list, read and catalog forward their real records without creating receipts', async () => {
  const conversations = conversationsWith();
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  for (const [route, request] of [
    ['list', { target: conversationTarget, limit: 4 }],
    ['read', { target: conversationTarget, sessionId: conversationSession.id, cursor: 'actual-cursor', limit: 2 }],
    ['catalog', { target: conversationTarget }],
  ]) {
    const response = await f.request(`/api/herdr/conversations/${route}`, { token, body: { request } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.protocol, conversationProtocol);
    assert.deepEqual(result.target, conversationTarget);
  }
  await assert.rejects(fs.stat(path.join(f.stateDir, 'receipts.jsonl')), (error) => error.code === 'ENOENT');
});

test('conversation history reads need no pane and rebind requires a minimal mutation receipt', async () => {
  let histories = 0; let rebound = 0;
  const conversations = conversationsWith({
    historyList: async ({ machine }) => { histories++; assert.equal(machine, 'local'); return { protocol: conversationProtocol, sessions: [{ session: conversationSession }], complete: true, failures: [] }; },
    historyRead: async ({ sessionId }) => { histories++; assert.equal(sessionId, conversationSession.id); return { protocol: conversationProtocol, session: conversationSession, messages: { data: [], cursor: {} }, access: 'read-only', needsBinding: true }; },
    rebind: async ({ target, sessionId }) => { rebound++; assert.equal(sessionId, conversationSession.id); return { protocol: conversationProtocol, target, session: { ...conversationSession, title: 'private-title-not-in-receipt' } }; },
  });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  assert.equal((await f.request('/api/herdr/conversations/history/list', { token, body: { request: { machine: 'local' } } })).status, 200);
  assert.equal((await f.request('/api/herdr/conversations/history/read', { token, body: { request: { sessionId: conversationSession.id } } })).status, 200);
  assert.equal(histories, 2);
  assert.equal((await f.request('/api/herdr/conversations/history/read', { token, body: { request: { sessionId: conversationSession.id, target: conversationTarget } } })).status, 400);
  const request = { target: conversationTarget, sessionId: conversationSession.id };
  assert.equal((await f.request('/api/herdr/conversations/rebind', { token, body: { request } })).status, 400);
  assert.equal(rebound, 0);
  assert.equal((await f.request('/api/herdr/conversations/rebind', { token, body: { request, requestId: 'conversation-rebind' } })).status, 200);
  const receipt = (await (await f.request('/api/herdr/receipts/conversation-rebind', { token })).json()).receipt;
  assert.equal(receipt.method, 'conversation.rebind');
  assert.deepEqual(receipt.response.result, { protocol: conversationProtocol, target: conversationTarget, sessionId: conversationSession.id, action: 'rebind' });
  assert.ok(!(await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8')).includes('private-title-not-in-receipt'));
});

test('conversation events wait for drain before reading more source frames', async () => {
  let produced = 0; let cleaned = 0;
  const conversations = conversationsWith({ async *events() { try { while (true) { produced++; yield { protocol: conversationProtocol, type: 'conversation.event', target: conversationTarget, sessionId: conversationSession.id, event: { type: 'session.text.delta', data: { delta: 'x'.repeat(8 * 1024 * 1024) } } }; } } finally { cleaned++; } } });
  const f = await fixture(undefined, { conversations });
  const { token } = await f.pair();
  const payload = JSON.stringify({ request: { target: conversationTarget, sessionId: conversationSession.id } });
  const request = http.request(`${f.url}/api/herdr/conversations/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
  request.on('error', () => {});
  const response = await new Promise((resolve, reject) => { request.once('response', resolve); request.once('error', reject); request.end(payload); });
  response.on('error', () => {}); response.pause();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(produced, 1);
  request.destroy(); response.destroy();
  for (let i = 0; i < 30 && cleaned < 1; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cleaned, 1);
});

test('preferences are authenticated, preserve profile/surface scope and reject stale revisions', async () => {
  let enterpriseMode = false;
  const f = await fixture(undefined, { readPolicy: () => ({ enterpriseMode, allowNetworkAccess: true }) });
  const route = '/api/herdr/preferences';
  const read = { operation: 'read', surface: 'mobile' };
  assert.equal((await f.request(route, { body: read })).status, 401);
  const { token } = await f.pair();
  const initial = await (await f.request(route, { token, body: read })).json();
  assert.equal(initial.revision, 0);
  const update = { operation: 'update', surface: 'mobile', expectedRevision: 0, changes: { fontSize: 120, uiFont: 'system', useSystemTheme: true } };
  assert.equal((await f.request(route, { token, body: update })).status, 200);
  const mobile = await (await f.request(route, { token, body: read })).json();
  const web = await (await f.request(route, { token, body: { operation: 'read', surface: 'web' } })).json();
  assert.equal(mobile.values.fontSize, 120);
  assert.equal(web.values.uiFont, 'system');
  assert.equal(web.values.fontSize, undefined);
  assert.equal((await f.request(route, { token, body: update })).status, 409);
  assert.equal((await f.request(route, { token, body: { ...update, expectedRevision: 1, changes: { provider: 'unexpected' } } })).status, 400);
  assert.equal((await (await f.request('/api/herdr/info', { token })).json()).allowRemoteFonts, true);
  enterpriseMode = true;
  assert.equal((await (await f.request('/api/herdr/info', { token })).json()).allowRemoteFonts, false);
});

test('project context uses native project ownership and receipts omit note contents', async () => {
  let projectRoot;
  const rpc = async () => ({ id: 'native-project', result: { snapshot: { workspaces: [{ workspace_id: 'w1', worktree: { repo_root: projectRoot, checkout_path: projectRoot } }], panes: [{ pane_id: 'w1:p1', workspace_id: 'w1' }] } } });
  const f = await fixture(rpc);
  projectRoot = await fs.realpath(f.stateDir);
  const route = '/api/herdr/project-context';
  const request = { machine: 'local', pane_id: 'w1:p1', operation: 'context.read' };
  assert.equal((await f.request(route, { body: { request } })).status, 401);
  const { token } = await f.pair();
  const reading = await f.request(route, { token, body: { request } });
  const source = await reading.json();
  assert.equal(reading.status, 200, JSON.stringify(source));
  assert.equal(source.owner.root, projectRoot);
  const mutation = { ...request, operation: 'context.note.create', body: 'private-note-not-in-receipts', expectedOwner: source.owner.id, expectedRevision: source.revision };
  assert.equal((await f.request(route, { token, body: { request: mutation } })).status, 400);
  const changed = await f.request(route, { token, body: { request: mutation, requestId: 'project-note-create' } });
  assert.equal(changed.status, 200);
  const saved = await changed.json();
  assert.equal(saved.context.notes.length, 1);
  const receipt = await (await f.request('/api/herdr/receipts/project-note-create', { token })).json();
  assert.equal(receipt.receipt.status, 'complete');
  assert.deepEqual(receipt.receipt.response.result, { owner: saved.owner, revision: saved.revision });
  assert.ok(!(await fs.readFile(path.join(f.stateDir, 'receipts.jsonl'), 'utf8')).includes(mutation.body));
  assert.equal((await f.request(route, { token, body: { request: mutation, requestId: 'project-note-create' } })).status, 409);
  assert.equal((await f.request(route, { token, body: { request: mutation, requestId: 'project-note-stale' } })).status, 409);
  assert.equal((await (await f.request('/api/herdr/receipts/project-note-stale', { token })).json()).receipt.status, 'rejected');
});
