import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
