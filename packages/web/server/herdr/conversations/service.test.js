import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OpenCode } from '@opencode/client';
import { createConversationService } from './service.js';
import { conversationActionRequest } from './contracts.js';
import { loopbackEndpoint } from './runtime.js';

async function fixture(t, options = {}) {
  const base = path.resolve('.tmp'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'conversation-driver-test-'));
  let pane = { pane_id: 'w1:p1', terminal_id: 'term-owned', workspace_id: 'w1', tab_id: 'w1:t1', cwd: root, agent: 'shell' };
  const requests = [], sessions = new Map(), runtimeRequests = [];
  let sequence = 0, failRead = false, dropPrompt = false, afterPrompt, eventValues = [], otherPanes = [];
  const session = (id, metadata = {}) => ({ id, location: { directory: root }, metadata, time: { created: sequence, updated: sequence }, title: id });
  const model = { id: 'model-a', modelID: 'model-a', providerID: 'provider-a', name: 'Model', enabled: true, variants: [{ id: 'high', headers: { secret: 'variant-secret' }, body: { token: 'hidden' } }], capabilities: { input: { image: true } }, limit: { context: 1234 }, cost: [], status: 'active', headers: { authorization: 'secret' }, settings: { token: 'secret' }, body: { secret: 'secret' } };
  const agent = { id: 'build', name: 'Build', hidden: false, mode: 'primary', request: { apiKey: 'secret' }, system: 'private' };
  let pendingPermissions = [], pendingForms = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init) => {
    const parsed = new URL(url); const pathname = parsed.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ pathname, query: parsed.searchParams, method: init.method, body, signal: init.signal });
    if (pathname === '/api/model') return json({ location: { directory: root }, data: [model] });
    if (pathname === '/api/agent') return json({ location: { directory: root }, data: [agent] });
    if (pathname === '/api/session/active') return json({ data: {} });
    if (pathname === '/api/event') return new Response(eventValues.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    if (pathname === '/api/session' && init.method === 'POST') {
      const next = session(`ses_owned_${++sequence}`, body.metadata); sessions.set(next.id, next); return json({ data: next });
    }
    const [, , , id, operation] = pathname.split('/');
    const current = sessions.get(id);
    if (!current) return json({ _tag: 'SessionNotFoundError', message: 'Unavailable' }, 404);
    if (!operation) {
      if (init.method === 'DELETE') { sessions.delete(id); return new Response(null, { status: 204 }); }
      if (init.method === 'PATCH') { Object.assign(current, body); return new Response(null, { status: 204 }); }
      return json({ data: current });
    }
    if (operation === 'message') {
      if (failRead) return json({ _tag: 'UnknownError', message: 'read failed' }, 500);
      return json({ data: [{ id: 'msg_real', type: 'assistant', time: { created: 12 }, agent: 'build', model: { id: 'model-a', providerID: 'provider-a' }, content: [{ type: 'text', text: 'Actual content' }, { type: 'tool', id: 'tool-real', name: 'read', time: { created: 13 }, state: { status: 'completed', output: 'file bytes' } }] }], cursor: { previous: 'cursor-upstream', next: null } });
    }
    if (operation === 'prompt') {
      afterPrompt?.();
      if (dropPrompt) throw new TypeError('Disconnected after dispatch');
      return json({ data: { id: 'msg_enqueued', sessionID: id, type: 'user', time: { created: 20 }, payload: { text: body.text, files: body.files }, delivery: 'queue' } });
    }
    if (operation === 'permission' && init.method === 'GET') return json({ data: pendingPermissions });
    if (operation === 'form' && init.method === 'GET') return json({ data: pendingForms });
    if (operation === 'interrupt') return json({ status: 'interrupted' });
    if (operation === 'fork') { const next = session(`ses_fork_${++sequence}`, current.metadata); sessions.set(next.id, next); return json({ data: next }); }
    return new Response(null, { status: 204 });
  };
  const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:1234', fetch });
  const runtime = {
    get: async (request) => { runtimeRequests.push(request); return { client, kind: options.kind ?? 'registered', info: { pid: 1234, version: '2.0.27' } }; },
    capture: (signal) => ({ signal: signal ?? new AbortController().signal, release() {} }), close: async () => {},
  };
  const bridge = { rpc: async (machine, method, params) => { assert.equal(machine, 'local'); if (method === 'session.snapshot') return { result: { snapshot: { panes: [pane, ...otherPanes] } } }; assert.equal(method, 'pane.get'); assert.equal(params.pane_id, 'w1:p1'); return { result: { pane } }; } };
  const stateDir = path.join(root, 'state'); await fs.mkdir(stateDir, { mode: 0o700 });
  let service = await createConversationService({ bridge, stateDir, runtime });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return {
    root, requests, sessions, runtimeRequests, session, client,
    get service() { return service; },
    async restart() { await service.close(); service = await createConversationService({ bridge, stateDir, runtime }); },
    async target() { return (await service.resolve({ target: { machine: 'local', paneId: 'w1:p1' } })).target; },
    pane(update) { pane = { ...pane, ...update }; },
    failRead() { failRead = true; }, dropPrompt() { dropPrompt = true; }, afterPrompt(fn) { afterPrompt = fn; },
    permissions(value) { pendingPermissions = value; }, forms(value) { pendingForms = value; }, events(value) { eventValues = value; },
    otherPanes(value) { otherPanes = value; },
  };
}

