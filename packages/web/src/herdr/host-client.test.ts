import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { HerdrTransport, PendingDeliveryStore, TransportError, type PendingDelivery } from './transport';
import { HostClient, hostSchemas, createFileDraft, draftKey, editFileDraft, prepareFileSave, finishFileSave, acceptFileReload, isConfirmedHostRefusal, fileBytesToBase64, downloadBytes, type FileDraft } from './host-client';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const connection = { server: 'https://host.example', token: 'private-device' };
const target = { machine: 'saved-ssh', pane_id: 'w1:p1' };
const hash = 'a'.repeat(64);
const changedHash = 'b'.repeat(64);
function fixture() {
  let raw: string | null = null;
  const storage = { kind: 'native' as const, async read() { return raw; }, async write(value: string) { raw = value; } };
  const store = new PendingDeliveryStore(() => storage);
  const transport = new HerdrTransport(connection, store);
  return { store, transport, client: new HostClient(transport, target), storage, raw: () => raw };
}
function draft(): FileDraft {
  return { server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, baseContent: 'before', content: 'phone edit', bytes: 6, lineEnding: '\n', editVersion: 1 };
}
function pending(requestId: string, method = 'files.write'): PendingDelivery {
  return { requestId, server: connection.server, machine: target.machine, session: null, workspaceId: 'w1', tabId: '', paneId: target.pane_id, method };
}

describe('host client read contracts', () => {
  test('uses the selected target and bearer transport without request IDs for reads', async () => {
    const f = fixture();
    let received: { url: string; init?: RequestInit } | undefined;
    // SAFETY: This Response-returning fetch stub exercises authenticated transport; Bun preconnect is unused.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => { received = { url: String(input), init }; return Response.json({ root: '/repo', path: 'notes.txt', content: 'before', revision: hash, bytes: 6 }); }) as typeof fetch;
    const result = await f.client.read({ operation: 'files.read', path: 'notes.txt' }, hostSchemas.file);
    expect(result.content).toBe('before');
    expect(received?.url).toBe('https://host.example/api/herdr/host');
    expect(JSON.parse(String(received?.init?.body))).toEqual({ request: { ...target, operation: 'files.read', path: 'notes.txt' } });
    expect(new Headers(received?.init?.headers).get('Authorization')).toBe('Bearer private-device');
    expect(await f.store.load(connection.server)).toBeNull();
  });
  test('missing revision, malformed listings and HTTP failures never become valid empty reads', async () => {
    const f = fixture();
    for (const body of [{ root: '/repo', path: 'notes.txt', content: 'text', bytes: 4 }, { root: '/repo', path: '', entries: [] }]) {
      // SAFETY: This Response-returning fetch stub supplies malformed remote data at the parsing boundary.
      globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
      await expect(f.client.read({ operation: 'files.read', path: 'notes.txt' }, hostSchemas.file)).rejects.toThrow('Invalid server response');
    }
    // SAFETY: This Response-returning fetch stub supplies an authoritative failed read.
    globalThis.fetch = (async () => Response.json({ error: { code: 'pane_not_found', message: 'Pane closed' } }, { status: 404 })) as typeof fetch;
    await expect(f.client.read({ operation: 'files.list', path: '' }, hostSchemas.list)).rejects.toThrow('Pane closed');
  });
});

