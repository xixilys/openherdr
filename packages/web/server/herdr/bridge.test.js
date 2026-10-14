import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHerdrBridge } from './bridge.js';

const cleanup = [];
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });

async function fixture(handler, { session = 'owned-test', statusOverrides = {}, timeoutMs = 1000, helperCommand } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-ssh-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const socketPath = path.join(root, 'authoritative.sock');
  const metadata = { running: true, compatible: true, endpoint_compatible: true, protocol: 22, session, socket: socketPath, ...statusOverrides };
  const metadataFile = path.join(root, 'metadata.json');
  await fs.writeFile(metadataFile, JSON.stringify(metadata));
  const fakeHerdr = path.join(root, 'herdr');
  const metadataArgs = path.join(root, 'argv.json');
  const observerArgs = path.join(root, 'observer-argv.json');
  const observerStopped = path.join(root, 'observer-stopped');
  await fs.writeFile(fakeHerdr, `#!/usr/bin/env python3
import json,os,signal,sys,time
if sys.argv[3:6] == ['terminal','session','observe']:
    json.dump({'args':sys.argv[1:],'socket':os.environ.get('HERDR_SOCKET_PATH')},open(${JSON.stringify(observerArgs)},'w'))
    def stop(signum,frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop)
    try:
        print(json.dumps({'type':'terminal.frame','data':'aGVsbG8='}),flush=True)
        while True:
            time.sleep(1)
    finally:
        open(${JSON.stringify(observerStopped)},'w').write('stopped')
else:
    json.dump({'args':sys.argv[1:],'inheritedSocket':os.environ.get('HERDR_SOCKET_PATH')},open(${JSON.stringify(metadataArgs)},'w'))
    sys.stdout.write(open(${JSON.stringify(metadataFile)}).read())
`, { mode: 0o700 });
  const connections = new Set();
  const requests = [];
  const server = net.createServer((connection) => {
    connections.add(connection); connection.on('close', () => connections.delete(connection));
    let input = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk) => {
      input += chunk;
      if (!input.includes('\n')) return;
      const request = JSON.parse(input); requests.push(request);
      handler(request, connection);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  cleanup.push(() => new Promise((resolve) => { for (const connection of connections) connection.destroy(); server.close(resolve); }));
  const spawned = [];
  const bridge = createHerdrBridge({ session: 'irrelevant-local', timeoutMs, execute: async (_binary, args, options) => {
    assert.deepEqual(args, ['machine', 'list', '--json']);
    assert.equal(options.env.HERDR_SOCKET_PATH, undefined);
    return { stdout: JSON.stringify([{ id: 'saved', label: 'Saved SSH alias', target: 'configured-alias', session }]) };
  }, spawnProcess: (_binary, args, options) => {
    spawned.push(args);
    assert.deepEqual(args.slice(0, -1), ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'configured-alias']);
    assert.equal(options.env.HERDR_SOCKET_PATH, undefined);
    const child = spawn('/bin/sh', ['-c', helperCommand ?? args.at(-1)], { ...options, env: { ...options.env, HERDR_BIN_PATH: fakeHerdr, HERDR_SOCKET_PATH: '/wrong/inherited.sock' } });
    return child;
  } });
  return { bridge, requests, spawned, metadataArgs, observerArgs, observerStopped, socketPath };
}

test('SSH fixed helper preserves atomic multiline input, quotes and leading dash through stdin', async () => {
  const f = await fixture((request, connection) => connection.end(`${JSON.stringify({ id: request.id, result: { type: 'ok' } })}\n`));
  const text = '-first line\n"double quote" and \'single quote\'\nprintf "$HOME $(touch forbidden)"\nUnicode 你好';
  const params = { pane_id: 'wP:pA0B1', text, keys: ['Ctrl-c', 'Enter'] };
  const response = await f.bridge.rpc('saved', 'pane.send_input', params);
  assert.deepEqual(response.result, { type: 'ok' });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].params, params);
  assert.equal(f.requests[0].method, 'pane.send_input');
  assert.ok(!f.spawned[0].at(-1).includes(text));
  const metadata = JSON.parse(await fs.readFile(f.metadataArgs, 'utf8'));
  assert.deepEqual(metadata.args, ['--session', 'owned-test', 'status', 'server', '--json']);
  assert.equal(metadata.inheritedSocket, null);
});

test('SSH read returns original revision, truncation and terminal bytes', async () => {
  const original = { type: 'pane_read', pane_id: 'wP:pA0B1', text: '\u001b[31mhello\r\n你好', revision: 713, truncated: true, source: 'recent_unwrapped', start_line: 17 };
  const f = await fixture((request, connection) => connection.end(`${JSON.stringify({ id: request.id, result: original })}\n`));
  const response = await f.bridge.rpc('saved', 'pane.read', { pane_id: 'wP:pA0B1', source: 'recent_unwrapped', strip_ansi: false });
  assert.deepEqual(response.result, original);
});

