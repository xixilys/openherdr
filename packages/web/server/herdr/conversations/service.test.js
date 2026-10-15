import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OpenCode } from '@opencode/client';
import { createConversationService } from './service.js';
import { conversationActionRequest, conversationRegistryRequest } from './contracts.js';
import { loopbackEndpoint } from './runtime.js';

async function fixture(t, options = {}) {
  const base = path.resolve('.tmp'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'conversation-driver-test-'));
  let pane = { pane_id: 'w1:p1', terminal_id: 'term-owned', workspace_id: 'w1', tab_id: 'w1:t1', cwd: root, agent: 'shell' };
  const requests = [], sessions = new Map(), runtimeRequests = [], synthetics = [];
  let sequence = 0, failRead = false, dropPrompt = false, afterPrompt, eventValues = [], otherPanes = [], afterRegistry, afterCommand, dropCommand = false, afterSynthetic, rejectCommand = false;
  let commands = [{ name: 'review', description: 'Review changes' }];
  let skills = [{ id: 'skill-folder', name: 'inspect', description: 'Inspect source', path: '/private/skill-folder', content: 'private-skill-content' }];
  let registryFailure = false;
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
    if (pathname === '/api/command' || pathname === '/api/skill') {
      afterRegistry?.(pathname);
      if (registryFailure) return json({ _tag: 'UnknownError', message: 'Registry unavailable' }, 500);
      return json({ location: { directory: root }, data: pathname === '/api/command' ? commands : skills });
    }
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
    if (operation === 'synthetic') {
      const item = { id: `msg_synthetic_${synthetics.length + 1}`, sessionID: id, type: 'synthetic', time: { created: 21 }, payload: { text: body.text }, delivery: body.delivery ?? 'queue' };
      synthetics.push(item); afterSynthetic?.(); return json({ data: item });
    }
    if (operation === 'command') {
      afterCommand?.(); if (dropCommand) throw new TypeError('Disconnected after command');
      if (rejectCommand) return json({ _tag: 'InvalidRequestError', message: 'Command refused' }, 400);
      return new Response(null, { status: 204 });
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
    root, requests, sessions, runtimeRequests, synthetics, session, client,
    get service() { return service; },
    async restart() { await service.close(); service = await createConversationService({ bridge, stateDir, runtime }); },
    async target() { return (await service.resolve({ target: { machine: 'local', paneId: 'w1:p1' } })).target; },
    pane(update) { pane = { ...pane, ...update }; },
    failRead() { failRead = true; }, dropPrompt() { dropPrompt = true; }, afterPrompt(fn) { afterPrompt = fn; },
    permissions(value) { pendingPermissions = value; }, forms(value) { pendingForms = value; }, events(value) { eventValues = value; },
    otherPanes(value) { otherPanes = value; },
    commands(value) { commands = value; }, skills(value) { skills = value; }, failRegistry(value = true) { registryFailure = value; },
    afterRegistry(fn) { afterRegistry = fn; }, afterCommand(fn) { afterCommand = fn; }, dropCommand() { dropCommand = true; },
    afterSynthetic(fn) { afterSynthetic = fn; }, rejectCommand() { rejectCommand = true; },
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
  assert.equal(f.requests.some((r) => ['/api/command', '/api/skill'].includes(r.pathname)), false);
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

test('registry uses the owned session coordinator and current directory, projecting minimal metadata', async (t) => {
  const f = await fixture(t, { kind: 'private' }); const target = await f.target(); const { session } = await f.service.create({ target });
  f.commands([{ name: 'review', description: 'Review changes', agent: 'private-agent', model: 'private-model', scope: '/private', content: 'private-command-content' }]);
  f.runtimeRequests.length = 0; f.requests.length = 0;
  const commands = await f.service.registry({ target, sessionId: session.id, kind: 'commands' });
  const skills = await f.service.registry({ target, sessionId: session.id, kind: 'skills' });
  assert.deepEqual(commands, { protocol: 'opencode-v2', target, sessionId: session.id, kind: 'commands', commands: [{ name: 'review', description: 'Review changes' }] });
  assert.deepEqual(skills.skills, [{ id: 'skill-folder', name: 'inspect', description: 'Inspect source' }]);
  assert.equal(JSON.stringify(skills).includes('private'), false);
  assert.equal(f.runtimeRequests.length, 2);
  for (const request of f.runtimeRequests) { assert.equal(request.kind, 'private'); assert.equal(request.allowStart, true); }
  for (const request of f.requests.filter((r) => ['/api/command', '/api/skill'].includes(r.pathname))) {
    assert.equal(request.query.get('location[directory]'), f.root); assert.ok(request.signal instanceof AbortSignal);
  }
  assert.equal(f.requests.some((r) => ['/api/model', '/api/agent'].includes(r.pathname)), false);
});

test('native read-only registry uses the registered source and unrelated sessions never read a registry', async (t) => {
  const f = await fixture(t);
  f.sessions.set('ses_native', f.session('ses_native'));
  f.pane({ agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: 'ses_native' } });
  const target = await f.target(); f.runtimeRequests.length = 0;
  await f.service.registry({ target, sessionId: 'ses_native', kind: 'commands' });
  assert.equal(f.runtimeRequests.length, 1); assert.equal(f.runtimeRequests[0].kind, 'registered'); assert.equal(f.runtimeRequests[0].allowStart, false);
  f.requests.length = 0;
  await assert.rejects(f.service.registry({ target, sessionId: 'ses_foreign', kind: 'commands' }), (e) => e.code === 'conversation_session_forbidden');
  assert.equal(f.requests.length, 0);
});

