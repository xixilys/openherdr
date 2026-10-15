import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { openHostAsset } from './asset-transport.js';
import { createHerdrBridge } from './bridge.js';
import { parseAssetDescribeRequest, parseAssetRawRequest } from './asset-protocol.js';
import { parseHostRequest, isHostMutation, executeHostOperation } from './host-operations.js';

async function fixture() {
  const base = path.resolve('.tmp');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'asset-host-tests-'));
  const root = await fs.realpath(directory);
  const socketPath = `/tmp/oh-asset-${randomUUID()}.sock`;
  let activeRoot = root;
  let terminal = 'terminal-1';
  let onSnapshot = () => {};
  let snapshots = 0;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', (data) => {
      input += data;
      if (!input.endsWith('\n')) return;
      const request = JSON.parse(input);
      onSnapshot(++snapshots);
      socket.end(JSON.stringify({ id: request.id, result: { snapshot: { panes: [{ pane_id: 'w1:p1', cwd: activeRoot, terminal_id: terminal ?? undefined }] } } }) + '\n');
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const children = new Set();
  const spawnOwned = (...args) => {
    const child = spawn(...args);
    children.add(child);
    child.once('close', () => children.delete(child));
    return child;
  };
  const bridge = createHerdrBridge({ socketPath, spawnProcess: spawnOwned });
  const describeRequest = (file = 'file.bin') => ({ operation: 'files.describe', machine: 'local', pane_id: 'w1:p1', terminal_id: 'terminal-1', expectedRoot: root, path: file });
  const rawRequest = (metadata) => ({ ...describeRequest(metadata.path), operation: 'files.raw', expectedAssetVersion: metadata.assetVersion });
  return {
    root, directory, socketPath, bridge, children, spawnOwned, describeRequest, rawRequest,
    setTerminal(value) { terminal = value; }, setRoot(value) { activeRoot = value; },
    onSnapshot(callback) { onSnapshot = callback; snapshots = 0; },
    async close() {
      for (const child of [...children]) {
        const closed = new Promise((resolve) => child.once('close', resolve));
        child.kill('SIGKILL');
        await closed;
      }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

async function bytes(opened) {
  const chunks = [];
  for await (const chunk of opened.body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('asset schemas require explicit terminal/root/version and preserve the legacy host allowlist', () => {
  const request = { operation: 'files.describe', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp/root', path: 'name:2026.bin' };
  assert.deepEqual(parseAssetDescribeRequest(request), request);
  assert.equal(isHostMutation(parseHostRequest(request)), false);
  for (const path of ['/etc/passwd', '../secret', 'a/../b', '.GIT/config', 'bad\\file', 'bad\nfile', 'bad\0file', '.', './file', 'a//b', 'a/']) assert.throws(() => parseAssetDescribeRequest({ ...request, path }), { code: 'invalid_asset_request' });
  for (const key of ['terminal_id', 'expectedRoot', 'path']) {
    const broken = { ...request }; delete broken[key];
    assert.throws(() => parseAssetDescribeRequest(broken), { code: 'invalid_asset_request' });
  }
  assert.throws(() => parseAssetRawRequest({ ...request, operation: 'files.raw', expectedAssetVersion: 'a'.repeat(64) }), { code: 'invalid_asset_request' });
  assert.throws(() => parseHostRequest({ ...request, operation: 'files.raw', expectedAssetVersion: `stat-v1:${'a'.repeat(64)}` }), { code: 'invalid_host_request' });
});

test('real Python describes and seeks a sparse file beyond 8 MiB without a whole-file read', async () => {
  const f = await fixture();
  try {
    const file = await fs.open(path.join(f.root, 'file.bin'), 'w');
    const size = 32 * 1024 * 1024 + 19;
    await file.truncate(size);
    const marker = Buffer.from([0, 255, 10, 13, 128, 17]);
    await file.write(marker, 0, marker.length, size - marker.length);
    await file.close();
    const described = await f.bridge.describeAsset(f.describeRequest());
    assert.equal(described.metadata.bytes, size);
    assert.equal(described.metadata.sampleKind, 'binary');
    assert.match(described.metadata.assetVersion, /^stat-v1:[a-f0-9]{64}$/);
    assert.match(described.binding, /^[a-f0-9]{64}$/);
    assert.deepEqual(await executeHostOperation(f.bridge, f.describeRequest()), described.metadata);
    const range = { start: size - marker.length, end: size - 1 };
    const opened = await f.bridge.openAsset(f.rawRequest(described.metadata), { expectedBinding: described.binding, range });
    assert.deepEqual(await bytes(opened), marker);
    assert.equal(f.children.size, 0);
    const head = await f.bridge.openAsset(f.rawRequest(described.metadata), { expectedBinding: described.binding, headOnly: true });
    assert.equal(f.children.size, 0, 'HEAD resolves only after helper exit');
    assert.equal((await bytes(head)).length, 0);
    const one = await f.bridge.openAsset(f.rawRequest(described.metadata), { range: { start: size - 1, end: size - 1 } });
    assert.deepEqual(await bytes(one), marker.subarray(-1));
  } finally { await f.close(); }
});

test('real Python preserves all streamed bytes in bounded chunks above the old size limit', async () => {
  const f = await fixture();
  try {
    const expected = Buffer.alloc(9 * 1024 * 1024 + 1);
    for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
    await fs.writeFile(path.join(f.root, 'file.bin'), expected);
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    const opened = await f.bridge.openAsset(f.rawRequest(metadata));
    let offset = 0;
    let chunks = 0;
    for await (const chunk of opened.body) {
      assert.ok(chunk.length > 0 && chunk.length <= 65536);
      assert.deepEqual(chunk, expected.subarray(offset, offset + chunk.length));
      offset += chunk.length;
      chunks++;
    }
    assert.equal(offset, expected.length);
    assert.ok(chunks > 100);
  } finally { await f.close(); }
});

test('classification handles a UTF-8 codepoint split at the sample boundary and empty files', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'file.bin'), 'a'.repeat(8191) + '文\n');
    assert.equal((await f.bridge.describeAsset(f.describeRequest())).metadata.sampleKind, 'text');
    await fs.writeFile(path.join(f.root, 'file.bin'), Buffer.from([0xe6]));
    assert.equal((await f.bridge.describeAsset(f.describeRequest())).metadata.sampleKind, 'binary');
    await fs.writeFile(path.join(f.root, 'file.bin'), '');
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    const opened = await f.bridge.openAsset(f.rawRequest(metadata));
    assert.equal(f.children.size, 0, 'empty GET resolves after helper exit');
    assert.equal((await bytes(opened)).length, 0);
  } finally { await f.close(); }
});

test('helper refuses symlinks, directories, missing terminals, changed roots and versions', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'file.bin'), 'original');
    await fs.symlink('/etc/passwd', path.join(f.root, 'link'));
    await assert.rejects(f.bridge.describeAsset(f.describeRequest('link')), { code: 'path_forbidden' });
    await fs.mkdir(path.join(f.root, 'folder'));
    await assert.rejects(f.bridge.describeAsset(f.describeRequest('folder')), { code: 'not_file' });
    await assert.rejects(f.bridge.describeAsset(f.describeRequest('missing')), { code: 'file_not_found' });
    f.setTerminal(null);
    await assert.rejects(f.bridge.describeAsset(f.describeRequest()), { code: 'terminal_unavailable' });
    f.setTerminal('other-terminal');
    await assert.rejects(f.bridge.describeAsset(f.describeRequest()), { code: 'target_changed' });
    f.setTerminal('terminal-1');
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    await fs.writeFile(path.join(f.root, 'file.bin'), 'changed');
    await assert.rejects(f.bridge.openAsset(f.rawRequest(metadata)), { code: 'asset_changed' });
    f.setRoot(path.dirname(f.root));
    await assert.rejects(f.bridge.describeAsset(f.describeRequest()), { code: 'target_changed' });
  } finally { await f.close(); }
});

