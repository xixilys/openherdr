import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHerdrProjectContext, parseProjectContextRequest } from './project-context.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openherdr-context-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project');
  await fs.mkdir(root);
  const workspaces = [
    { workspace_id: 'w1', worktree: { repo_root: root, checkout_path: root } },
    { workspace_id: 'w2', worktree: { repo_root: root, checkout_path: root + '-branch' } },
    { workspace_id: 'w3' },
  ];
  const panes = workspaces.map((workspace) => ({ workspace_id: workspace.workspace_id, pane_id: `${workspace.workspace_id}:p1`, cwd: root + '/unrelated-subdirectory', foreground_cwd: '/unrelated' }));
  const bridge = { async rpc() { return { result: { snapshot: { workspaces, panes } } }; } };
  const options = { bridge, stateDir: path.join(directory, 'state') };
  return { directory, root: await fs.realpath(root), workspaces, panes, options, service: createHerdrProjectContext(options) };
}
const read = (service, machine = 'local', pane_id = 'w1:p1') => service.execute({ machine, pane_id, operation: 'context.read' });
const write = (service, current, operation, fields = {}) => service.execute({ machine: current.owner.machine, pane_id: current.owner.paneId, operation, expectedOwner: current.owner.id, expectedRevision: current.revision, ...fields });

test('notes, todos and raw personal plans survive restart and delete individually', async (t) => {
  const f = await fixture(t);
  let current = await read(f.service);
  assert.deepEqual(current.context, { notes: [], todos: [], plans: [] });
  current = await write(f.service, current, 'context.note.create', { body: 'A project note' });
  const noteId = current.context.notes[0].id;
  current = await write(f.service, current, 'context.todo.create', { text: 'Check the result' });
  const todoId = current.context.todos[0].id;
  current = await write(f.service, current, 'context.plan.create', { title: 'First plan', body: 'Initial body' });
  const planId = current.plan.id;
  const raw = '# Revised title\n\n  exact spacing\n';
  current = await write(f.service, current, 'context.plan.update', { planId, raw });
  assert.equal(current.plan.raw, raw);
  assert.equal(current.plan.path, undefined);
  assert.equal(current.context.plans[0].title, 'Revised title');
  const restarted = createHerdrProjectContext(f.options);
  const again = await read(restarted);
  assert.deepEqual(again, { owner: current.owner, context: current.context, revision: current.revision });
  const plan = await restarted.execute({ machine: 'local', pane_id: 'w1:p1', operation: 'context.plan.read', planId });
  assert.equal(plan.plan.raw, raw);
  current = await write(restarted, again, 'context.note.update', { noteId, body: 'Updated note' });
  current = await write(restarted, current, 'context.todo.update', { todoId, completed: true, text: 'Checked' });
  current = await write(restarted, current, 'context.note.delete', { noteId });
  current = await write(restarted, current, 'context.todo.delete', { todoId });
  current = await write(restarted, current, 'context.plan.delete', { planId });
  assert.deepEqual(current.context, { notes: [], todos: [], plans: [] });
});

test('native worktrees share project context while equal paths on different machines stay isolated', async (t) => {
  const f = await fixture(t);
  const original = await read(f.service);
  const saved = await write(f.service, original, 'context.note.create', { body: 'Shared across worktrees' });
  const branch = await read(f.service, 'local', 'w2:p1');
  assert.equal(branch.owner.id, saved.owner.id);
  assert.equal(branch.owner.root, f.root);
  assert.deepEqual(branch.context, saved.context);
  const remote = await read(f.service, 'wsl');
  assert.notEqual(remote.owner.id, saved.owner.id);
  assert.deepEqual(remote.context.notes, []);
});

test('stale and concurrent saves refuse overwrites, including across service instances', async (t) => {
  const f = await fixture(t);
  const original = await read(f.service);
  const second = createHerdrProjectContext(f.options);
  const results = await Promise.allSettled([
    write(f.service, original, 'context.note.create', { body: 'First writer' }),
    write(second, original, 'context.todo.create', { text: 'Second writer' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.equal(failure.reason.code, 'project_context_changed');
  assert.equal(failure.reason.confirmedNoEffect, true);
  await assert.rejects(write(f.service, original, 'context.note.create', { body: 'Stale' }), { code: 'project_context_changed' });
  const latest = await read(f.service);
  assert.equal(latest.context.notes.length + latest.context.todos.length, 1);
});

test('unregistered workspace fails explicitly and trusted roots do not follow pane cwd', async (t) => {
  const f = await fixture(t);
  await assert.rejects(read(f.service, 'local', 'w3:p1'), { code: 'project_root_unavailable' });
  const registered = createHerdrProjectContext({ ...f.options, resolveWorkspaceRoot: async ({ machine, workspaceId }) => machine === 'local' && workspaceId === 'w3' ? f.root : null });
  const current = await read(registered, 'local', 'w3:p1');
  assert.equal(current.owner.root, f.root);
  f.panes[2].cwd = '/elsewhere';
  const updated = await write(registered, current, 'context.note.create', { body: 'Pinned project' });
  assert.equal(updated.owner.id, current.owner.id);
  f.workspaces[2].worktree = { repo_root: f.directory, checkout_path: f.directory };
  await assert.rejects(write(registered, updated, 'context.note.create', { body: 'Wrong project' }), { code: 'project_owner_changed' });
});

test('todo reorder must preserve exactly the existing items', async (t) => {
  const f = await fixture(t);
  let current = await read(f.service);
  current = await write(f.service, current, 'context.todo.create', { text: 'First' });
  current = await write(f.service, current, 'context.todo.create', { text: 'Second' });
  const ids = current.context.todos.map((entry) => entry.id);
  await assert.rejects(write(f.service, current, 'context.todo.reorder', { todoIds: [ids[0], ids[0]] }), { code: 'project_todos_changed' });
  current = await write(f.service, current, 'context.todo.reorder', { todoIds: ids.toReversed() });
  assert.deepEqual(current.context.todos.map((entry) => entry.id), ids.toReversed());
});

test('a vanished directory or a file cannot become a local project root', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'file');
  await fs.writeFile(file, 'not a directory');
  for (const root of [file, path.join(f.directory, 'missing')]) {
    f.workspaces[0].worktree.repo_root = root;
    await assert.rejects(read(f.service), { code: 'project_root_unavailable', confirmedNoEffect: true });
  }
});

test('malformed persistence is an error and request paths cannot select storage', async (t) => {
  const f = await fixture(t);
  const current = await read(f.service);
  const storage = path.join(f.options.stateDir, 'project-context', current.owner.id);
  await fs.mkdir(storage, { recursive: true });
  await fs.writeFile(path.join(storage, 'context.json'), '{malformed');
  await assert.rejects(read(f.service), /malformed/);
  assert.throws(() => parseProjectContextRequest({ machine: 'local', pane_id: 'w1:p1', operation: 'context.read', root: '/chosen' }), { code: 'invalid_project_context_request' });
  assert.throws(() => parseProjectContextRequest({ machine: 'local', pane_id: 'w1:p1', operation: 'context.note.create', body: 'missing pins' }), { code: 'invalid_project_context_request' });
});
