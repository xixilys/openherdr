import { afterEach, describe, expect, it } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./openherdr.js', import.meta.url));
const fixtures = [];
const stableOrigin = 'https://owned-openherdr.example';
const dummyToken = 'controlled-cloudflare-token-for-subprocess-test';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// This executable implements only cloudflared's process/readiness protocol.
// It opens no network connections and uses only this test's files.
const fakeCloudflared = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.OPENHERDR_TEST_FIXTURE;
const pidfile = args[args.indexOf('--pidfile') + 1];
fs.appendFileSync(path.join(root, 'invocations.ndjson'), JSON.stringify({
  args, pid: process.pid, ppid: process.ppid,
  inheritedToken: Boolean(process.env.TUNNEL_TOKEN || process.env.CLOUDFLARE_TUNNEL_TOKEN),
}) + '\n');
if (process.env.OPENHERDR_TEST_OUTPUT) console.error(process.env.OPENHERDR_TEST_OUTPUT);
let previous;
let terminating = false;
const timer = setInterval(() => {
  let control;
  try { control = JSON.parse(fs.readFileSync(path.join(root, 'control.json'), 'utf8')); }
  catch { return; }
  if (control.exit) process.exit(control.exit);
  if (control.stop) process.exit(0);
  if (terminating && control.releaseTerm) process.exit(0);
  if (control.ready !== previous && control.ready && args.includes('--pidfile')) {
    fs.mkdirSync(path.dirname(pidfile), { recursive: true });
    fs.writeFileSync(pidfile, String(control.ready === 'correct' ? process.pid : 1));
    previous = control.ready;
  }
}, 20);
function terminate(signal) {
  fs.appendFileSync(path.join(root, 'signals.ndjson'), JSON.stringify({ pid: process.pid, signal }) + '\n');
  let control = {};
  try { control = JSON.parse(fs.readFileSync(path.join(root, 'control.json'), 'utf8')); } catch {}
  if (control.holdTerm) { terminating = true; return; }
  clearInterval(timer);
  process.exit(0);
}
process.on('SIGTERM', () => terminate('SIGTERM'));
process.on('SIGINT', () => terminate('SIGINT'));
`;

async function fixture() {
  // Keep Unix admin socket paths below macOS's socket path limit.
  const root = await fs.mkdtemp('/tmp/ohcf-');
  const stateDir = path.join(root, 'state');
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(root, 'home'));
  await fs.writeFile(path.join(bin, 'cloudflared'), fakeCloudflared, { mode: 0o700 });
  const tokenFile = path.join(root, 'token');
  const configFile = path.join(root, 'config.yml');
  await fs.writeFile(tokenFile, dummyToken + '\n', { mode: 0o600 });
  await fs.writeFile(configFile, 'tunnel: controlled-test-id\ningress:\n  - service: http_status:404\n', { mode: 0o600 });
  const port = await availablePort();
  const processes = [];
  const env = {
    HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'home', '.config'),
    XDG_STATE_HOME: path.join(root, 'home', '.state'),
    PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    OPENCHAMBER_ENTERPRISE_MODE: '0',
    OPENHERDR_TEST_FIXTURE: root,
    OPENHERDR_TEST_OUTPUT: 'https://untrusted-noise.trycloudflare.com Registered tunnel connection',
  };
  const f = {
    root, stateDir, tokenFile, configFile, port, processes, env,
    baseUrl: `http://127.0.0.1:${port}`,
    control: (value) => fs.writeFile(path.join(root, 'control.json'), JSON.stringify(value)),
    async invocations() {
      return (await readText(path.join(root, 'invocations.ndjson'))).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    async signals() {
      return (await readText(path.join(root, 'signals.ndjson'))).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    launch(command, options = [], overrides = {}) {
      const child = spawn(process.execPath, [cli, command, '--state-dir', stateDir, '--port', String(port), '--socket', path.join(root, 'unused-herdr.sock'), ...options], {
        env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const execution = { child, stdout: '', stderr: '', done: false };
      child.stdout.on('data', (chunk) => { execution.stdout += chunk; });
      child.stderr.on('data', (chunk) => { execution.stderr += chunk; });
      execution.completion = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => { execution.done = true; resolve({ code, signal, stdout: execution.stdout, stderr: execution.stderr }); });
      });
      processes.push(execution);
      return execution;
    },
    async run(command, options = [], overrides = {}) {
      const execution = f.launch(command, options, overrides);
      await waitUntil(() => execution.done, `${command} command exit`, 18000);
      return execution.completion;
    },
    named(mode) {
      return ['--cf', '--cf-mode', mode, '--server', stableOrigin,
        ...(mode === 'managed-remote' ? ['--cf-token-file', tokenFile] : ['--cf-config', configFile])];
    },
    async stop() {
      const result = await f.run('stop', ['--json']);
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).status).toBe('stopped');
      return result;
    },
  };
  fixtures.push(f);
  await f.control({});
  return f;
}

