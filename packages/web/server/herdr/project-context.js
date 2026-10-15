import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './contracts.js';
import { createProjectContextRuntime } from '../lib/project-context/runtime.js';

const identifier = z.string().min(1).max(160);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const target = { machine: identifier.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/), pane_id: identifier.regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/) };
const pinned = { expectedOwner: revision, expectedRevision: revision };
const nonblank = (max) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
const operation = (name, fields = {}) => z.strictObject({ ...target, operation: z.literal(name), ...fields });
const requestSchema = z.discriminatedUnion('operation', [
  operation('context.read'),
  operation('context.plan.read', { planId: identifier }),
  operation('context.note.create', { ...pinned, body: nonblank(3000) }),
  operation('context.note.update', { ...pinned, noteId: identifier, body: nonblank(3000) }),
  operation('context.note.delete', { ...pinned, noteId: identifier }),
  operation('context.todo.create', { ...pinned, text: nonblank(1000) }),
  operation('context.todo.update', { ...pinned, todoId: identifier, text: nonblank(1000).optional(), completed: z.boolean().optional() }).refine((value) => value.text !== undefined || value.completed !== undefined),
  operation('context.todo.delete', { ...pinned, todoId: identifier }),
  operation('context.todo.reorder', { ...pinned, todoIds: z.array(identifier).max(500) }),
  operation('context.plan.create', { ...pinned, title: nonblank(160), body: z.string().max(199800).default('') }),
  operation('context.plan.update', { ...pinned, planId: identifier, raw: z.string().max(200000) }),
  operation('context.plan.delete', { ...pinned, planId: identifier }),
]);
const snapshotSchema = z.object({ result: z.object({ snapshot: z.object({
  workspaces: z.array(z.object({ workspace_id: identifier, worktree: z.object({ repo_root: z.string().min(1), checkout_path: z.string().min(1) }).nullable().optional() })),
  panes: z.array(z.object({ pane_id: identifier, workspace_id: identifier })),
}) }) });
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const locks = new Map();

function refusal(status, code, message) {
  const error = new ApiError(status, code, message);
  error.confirmedNoEffect = true;
  return error;
}
export function parseProjectContextRequest(body) {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw refusal(400, 'invalid_project_context_request', 'Invalid project context request');
  return parsed.data;
}
export const isProjectContextMutation = (request) => !['context.read', 'context.plan.read'].includes(request.operation);

async function withOwnerLock(key, action) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const pending = previous.then(() => next);
  locks.set(key, pending);
  await previous;
  try { return await action(); }
  finally { release(); if (locks.get(key) === pending) locks.delete(key); }
}