test('SSH disconnect after dispatch and wrong response ID remain unknown', async () => {
  const disconnected = await fixture((_request, connection) => connection.end());
  await assert.rejects(disconnected.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => !(error.confirmedNoEffect || error.status < 500));
  assert.equal(disconnected.requests.length, 1);
  const mismatched = await fixture((_request, connection) => connection.end(`${JSON.stringify({ id: 'wrong-id', result: { type: 'ok' } })}\n`));
  await assert.rejects(mismatched.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => !(error.confirmedNoEffect || error.status < 500));
});

test('SSH status session mismatch refuses before dispatch without socket guesses', async () => {
  const f = await fixture(() => assert.fail('Must not dispatch'), { statusOverrides: { session: 'wrong-session' } });
  await assert.rejects(f.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => error.status === 501 && error.code === 'remote_herdr_unavailable' && error.confirmedNoEffect === true);
  assert.equal(f.requests.length, 0);
});

test('SSH original error code is classified while partial agent startup stays unknown', async () => {
  const f = await fixture((request, connection) => connection.end(`${JSON.stringify({ id: request.id, error: { code: 'pane_not_found', message: 'private details' } })}\n`));
  await assert.rejects(f.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => error.code === 'pane_not_found' && error.confirmedNoEffect === true && !error.message.includes('private'));
  await assert.rejects(f.bridge.rpc('saved', 'agent.start', { pane_id: 'wP:p1', name: 'owned', kind: 'codex' }), (error) => error.code === 'pane_not_found' && error.confirmedNoEffect === false);
});

test('SSH default session accepts authoritative null session metadata', async () => {
  const f = await fixture((request, connection) => connection.end(`${JSON.stringify({ id: request.id, result: { type: 'ok' } })}\n`), { session: 'default', statusOverrides: { session: null } });
  assert.deepEqual((await f.bridge.rpc('saved', 'session.snapshot', {})).result, { type: 'ok' });
});


test('SSH missing Python3 is explicit unsupported and performs no socket request', async () => {
  const f = await fixture(() => assert.fail('No socket request expected'), { helperCommand: 'exit 127' });
  await assert.rejects(f.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => error.status === 501 && error.code === 'remote_python_unavailable' && error.confirmedNoEffect === true);
  assert.equal(f.requests.length, 0);
});

test('SSH helper response timeout stays unknown after one dispatch', async () => {
  const f = await fixture(() => {}, { timeoutMs: 50 });
  await assert.rejects(f.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => !(error.confirmedNoEffect || error.status < 500));
  assert.equal(f.requests.length, 1);
});

test('SSH helper refuses a relative status socket and never selects a default socket', async () => {
  const f = await fixture(() => assert.fail('No socket request expected'), { statusOverrides: { socket: 'other.sock' } });
  await assert.rejects(f.bridge.rpc('saved', 'session.snapshot', {}), (error) => error.status === 501);
  assert.equal(f.requests.length, 0);
});


test('SSH helper refuses incompatible, missing and malformed protocol metadata before dispatch', async () => {
  for (const statusOverrides of [
    { compatible: false }, { compatible: undefined },
    { endpoint_compatible: false }, { endpoint_compatible: undefined },
    { protocol: 999 }, { protocol: undefined }, { protocol: '22' },
  ]) {
    const f = await fixture(() => assert.fail('Must not dispatch incompatible protocol'), { statusOverrides });
    await assert.rejects(f.bridge.rpc('saved', 'pane.send_input', { pane_id: 'wP:p1', text: 'hello' }), (error) => error.status === 501 && error.confirmedNoEffect === true);
    assert.equal(f.requests.length, 0);
  }
});


test('SSH observation invokes remote official observer and EOF terminates only its child', async () => {
  const f = await fixture(() => assert.fail('Observation is an official remote CLI stream'));
  const child = await f.bridge.observe('saved', 'wP:pA0B1', 88, 33);
  child.stderr.resume();
  const frame = await new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.on('data', (chunk) => { buffer += chunk; if (buffer.includes('\n')) resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n')))); });
    child.on('error', reject);
  });
  assert.deepEqual(frame, { type: 'terminal.frame', data: 'aGVsbG8=' });
  const invocation = JSON.parse(await fs.readFile(f.observerArgs, 'utf8'));
  assert.deepEqual(invocation.args, ['--session', 'owned-test', 'terminal', 'session', 'observe', 'wP:pA0B1', '--cols', '88', '--rows', '33']);
  assert.equal(invocation.socket, f.socketPath);
  const stopped = new Promise((resolve) => child.once('close', resolve));
  child.stdin.end();
  await stopped;
  assert.equal(await fs.readFile(f.observerStopped, 'utf8'), 'stopped');
  assert.equal(f.requests.length, 0);
});

test('SSH observation validates status before starting a remote observer', async () => {
  const f = await fixture(() => assert.fail('Must not connect'), { statusOverrides: { compatible: false } });
  const child = await f.bridge.observe('saved', 'wP:p1', 80, 24);
  child.stderr.resume();
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  await new Promise((resolve) => child.once('close', resolve));
  assert.equal(JSON.parse(output).type, 'terminal.error');
  await assert.rejects(fs.stat(f.observerArgs), (error) => error.code === 'ENOENT');
});