function jsonSuccess(result) {
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

function expectNamed(status, mode) {
  expect(status.status).toBe('running');
  expect(status.publicOrigins).toContain(stableOrigin);
  expect(status.tunnel).toMatchObject({ mode, publicOrigin: stableOrigin, connector: 'first-connected', publicRouting: 'unverified' });
}

async function pairedClient(f) {
  const pair = jsonSuccess(await f.run('connect', ['--json']));
  expect(pair.server).toBe(stableOrigin);
  const link = new URL(pair.url);
  expect(link.origin).toBe(stableOrigin);
  const payload = JSON.parse(Buffer.from(new URLSearchParams(link.hash.slice(1)).get('pairing'), 'base64url').toString());
  expect(payload.server).toBe(stableOrigin);
  const response = await fetch(f.baseUrl + '/api/pairing/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: stableOrigin },
    body: JSON.stringify({ pairingId: payload.pairingId, secret: payload.secret, deviceName: 'owned subprocess fixture' }),
  });
  expect(response.status).toBe(200);
  const client = await response.json();
  expect(client.token).toBeTruthy();
  const second = await fetch(f.baseUrl + '/api/pairing/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingId: payload.pairingId, secret: payload.secret }),
  });
  expect(second.status).toBe(400);
  return client;
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    // Release a fake connector even if an assertion found broken CLI shutdown.
    await f.control({ stop: true });
    await f.run('stop', ['--json']).catch(() => {});
    for (const execution of f.processes) {
      if (!execution.done) execution.child.kill('SIGTERM');
    }
    const invocations = await f.invocations();
    for (const pid of new Set(invocations.flatMap(({ pid, ppid }) => [pid, ppid]))) {
      if (!alive(pid)) continue;
      // Background serve is a grandchild. Check its exact fixture path before
      // fallback cleanup, so another process can never match by name alone.
      let command = '';
      try { command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch { continue; }
      if (command.includes(f.root)) process.kill(pid, 'SIGTERM');
    }
    await Promise.all(f.processes.map(async (execution) => {
      if (execution.done) return;
      await waitUntil(() => execution.done, 'owned CLI cleanup', 4000).catch(() => execution.child.kill('SIGKILL'));
    }));
    await fs.rm(f.root, { recursive: true, force: true });
  }
}, 30000);