test('registry rejects stale pane identity before and after a directory read', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.pane({ terminal_id: 'replacement' });
  await assert.rejects(f.service.registry({ target, sessionId: session.id, kind: 'commands' }), (e) => e.code === 'conversation_target_changed');
  assert.equal(f.requests.some((r) => r.pathname === '/api/command'), false);
  f.pane({ terminal_id: 'term-owned' }); f.afterRegistry(() => f.pane({ terminal_id: 'replacement' }));
  await assert.rejects(f.service.registry({ target, sessionId: session.id, kind: 'commands' }), (e) => e.code === 'conversation_target_changed');
  assert.equal(f.requests.filter((r) => r.pathname === '/api/command').length, 1);
});

test('malformed or unavailable registries stay errors while a genuine empty list succeeds', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  for (const [kind, set] of [['commands', (value) => f.commands(value)], ['skills', (value) => f.skills(value)]]) {
    const malformedLists = [null, {}, [{ name: 1 }], ...(kind === 'skills' ? [[{ name: 'missing-id' }]] : [])];
    for (const malformed of malformedLists) {
      set(malformed);
      await assert.rejects(f.service.registry({ target, sessionId: session.id, kind }));
    }
    set([]);
    assert.deepEqual((await f.service.registry({ target, sessionId: session.id, kind }))[kind], []);
    f.failRegistry(); await assert.rejects(f.service.registry({ target, sessionId: session.id, kind })); f.failRegistry(false);
  }
});

test('commands preserve exact arguments, attachments and delivery with a real void result', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  const files = [{ name: 'input.txt', uri: 'data:text/plain;base64,SGVsbG8=' }];
  for (const delivery of ['queue', 'steer']) {
    const result = await f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', arguments: '  a\n--b "c"', files, delivery } });
    assert.equal(result.action, 'command'); assert.equal(result.result, null);
    assert.deepEqual(f.requests.filter((r) => r.pathname.endsWith('/command')).at(-1).body, { name: 'review', text: '  a\n--b "c"', files, delivery });
  }
  await f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review' } });
  assert.deepEqual(f.requests.filter((r) => r.pathname.endsWith('/command')).at(-1).body, { name: 'review', text: '' });
  await f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [] } });
  const lookups = f.requests.filter((r) => r.pathname === '/api/command');
  assert.equal(lookups.length, 4); assert.ok(lookups.every((r) => r.query.get('location[directory]') === f.root));
  assert.equal(f.requests.filter((r) => r.pathname.endsWith(`/${session.id}/command`)).length, 4);
  assert.equal(f.requests.some((r) => r.pathname === '/api/skill' || r.pathname.endsWith('/synthetic')), false);
});

test('native command names retain path, namespace and Unicode characters under live membership validation', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  for (const name of ['team/review', 'org:review', '审阅', '_review', '.review']) {
    f.commands([{ name }]);
    const request = { target, sessionId: session.id, action: 'command', input: { command: name, arguments: 'keep args' } };
    await f.service.act(request);
    assert.deepEqual(f.requests.filter((r) => r.pathname.endsWith(`/${session.id}/command`)).at(-1).body, { name, text: 'keep args' });
    f.commands([]);
    await assert.rejects(f.service.act(request), (e) => e.code === 'conversation_command_unavailable' && e.confirmedNoEffect);
  }
  assert.equal(f.requests.filter((r) => r.pathname.endsWith(`/${session.id}/command`)).length, 5);
  for (const command of ['', 'a'.repeat(4097)]) {
    await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'command', input: { command } }), (e) => e.code === 'invalid_conversation_request');
  }
});