test('owned session prompt uses actual SDK wire, inline attachments and genuine IDs', async (t) => {
  const f = await fixture(t); const target = await f.target();
  const created = await f.service.create({ target, title: 'Test' });
  assert.equal(created.access, 'owned');
  const files = [{ name: 'example.txt', uri: 'data:text/plain;base64,SGVsbG8=' }];
  const result = await f.service.act({ target, sessionId: created.session.id, action: 'prompt', input: { text: 'Hello', files, delivery: 'queue' } });
  assert.equal(result.result.id, 'msg_enqueued');
  const sent = f.requests.find((r) => r.pathname.endsWith('/prompt'));
  assert.deepEqual(sent.body, { text: 'Hello', files, delivery: 'queue' });
  assert.ok(sent.signal instanceof AbortSignal);
  const read = await f.service.read({ target, sessionId: created.session.id, cursor: 'opaque-cursor', limit: 12 });
  assert.equal(read.messages.data[0].content[1].id, 'tool-real');
  assert.equal(read.messages.data[0].content[0].id, undefined);
  assert.equal(read.messages.data[0].tokens, undefined);
  const history = f.requests.find((r) => r.pathname.endsWith('/message'));
  assert.equal(history.query.get('cursor'), 'opaque-cursor'); assert.equal(history.query.get('limit'), '12');
  assert.equal(history.query.has('order'), false);
  assert.equal(read.messages.cursor.previous, 'cursor-upstream');
});

test('native OpenCode session is read-only, foreign IDs and paths never open', async (t) => {
  const f = await fixture(t);
  f.sessions.set('ses_native', f.session('ses_native'));
  f.pane({ agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: 'ses_native' } });
  const resolved = await f.service.resolve({ target: { machine: 'local', paneId: 'w1:p1' } });
  assert.equal(resolved.nativeAccess, 'read-only');
  assert.equal((await f.service.read({ target: resolved.target, sessionId: 'ses_native' })).access, 'read-only');
  await assert.rejects(f.service.act({ target: resolved.target, sessionId: 'ses_native', action: 'abort', input: {} }), (e) => e.code === 'conversation_read_only' && e.confirmedNoEffect);
  await assert.rejects(f.service.read({ target: resolved.target, sessionId: 'ses_other' }), (e) => e.code === 'conversation_session_forbidden');
  f.pane({ agent_session: { source: 'opencode', agent: 'opencode', kind: 'path', value: '/arbitrary/private/file' } });
  const unavailable = await f.service.resolve({ target: { machine: 'local', paneId: 'w1:p1' } });
  assert.equal(unavailable.nativeAccess, 'path-reader-pending');
  assert.equal(unavailable.capabilities.nativeHistory, false);
});