describe('pinned file drafts', () => {
  test('raw LF and CRLF files become complete normalized drafts and save in their original style', () => {
    const f = fixture();
    for (const lineEnding of ['\n', '\r\n']) {
      const raw = `first${lineEnding}second${lineEnding}`;
      const document = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: raw });
      expect(document.baseContent).toBe('first\nsecond\n');
      expect(document.content).toBe('first\nsecond\n');
      expect(document.lineEnding).toBe(lineEnding);
      expect(document.bytes).toBe(lineEnding === '\r\n' ? 15 : 13);
      expect(document.editVersion).toBe(0);
      expect(prepareFileSave(document, f.client, '/repo', false).content).toBe(raw);
      expect(document.content).toBe(document.baseContent);
    }
  });
  test('editing and undoing a CRLF file returns to its normalized clean baseline', () => {
    const f = fixture();
    const opened = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: 'first\r\nsecond\r\n' });
    const edited = editFileDraft(opened, 'first\nchanged\n');
    expect(edited.content).not.toBe(edited.baseContent);
    expect(edited.lineEnding).toBe('\r\n');
    const undone = editFileDraft(edited, opened.content);
    expect(undone.content).toBe(undone.baseContent);
    expect(undone.lineEnding).toBe('\r\n');
    expect(prepareFileSave(undone, f.client, '/repo', false).content).toBe('first\r\nsecond\r\n');
  });
  test('BOM, non-ASCII text, empty files and missing final newlines survive draft/save round trips', () => {
    const f = fixture();
    const contents = ['', '\uFEFF', 'non-ASCII \u4f60\u597d \u03c0', '\uFEFFfirst\n\u7b2c\u4e8c\u884c', '\uFEFFfirst\r\n\u7b2c\u4e8c\u884c', 'single line', '\n', '\r\n'];
    for (const raw of contents) {
      const document = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: raw });
      expect(document.content).toBe(raw.replace(/\r\n/g, '\n'));
      expect(document.baseContent).toBe(document.content);
      const request = prepareFileSave(document, f.client, '/repo', false);
      expect(request.content).toBe(raw);
      expect(request.expectedRevision).toBe(hash);
      expect(document.content).not.toContain('\r');
    }
  });
  test('loaded byte size retains BOM, Unicode and mixed separators until an acknowledged save', () => {
    const f = fixture();
    const raw = '\uFEFF你\r\nx\ny\rz';
    const opened = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: raw });
    expect(opened.baseContent).toBe('\uFEFF你\nx\ny\nz');
    expect(opened.lineEnding).toBe('\n');
    expect(opened.bytes).toBe(13);
    const request = prepareFileSave(opened, f.client, '/repo', false);
    expect(request.content).toBe('\uFEFF你\nx\ny\nz');
    expect(opened.bytes).toBe(13);
    const acknowledged = finishFileSave(opened, opened, { root: '/repo', path: opened.path, success: true, revision: changedHash });
    expect(acknowledged.bytes).toBe(12);
    expect(acknowledged.content).toBe(opened.content);
  });
  test('large normalized drafts retain the full tail through outbound serialization', () => {
    const f = fixture();
    const raw = `\uFEFF${'large text\r\n'.repeat(25000)}TAIL`;
    const document = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: raw });
    expect(document.content.length).toBeGreaterThan(200000);
    expect(document.content.endsWith('TAIL')).toBe(true);
    expect(document.bytes).toBe(300007);
    expect(prepareFileSave(document, f.client, '/repo', false).content).toBe(raw);
  });
  test('save acknowledgement keeps a normalized captured baseline and later edits with the original line style', () => {
    const f = fixture();
    const opened = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: '\uFEFFfirst\r\nsecond' });
    const sent = editFileDraft(opened, '\uFEFFchanged\nsecond');
    const request = prepareFileSave(sent, f.client, '/repo', false);
    const later = editFileDraft(sent, '\uFEFFchanged\nnewer edit');
    expect(opened.bytes).toBe(16);
    expect(sent.bytes).toBe(16);
    expect(later.bytes).toBe(16);
    expect(request.content).toBe('\uFEFFchanged\r\nsecond');
    const acknowledged = finishFileSave(later, sent, { root: '/repo', path: sent.path, success: true, revision: changedHash });
    expect(acknowledged.content).toBe('\uFEFFchanged\nnewer edit');
    expect(acknowledged.baseContent).toBe('\uFEFFchanged\nsecond');
    expect(acknowledged.bytes).toBe(18);
    expect(acknowledged.lineEnding).toBe('\r\n');
    expect(acknowledged.revision).toBe(changedHash);
    expect(acknowledged.content).not.toBe(acknowledged.baseContent);
    expect(prepareFileSave(acknowledged, f.client, '/repo', false).content).toBe('\uFEFFchanged\r\nnewer edit');
    const clean = finishFileSave(sent, sent, { root: '/repo', path: sent.path, success: true, revision: changedHash });
    expect(clean.content).toBe(clean.baseContent);
    expect(clean.baseContent).not.toContain('\r');
    expect(clean.bytes).toBe(18);
  });
  test('line style does not weaken root/path ownership or file revision checks', () => {
    const f = fixture();
    const document = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: 'first\r\nsecond' });
    expect(prepareFileSave(document, f.client, '/repo', false).expectedRevision).toBe(hash);
    expect(() => prepareFileSave(document, f.client, '/other', false)).toThrow('Your edits are kept');
    expect(() => finishFileSave(document, document, { root: '/other', path: document.path, success: true, revision: changedHash })).toThrow('does not match');
    expect(() => finishFileSave(document, document, { root: '/repo', path: 'other.txt', success: true, revision: changedHash })).toThrow('does not match');
    const current = { ...document, revision: changedHash };
    const incoming = createFileDraft({ server: connection.server, target, root: '/repo', path: document.path, revision: 'c'.repeat(64), content: 'disk\nstyle' });
    const preserved = acceptFileReload(current, document, incoming);
    expect(preserved.revision).toBe(changedHash);
    expect(preserved.lineEnding).toBe('\r\n');
    expect(preserved.reloadConflict).toBe(true);
  });
  test('save captures original root, path, revision and content and refuses target changes', () => {
    const f = fixture();
    const original = draft();
    const request = prepareFileSave(original, f.client, '/repo', false);
    expect(request).toEqual({ operation: 'files.write', expectedRoot: '/repo', path: 'notes.txt', expectedRevision: hash, content: 'phone edit' });
    expect(() => prepareFileSave(original, f.client, '/other', false)).toThrow('Your edits are kept');
    expect(() => prepareFileSave(original, new HostClient(f.transport, { ...target, machine: 'different' }), '/repo', false)).toThrow();
    expect(() => prepareFileSave(original, f.client, '/repo', true)).toThrow();
    expect(original.content).toBe('phone edit');
  });
  test('a late save confirms the sent text while preserving edits made in flight', () => {
    const sent = draft();
    const current = editFileDraft(sent, 'another edit made during save');
    const saved = finishFileSave(current, sent, { root: '/repo', path: 'notes.txt', success: true, revision: changedHash });
    expect(saved.content).toBe('another edit made during save');
    expect(saved.baseContent).toBe('phone edit');
    expect(saved.revision).toBe(changedHash);
    expect(saved.editVersion).toBe(2);
    expect(finishFileSave(sent, sent, { root: '/repo', path: 'notes.txt', success: true, revision: changedHash }).content).toBe('phone edit');
    expect(() => finishFileSave(current, { ...sent, target: { ...target, pane_id: 'w2:p1' } }, { root: '/repo', path: 'notes.txt', success: true, revision: changedHash })).toThrow('does not match');
    expect(draftKey(sent)).not.toBe(draftKey({ ...sent, root: '/changed' }));
  });
  test('a revision conflict preserves the unsaved draft and its exact request for receipt inspection', async () => {
    const f = fixture();
    const document = draft();
    // SAFETY: This Response-returning fetch stub represents a server-confirmed revision conflict.
    globalThis.fetch = (async () => Response.json({ error: { code: 'file_conflict', message: 'The file changed. Reload it before editing' } }, { status: 409 })) as typeof fetch;
    await expect(f.client.mutate(prepareFileSave(document, f.client, '/repo', false), hostSchemas.write)).rejects.toThrow('The file changed');
    expect(document.content).toBe('phone edit');
    expect(document.revision).toBe(hash);
    expect(document.bytes).toBe(6);
    const record = await f.store.load(connection.server);
    expect(record?.method).toBe('files.write');
    expect(record?.paneId).toBe(target.pane_id);
    expect(f.raw()).not.toContain('phone edit');
    expect(f.raw()).not.toContain('private-device');
  });
});