// Personal plans use the upstream runtime, with atomic replacement for markdown too.
const personalFiles = { ...fs, async writeFile(filename, content, options) {
  if (!filename.endsWith('.md')) return fs.writeFile(filename, content, options);
  const temporary = `${filename}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, options);
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
} };

export function createHerdrProjectContext({ bridge, stateDir, resolveWorkspaceRoot }) {
  const storage = path.resolve(stateDir, 'project-context');
  const runtime = createProjectContextRuntime({ fsPromises: personalFiles, path, projectsDirPath: storage, createId: randomUUID });

  async function ownerFor(request) {
    const parsed = snapshotSchema.safeParse(await bridge.rpc(request.machine, 'session.snapshot', {}));
    if (!parsed.success) throw refusal(502, 'invalid_project_snapshot', 'The project workspace could not be identified');
    const snapshot = parsed.data.result.snapshot;
    const pane = snapshot.panes.find((entry) => entry.pane_id === request.pane_id);
    const workspace = pane && snapshot.workspaces.find((entry) => entry.workspace_id === pane.workspace_id);
    if (!pane || !workspace || !request.pane_id.startsWith(`${workspace.workspace_id}:`)) throw refusal(404, 'project_target_missing', 'The selected project pane no longer exists');
    const candidate = workspace.worktree?.repo_root ?? await resolveWorkspaceRoot?.({ machine: request.machine, workspaceId: workspace.workspace_id });
    if (!candidate || !path.posix.isAbsolute(candidate) || candidate.includes('\0')) throw refusal(409, 'project_root_unavailable', 'This workspace has no verified project root');
    // Herdr resolves repo_root on its own host. Never resolve a remote path on this server.
    let root = path.posix.normalize(candidate);
    if (request.machine === 'local') {
      try {
        root = await fs.realpath(candidate);
        if (!(await fs.stat(root)).isDirectory()) throw new Error('Project root is not a directory');
      } catch { throw refusal(409, 'project_root_unavailable', 'The verified project directory is unavailable'); }
    }
    return { id: hash([request.machine, root]), machine: request.machine, root, workspaceId: workspace.workspace_id, paneId: pane.pane_id };
  }

  async function read(owner) {
    const context = await runtime.readContext(owner.id);
    const plans = await Promise.all(context.plans.map((entry) => runtime.readPlan(owner.id, entry.id)));
    if (plans.some((entry) => !entry)) throw new ApiError(500, 'project_plan_missing', 'A saved plan is missing. Existing project data was kept');
    const publicContext = { notes: context.notes, todos: context.todos, plans: context.plans };
    return { owner, context: publicContext, revision: hash([publicContext, plans.map((entry) => entry.raw)]) };
  }

  function publicPlan(plan) {
    const { path: _privateStoragePath, ...entry } = plan;
    return entry;
  }

  async function mutate(owner, request, current) {
    const id = owner.id;
    switch (request.operation) {
      case 'context.note.create': return runtime.createNote(id, { body: request.body, source: 'manual' });
      case 'context.note.update': return runtime.updateNote(id, request.noteId, { body: request.body });
      case 'context.note.delete': {
        if (!current.context.notes.some((note) => note.id === request.noteId)) throw refusal(404, 'project_entry_missing', 'This note no longer exists');
        return runtime.deleteNote(id, request.noteId);
      }
      case 'context.todo.create': return runtime.createTodo(id, { text: request.text });
      case 'context.todo.update': return runtime.updateTodo(id, request.todoId, { text: request.text, completed: request.completed });
      case 'context.todo.delete': return runtime.deleteTodo(id, request.todoId);
      case 'context.todo.reorder': {
        const todos = current.context.todos;
        if (request.todoIds.length !== todos.length || new Set(request.todoIds).size !== todos.length || request.todoIds.some((id) => !todos.some((todo) => todo.id === id))) throw refusal(409, 'project_todos_changed', 'The todo list changed. Reload before reordering');
        return runtime.saveTodos(id, request.todoIds.map((id) => todos.find((todo) => todo.id === id)));
      }
      case 'context.plan.create': return runtime.createPlan(id, { title: request.title, body: request.body });
      case 'context.plan.update': return runtime.updatePlan(id, request.planId, { raw: request.raw });
      case 'context.plan.delete': {
        if (!current.context.plans.some((plan) => plan.id === request.planId)) throw refusal(404, 'project_entry_missing', 'This plan no longer exists');
        return runtime.deletePlan(id, request.planId);
      }
      default: throw refusal(400, 'invalid_project_context_request', 'Invalid project context operation');
    }
  }

  return { async execute(body) {
    const request = parseProjectContextRequest(body);
    const owner = await ownerFor(request);
    return withOwnerLock(JSON.stringify([storage, owner.id]), async () => {
      const latestOwner = await ownerFor(request);
      if (latestOwner.id !== owner.id || latestOwner.workspaceId !== owner.workspaceId) throw refusal(409, 'project_owner_changed', 'The project changed. Your edits were kept');
      const current = await read(latestOwner);
      if (request.operation === 'context.read') return current;
      if (request.operation === 'context.plan.read') {
        const plan = await runtime.readPlan(owner.id, request.planId);
        if (!plan) throw refusal(404, 'project_entry_missing', 'This plan no longer exists');
        return { ...current, plan: publicPlan(plan) };
      }
      if (request.expectedOwner !== owner.id) throw refusal(409, 'project_owner_changed', 'The project changed. Your edits were kept');
      if (request.expectedRevision !== current.revision) throw refusal(409, 'project_context_changed', 'Project notes, todos or plans changed. Reload before saving');
      let result;
      try { result = await mutate(owner, request, current); }
      catch (error) {
        if (error.status === 400 || error.status === 404 || error.statusCode === 400 || error.statusCode === 404) throw refusal(error.status ?? error.statusCode, 'project_entry_invalid', error.message);
        throw error;
      }
      if (!result) throw refusal(404, 'project_entry_missing', 'This entry no longer exists');
      const response = await read(latestOwner);
      const planId = request.operation === 'context.plan.create' ? result.plan.id : request.operation === 'context.plan.update' ? request.planId : null;
      return planId ? { ...response, plan: publicPlan(await runtime.readPlan(owner.id, planId)) } : response;
    });
  } };
}