test('stale pane identity rejects before mutation and after dispatch retains unknown', async (t) => {
  const f = await fixture(t); const target = await f.target(); const created = await f.service.create({ target });
  f.pane({ terminal_id: 'replacement' });
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'prompt', input: { text: 'No delivery' } }), (e) => e.code === 'conversation_target_changed' && e.confirmedNoEffect);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/prompt')).length, 0);
  f.pane({ terminal_id: 'term-owned' });
  f.afterPrompt(() => f.pane({ terminal_id: 'replacement' }));
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'prompt', input: { text: 'One delivery' } }), (e) => e.code === 'conversation_target_changed' && e.confirmedNoEffect === false);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/prompt')).length, 1);
});

test('transport failure never retries prompt or becomes empty successful history', async (t) => {
  const f = await fixture(t); const target = await f.target(); const created = await f.service.create({ target });
  f.dropPrompt();
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'prompt', input: { text: 'Once' } }), (e) => e.confirmedNoEffect === false);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/prompt')).length, 1);
  f.failRead(); await assert.rejects(f.service.read({ target, sessionId: created.session.id }));
});

test('catalog strips nested model headers and agent request secrets, rejects unknown model', async (t) => {
  const f = await fixture(t); const target = await f.target();
  const catalog = await f.service.catalog({ target });
  assert.equal(JSON.stringify(catalog).includes('secret'), false);
  assert.equal(catalog.authoritative, false);
  assert.equal(f.requests.find((r) => r.pathname === '/api/model').query.get('location[directory]'), f.root);
  const created = await f.service.create({ target });
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'model', input: { id: 'missing', providerID: 'provider-a' } }), (e) => e.confirmedNoEffect);
  await f.service.act({ target, sessionId: created.session.id, action: 'model', input: { id: 'model-a', providerID: 'provider-a', variant: 'high' } });
  assert.deepEqual(f.requests.find((r) => r.pathname.endsWith('/model') && r.method === 'POST').body, { model: { id: 'model-a', providerID: 'provider-a', variant: 'high' } });
});

test('permissions and forms require still-pending same-session records', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  const permission = { target, sessionId: session.id, action: 'permission', input: { requestId: 'perm_real', decision: 'once' } };
  await assert.rejects(f.service.act(permission), (e) => e.code === 'conversation_permission_settled' && e.confirmedNoEffect);
  f.permissions([{ id: 'perm_real', sessionID: session.id, action: 'read', resources: [f.root] }]);
  await f.service.act(permission);
  assert.deepEqual(f.requests.find((r) => r.pathname.endsWith('/perm_real/reply')).body, { decision: 'once' });
  f.forms([{ id: 'form_real', sessionID: session.id, title: 'Choice', fields: [] }]);
  await f.service.act({ target, sessionId: session.id, action: 'form_reply', input: { formId: 'form_real', answer: { choice: 'one' } } });
  assert.deepEqual(f.requests.find((r) => r.pathname.endsWith('/form_real/reply')).body, { answer: { choice: 'one' } });
});

test('private owned history and controls recover after service restart without create', async (t) => {
  const f = await fixture(t, { kind: 'private' }); const target = await f.target(); const created = await f.service.create({ target });
  await f.restart(); f.runtimeRequests.length = 0;
  const listed = await f.service.list({ target });
  assert.equal(listed.sessions[0].session.id, created.session.id);
  assert.equal(f.runtimeRequests[0].kind, 'private'); assert.equal(f.runtimeRequests[0].allowStart, true);
  const read = await f.service.read({ target, sessionId: created.session.id }); assert.equal(read.access, 'owned');
  await f.service.act({ target, sessionId: created.session.id, action: 'abort', input: {} });
  f.sessions.get(created.session.id).metadata.openherdr.owner = 'replaced-owner';
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'abort', input: {} }), (e) => e.code === 'conversation_owner_changed');
});