describe('shared durable host mutations', () => {
  test('waits for persistence, validates the matching response and requires exact caller clear', async () => {
    let raw: string | null = null;
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = new PendingDeliveryStore(() => ({ kind: 'native', async read() { return raw; }, async write(value) { started?.(); await gate; raw = value; } }));
    let calls = 0;
    // SAFETY: This Response-returning fetch stub observes the real persistence-before-dispatch ordering.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ root: '/repo', path: 'notes.txt', success: true, revision: changedHash }); }) as typeof fetch;
    const client = new HostClient(new HerdrTransport(connection, store), target);
    const dispatched = client.mutate(prepareFileSave(draft(), client, '/repo', false), hostSchemas.write);
    await ready;
    expect(calls).toBe(0);
    release?.();
    const result = await dispatched;
    expect(result.outcome.kind).toBe('complete');
    expect(await store.load(connection.server)).toEqual(result.record);
    expect(await store.clear(connection.server, 'wrong-request')).toBe(false);
    expect(await store.clear(connection.server, result.record.requestId)).toBe(true);
  });
  test('lost save acknowledgement blocks any second mutation after native store restart', async () => {
    const f = fixture();
    let calls = 0;
    // SAFETY: This rejecting fetch stub represents disconnect after one dispatch.
    globalThis.fetch = (async () => { calls += 1; throw new Error('Disconnected after server wrote'); }) as typeof fetch;
    try { await f.client.mutate(prepareFileSave(draft(), f.client, '/repo', false), hostSchemas.write); throw new Error('Expected unknown'); }
    catch (error) { expect(error).toBeInstanceOf(TransportError); if (error instanceof TransportError) { expect(error.uncertain).toBe(true); expect(error.requestId).toBeTruthy(); } }
    const stored = await f.store.load(connection.server);
    const restartedStore = new PendingDeliveryStore(() => f.storage);
    const restarted = new HostClient(new HerdrTransport(connection, restartedStore), target);
    const attemptedCommit = await restarted.mutate({ operation: 'git.commit', expectedRoot: '/repo', message: 'must not resend' }, hostSchemas.commit);
    expect(attemptedCommit.outcome).toEqual({ kind: 'pending', record: stored });
    expect(calls).toBe(1);
    expect(await restartedStore.clear(connection.server, attemptedCommit.record.requestId)).toBe(false);
  });
  test('an existing terminal delivery blocks a host mutation through the same store', async () => {
    const f = fixture();
    const terminal = pending('terminal-request', 'pane.send_input');
    await f.store.begin(terminal);
    let calls = 0;
    // SAFETY: The stub would record an accidental network dispatch while another mutation is unresolved.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ root: '/repo', success: true }); }) as typeof fetch;
    const result = await f.client.mutate({ operation: 'git.stage', expectedRoot: '/repo', paths: ['notes.txt'] }, hostSchemas.gitMutation);
    expect(result.outcome).toEqual({ kind: 'pending', record: terminal });
    expect(calls).toBe(0);
  });
  test('storage failure, wrong target and wrong response path cannot dispatch or clear a new request', async () => {
    let calls = 0;
    // SAFETY: The stub supplies a valid-looking response for the wrong file identity.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ root: '/repo', path: 'other.txt', success: true, revision: changedHash }); }) as typeof fetch;
    const broken = new PendingDeliveryStore(() => ({ kind: 'native', async read() { return null; }, async write() { throw new Error('Vault locked'); } }));
    const transport = new HerdrTransport(connection, broken);
    await expect(transport.trackedRequest(pending('storage-fail'), '/api/herdr/host', { ...target, operation: 'files.write' }, hostSchemas.write)).rejects.toThrow('deliveryStorage');
    expect(calls).toBe(0);
    const f = fixture();
    await expect(f.transport.trackedRequest(pending('target-mismatch'), '/api/herdr/host', { ...target, pane_id: 'w2:p1', operation: 'files.write' }, hostSchemas.write)).rejects.toThrow('deliveryStorage');
    expect(calls).toBe(0);
    await expect(f.client.mutate(prepareFileSave(draft(), f.client, '/repo', false), hostSchemas.write)).rejects.toThrow('Invalid server response');
    expect(calls).toBe(1);
    expect(await f.store.load(connection.server)).not.toBeNull();
  });
  test('conversation envelopes use the same pending store and validate exact route/action targeting', async () => {
    const f = fixture();
    const record = pending('conversation-send', 'conversation.send');
    let body: unknown;
    // SAFETY: This Response-returning stub observes the conversation JSON envelope and shared mutation blocker.
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return Response.json({ accepted: true }); }) as typeof fetch;
    const request = { target: { machine: target.machine, paneId: target.pane_id }, sessionId: 'native-session', action: 'send', input: { text: 'hello' } };
    await expect(f.transport.trackedRequest({ ...record, requestId: 'wrong-action', method: 'conversation.stop' }, '/api/herdr/conversations/act', request, z.object({ accepted: z.boolean() }))).rejects.toThrow('deliveryStorage');
    expect(await f.transport.trackedRequest(record, '/api/herdr/conversations/act', request, z.object({ accepted: z.boolean() }))).toEqual({ kind: 'complete', value: { accepted: true } });
    expect(body).toEqual({ request, requestId: record.requestId });
    expect(await f.store.load(connection.server)).toEqual(record);
  });
  test('binary transfer round-trips bytes without UTF-8 conversion', () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 39]);
    expect(downloadBytes(fileBytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('authenticated host streaming and native worktrees', () => {
  test('streams NDJSON with bearer, exact body and caller abort without storing a mutation', async () => {
    const f = fixture();
    const controller = new AbortController();
    let received: RequestInit | undefined;
    // SAFETY: The Response-returning stub exposes one actual NDJSON reader without browser transport globals.
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => { received = init; return new Response('{"type":"ready"}\n', { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }); }) as typeof fetch;
    const body = JSON.stringify({ request: { target: { machine: target.machine, paneId: target.pane_id }, sessionId: 'native-session' } });
    const response = await f.transport.streamResponse('/api/herdr/conversations/events', { method: 'POST', body, signal: controller.signal });
    expect(await response.text()).toBe('{"type":"ready"}\n');
    expect(new Headers(received?.headers).get('Authorization')).toBe('Bearer private-device');
    expect(received?.body).toBe(body);
    expect(received?.signal).toBe(controller.signal);
    expect(received?.cache).toBe('no-store');
    expect(received?.credentials).toBe('omit');
    expect(received?.redirect).toBe('error');
    expect(await f.store.load(connection.server)).toBeNull();
  });
  test('wrong stream media type, auth failure and explicit abort remain errors', async () => {
    const f = fixture();
    const controller = new AbortController();
    // SAFETY: This Response-returning stub supplies a wrong stream media type.
    globalThis.fetch = (async () => Response.json({ event: 'wrong' })) as typeof fetch;
    await expect(f.transport.streamResponse('/api/herdr/conversations/events', { signal: controller.signal })).rejects.toThrow('Invalid server stream');
    // SAFETY: This Response-returning stub supplies the real authenticated API error envelope.
    globalThis.fetch = (async () => Response.json({ error: { code: 'unauthorized', message: 'Device revoked' } }, { status: 401 })) as typeof fetch;
    await expect(f.transport.streamResponse('/api/herdr/conversations/events', { signal: controller.signal })).rejects.toThrow('Device revoked');
    controller.abort();
    // SAFETY: This rejecting stub represents the supplied abort signal ending a fetch.
    globalThis.fetch = (async () => { throw controller.signal.reason; }) as typeof fetch;
    await expect(f.transport.streamResponse('/api/herdr/conversations/events', { signal: controller.signal })).rejects.toThrow();
  });
  test('native worktree calls retain explicit workspace targeting and shared delivery storage', async () => {
    const f = fixture();
    const bodies: Array<{ method: string; params: { workspace_id: string }; requestId: string }> = [];
    // SAFETY: This Response-returning stub observes native worktree RPC requests through the actual tracked transport.
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const body = bodies.at(-1);
      if (body?.method === 'worktree.remove') return Response.json({ id: 'native', result: { type: 'worktree_removed', workspace_id: 'w1', path: '/owned-worktree', forced: false } });
      const type = body?.method === 'worktree.open' ? 'worktree_opened' : 'worktree_created';
      if (type === 'worktree_opened') return Response.json({ id: 'native', result: { ...nativeSelection(type), already_open: true } });
      return Response.json({ id: 'native', result: nativeSelection(type) });
    }) as typeof fetch;
    for (const mutation of [
      { method: 'worktree.create', params: { workspace_id: 'w1', branch: 'phone', focus: false } },
      { method: 'worktree.open', params: { workspace_id: 'w1', branch: 'phone', focus: false } },
      { method: 'worktree.remove', params: { workspace_id: 'w1', force: false } },
    ] satisfies Array<import('./transport').Mutation>) {
      const record = pending(crypto.randomUUID(), mutation.method);
      expect((await f.transport.dispatchTrackedMutation(record, mutation)).kind).toBe('stored');
      expect(bodies.at(-1)?.params.workspace_id).toBe('w1');
      expect(await f.store.clear(connection.server, record.requestId)).toBe(true);
    }
    expect(bodies.map((body) => body.method)).toEqual(['worktree.create', 'worktree.open', 'worktree.remove']);
    const wrong = { ...pending('wrong-workspace', 'worktree.remove'), workspaceId: 'w2' };
    await expect(f.transport.dispatchTrackedMutation(wrong, { method: 'worktree.remove', params: { workspace_id: 'w1' } })).rejects.toThrow('deliveryStorage');
    expect(bodies).toHaveLength(3);
  });
});