test('skill prompt preserves full slash text, real ID, files and delivery in the same source', async (t) => {
  const f = await fixture(t, { kind: 'private' }); const target = await f.target(); const { session } = await f.service.create({ target });
  const skills = [{ id: 'actual/folder', name: 'inspect' }]; f.skills(skills); f.runtimeRequests.length = 0;
  const files = [{ name: 'input.txt', uri: 'data:text/plain;base64,SGVsbG8=' }];
  const input = { text: '/inspect  retain\nthese args', files, delivery: 'steer', skills: [{ id: 'actual/folder' }] };
  const result = await f.service.act({ target, sessionId: session.id, action: 'prompt', input });
  assert.equal(result.result.id, 'msg_enqueued'); assert.deepEqual(f.requests.find((r) => r.pathname.endsWith('/prompt')).body, input);
  assert.equal(f.runtimeRequests.length, 1); assert.equal(f.runtimeRequests[0].kind, 'private');
  assert.equal(f.requests.find((r) => r.pathname === '/api/skill').query.get('location[directory]'), f.root);
  assert.equal(f.requests.some((r) => r.pathname.endsWith(`/${session.id}/skill`)), false);
  assert.equal(f.synthetics.length, 0);
});

test('commands with skills admit the original instruction before their native command with exact SDK payloads', async (t) => {
  const f = await fixture(t, { kind: 'private' }); const target = await f.target(); const { session } = await f.service.create({ target });
  f.skills([{ id: 'internal/first-folder', name: 'inspect' }, { id: 'internal/second-folder', name: 'code-review' }]); f.runtimeRequests.length = 0;
  const files = [{ name: 'input.txt', uri: 'data:text/plain;base64,SGVsbG8=' }];
  const text = "The user explicitly mentioned these skills in their message: $code-review, $inspect. Use the corresponding skill tool when it is relevant to accomplishing the user's request.";
  for (const delivery of ['queue', 'steer']) {
    const result = await f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', arguments: '  $inspect\n--keep "args"', files, delivery, skills: [{ id: 'internal/second-folder' }, { id: 'internal/first-folder' }] } });
    assert.equal(result.action, 'command'); assert.equal(result.result, null);
    const writes = f.requests.filter((r) => r.pathname.endsWith('/synthetic') || r.pathname.endsWith(`/${session.id}/command`)).slice(-2);
    assert.deepEqual(writes.map((r) => r.pathname), [`/api/session/${session.id}/synthetic`, `/api/session/${session.id}/command`]);
    assert.deepEqual(writes[0].body, { text, delivery, resume: false });
    assert.deepEqual(writes[1].body, { name: 'review', text: '  $inspect\n--keep "args"', files, delivery });
    assert.ok(writes.every((r) => r.signal instanceof AbortSignal));
  }
  assert.equal(f.synthetics.length, 2); assert.ok(f.synthetics.every((item) => item.payload.text === text));
  assert.equal(f.runtimeRequests.length, 2); assert.ok(f.runtimeRequests.every((request) => request.kind === 'private'));
  const registries = f.requests.filter((r) => ['/api/command', '/api/skill'].includes(r.pathname));
  assert.equal(registries.length, 4); assert.ok(registries.every((r) => r.query.get('location[directory]') === f.root));
  assert.equal(f.requests.some((r) => r.pathname.endsWith('/prompt') || r.pathname.endsWith(`/${session.id}/skill`)), false);
});

