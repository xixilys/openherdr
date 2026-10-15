import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createConversationRuntime } from './runtime.js';

async function fixture(t, { exitsOnKill = true, version = '2.0.27' } = {}) {
  const base = path.resolve('.tmp'); await fs.mkdir(base, { recursive: true });
  const stateDir = await fs.mkdtemp(path.join(base, 'conversation-driver-runtime-'));
  const children = [], launches = [];
  const runtime = createConversationRuntime({
    stateDir, discover: async () => undefined, readPolicy: () => ({ opencodeBinary: '/pinned/opencode' }),
    spawnProcess(binary, args, options) {
      launches.push({ binary, args, options });
      const child = new EventEmitter();
      Object.assign(child, { pid: children.length + 5000, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), kills: [] });
      child.kill = (signal) => {
        child.kills.push(signal);
        if (exitsOnKill) { child.signalCode = signal; queueMicrotask(() => child.emit('exit', null, signal)); }
        return true;
      };
      children.push(child);
      queueMicrotask(() => child.stdout.write(`server listening on http://127.0.0.1:${child.pid}\n`));
      return child;
    },
    makeClient({ baseUrl }) { return { server: { info: async () => ({ version, pid: Number(new URL(baseUrl).port) }) } }; },
  });
  t.after(async () => { for (const child of children) { child.exitCode = 0; child.emit('exit', 0); } await runtime.close(); await fs.rm(stateDir, { recursive: true, force: true }); });
  return { runtime, children, launches };
}

test('close returns for a child already terminated by signal', async (t) => {
  const { runtime, children, launches } = await fixture(t);
  await runtime.get({ kind: 'private', allowStart: true });
  const child = children[0]; child.signalCode = 'SIGTERM'; child.emit('exit', null, 'SIGTERM');
  await runtime.close();
  assert.deepEqual(child.kills, []);
  assert.equal(launches[0].binary, '/pinned/opencode');
  assert.deepEqual(launches[0].args, ['serve', '--hostname', '127.0.0.1', '--port', '0']);
});

test('an explicit private history read can restart a dead child, without replaying any turn', async (t) => {
  const { runtime, children } = await fixture(t);
  const first = await runtime.get({ kind: 'private', allowStart: true });
  children[0].signalCode = 'SIGTERM'; children[0].emit('exit', null, 'SIGTERM');
  await assert.rejects(runtime.get({ kind: 'private' }), (e) => e.code === 'conversation_coordinator_unavailable');
  const second = await runtime.get({ kind: 'private', allowStart: true });
  assert.notEqual(first.info.pid, second.info.pid); assert.equal(second.kind, 'private'); assert.equal(children.length, 2);
  await runtime.close(); assert.deepEqual(children[1].kills, ['SIGTERM']);
});

test('close has a bounded failure when the owned process never confirms exit', async (t) => {
  const { runtime, children } = await fixture(t, { exitsOnKill: false });
  await runtime.get({ kind: 'private', allowStart: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closing = runtime.close();
  // close first awaits its possibly pending start, then installs the timeout.
  await Promise.resolve();
  t.mock.timers.tick(2000);
  t.mock.timers.tick(1000);
  await assert.rejects(closing, (e) => e.code === 'conversation_stop_timeout');
  assert.deepEqual(children[0].kills, ['SIGTERM', 'SIGKILL']);
  children[0].signalCode = 'SIGKILL'; children[0].emit('exit', null, 'SIGKILL');
});

test('unsupported old 2.x coordinator is rejected and never upgraded', async () => {
  let spawned = 0;
  const runtime = createConversationRuntime({
    stateDir: path.resolve('.tmp/conversation-driver-unused'),
    discover: async () => ({ url: 'http://127.0.0.1:5000' }),
    makeClient: () => ({ server: { info: async () => ({ version: '2.0.0', pid: 5000 }) } }),
    spawnProcess: () => { spawned++; throw new Error('Unexpected spawn'); },
  });
  await assert.rejects(runtime.get({ allowStart: true }), (e) => e.code === 'conversation_version_unsupported');
  assert.equal(spawned, 0); await runtime.close();
});