function nativeSelection(type = 'worktree_created') {
  return {
    type,
    workspace: { workspace_id: 'w2', label: 'Owned child', focused: false, active_tab_id: 'w2:t1', agent_status: 'unknown', pane_count: 1, tab_count: 1 },
    tab: { tab_id: 'w2:t1', workspace_id: 'w2', label: '1', focused: false, agent_status: 'unknown', pane_count: 1 },
    root_pane: { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', terminal_id: 'owned-terminal', focused: false, revision: 0, agent_status: 'unknown' },
  };
}

describe('reload, refusal and cross-tab delivery regressions', () => {
  test('an accepted disk reload replaces line style, while a changed captured style remains a conflict', () => {
    const f = fixture();
    const captured = createFileDraft({ server: connection.server, target, root: '/repo', path: 'notes.txt', revision: hash, content: 'before\r\nreload' });
    const incoming = createFileDraft({ server: connection.server, target, root: '/repo', path: captured.path, revision: changedHash, content: 'after\nreload' });
    const accepted = acceptFileReload(captured, captured, incoming);
    expect(accepted.lineEnding).toBe('\n');
    expect(accepted.bytes).toBe(12);
    expect(prepareFileSave(accepted, f.client, '/repo', false).content).toBe('after\nreload');
    const styleChanged: FileDraft = { ...captured, lineEnding: '\n' };
    const conflict = acceptFileReload(styleChanged, captured, incoming);
    expect(conflict.lineEnding).toBe('\n');
    expect(conflict.revision).toBe(hash);
    expect(conflict.content).toBe('before\nreload');
    expect(conflict.reloadConflict).toBe(true);
    const restored = acceptFileReload(accepted, accepted, captured);
    expect(restored.lineEnding).toBe('\r\n');
    expect(restored.bytes).toBe(14);
    expect(prepareFileSave(restored, f.client, '/repo', false).content).toBe('before\r\nreload');
  });
  test('reload preserves typing and newer save acknowledgements made while its read was in flight', () => {
    const captured = draft();
    const incoming = { ...captured, content: 'new disk version', baseContent: 'new disk version', bytes: 16, revision: changedHash, editVersion: 0 };
    const typed = editFileDraft(captured, 'typing during reload');
    const preserved = acceptFileReload(typed, captured, incoming);
    expect(preserved.content).toBe('typing during reload');
    expect(preserved.revision).toBe(hash);
    expect(preserved.reloadConflict).toBe(true);
    const acknowledged = finishFileSave(captured, captured, { root: '/repo', path: captured.path, success: true, revision: changedHash });
    expect(acceptFileReload(acknowledged, captured, incoming).baseContent).toBe('phone edit');
    expect(acceptFileReload(captured, captured, incoming)).toEqual(incoming);
    expect(acceptFileReload(undefined, undefined, incoming)).toEqual(incoming);
  });
  test('confirmed conflict releases only its exact pending request; storage and unknown outcomes stay blocked', async () => {
    const f = fixture();
    // SAFETY: This Response-returning stub models a definitive backend refusal before file effects.
    globalThis.fetch = (async () => Response.json({ error: { code: 'file_conflict', message: 'File changed' } }, { status: 409 })) as typeof fetch;
    let refused: Error | undefined;
    try { await f.client.mutate(prepareFileSave(draft(), f.client, '/repo', false), hostSchemas.write); }
    catch (error) { refused = error instanceof Error ? error : new Error(String(error)); }
    if (!refused) throw new Error('Expected a refused save');
    expect(isConfirmedHostRefusal(refused)).toBe(true);
    const record = await f.store.load(connection.server);
    expect(record?.requestId).toBeTruthy();
    if (isConfirmedHostRefusal(refused)) {
      expect(await f.store.clear(connection.server, refused.requestId)).toBe(true);
      await f.store.begin(pending('newer-pending'));
      expect(await f.store.clear(connection.server, refused.requestId)).toBe(false);
    }
    for (const error of [new TransportError('DELIVERY_STORAGE', 'Locked', false, 'stored-request'), new TransportError('INVALID_RESPONSE', 'Bad response', false, 'stored-request'), new TransportError('OUTCOME_UNKNOWN', 'Unknown', true, 'stored-request'), new TransportError('file_conflict', 'Missing ID', false)]) expect(isConfirmedHostRefusal(error)).toBe(false);
  });
  test('two browser realms sharing one Web Lock can begin only one unresolved request', async () => {
    let raw: string | null = null;
    const queues = new Map<string, Promise<void>>();
    const lock = { request<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const next = (queues.get(name) ?? Promise.resolve()).then(operation);
      queues.set(name, next.then(() => undefined, () => undefined));
      return next;
    } };
    const storage = { kind: 'browser' as const, async read() { const value = raw; await Promise.resolve(); return value; }, async write(value: string) { await Promise.resolve(); raw = value; } };
    const one = new PendingDeliveryStore(() => storage, lock);
    const two = new PendingDeliveryStore(() => storage, lock);
    const results = await Promise.all([one.begin(pending('first-realm')), two.begin(pending('second-realm'))]);
    expect(results).toEqual([{ kind: 'stored' }, { kind: 'pending', record: pending('first-realm') }]);
    expect(await two.clear(connection.server, 'second-realm')).toBe(false);
    expect(await one.clear(connection.server, 'first-realm')).toBe(true);
    await two.begin(pending('second-realm'));
    expect(await one.clear(connection.server, 'first-realm')).toBe(false);
    expect(await two.load(connection.server)).toEqual(pending('second-realm'));
  });
  test('browser writes fail closed without Web Locks instead of racing localStorage', async () => {
    let writes = 0;
    let calls = 0;
    const store = new PendingDeliveryStore(() => ({ kind: 'browser', async read() { return null; }, async write() { writes += 1; } }), null);
    // SAFETY: This stub records an accidental dispatch if atomic browser storage is unavailable.
    globalThis.fetch = (async () => { calls += 1; return Response.json({ success: true }); }) as typeof fetch;
    await expect(new HerdrTransport(connection, store).trackedRequest(pending('no-browser-lock'), '/api/herdr/host', { ...target, operation: 'files.write' }, hostSchemas.write)).rejects.toThrow('deliveryStorage');
    expect(writes).toBe(0);
    expect(calls).toBe(0);
  });
  test('worktree response retains returned selection IDs and malformed associations stay unknown', async () => {
    const f = fixture();
    // SAFETY: This Response-returning stub supplies a complete native worktree result.
    globalThis.fetch = (async () => Response.json({ id: 'native', result: nativeSelection() })) as typeof fetch;
    const record = pending('native-create-ok', 'worktree.create');
    const result = await f.transport.dispatchTrackedMutation(record, { method: 'worktree.create', params: { workspace_id: 'w1', branch: 'owned', focus: false } });
    if (result.kind !== 'stored') throw new Error('Expected stored native mutation');
    expect(result.value.workspace?.workspace_id).toBe('w2');
    expect(result.value.tab?.tab_id).toBe('w2:t1');
    expect(result.value.root_pane?.pane_id).toBe('w2:p1');
    await f.store.clear(connection.server, record.requestId);
    const bad = nativeSelection();
    bad.root_pane.tab_id = 'w3:t1';
    // SAFETY: This Response-returning stub supplies inconsistent native ownership IDs.
    globalThis.fetch = (async () => Response.json({ id: 'native', result: bad })) as typeof fetch;
    const malformed = pending('native-create-bad', 'worktree.create');
    try { await f.transport.dispatchTrackedMutation(malformed, { method: 'worktree.create', params: { workspace_id: 'w1', branch: 'owned', focus: false } }); throw new Error('Expected invalid ownership'); }
    catch (error) { expect(error).toBeInstanceOf(TransportError); if (error instanceof TransportError) expect(error.uncertain).toBe(true); }
    expect(await f.store.load(connection.server)).toEqual(malformed);
  });
});
