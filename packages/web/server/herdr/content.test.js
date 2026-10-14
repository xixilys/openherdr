import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readPaneFiles, readPaneGit } from './content.js';

test('file previews stay in the authoritative pane cwd, including symlinks', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'openherdr-files-'));
  const root = path.join(fixture, 'repo');
  await fs.mkdir(root); await fs.writeFile(path.join(root, 'hello.txt'), 'hello phone');
  await fs.writeFile(path.join(fixture, 'private.txt'), 'outside');
  await fs.symlink(path.join(fixture, 'private.txt'), path.join(root, 'escape'));
  const bridge = { rpc: async () => ({ result: { snapshot: { panes: [{ pane_id: 'w1:p1', cwd: root }] } } }) };
  try {
    const req = { machine: 'local', pane_id: 'w1:p1', path: 'hello.txt', mode: 'read' };
    assert.equal((await readPaneFiles(bridge, req)).content, 'hello phone');
    for (const name of ['../private.txt', '/etc/passwd', 'escape']) {
      await assert.rejects(readPaneFiles(bridge, { ...req, path: name }), (error) => error.code === 'path_forbidden');
    }
    await assert.rejects(readPaneFiles(bridge, { ...req, machine: 'other' }), (error) => error.code === 'remote_files_unavailable');
    await assert.rejects(readPaneFiles(bridge, { ...req, pane_id: 'w2:p1' }), (error) => error.code === 'pane_not_found');
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
});

test('Git review shows a real worktree change without changing the repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openherdr-git-'));
  const run = promisify(execFile);
  try {
    await run('git', ['init', '-q', root]);
    await fs.writeFile(path.join(root, 'hello.txt'), 'before\n');
    await run('git', ['-C', root, 'add', 'hello.txt']);
    await run('git', ['-C', root, '-c', 'user.name=OpenHerdr Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture']);
    await fs.writeFile(path.join(root, 'hello.txt'), 'after\n');
    const bridge = { rpc: async () => ({ result: { snapshot: { panes: [{ pane_id: 'w1:p1', cwd: root }] } } }) };
    const request = { machine: 'local', pane_id: 'w1:p1', mode: 'diff' };
    const result = await readPaneGit(bridge, request);
    assert.match(result.diff, /-before\n\+after/);
    assert.equal(await fs.readFile(path.join(root, 'hello.txt'), 'utf8'), 'after\n');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