test('command skill validation failures finish all required lookups without writing context or a command', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  const request = { target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [{ id: 'skill-folder' }] } };
  f.commands([]);
  await assert.rejects(f.service.act(request), (e) => e.code === 'conversation_command_unavailable' && e.confirmedNoEffect === true);
  assert.equal(f.requests.some((r) => r.pathname === '/api/skill'), false);
  f.commands([{ name: 'review' }]);
  f.skills([]);
  await assert.rejects(f.service.act(request), (e) => e.code === 'conversation_skill_unavailable' && e.confirmedNoEffect === true);
  f.skills(null);
  await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true);
  f.afterRegistry((pathname) => { if (pathname === '/api/skill') f.failRegistry(); });
  await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true);
  assert.equal(f.requests.filter((r) => r.pathname === '/api/command').length, 4);
  assert.equal(f.requests.filter((r) => r.pathname === '/api/skill').length, 3);
  assert.equal(f.requests.some((r) => r.pathname.endsWith('/synthetic') || r.pathname.endsWith(`/${session.id}/command`)), false);
  assert.equal(f.synthetics.length, 0);
});

test('native takeover or target replacement during command skill validation prevents the first mutation', async (t) => {
  for (const change of ['native-writer', 'target']) await t.test(change, async (t) => {
    const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
    f.afterRegistry((pathname) => {
      if (pathname !== '/api/skill') return;
      if (change === 'target') f.pane({ terminal_id: 'replacement' });
      else f.otherPanes([{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: f.root, agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: session.id } }]);
    });
    await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [{ id: 'skill-folder' }] } }), (e) => e.code === (change === 'target' ? 'conversation_target_changed' : 'conversation_read_only') && e.confirmedNoEffect === true);
    assert.equal(f.synthetics.length, 0);
    assert.equal(f.requests.some((r) => r.pathname.endsWith('/synthetic') || r.pathname.endsWith(`/${session.id}/command`)), false);
  });
});

test('native takeover or target replacement after synthetic admission leaves unknown context and prevents the command', async (t) => {
  for (const change of ['native-writer', 'target']) await t.test(change, async (t) => {
    const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
    f.afterSynthetic(() => {
      if (change === 'target') f.pane({ terminal_id: 'replacement' });
      else f.otherPanes([{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: f.root, agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: session.id } }]);
    });
    await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [{ id: 'skill-folder' }] } }), (e) => e.code === (change === 'target' ? 'conversation_target_changed' : 'conversation_read_only') && e.confirmedNoEffect === false);
    assert.equal(f.synthetics.length, 1);
    assert.equal(f.requests.filter((r) => r.pathname.endsWith('/synthetic')).length, 1);
    assert.equal(f.requests.some((r) => r.pathname.endsWith(`/${session.id}/command`)), false);
  });
});

test('a lost synthetic response never dispatches or retries the following command', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.afterSynthetic(() => { throw new TypeError('Disconnected after synthetic write'); });
  await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [{ id: 'skill-folder' }] } }), (e) => e.confirmedNoEffect === false);
  assert.equal(f.synthetics.length, 1);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/synthetic')).length, 1);
  assert.equal(f.requests.some((r) => r.pathname.endsWith(`/${session.id}/command`)), false);
});

test('a command refusal after synthetic admission stays unknown and neither mutation is retried', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.rejectCommand();
  await assert.rejects(f.service.act({ target, sessionId: session.id, action: 'command', input: { command: 'review', skills: [{ id: 'skill-folder' }] } }), (e) => e.status === 400 && e.confirmedNoEffect === false);
  assert.equal(f.synthetics.length, 1);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith('/synthetic')).length, 1);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith(`/${session.id}/command`)).length, 1);
});

test('missing, stale and failed command or skill lookups refuse dispatch without fallback', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  const command = { target, sessionId: session.id, action: 'command', input: { command: 'missing' } };
  const skill = { target, sessionId: session.id, action: 'prompt', input: { text: '/inspect', skills: [{ id: 'missing' }] } };
  for (const request of [command, skill]) {
    await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true);
    f.failRegistry(); await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true); f.failRegistry(false);
  }
  f.commands(null); f.skills(null);
  for (const request of [command, skill]) await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true);
  const commandList = f.client.command.list; const skillList = f.client.skill.list;
  f.client.command.list = undefined; f.client.skill.list = undefined;
  for (const request of [command, skill]) await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === true);
  f.client.command.list = commandList; f.client.skill.list = skillList;
  f.commands([{ name: 'review' }]);
  f.afterRegistry(() => f.pane({ terminal_id: 'replacement' }));
  await assert.rejects(f.service.act({ ...command, input: { command: 'review' } }), (e) => e.code === 'conversation_target_changed' && e.confirmedNoEffect);
  assert.equal(f.requests.some((r) => r.pathname.endsWith(`/${session.id}/command`) || r.pathname.endsWith('/prompt')), false);
});