test('completion checks truncate a nonempty stream after root, terminal or file changes', async () => {
  for (const change of ['root', 'terminal', 'file']) {
    const f = await fixture();
    try {
      const filePath = path.join(f.root, 'file.bin');
      const file = await fs.open(filePath, 'w');
      await file.truncate(32 * 1024 * 1024);
      await file.close();
      const { metadata } = await f.bridge.describeAsset(f.describeRequest());
      const opened = await f.bridge.openAsset(f.rawRequest(metadata));
      if (change === 'root') f.setRoot(path.dirname(f.root));
      if (change === 'terminal') f.setTerminal('replacement');
      if (change === 'file') await fs.writeFile(filePath, 'replacement');
      let delivered = 0;
      await assert.rejects((async () => { for await (const chunk of opened.body) delivered += chunk.length; })());
      assert.ok(delivered < metadata.bytes, `${change} cannot complete Content-Length`);
      assert.equal(f.children.size, 0);
    } finally { await f.close(); }
  }
});

test('HEAD and empty files reject failed completion instead of publishing metadata success', async () => {
  for (const size of [0, 20]) {
    const f = await fixture();
    try {
      await fs.writeFile(path.join(f.root, 'file.bin'), Buffer.alloc(size));
      const { metadata } = await f.bridge.describeAsset(f.describeRequest());
      f.onSnapshot((count) => { if (count === 3) f.setTerminal('replacement'); });
      await assert.rejects(f.bridge.openAsset(f.rawRequest(metadata), { headOnly: size > 0 }));
      assert.equal(f.children.size, 0);
    } finally { await f.close(); }
  }
});