test('partial lists preserve successful entities and deletion persists across restart', async (t) => {
  const f = await fixture(t); const target = await f.target();
  const first = await f.service.create({ target }); const second = await f.service.create({ target });
  f.sessions.delete(first.session.id);
  const list = await f.service.list({ target });
  assert.equal(list.complete, false); assert.equal(list.failures[0].sessionId, first.session.id); assert.equal(list.sessions[0].session.id, second.session.id);
  await f.service.act({ target, sessionId: second.session.id, action: 'delete', input: {} });
  await f.restart(); assert.equal((await f.service.list({ target })).sessions.length, 0);
});

test('saved history survives replaced panes and rebind is explicit and invalidates old control', async (t) => {
  const f = await fixture(t); const target = await f.target(); const created = await f.service.create({ target });
  f.pane({ terminal_id: 'replacement-terminal' });
  await f.restart();
  const history = await f.service.historyList({ machine: 'local' });
  assert.equal(history.conversations[0].history.lastPaneId, target.paneId);
  assert.equal(history.conversations[0].session.id, created.session.id);
  const read = await f.service.historyRead({ sessionId: created.session.id });
  assert.equal(read.access, 'read-only'); assert.equal(read.permissions, null); assert.equal(read.capabilities.prompt, false);
  const replacement = await f.target();
  await assert.rejects(f.service.act({ target: replacement, sessionId: created.session.id, action: 'abort', input: {} }), (e) => e.code === 'conversation_session_forbidden');
  await f.service.rebind({ target: replacement, sessionId: created.session.id });
  await f.service.act({ target: replacement, sessionId: created.session.id, action: 'abort', input: {} });
  await assert.rejects(f.service.act({ target, sessionId: created.session.id, action: 'abort', input: {} }), (e) => e.code === 'conversation_target_changed');
  f.pane({ agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: created.session.id } });
  const native = await f.target();
  await assert.rejects(f.service.rebind({ target: native, sessionId: created.session.id }), (e) => e.code === 'conversation_read_only');
});

test('a different native pane prevents a second writer and explicit rebinding', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.otherPanes([{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: f.root, agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: session.id } }]);
  await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'prompt', input: { text: 'Do not send' } }), (e) => e.code === 'conversation_read_only' && e.confirmedNoEffect);
  await assert.rejects(f.service.rebind({ target, sessionId: session.id }), (e) => e.code === 'conversation_read_only' && e.confirmedNoEffect);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/prompt')).length, 0);
});

test('stream emits real scoped events, drops duplicates and forces resync', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  const actual = { id: 'event-real', type: 'session.text.delta', data: { sessionID: session.id, assistantMessageID: 'msg-real', ordinal: 2, delta: 'Hello' } };
  f.events([{ id: 'foreign', type: 'session.text.delta', data: { sessionID: 'ses_foreign', delta: 'private' } }, actual, actual, { id: 'event-form', type: 'form.created', data: { form: { id: 'form-live', sessionID: session.id } } }]);
  const stream = f.service.events({ target, sessionId: session.id });
  assert.equal((await stream.next()).value.type, 'conversation.resync');
  assert.deepEqual((await stream.next()).value.event, actual);
  assert.equal((await stream.next()).value.event.id, 'event-form');
  await stream.return();
});

test('strict input rejects paths, provider configuration and non-loopback endpoints', () => {
  const base = { target: { machine: 'local', paneId: 'w1:p1' }, sessionId: 'ses_owned', action: 'prompt', input: { text: 'test', files: [{ name: 'file', uri: 'file:///etc/passwd' }] } };
  assert.equal(conversationActionRequest.safeParse(base).success, false);
  assert.equal(conversationActionRequest.safeParse({ ...base, input: { text: 'test', provider: { apiKey: 'secret' } } }).success, false);
  for (const url of ['http://example.com', 'http://localhost:123', 'https://127.0.0.1:123', 'http://127.0.0.1:123/path']) assert.throws(() => loopbackEndpoint({ url }));
  assert.equal(loopbackEndpoint({ url: 'http://127.0.0.1:1234' }).url, 'http://127.0.0.1:1234');
});