describe.sequential('OpenHerdr CLI with an owned Cloudflare executable fixture', () => {
  it.each(['managed-remote', 'managed-local'])('waits for %s first connection and exposes a stable pairing origin', async (mode) => {
    const f = await fixture();
    const start = f.launch('start', [...f.named(mode), '--json'], {
      OPENHERDR_TEST_OUTPUT: dummyToken + ' https://noise.trycloudflare.com Registered tunnel connection',
    });
    const invocation = await waitUntil(async () => (await f.invocations())[0], 'connector launch');
    expect(invocation.args).toContain('--pidfile');
    expect(invocation.args).not.toContain(dummyToken);
    expect(invocation.inheritedToken).toBe(false);
    for (const pid of [invocation.pid, invocation.ppid]) {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      expect(command).not.toContain(dummyToken);
    }
    await f.control({ ready: 'wrong' });
    await delay(250);
    expect(start.done).toBe(false);
    expect(start.stdout).toBe('');
    expect((await fetch(f.baseUrl + '/health')).status).toBe(200);
    await f.control({ ready: 'correct' });
    await waitUntil(() => start.done, 'background startup');
    expectNamed(jsonSuccess(await start.completion), mode);
    expectNamed(jsonSuccess(await f.run('status', ['--json'])), mode);
    const client = await pairedClient(f);
    const headers = { authorization: `Bearer ${client.token}`, origin: stableOrigin };
    expect((await fetch(f.baseUrl + '/api/herdr/info', { headers })).status).toBe(200);
    expect((await fetch(f.baseUrl + '/api/herdr/info')).status).toBe(401);
    await f.stop();
    expect(alive(invocation.pid)).toBe(false);
    await f.control({ ready: 'correct' });
    expectNamed(jsonSuccess(await f.run('start', [...f.named(mode), '--json'])), mode);
    expect((await fetch(f.baseUrl + '/api/herdr/info', { headers })).status).toBe(200);
    const clients = await (await fetch(f.baseUrl + '/api/herdr/clients', { headers })).json();
    expect(clients.clients).toHaveLength(1);
    expect((await fetch(f.baseUrl + `/api/herdr/clients/${clients.clients[0].id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(f.baseUrl + '/api/herdr/info', { headers })).status).toBe(401);
    await f.stop();
    expectNamed(jsonSuccess(await f.run('start', [...f.named(mode), '--json'])), mode);
    expect((await fetch(f.baseUrl + '/api/herdr/info', { headers })).status).toBe(401);
    await f.stop();
    expect(await fs.readFile(f.tokenFile, 'utf8')).toBe(dummyToken + '\n');
    for (const file of await fs.readdir(f.stateDir, { recursive: true })) {
      const filename = path.join(f.stateDir, file);
      if ((await fs.stat(filename)).isFile()) expect(await fs.readFile(filename, 'utf8'), file).not.toContain(dummyToken);
    }
    for (const execution of f.processes) expect(execution.stdout + execution.stderr).not.toContain(dummyToken);
  }, 30000);

  it.each(['managed-remote', 'managed-local'])('runs %s in foreground and preserves an unrelated process on stop', async (mode) => {
    const f = await fixture();
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      await f.control({ ready: 'correct' });
      const serve = f.launch('serve', [...f.named(mode), '--json'], { OPENHERDR_TEST_OUTPUT: dummyToken + ' https://noise.trycloudflare.com' });
      const status = await waitUntil(() => serve.stdout.includes('\n') && JSON.parse(serve.stdout), 'foreground readiness');
      expectNamed(status, mode);
      const invocation = (await f.invocations())[0];
      expect(invocation.ppid).toBe(serve.child.pid);
      await f.stop();
      await waitUntil(() => serve.done, 'foreground exit');
      expect((await serve.completion).code).toBe(0);
      expect(alive(invocation.pid)).toBe(false);
      expect(alive(sentinel.pid)).toBe(true);
      expect(serve.stdout + serve.stderr).not.toContain(dummyToken);
      expect(await readText(path.join(f.stateDir, 'cloudflare.log'))).not.toContain(dummyToken);
    } finally {
      sentinel.kill('SIGTERM');
      await once(sentinel, 'close');
    }
  }, 20000);

  it.each(['serve', 'start'])('cancels %s during connector startup and removes owned receipts', async (command) => {
    const f = await fixture();
    const execution = f.launch(command, [...f.named('managed-remote'), '--json']);
    const invocation = await waitUntil(async () => (await f.invocations())[0], 'pending connector');
    expect(execution.done).toBe(false);
    await f.stop();
    await waitUntil(() => execution.done, 'cancelled startup exit');
    expect(alive(invocation.pid)).toBe(false);
    expect(jsonSuccess(await f.run('status', ['--json'])).status).toBe('stopped');
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe('');
    const pidFile = invocation.args[invocation.args.indexOf('--pidfile') + 1];
    await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.dirname(pidFile))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(execution.stdout).not.toContain('first-connected');
  }, 20000);

  it('fails background startup when its connector exits before readiness', async () => {
    const f = await fixture();
    await f.control({ exit: 7 });
    const result = await f.run('start', [...f.named('managed-remote'), '--json']);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout).error.message).toBeTruthy();
    expect(result.stderr).toBe('');
    const invocation = (await f.invocations())[0];
    expect(alive(invocation.pid)).toBe(false);
    expect(jsonSuccess(await f.run('status', ['--json'])).status).toBe('stopped');
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe('');
  }, 20000);

  it.each(['serve', 'start'])('joins owned descendants when pending %s receives SIGTERM', async (command) => {
    const f = await fixture();
    const execution = f.launch(command, [...f.named('managed-remote'), '--json']);
    const invocation = await waitUntil(async () => (await f.invocations())[0], 'pending connector before signal');
    execution.child.kill('SIGTERM');
    await waitUntil(() => execution.done, 'signalled CLI exit');
    const result = await execution.completion;
    expect(result, JSON.stringify(result)).toMatchObject({ code: 1, signal: null });
    expect(JSON.parse(result.stdout).error.message).toBeTruthy();
    expect(result.stderr).toBe('');
    expect(alive(invocation.pid)).toBe(false);
    expect(alive(invocation.ppid)).toBe(false);
    expect(jsonSuccess(await f.run('status', ['--json'])).status).toBe('stopped');
    const pidFile = invocation.args[invocation.args.indexOf('--pidfile') + 1];
    await expect(fs.stat(path.dirname(pidFile))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe('');
  }, 20000);

  it.each([false, true])('retains admin ownership through connector cleanup with initial readiness=%s', async (initiallyReady) => {
    const f = await fixture();
    await f.control({ ready: initiallyReady ? 'correct' : undefined, holdTerm: true });
    const firstStart = f.launch('start', [...f.named('managed-remote'), '--json']);
    const firstChild = await waitUntil(async () => (await f.invocations())[0], 'first connector before overlap');
    if (initiallyReady) {
      await waitUntil(() => firstStart.done, 'first startup readiness');
      expectNamed(jsonSuccess(await firstStart.completion), 'managed-remote');
    } else {
      expect(firstStart.done).toBe(false);
    }
    const receiptBefore = await readText(path.join(f.stateDir, 'tunnel.json'));
    expect(Boolean(receiptBefore)).toBe(initiallyReady);
    const stop = f.launch('stop', ['--json']);
    await waitUntil(async () => (await f.signals()).some((event) => event.pid === firstChild.pid && event.signal === 'SIGTERM'), 'connector cleanup gate');
    expect(alive(firstChild.pid)).toBe(true);
    expect(stop.done).toBe(false);
    const duringStop = jsonSuccess(await f.run('status', ['--json']));
    expect(duringStop.status).toBe('running');
    expect(duringStop.pid).toBe(firstChild.ppid);
    const concurrent = await f.run('start', [...f.named('managed-remote'), '--json']);
    if (concurrent.code === 0) {
      expect(JSON.parse(concurrent.stdout).pid).toBe(firstChild.ppid);
    } else {
      expect(JSON.parse(concurrent.stdout).error.message).toBeTruthy();
    }
    expect(concurrent.stderr).toBe('');
    expect(await f.invocations()).toHaveLength(1);
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe(receiptBefore);
    await f.control({ releaseTerm: true });
    await waitUntil(() => stop.done, 'overlapping stop confirmation');
    expect(jsonSuccess(await stop.completion).status).toBe('stopped');
    await waitUntil(() => firstStart.done, 'original startup exit');
    if (!initiallyReady) expect((await firstStart.completion).code).toBe(1);
    expect(alive(firstChild.pid)).toBe(false);
    expect(alive(firstChild.ppid)).toBe(false);
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe('');
    await f.control({ ready: 'correct' });
    const fresh = jsonSuccess(await f.run('start', [...f.named('managed-remote'), '--json']));
    expectNamed(fresh, 'managed-remote');
    const invocations = await f.invocations();
    expect(invocations).toHaveLength(2);
    expect(invocations[1].ppid).toBe(fresh.pid);
    expect(fresh.pid).not.toBe(firstChild.ppid);
    const freshReceipt = await readText(path.join(f.stateDir, 'tunnel.json'));
    expect(freshReceipt).toBeTruthy();
    expect(freshReceipt).not.toBe(receiptBefore);
    expectNamed(jsonSuccess(await f.run('status', ['--json'])), 'managed-remote');
    expect(await readText(path.join(f.stateDir, 'tunnel.json'))).toBe(freshReceipt);
    await f.stop();
  }, 20000);

  it.each([false, true])('keeps Quick URL and readiness independent with explicit start server=%s', async (explicitServer) => {
    const f = await fixture();
    const start = f.launch('start', ['--cf', ...(explicitServer ? ['--server', stableOrigin] : []), '--json']);
    await waitUntil(async () => (await f.invocations())[0], 'Quick launch');
    await delay(200);
    expect(start.done).toBe(false);
    await f.control({ ready: 'correct' });
    await waitUntil(() => start.done, 'Quick readiness');
    const status = jsonSuccess(await start.completion);
    expect(status.tunnel).toMatchObject({ mode: 'quick', publicOrigin: 'https://untrusted-noise.trycloudflare.com', connector: 'first-connected', publicRouting: 'unverified' });
    const pair = jsonSuccess(await f.run('connect', ['--json']));
    expect(pair.server).toBe('https://untrusted-noise.trycloudflare.com');
    const explicit = jsonSuccess(await f.run('connect', ['--server', stableOrigin, '--json']));
    expect(explicit.server).toBe(stableOrigin);
    expect(jsonSuccess(await f.run('status', ['--json'])).tunnel.mode).toBe('quick');
    await f.stop();
  }, 20000);

  it('reports a connector that exits after readiness without losing the running bridge', async () => {
    const f = await fixture();
    await f.control({ ready: 'correct' });
    expectNamed(jsonSuccess(await f.run('start', [...f.named('managed-local'), '--json'])), 'managed-local');
    const invocation = (await f.invocations())[0];
    await f.control({ exit: 8 });
    await waitUntil(() => !alive(invocation.pid), 'connector exit');
    const status = jsonSuccess(await f.run('status', ['--json']));
    expect(status.status).toBe('running');
    expect(status.tunnel).toMatchObject({ mode: 'managed-local', publicOrigin: stableOrigin, connector: 'exited', publicRouting: 'unverified' });
    expect(status.tunnel.reason).toMatch(/exited/i);
    expect((await fetch(f.baseUrl + '/health')).status).toBe(200);
    expect(jsonSuccess(await f.run('connect', ['--json'])).server).toBe(stableOrigin);
    await f.stop();
  }, 20000);

  it('prints a concise useful result in quiet non-TTY mode', async () => {
    const f = await fixture();
    await f.control({ ready: 'correct' });
    const start = await f.run('start', [...f.named('managed-local'), '--quiet']);
    expect(start.code, start.stderr).toBe(0);
    expect(start.stderr).toBe('');
    expect(start.stdout.trim()).toBeTruthy();
    expect(start.stdout).not.toContain('\u001b');
    const pair = await f.run('connect', ['--quiet']);
    expect(pair.code).toBe(0);
    expect(new URL(pair.stdout.trim()).origin).toBe(stableOrigin);
    await f.stop();
  }, 20000);

  it('keeps an old receipt unconfirmed while status and pairing remain usable', async () => {
    const f = await fixture();
    const status = jsonSuccess(await f.run('start', ['--server', stableOrigin, '--json']));
    expect(status.tunnel).toBeNull();
    const legacyOrigin = 'https://legacy-owned.trycloudflare.com';
    // This is the previous CLI's on-disk receipt format. It has no managed
    // mode, launch identity or first-connection PID confirmation.
    await fs.writeFile(path.join(f.stateDir, 'tunnel.json'), JSON.stringify({
      pid: status.pid, publicOrigin: legacyOrigin, startedAt: new Date().toISOString(),
    }), { mode: 0o600 });
    const current = jsonSuccess(await f.run('status', ['--json']));
    expect(current.status).toBe('running');
    expect(current.tunnel).toMatchObject({ mode: null, publicOrigin: legacyOrigin, connector: 'unconfirmed', publicRouting: 'unverified' });
    expect(jsonSuccess(await f.run('connect', ['--json'])).server).toBe(stableOrigin);
    await fs.unlink(path.join(f.stateDir, 'tunnel.json'));
    await f.stop();
  }, 20000);

  it('refuses a different named setup on an already running owned bridge', async () => {
    const f = await fixture();
    await f.control({ ready: 'correct' });
    expectNamed(jsonSuccess(await f.run('start', [...f.named('managed-remote'), '--json'])), 'managed-remote');
    const otherFile = path.join(f.root, 'other-token');
    await fs.writeFile(otherFile, 'different-controlled-token', { mode: 0o600 });
    const changed = [
      ['--cf', '--cf-mode', 'managed-remote', '--server', stableOrigin, '--cf-token-file', otherFile],
      ['--cf', '--cf-mode', 'managed-remote', '--server', 'https://other-owned.example', '--cf-token-file', f.tokenFile],
      f.named('managed-local'),
      ['--cf'],
    ];
    for (const options of changed) {
      const result = await f.run('start', [...options, '--json']);
      expect(result.code).not.toBe(0);
      expect(JSON.parse(result.stdout).error.message).toBeTruthy();
    }
    expect(await f.invocations()).toHaveLength(1);
    expectNamed(jsonSuccess(await f.run('status', ['--json'])), 'managed-remote');
    await f.stop();
  }, 20000);

  it('rejects missing, conflicting and irrelevant options before launching', async () => {
    const f = await fixture();
    const invalid = [
      ['--cf-mode', 'managed-remote', '--server', stableOrigin, '--cf-token-file', f.tokenFile],
      ['--cf', '--cf-mode', 'bad'],
      ['--cf', '--cf-mode', 'managed-remote', '--server', stableOrigin],
      ['--cf', '--cf-mode', 'managed-local', '--server', stableOrigin],
      ['--cf', '--cf-mode', 'managed-remote', '--cf-token-file', f.tokenFile],
      ['--cf', '--cf-mode', 'managed-local', '--cf-config', f.configFile, '--server', 'http://owned-openherdr.example'],
      [...f.named('managed-remote'), '--cf-config', f.configFile],
      [...f.named('managed-local'), '--cf-token-file', f.tokenFile],
      ['--cf', '--cf-token-file', f.tokenFile],
      ['--cf-config', f.configFile],
    ];
    for (const options of invalid) {
      const result = await f.run('start', [...options, '--json']);
      expect(result.code, JSON.stringify(options)).not.toBe(0);
      expect(JSON.parse(result.stdout).error.message).toBeTruthy();
      expect(result.stderr).toBe('');
      expect(await f.invocations()).toEqual([]);
      expect(await readText(path.join(f.stateDir, 'server.json'))).toBe('');
    }
    const irrelevant = await f.run('status', [...f.named('managed-remote'), '--json']);
    expect(irrelevant.code).not.toBe(0);
    expect(JSON.parse(irrelevant.stdout).error).toBeTruthy();
    expect(await f.invocations()).toEqual([]);
  }, 20000);

  it.each(['quick', 'managed-remote', 'managed-local'])('refuses %s under enterprise policy before listening', async (mode) => {
    const f = await fixture();
    const options = mode === 'quick' ? ['--cf'] : f.named(mode);
    const result = await f.run('start', [...options, '--json'], { OPENCHAMBER_ENTERPRISE_MODE: '1' });
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout).error.message).toMatch(/enterprise/i);
    expect(result.stderr).toBe('');
    expect(await f.invocations()).toEqual([]);
    expect(await readText(path.join(f.stateDir, 'server.json'))).toBe('');
    await expect(fetch(f.baseUrl + '/health')).rejects.toThrow();
  }, 20000);
});
