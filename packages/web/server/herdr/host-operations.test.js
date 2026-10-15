import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHostRequest, executeHostOperation, isHostMutation } from './host-operations.js';
import { runHostOperation } from './host-transport.js';
import { parseRpc } from './contracts.js';

const exec = promisify(execFile);
async function fixture() {
  const base = path.resolve('.tmp');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'host-test-'));
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const socketPath = path.join('/tmp', 'oh-host-' + path.basename(directory) + '.sock');
  let paneRoot = await fs.realpath(root);
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      const request = JSON.parse(data.toString());
      socket.end(JSON.stringify({ id: request.id, result: { snapshot: { panes: [{ pane_id: 'w1:p1', cwd: paneRoot }] } } }) + '\n');
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const bridge = { host: (request) => runHostOperation({ request, socketPath }) };
  const request = (operation, fields = {}) => executeHostOperation(bridge, { machine: 'local', pane_id: 'w1:p1', operation, ...fields });
  return { root: paneRoot, directory, bridge, socketPath, request, changeRoot: (value) => { paneRoot = value; }, close: async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('host request contracts reject selectors, traversal, missing pins, and unchecked worktree deletion', () => {
  const base = { machine: 'local', pane_id: 'w1:p1', operation: 'files.read' };
  for (const fields of [{ path: '../secret' }, { path: '/etc/passwd' }, { path: '.git/config' }, { path: '.GIT/config' }, { cwd: '/tmp' }, { socketPath: '/tmp/x' }, { operation: 'files.write', path: 'x', content: 'x' }, { machine: '-bad' }]) {
    assert.throws(() => parseHostRequest({ ...base, ...fields }), { code: 'invalid_host_request' });
  }
  assert.equal(isHostMutation(parseHostRequest(base)), false);
  assert.equal(isHostMutation(parseHostRequest({ ...base, operation: 'files.mkdir', path: 'dir', expectedRoot: '/tmp' })), true);
  const rpc = { machine: 'local', method: 'worktree.create', params: { workspace_id: 'w1', branch: 'feature' }, requestId: 'test-create' };
  assert.equal(parseRpc(rpc).method, 'worktree.create');
  assert.throws(() => parseRpc({ ...rpc, params: { ...rpc.params, cwd: '/tmp' } }), { code: 'invalid_params' });
  assert.throws(() => parseRpc({ ...rpc, method: 'worktree.remove', params: { workspace_id: 'w1', force: true } }), { code: 'invalid_params' });
});

test('files round-trip text and binary with conflict detection, root pins and atomic no-overwrite rename', async () => {
  const f = await fixture();
  try {
    const pin = { expectedRoot: f.root };
    const first = await f.request('files.write', { ...pin, path: 'hello.txt', content: 'Hello phone\n', expectedRevision: null });
    const read = await f.request('files.read', { path: 'hello.txt' });
    assert.equal(read.content, 'Hello phone\n');
    assert.equal(read.revision, first.revision);
    await fs.writeFile(path.join(f.root, 'hello.txt'), 'External change\n');
    await assert.rejects(f.request('files.write', { ...pin, path: 'hello.txt', content: 'Lost edit', expectedRevision: first.revision }), { code: 'file_conflict', confirmedNoEffect: true });
    assert.equal(await fs.readFile(path.join(f.root, 'hello.txt'), 'utf8'), 'External change\n');
    const current = await f.request('files.read', { path: 'hello.txt' });
    await f.request('files.write', { ...pin, path: 'occupied', content: 'Keep', expectedRevision: null });
    await assert.rejects(f.request('files.rename', { ...pin, path: 'hello.txt', newPath: 'occupied', expectedRevision: current.revision }), { code: 'path_exists' });
    assert.equal(await fs.readFile(path.join(f.root, 'occupied'), 'utf8'), 'Keep');
    await f.request('files.rename', { ...pin, path: 'hello.txt', newPath: 'renamed.txt', expectedRevision: current.revision });
    const upload = await f.request('files.upload', { ...pin, path: 'image.bin', base64: Buffer.from([0, 255, 4, 9]).toString('base64'), expectedRevision: null });
    assert.equal((await f.request('files.binary', { path: 'image.bin' })).dataUrl, 'data:application/octet-stream;base64,AP8ECQ==');
    assert.equal((await f.request('files.download', { path: 'image.bin' })).base64, 'AP8ECQ==');
    await assert.rejects(f.request('files.read', { path: 'image.bin' }), { code: 'binary_file' });
    await f.request('files.delete', { ...pin, path: 'image.bin', expectedRevision: upload.revision });
    await f.request('files.mkdir', { ...pin, path: 'directory' });
    assert.equal((await f.request('files.stat', { path: 'directory' })).isDirectory, true);
    const listing = await f.request('files.list');
    assert.equal(listing.entries.find((entry) => entry.name === 'directory').isDirectory, true);
    assert.match((await f.request('files.search', { query: 'External' })).results[0].preview[0], /External change/);
    await assert.rejects(f.request('files.mkdir', { expectedRoot: '/wrong', path: 'wrong' }), { code: 'target_changed', confirmedNoEffect: true });
    f.changeRoot(f.directory);
    await assert.rejects(f.request('files.write', { ...pin, path: 'hello.txt', content: 'Wrong target', expectedRevision: null }), { code: 'target_changed', confirmedNoEffect: true });
  } finally { await f.close(); }
});


test('concurrent file writes serialize expected revisions and preserve one completed edit', async () => {
  const f = await fixture();
  try {
    const base = { expectedRoot: f.root, path: 'concurrent.txt' };
    const first = await f.request('files.write', { ...base, content: 'initial', expectedRevision: null });
    const results = await Promise.allSettled(['one', 'two'].map((content) => f.request('files.write', { ...base, content, expectedRevision: first.revision })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'file_conflict');
    assert.ok(['one', 'two'].includes(await fs.readFile(path.join(f.root, 'concurrent.txt'), 'utf8')));
  } finally { await f.close(); }
});

test('file operations reject links and special files, preserve nonempty folders and bound downloads', async () => {
  const f = await fixture();
  try {
    const pin = { expectedRoot: f.root };
    await fs.writeFile(path.join(f.directory, 'private.txt'), 'private');
    await fs.symlink(path.join(f.directory, 'private.txt'), path.join(f.root, 'link'));
    await fs.symlink(f.directory, path.join(f.root, 'linked-folder'));
    for (const [operation, fields] of [['files.read', { path: 'link' }], ['files.write', { ...pin, path: 'linked-folder/private.txt', content: 'overwrite', expectedRevision: null }]]) {
      await assert.rejects(f.request(operation, fields), { code: 'path_forbidden' });
    }
    await fs.mkdir(path.join(f.root, 'folder'));
    await fs.writeFile(path.join(f.root, 'folder', 'keep'), 'Keep');
    await assert.rejects(f.request('files.delete', { ...pin, path: 'folder', expectedRevision: null }), { code: 'directory_not_empty' });
    assert.equal(await fs.readFile(path.join(f.root, 'folder', 'keep'), 'utf8'), 'Keep');
    await fs.writeFile(path.join(f.root, 'huge'), Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(f.request('files.download', { path: 'huge' }), { code: 'file_too_large' });
    await exec('mkfifo', [path.join(f.root, 'fifo')]);
    await assert.rejects(f.request('files.read', { path: 'fifo' }), { code: 'not_file' });
    assert.equal(await fs.readFile(path.join(f.directory, 'private.txt'), 'utf8'), 'private');
  } finally { await f.close(); }
});

test('Git stage, unstage, commit, log and branches use a real owned repository and retain dirty checkout failures', async () => {
  const f = await fixture();
  const run = (args) => exec('git', ['-C', f.root, ...args]);
  try {
    await run(['init', '-q', '-b', 'main']);
    await run(['config', 'user.name', 'OpenHerdr Test']);
    await run(['config', 'user.email', 'openherdr-test@localhost']);
    const pin = { expectedRoot: f.root };
    assert.equal((await f.request('git.log')).total, 0);
    await fs.writeFile(path.join(f.root, '-leading.txt'), 'initial\n');
    await fs.writeFile(path.join(f.root, 'odd\nfile.txt'), 'odd\n');
    let status = await f.request('git.status');
    assert.equal(status.files.length, 2);
    await f.request('git.stage', { ...pin, paths: ['-leading.txt', 'odd\nfile.txt'] });
    await f.request('git.unstage', { ...pin, paths: ['-leading.txt'] });
    status = await f.request('git.status');
    assert.equal(status.files.find((item) => item.path === '-leading.txt').index, '?');
    await f.request('git.stage', { ...pin, paths: ['-leading.txt'] });
    const first = await f.request('git.commit', { ...pin, message: 'Initial fixture' });
    assert.match(first.commit, /^[a-f0-9]{40,64}$/);
    assert.equal((await f.request('git.status')).isClean, true);
    const log = await f.request('git.log');
    assert.equal(log.total, 1);
    assert.equal(log.latest.message, 'Initial fixture');
    assert.equal(log.latest.filesChanged, 2);
    await f.request('git.branch', { ...pin, name: 'feature' });
    await f.request('git.checkout', { ...pin, branch: 'feature' });
    await fs.writeFile(path.join(f.root, '-leading.txt'), 'feature\n');
    await f.request('git.stage', { ...pin, paths: ['-leading.txt'] });
    await f.request('git.commit', { ...pin, message: 'Feature fixture' });
    const featureLog = await f.request('git.log');
    assert.equal(featureLog.total, 2);
    assert.equal(featureLog.latest.message, 'Feature fixture');
    assert.equal(featureLog.all[1].message, 'Initial fixture');
    await f.request('git.checkout', { ...pin, branch: 'main' });
    await fs.writeFile(path.join(f.root, '-leading.txt'), 'dirty main\n');
    assert.match((await f.request('git.diff', { path: '-leading.txt' })).diff, /dirty main/);
    await assert.rejects(f.request('git.checkout', { ...pin, branch: 'feature' }), { code: 'git_operation_failed' });
    assert.equal((await f.request('git.branches')).current, 'main');
    assert.equal(await fs.readFile(path.join(f.root, '-leading.txt'), 'utf8'), 'dirty main\n');
    const filterScript = path.join(f.directory, 'probe-clean.py');
    const filterMarker = path.join(f.directory, 'filter-executed');
    await fs.writeFile(filterScript, 'import sys\nfrom pathlib import Path\nPath(' + JSON.stringify(filterMarker) + ").write_text('executed')\nsys.stdout.buffer.write(sys.stdin.buffer.read())\n");
    await fs.writeFile(path.join(f.root, '.gitattributes'), '*.txt filter=probe\n');
    await run(['config', 'filter.probe.clean', "python3 '" + filterScript.replaceAll("'", "'\"'\"'") + "'"]);
    await run(['diff', '--no-textconv', '--no-ext-diff']);
    assert.equal(await fs.readFile(filterMarker, 'utf8'), 'executed');
    await fs.unlink(filterMarker);
    for (const [operation, fields] of [
      ['git.status', {}], ['git.diff', {}], ['git.log', {}], ['git.branches', {}],
      ['git.stage', { ...pin, paths: ['-leading.txt'] }],
      ['git.unstage', { ...pin, paths: ['-leading.txt'] }],
      ['git.commit', { ...pin, message: 'Must not execute' }],
      ['git.branch', { ...pin, name: 'must-not-create' }],
      ['git.checkout', { ...pin, branch: 'feature' }],
    ]) {
      await assert.rejects(f.request(operation, fields), { code: 'git_filters_require_trust', confirmedNoEffect: true });
      await assert.rejects(fs.stat(filterMarker), { code: 'ENOENT' });
    }
    await fs.mkdir(path.join(f.root, 'child'));
    f.changeRoot(path.join(f.root, 'child'));
    await assert.rejects(f.request('git.status'), { code: 'git_root_mismatch' });
  } finally { await f.close(); }
});

test('SSH host transport keeps all request bytes in stdin and rejects broken framing or duplicate JSON', async () => {
  const f = await fixture();
  try {
    const request = parseHostRequest({ machine: 'remote', pane_id: 'w1:p1', operation: 'files.read', path: "quotes'\n--file" });
    let received;
    const spawnProcess = (binary, args, options) => {
      assert.equal(binary, 'ssh');
      assert.deepEqual(args.slice(0, 8), ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'fixture@host', args[7]]);
      assert.equal(args.at(-1).includes(request.path), false);
      received = args;
      return spawn('python3', ['-c', "import sys,json; p=json.loads(sys.stdin.readline()); print(json.dumps({'result': {'root':'/remote','path':p['request']['path'],'content':'remote','bytes':6,'revision':'a'*64}}))"], options);
    };
    const result = await runHostOperation({ request, profile: { target: 'fixture@host', session: 'fixture' }, spawnProcess });
    assert.equal(result.path, request.path);
    assert.ok(received.at(-1).startsWith("python3 -c '"));
    for (const output of ['{', '{}\n{}']) {
      const broken = () => spawn('python3', ['-c', 'import sys; sys.stdin.read(); sys.stdout.write(' + JSON.stringify(output) + ')'], { stdio: ['pipe', 'pipe', 'pipe'] });
      await assert.rejects(runHostOperation({ request, profile: { target: 'fixture@host', session: 'fixture' }, spawnProcess: broken }), { code: 'invalid_host_response', confirmedNoEffect: false });
    }
    const incompatible = () => spawn('python3', ['-c', 'import sys; sys.stdin.read(); sys.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
    await assert.rejects(runHostOperation({ request, profile: { target: 'fixture@host', session: 'fixture' }, spawnProcess: incompatible }), { code: 'remote_python_unavailable', confirmedNoEffect: true });
  } finally { await f.close(); }
});

test('Git rejects a .git file that redirects index writes to an unrelated repository', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.directory, 'outside-repo');
    await fs.mkdir(outside);
    await exec('git', ['init', '-q', '-b', 'main', outside]);
    await fs.writeFile(path.join(f.root, '.git'), 'gitdir: ' + path.join(outside, '.git') + '\n');
    await fs.writeFile(path.join(f.root, 'selected.txt'), 'selected data\n');
    await assert.rejects(f.request('git.stage', { expectedRoot: f.root, paths: ['selected.txt'] }), { code: 'git_metadata_mismatch', confirmedNoEffect: true });
    await assert.rejects(fs.stat(path.join(outside, '.git', 'index')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('file mutations refuse a pinned parent moved outside the root during revision checking', async () => {
  const f = await fixture();
  try {
    const helper = new URL('./host-helper.py', import.meta.url).pathname;
    const source = `import hashlib,json,os,sys
source=open(sys.argv[1]).read().split('\\ntry:\\n    main()')[0]
namespace={}
exec(compile(source,sys.argv[1],'exec'),namespace)
root=sys.argv[2]
outside=sys.argv[3]
operation=sys.argv[4]
original=namespace['expected_file']
triggered=False
def race(*args):
    global triggered
    result=original(*args)
    if not triggered:
        triggered=True
        os.rename(os.path.join(root,'folder'),outside)
        os.mkdir(os.path.join(root,'folder'))
        open(os.path.join(root,'folder','file.txt'),'w').write('before')
    return result
namespace['expected_file']=race
fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
try:
    namespace['files'](root,fd,{'operation':operation,'path':'folder/file.txt','newPath':'renamed.txt','content':'mobile-write','expectedRevision':hashlib.sha256(b'before').hexdigest()})
    code='unexpected_success'
except namespace['Failure'] as error:
    code=error.code
finally:
    os.close(fd)
print(json.dumps({'code':code,'inside':open(os.path.join(root,'folder','file.txt')).read(),'outside':open(os.path.join(outside,'file.txt')).read()}))`;
    for (const operation of ['files.write', 'files.rename', 'files.delete']) {
      await fs.mkdir(path.join(f.root, 'folder'));
      await fs.writeFile(path.join(f.root, 'folder', 'file.txt'), 'before');
      const { stdout } = await exec('python3', ['-c', source, helper, f.root, path.join(f.directory, 'moved-parent-' + operation), operation]);
      assert.deepEqual(JSON.parse(stdout), { code: 'directory_changed', inside: 'before', outside: 'before' });
      await fs.rm(path.join(f.root, 'folder'), { recursive: true });
    }
  } finally { await f.close(); }
});

test('Git accepts a registered linked worktree and refuses a broken backlink', async () => {
  const f = await fixture();
  try {
    const run = (args) => exec('git', ['-C', f.root, ...args]);
    await run(['init', '-q', '-b', 'main']);
    await run(['config', 'user.name', 'OpenHerdr Test']);
    await run(['config', 'user.email', 'openherdr-test@localhost']);
    await fs.writeFile(path.join(f.root, 'tracked.txt'), 'source\n');
    await run(['add', '--', 'tracked.txt']);
    await run(['commit', '-qm', 'Source fixture']);
    const linked = path.join(f.directory, 'linked');
    await run(['worktree', 'add', '-q', '-b', 'linked-test', linked]);
    f.changeRoot(linked);
    assert.equal((await f.request('git.status')).current, 'linked-test');
    await fs.writeFile(path.join(linked, 'tracked.txt'), 'linked\n');
    await f.request('git.stage', { expectedRoot: linked, paths: ['tracked.txt'] });
    assert.match((await f.request('git.diff', { staged: true })).diff, /linked/);
    assert.ok((await f.request('git.commit', { expectedRoot: linked, message: 'Linked fixture' })).commit);
    const { stdout } = await exec('git', ['-C', linked, 'rev-parse', '--absolute-git-dir']);
    await fs.writeFile(path.join(stdout.trim(), 'gitdir'), path.join(f.directory, 'unrelated', '.git') + '\n');
    await assert.rejects(f.request('git.status'), { code: 'git_metadata_mismatch', confirmedNoEffect: true });
  } finally { await f.close(); }
});

test('Git refuses metadata index, object and ref symlinks that redirect writes outside the checkout', async () => {
  for (const kind of ['index', 'objects', 'refs']) {
    const f = await fixture();
    try {
      await exec('git', ['init', '-q', '-b', 'main', f.root]);
      await fs.writeFile(path.join(f.root, 'tracked.txt'), 'initial\n');
      await exec('git', ['-C', f.root, 'add', '--', 'tracked.txt']);
      await exec('git', ['-C', f.root, '-c', 'user.name=OpenHerdr Test', '-c', 'user.email=openherdr-test@localhost', 'commit', '-qm', 'Metadata fixture']);
      await fs.writeFile(path.join(f.root, 'tracked.txt'), 'modified\n');
      const metadata = path.join(f.root, '.git', kind);
      const outside = path.join(f.directory, 'outside-' + kind);
      await fs.rename(metadata, outside);
      await fs.symlink(outside, metadata);
      const operation = kind === 'refs' ? 'git.branch' : 'git.stage';
      const fields = kind === 'refs' ? { name: 'must-not-create' } : { paths: ['tracked.txt'] };
      await assert.rejects(f.request(operation, { expectedRoot: f.root, ...fields }), { code: 'git_metadata_mismatch', confirmedNoEffect: true });
      if (kind === 'refs') await assert.rejects(fs.stat(path.join(outside, 'heads', 'must-not-create')), { code: 'ENOENT' });
    } finally { await f.close(); }
  }
});

test('terminating the host helper kills and reaps only its owned command group', async () => {
  const f = await fixture();
  const pidFile = path.join(f.directory, 'owned-command.pid');
  let child;
  try {
    const helper = new URL('./host-helper.py', import.meta.url).pathname;
    const source = `import sys
source=open(sys.argv[1]).read().split('\\ntry:\\n    main()')[0]
namespace={}
exec(compile(source,sys.argv[1],'exec'),namespace)
namespace['command']([sys.executable,'-c',"import os,sys,time; open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(20)",sys.argv[2]])`;
    child = spawn('python3', ['-c', source, helper, pidFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
    let pid;
    const deadline = Date.now() + 3000;
    while (!pid && Date.now() < deadline) {
      try { pid = Number(await fs.readFile(pidFile, 'utf8')); }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.ok(pid > 0, 'owned command reached its running state');
    child.kill('SIGTERM');
    assert.equal((await closed).code, 143);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await f.close();
  }
});