test('cancellation and explicit close join only the owned helper while its stdout is blocked', async () => {
  const f = await fixture();
  try {
    const file = await fs.open(path.join(f.root, 'file.bin'), 'w');
    await file.truncate(64 * 1024 * 1024);
    await file.close();
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    for (const cancel of ['abort', 'close']) {
      const controller = new AbortController();
      const opened = await f.bridge.openAsset(f.rawRequest(metadata), { signal: controller.signal });
      if (cancel === 'abort') controller.abort();
      await opened.close();
      assert.equal(f.children.size, 0);
      await assert.rejects(bytes(opened), { code: 'asset_cancelled' });
      await opened.close();
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.bridge.openAsset(f.rawRequest(metadata), { signal: controller.signal }), { code: 'asset_cancelled' });
    assert.equal(f.children.size, 0);
  } finally { await f.close(); }
});

test('fake SSH uses the fixed program and rejects saved-profile retargeting before spawn', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'file.bin'), Buffer.from([0, 255, 3, 4]));
    const status = path.join(f.root, 'fake-herdr');
    await fs.writeFile(status, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ running: true, compatible: true, endpoint_compatible: true, protocol: 22, session: 'fixture', socket: f.socketPath }))});\n`, { mode: 0o700 });
    let profile = { id: 'remote', label: 'Fixture', target: 'fixture-host', session: 'fixture', enabled: true };
    const calls = [];
    const bridge = createHerdrBridge({ session: 'fixture', sshBinary: 'fake-ssh', execute: async (_binary, argv) => { assert.deepEqual(argv, ['machine', 'list', '--json']); return { stdout: JSON.stringify([profile]) }; }, spawnProcess: (binary, argv, options) => {
      assert.equal(binary, 'fake-ssh');
      assert.deepEqual(argv.slice(0, 8), ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'fixture-host', argv[7]]);
      calls.push(argv);
      return f.spawnOwned('/bin/sh', ['-c', argv.at(-1)], { ...options, env: { ...options.env, HERDR_BIN_PATH: status } });
    } });
    const request = { ...f.describeRequest(), machine: 'remote' };
    const { binding, metadata } = await bridge.describeAsset(request);
    const opened = await bridge.openAsset({ ...request, operation: 'files.raw', expectedAssetVersion: metadata.assetVersion }, { expectedBinding: binding, range: { start: 1, end: 3 } });
    assert.deepEqual(await bytes(opened), Buffer.from([255, 3, 4]));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].at(-1), calls[1].at(-1));
    assert.ok(!calls[0].at(-1).includes(f.root));
    profile = { ...profile, target: 'replacement-host' };
    await assert.rejects(bridge.openAsset({ ...request, operation: 'files.raw', expectedAssetVersion: metadata.assetVersion }, { expectedBinding: binding }), { code: 'target_changed' });
    assert.equal(calls.length, 2);
    profile = { ...profile, target: 'fixture-host', session: 'replacement' };
    await assert.rejects(bridge.describeAsset(request, { expectedBinding: binding }), { code: 'target_changed' });
    assert.equal(calls.length, 2);
  } finally { await f.close(); }
});

test('framing rejects short, excessive, malformed and nonzero-exit bodies before their final byte', async () => {
  const metadata = { root: '/tmp', path: 'file.bin', terminal_id: 't1', assetVersion: `stat-v1:${'a'.repeat(64)}`, bytes: 3, sampleKind: 'binary' };
  const request = { operation: 'files.raw', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin', expectedAssetVersion: metadata.assetVersion };
  for (const scenario of [
    { body: 'ab', footer: '', code: 0 },
    { body: 'abcd', footer: '{"complete":true}\n', code: 0 },
    { body: 'abc', footer: '{"complete":false}\n', code: 0 },
    { body: 'abc', footer: '{"complete":true}\nextra', code: 0 },
    { body: 'abc', footer: '{"complete":true}\n', code: 7 },
  ]) {
    const wire = JSON.stringify({ metadata, length: 3 }) + '\n' + scenario.body + scenario.footer;
    const script = `import sys;sys.stdin.buffer.readline();sys.stdout.buffer.write(${JSON.stringify(wire)}.encode());sys.stdout.flush();sys.exit(${scenario.code})`;
    const opened = await openHostAsset({ request, spawnProcess: (_binary, _argv, options) => spawn('python3', ['-c', script], options) });
    let delivered = 0;
    await assert.rejects((async () => { for await (const chunk of opened.body) delivered += chunk.length; })());
    assert.ok(delivered < metadata.bytes);
  }
});

test('upstream deadlines pause while the consumer is backpressured and reject stalled helpers', async () => {
  const metadata = { root: '/tmp', path: 'file.bin', terminal_id: 't1', assetVersion: `stat-v1:${'a'.repeat(64)}`, bytes: 2 * 1024 * 1024, sampleKind: 'binary' };
  const request = { operation: 'files.raw', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin', expectedAssetVersion: metadata.assetVersion };
  const script = `import sys;sys.stdin.buffer.readline();sys.stdout.buffer.write(${JSON.stringify(JSON.stringify({ metadata, length: metadata.bytes }) + '\n')}.encode());sys.stdout.flush();sys.stdout.buffer.write(b'x'*${metadata.bytes});sys.stdout.buffer.write(b'{"complete":true}\\n');sys.stdout.flush()`;
  const opened = await openHostAsset({ request, timeoutMs: 100, spawnProcess: (_binary, _argv, options) => spawn('python3', ['-c', script], options) });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const actual = await bytes(opened);
  assert.equal(actual.length, metadata.bytes);
  assert.ok(actual.every((value) => value === 120));
  for (const stage of ['setup', 'body']) {
    let owned;
    const stalled = `import sys,time;sys.stdin.buffer.readline();${stage === 'body' ? `sys.stdout.buffer.write(${JSON.stringify(JSON.stringify({ metadata, length: metadata.bytes }) + '\n')}.encode());sys.stdout.flush();` : ''}time.sleep(10)`;
    const attempt = openHostAsset({ request, timeoutMs: 100, spawnProcess: (_binary, _argv, options) => { owned = spawn('python3', ['-c', stalled], options); return owned; } });
    await assert.rejects((async () => { const result = await attempt; await bytes(result); })(), { code: 'asset_timeout' });
    assert.ok(owned.exitCode !== null || owned.signalCode !== null);
  }
});

test('stdin EOF and SIGHUP stop a real helper even while its output pipe is backpressured', async () => {
  const f = await fixture();
  try {
    const file = await fs.open(path.join(f.root, 'file.bin'), 'w');
    await file.truncate(64 * 1024 * 1024);
    await file.close();
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    for (const stop of ['eof', 'sighup']) {
      const child = f.spawnOwned('python3', ['-c', readFileSync(new URL('./host-helper.py', import.meta.url), 'utf8')], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stderr.resume();
      const closed = new Promise((resolve) => child.once('close', (code, exitSignal) => resolve({ code, exitSignal })));
      child.stdin.write(JSON.stringify({ request: f.rawRequest(metadata), socketPath: f.socketPath, assetStream: true }) + '\n');
      await new Promise((resolve, reject) => {
        child.stdout.once('readable', resolve);
        child.once('error', reject);
      });
      // No reader drains stdout, so the large body must remain backpressured.
      if (stop === 'eof') child.stdin.end();
      else child.kill('SIGHUP');
      let timer;
      const result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned helper ignored cancellation')), 2000); })]).finally(() => clearTimeout(timer));
      assert.ok(result.code !== 0 || result.exitSignal !== null);
      child.stdout.destroy();
    }
  } finally { await f.close(); }
});

test('cancelling a pending profile lookup prevents a late helper from being spawned', async () => {
  let resolveProfile;
  const pending = new Promise((resolve) => { resolveProfile = resolve; });
  let spawns = 0;
  const bridge = createHerdrBridge({ session: 'fixture', execute: () => pending, spawnProcess: () => { spawns++; throw new Error('Unexpected spawn'); } });
  const controller = new AbortController();
  const request = { operation: 'files.describe', machine: 'remote', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin' };
  const reading = bridge.describeAsset(request, { signal: controller.signal });
  controller.abort();
  resolveProfile({ stdout: JSON.stringify([{ id: 'remote', label: 'Fixture', target: 'fixture', session: 'fixture' }]) });
  await assert.rejects(reading, { code: 'asset_cancelled' });
  assert.equal(spawns, 0);
});

test('HEAD samples at most 8 KiB and a far-tail range performs only the sample and requested read', async () => {
  const f = await fixture();
  try {
    const size = 64 * 1024 * 1024 * 1024;
    const file = await fs.open(path.join(f.root, 'file.bin'), 'w');
    await file.truncate(size);
    await file.write(Buffer.from('tail'), 0, 4, size - 4);
    await file.close();
    const calls = [];
    const bridge = createHerdrBridge({ socketPath: f.socketPath, spawnProcess: (binary, argv, options) => {
      const instrument = '\noriginal_pread = os.pread\ndef measured_pread(fd, count, offset):\n    sys.stderr.write(json.dumps([count, offset]) + "\\n")\n    sys.stderr.flush()\n    return original_pread(fd, count, offset)\nos.pread = measured_pread\n';
      const script = argv[1].replace('\ntry:\n    main()', instrument + '\ntry:\n    main()');
      const child = f.spawnOwned(binary, ['-c', script], options);
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('close', () => { calls.push(stderr.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))); });
      return child;
    } });
    const { metadata } = await bridge.describeAsset(f.describeRequest());
    assert.equal(metadata.bytes, size);
    assert.deepEqual(calls.pop(), [[8192, 0]]);
    const head = await bridge.openAsset(f.rawRequest(metadata), { headOnly: true });
    await head.close();
    assert.deepEqual(calls.pop(), [[8192, 0]]);
    const tail = await bridge.openAsset(f.rawRequest(metadata), { range: { start: size - 4, end: size - 1 } });
    assert.equal((await bytes(tail)).toString(), 'tail');
    assert.deepEqual(calls.pop(), [[8192, 0], [4, size - 4]]);
  } finally { await f.close(); }
});

test('missing local Python and missing remote Python return explicit unsupported errors', async () => {
  const request = { operation: 'files.describe', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin' };
  await assert.rejects(openHostAsset({ request, pythonBinary: '/nonexistent/openherdr-test-python' }), { code: 'host_python_unavailable', status: 501 });
  await assert.rejects(openHostAsset({ request, profile: { target: 'fixture', session: 'fixture' }, spawnProcess: (_binary, _argv, options) => spawn('python3', ['-c', 'import sys;sys.exit(127)'], options) }), { code: 'remote_python_unavailable', status: 501 });
});

test('a coalesced stdout chunk larger than 64 KiB preserves payload and completion framing', async () => {
  const metadata = { root: '/tmp', path: 'file.bin', terminal_id: 't1', assetVersion: `stat-v1:${'a'.repeat(64)}`, bytes: 300000, sampleKind: 'binary' };
  const request = { operation: 'files.raw', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin', expectedAssetVersion: metadata.assetVersion };
  const payload = Buffer.alloc(metadata.bytes);
  for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
  const wire = Buffer.concat([Buffer.from(JSON.stringify({ metadata, length: metadata.bytes }) + '\n'), payload, Buffer.from('{"complete":true}\n')]);
  const opened = await openHostAsset({ request, spawnProcess: (_binary, _argv, options) => {
    const child = spawn('python3', ['-c', 'import sys;sys.stdin.buffer.readline()'], options);
    child.stdout.resume();
    child.stdout = new PassThrough({ highWaterMark: wire.length * 2 });
    child.stdout.end(wire);
    assert.ok(child.stdout.readableLength > 65536);
    return child;
  } });
  const chunks = [];
  for await (const chunk of opened.body) { assert.ok(chunk.length <= 65536); chunks.push(chunk); }
  assert.deepEqual(Buffer.concat(chunks), payload);
});

test('binding is rechecked after describe/HEAD preparation and before the final body tail', async () => {
  const metadata = { root: '/tmp', path: 'file.bin', terminal_id: 't1', assetVersion: `stat-v1:${'a'.repeat(64)}`, bytes: 3, sampleKind: 'binary' };
  const request = { operation: 'files.describe', machine: 'remote', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin' };
  let profile = { id: 'remote', label: 'Fixture', target: 'fixture', session: 'fixture' };
  let changeDuringPrepare = false;
  const bridge = createHerdrBridge({ session: 'fixture', execute: async () => ({ stdout: JSON.stringify([profile]) }), spawnProcess: (_binary, _argv, options) => {
    const script = `import sys,json;p=json.loads(sys.stdin.buffer.readline());n=0 if p['headOnly'] or p['request']['operation']=='files.describe' else ${metadata.bytes};sys.stdout.buffer.write((json.dumps({'metadata':${JSON.stringify(metadata)},'length':n})+'\\n').encode());sys.stdout.buffer.write(b'abc'[:n]);sys.stdout.buffer.write(b'{"complete":true}\\n');sys.stdout.flush()`;
    const child = spawn('python3', ['-c', script], options);
    if (changeDuringPrepare) profile = { ...profile, target: 'changed' };
    return child;
  } });
  changeDuringPrepare = true;
  await assert.rejects(bridge.describeAsset(request), { code: 'target_changed' });
  changeDuringPrepare = false; profile = { ...profile, target: 'fixture' };
  const { binding } = await bridge.describeAsset(request);
  const raw = { ...request, operation: 'files.raw', expectedAssetVersion: metadata.assetVersion };
  changeDuringPrepare = true;
  await assert.rejects(bridge.openAsset(raw, { expectedBinding: binding, headOnly: true }), { code: 'target_changed' });
  profile = { ...profile, target: 'fixture' };
  await assert.rejects(bridge.openAsset(raw, { expectedBinding: binding }), { code: 'target_changed' });
  changeDuringPrepare = false; profile = { ...profile, target: 'fixture' };
  const opened = await bridge.openAsset(raw, { expectedBinding: binding });
  profile = { ...profile, session: 'changed' };
  let delivered = 0;
  await assert.rejects((async () => { for await (const chunk of opened.body) delivered += chunk.length; })(), { code: 'target_changed' });
  assert.equal(delivered, 0, 'no final tail escapes a failed binding check');
});

test('a real backpressured helper has an absolute lifetime even when stdin never closes', async () => {
  const f = await fixture();
  try {
    const file = await fs.open(path.join(f.root, 'file.bin'), 'w');
    await file.truncate(64 * 1024 * 1024);
    await file.close();
    const { metadata } = await f.bridge.describeAsset(f.describeRequest());
    const source = readFileSync(new URL('./host-helper.py', import.meta.url), 'utf8');
    const shortened = source.replace('asset_deadline_at = time.monotonic() + 3600', 'asset_deadline_at = time.monotonic() + 0.2');
    assert.notEqual(shortened, source);
    const child = f.spawnOwned('python3', ['-c', shortened], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const closed = new Promise((resolve) => child.once('close', (code, exitSignal) => resolve({ code, exitSignal })));
    child.stdin.write(JSON.stringify({ request: f.rawRequest(metadata), socketPath: f.socketPath, assetStream: true }) + '\n');
    await new Promise((resolve) => child.stdout.once('readable', resolve));
    let timer;
    const result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Absolute helper deadline did not fire')), 2000); })]).finally(() => clearTimeout(timer));
    assert.notEqual(result.code, 0);
    assert.equal(child.stdin.writableEnded, false, 'the cancellation pipe stayed open');
    child.stdin.destroy(); child.stdout.destroy();
  } finally { await f.close(); }
});

test('a real child exiting during asynchronous target validation cannot drain unread body bytes', async () => {
  const metadata = { root: '/tmp', path: 'file.bin', terminal_id: 't1', assetVersion: `stat-v1:${'a'.repeat(64)}`, bytes: 65536, sampleKind: 'binary' };
  const request = { operation: 'files.raw', machine: 'local', pane_id: 'w1:p1', terminal_id: 't1', expectedRoot: '/tmp', path: 'file.bin', expectedAssetVersion: metadata.assetVersion };
  let afterExit;
  const opened = await openHostAsset({ request, timeoutMs: 1000, validateTarget: async () => { await afterExit; }, spawnProcess: (_binary, _argv, options) => {
    const script = `import sys,json;sys.stdin.buffer.readline();sys.stdout.buffer.write((json.dumps({'metadata':${JSON.stringify(metadata)},'length':${metadata.bytes}})+'\\n').encode());sys.stdout.buffer.write(bytes(i%251 for i in range(${metadata.bytes})));sys.stdout.buffer.write(b'{"complete":true}\\n');sys.stdout.flush()`;
    const child = spawn('python3', ['-c', script], options);
    afterExit = new Promise((resolve) => child.once('exit', () => setImmediate(resolve)));
    return child;
  } });
  const actual = await bytes(opened);
  const expected = Buffer.alloc(metadata.bytes);
  for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
  assert.deepEqual(actual, expected);
});