test('a command dispatch failure or replaced pane remains unknown and is never retried', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.afterCommand(() => f.pane({ terminal_id: 'replacement' }));
  const request = { target, sessionId: session.id, action: 'command', input: { command: 'review' } };
  await assert.rejects(f.service.act(request), (e) => e.code === 'conversation_target_changed' && e.confirmedNoEffect === false);
  f.pane({ terminal_id: 'term-owned' }); f.afterCommand(undefined); f.dropCommand();
  await assert.rejects(f.service.act(request), (e) => e.confirmedNoEffect === false);
  assert.equal(f.requests.filter((r) => r.pathname.endsWith(`/${session.id}/command`)).length, 2);
});

test('a native writer claiming the session during registry validation prevents command and skill-prompt dispatch', async (t) => {
  const f = await fixture(t); const target = await f.target(); const { session } = await f.service.create({ target });
  f.afterRegistry(() => f.otherPanes([{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: f.root, agent: 'opencode', agent_session: { source: 'opencode', agent: 'opencode', kind: 'id', value: session.id } }]));
  for (const request of [
    { target, sessionId: session.id, action: 'command', input: { command: 'review' } },
    { target, sessionId: session.id, action: 'prompt', input: { text: '/inspect preserve args', skills: [{ id: 'skill-folder' }] } },
  ]) {
    f.otherPanes([]);
    await assert.rejects(f.service.act(request), (e) => e.code === 'conversation_read_only' && e.confirmedNoEffect === true);
  }
  assert.equal(f.requests.filter((r) => r.pathname === '/api/command').length, 1);
  assert.equal(f.requests.filter((r) => r.pathname === '/api/skill').length, 1);
  assert.equal(f.requests.some((r) => r.pathname.endsWith(`/${session.id}/command`) || r.pathname.endsWith('/prompt')), false);
});

test('registry and send schemas bound attachments and unique skill IDs consistently', () => {
  const base = { target: { machine: 'local', paneId: 'w1:p1' }, sessionId: 'ses_owned' };
  assert.equal(conversationRegistryRequest.safeParse({ ...base, kind: 'commands' }).success, true);
  for (const input of [{ ...base, kind: 'other' }, { target: base.target, kind: 'commands' }, { ...base, kind: 'skills', directory: '/private' }]) assert.equal(conversationRegistryRequest.safeParse(input).success, false);
  const file = { name: 'input.txt', uri: 'data:text/plain;base64,SGVsbG8=' };
  const oversized = { name: 'input.txt', uri: `data:text/plain;base64,${'A'.repeat(6 * 1024 * 1024)}` };
  for (const action of ['prompt', 'command']) {
    const required = action === 'prompt' ? { text: '/inspect' } : { command: 'review' };
    assert.equal(conversationActionRequest.safeParse({ ...base, action, input: { ...required, files: [oversized] } }).success, true);
    for (const changes of [{ files: Array(11).fill(file) }, { files: [oversized, oversized] }, { files: [{ ...file, uri: 'file:///private' }] }, { files: [{ ...file, name: '../input' }] }, { delivery: 'unknown' }]) {
      assert.equal(conversationActionRequest.safeParse({ ...base, action, input: { ...required, ...changes } }).success, false);
    }
    for (const payload of ['A', 'AAA', 'A=', 'AB=', 'AAAA=', 'AA===']) {
      assert.equal(conversationActionRequest.safeParse({ ...base, action, input: { ...required, files: [{ ...file, uri: `data:text/plain;base64,${payload}` }] } }).success, false);
    }
  }
  for (const skills of [[{ id: 'one' }, { id: 'one' }], Array.from({ length: 11 }, (_, i) => ({ id: `skill-${i}` })), [{ id: '' }], [{ id: 'a'.repeat(4097) }], [{ id: 'one', content: 'untrusted' }]]) {
    for (const action of ['prompt', 'command']) {
      const required = action === 'prompt' ? { text: '/inspect' } : { command: 'review' };
      assert.equal(conversationActionRequest.safeParse({ ...base, action, input: { ...required, skills } }).success, false);
    }
  }
  for (const untrusted of [{ skills: [{ id: 'one', name: 'arbitrary' }] }, { context: [{ text: 'client instruction' }] }, { synthetic: 'client instruction' }]) assert.equal(conversationActionRequest.safeParse({ ...base, action: 'command', input: { command: 'review', ...untrusted } }).success, false);
});
