import { afterEach, expect, test } from 'bun:test';
import { HerdrTransport, PendingDeliveryStore } from './transport';
import { ProjectContextClient, confirmProjectDraft, projectDraftMutation, projectContextSchema, type ProjectEntryDraft, type ProjectContext } from './project-context-client';

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });
const hash = 'a'.repeat(64);
const revision = 'b'.repeat(64);
const connection = { server: 'https://context.example', token: 'fixture-device' };
const target = { machine: 'local', pane_id: 'w1:p1' };
function context(): ProjectContext {
  return { owner: { id: hash, machine: 'local', root: '/project', workspaceId: 'w1', paneId: 'w1:p1' }, revision, context: { notes: [{ id: 'note-1', body: 'Saved note', source: 'manual', createdAt: 1, updatedAt: 1, pinned: false }], todos: [], plans: [] } };
}
function fixture() {
  let raw: string | null = null;
  const storage = { kind: 'native' as const, async read() { return raw; }, async write(value: string) { raw = value; } };
  const store = new PendingDeliveryStore(() => storage);
  const transport = new HerdrTransport(connection, store);
  return { client: new ProjectContextClient(transport, target), store, raw: () => raw };
}
function draft(): ProjectEntryDraft {
  return { server: connection.server, owner: context().owner, kind: 'note', id: 'note-1', text: 'Phone edit', baseText: 'Saved note', revision };
}

test('project reads use the selected machine and pane with bearer auth and reject wrong owners', async () => {
  const f = fixture();
  let request: RequestInit | undefined;
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => { request = init; return Response.json(context()); }, savedFetch);
  expect(await f.client.read()).toEqual(context());
  expect(JSON.parse(String(request?.body))).toEqual({ request: { ...target, operation: 'context.read' } });
  expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer fixture-device');
  expect(await f.store.load(connection.server)).toBeNull();
  globalThis.fetch = Object.assign(async () => Response.json({ ...context(), owner: { ...context().owner, machine: 'wsl' } }), savedFetch);
  await expect(f.client.read()).rejects.toThrow('Invalid server response');
});

test('malformed or failed reads never replace context with an empty success', async () => {
  const f = fixture();
  globalThis.fetch = Object.assign(async () => Response.json({ context: { notes: [], todos: [], plans: [] } }), savedFetch);
  await expect(f.client.read()).rejects.toThrow('Invalid server response');
  globalThis.fetch = Object.assign(async () => Response.json({ error: { code: 'project_root_unavailable', message: 'Root unavailable' } }, { status: 409 }), savedFetch);
  await expect(f.client.read()).rejects.toThrow('Root unavailable');
});

test('uncertain project writes persist only request metadata and block a second dispatch', async () => {
  const f = fixture();
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls += 1; throw new Error('Disconnected'); }, savedFetch);
  await expect(f.client.mutate(projectDraftMutation(draft(), connection.server, context().owner, false))).rejects.toThrow('Connection failed');
  expect(await f.store.load(connection.server)).toMatchObject({ machine: 'local', paneId: 'w1:p1', method: 'context.note.update' });
  expect(f.raw()).not.toContain('Phone edit');
  expect(f.raw()).not.toContain('fixture-device');
  const later = await f.client.mutate({ operation: 'context.todo.create', expectedOwner: hash, expectedRevision: revision, text: 'Later' });
  expect(later.outcome.kind).toBe('pending');
  expect(calls).toBe(1);
});

test('wrong-project mutation responses remain unconfirmed for delivery inspection', async () => {
  const f = fixture();
  globalThis.fetch = Object.assign(async () => Response.json({ ...context(), owner: { ...context().owner, id: 'c'.repeat(64) } }), savedFetch);
  await expect(f.client.mutate({ operation: 'context.note.update', expectedOwner: hash, expectedRevision: revision, noteId: 'note-1', body: 'Saved note' })).rejects.toThrow('Invalid server response');
  expect(await f.store.load(connection.server)).toMatchObject({ method: 'context.note.update' });
});

test('saving a draft pins its revision and preserves edits made while the request is in flight', () => {
  const sent = draft();
  const request = projectDraftMutation(sent, connection.server, context().owner, false);
  expect(request).toEqual({ operation: 'context.note.update', expectedOwner: hash, expectedRevision: revision, noteId: 'note-1', body: 'Phone edit' });
  expect(() => projectDraftMutation(sent, 'https://other.example', context().owner, false)).toThrow('project changed');
  expect(() => projectDraftMutation(sent, connection.server, { ...context().owner, id: 'c'.repeat(64) }, false)).toThrow('project changed');
  const response = context();
  response.context.notes[0].body = 'Phone edit';
  response.revision = 'd'.repeat(64);
  const result = confirmProjectDraft({ ...sent, text: 'More typing' }, sent, response);
  expect(result.text).toBe('More typing');
  expect(result.baseText).toBe('Phone edit');
  expect(result.revision).toBe(response.revision);
  const branchOwner = { ...context().owner, paneId: 'w2:p1', workspaceId: 'w2' };
  expect(projectDraftMutation(sent, connection.server, branchOwner, false).expectedOwner).toBe(hash);
});

test('plan reads parse exact raw markdown and never accept private storage paths', async () => {
  const value = { ...context(), plan: { id: 'plan-1', file: 'personal.md', title: 'Plan', createdAt: 1, body: 'Body', raw: '# Plan\n\nBody', source: 'personal' } };
  expect(projectContextSchema.safeParse(value).success).toBe(true);
  expect(projectContextSchema.safeParse({ ...value, plan: { ...value.plan, path: '/private/state/path' } }).success).toBe(false);
  const f = fixture();
  globalThis.fetch = Object.assign(async () => Response.json(value), savedFetch);
  await expect(f.client.readPlan('different-plan', hash)).rejects.toThrow('Invalid server response');
});
