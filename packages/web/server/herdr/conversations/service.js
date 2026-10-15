import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { z } from 'zod';
import { ApiError } from '../contracts.js';
import { createConversationRuntime } from './runtime.js';
import {
  conversationResolveRequest, conversationListRequest, conversationReadRequest, conversationCatalogRequest, conversationRegistryRequest,
  conversationCreateRequest, conversationActionRequest, conversationEventsRequest,
  conversationHistoryListRequest, conversationHistoryReadRequest, conversationRebindRequest,
  paneRecordSchema, sessionRecordSchema, messagePageSchema, eventRecordSchema,
} from './contracts.js';

const protocol = 'opencode-v2';
const paneReply = z.object({ result: z.object({ pane: paneRecordSchema }) });
const paneSnapshot = z.object({ result: z.object({ snapshot: z.object({ panes: z.array(paneRecordSchema) }) }) });
const ownerRecord = z.strictObject({ sessionId: z.string(), identity: z.string(), directory: z.string(), nonce: z.string(), kind: z.enum(['registered', 'private']), machine: z.literal('local').default('local'), paneId: z.string().optional(), deleted: z.boolean().optional() });
const tagSchema = z.object({ _tag: z.string() });
const pendingPermission = z.object({ id: z.string(), sessionID: z.string() }).passthrough();
const pendingForm = z.object({ id: z.string(), sessionID: z.string() }).passthrough();
const modelsSchema = z.object({ data: z.array(z.object({
  id: z.string(), modelID: z.string().optional(), providerID: z.string(), name: z.string(), enabled: z.boolean(),
  variants: z.array(z.object({ id: z.string() })),
  capabilities: z.json(), limit: z.json(), cost: z.json(), status: z.string(),
})) });
const agentsSchema = z.object({ data: z.array(z.object({
  id: z.string(), name: z.string(), description: z.string().optional(), model: z.object({ id: z.string(), providerID: z.string(), variant: z.string().optional() }).optional(),
  mode: z.enum(['primary', 'subagent', 'all']), hidden: z.boolean(), color: z.string().optional(),
})) });
const commandsSchema = z.object({ data: z.array(z.object({ name: z.string().min(1), description: z.string().optional() })) });
const skillsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(4096), name: z.string().min(1), description: z.string().optional() })) });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const capability = (writable) => ({
  history: true, pagination: true, events: true, prompt: writable, abort: writable,
  permissions: writable, forms: writable, modelSelection: writable, agentSelection: writable,
  attachments: writable ? 'inline-data-uri' : false, rename: writable, delete: writable,
  fork: writable, revert: writable, compact: writable, commands: writable, skills: writable,
  providerConfiguration: false, nativePathImport: false,
});

function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'invalid_conversation_request', 'Invalid conversation request');
  return parsed.data;
}
function normalizeError(error) {
  if (error instanceof ApiError || error?.name === 'AbortError' || error?.name === 'TimeoutError') return error;
  const tagged = tagSchema.safeParse(error);
  const status = tagged.success ? ({ SessionNotFoundError: 404, MessageNotFoundError: 404, PermissionNotFoundError: 404, FormNotFoundError: 404, InvalidRequestError: 400, InvalidCursorError: 400, FormInvalidAnswerError: 400, ForbiddenError: 403, UnauthorizedError: 401, SessionBusyError: 409, FormAlreadySettledError: 409, ConflictError: 409 })[tagged.data._tag] : undefined;
  const result = new ApiError(status ?? 502, status ? 'conversation_request_refused' : 'conversation_upstream_unavailable', status ? 'OpenCode refused the conversation request' : 'The OpenCode response could not be confirmed');
  result.confirmedNoEffect = status !== undefined;
  return result;
}

/** Server-owned source adapter. Its caller owns authentication and mutation receipts. */
export async function createConversationService({ bridge, stateDir, runtime: providedRuntime, ...runtimeOptions }) {
  const directory = path.join(stateDir, 'conversations');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new ApiError(503, 'conversation_state_unsafe', 'Conversation state must be a private directory owned by this user');
  const journalPath = path.join(directory, 'sessions.jsonl');
  const handle = await fs.open(journalPath, constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const fileStat = await handle.stat();
  const pathStat = await fs.lstat(journalPath);
  if (!fileStat.isFile() || pathStat.isSymbolicLink() || fileStat.uid !== process.getuid?.() || (fileStat.mode & 0o077)) { await handle.close(); throw new ApiError(503, 'conversation_state_unsafe', 'Conversation ownership journal must be private'); }
  const records = new Map();
  try {
    const content = await handle.readFile('utf8');
    for (const line of content.split('\n').filter(Boolean)) { const record = ownerRecord.parse(JSON.parse(line)); if (record.deleted) records.delete(record.sessionId); else records.set(record.sessionId, record); }
  } catch { await handle.close(); throw new ApiError(503, 'conversation_state_invalid', 'Conversation ownership records could not be read'); }
  const runtime = providedRuntime ?? createConversationRuntime({ stateDir: directory, ...runtimeOptions });
  let writes = Promise.resolve();
  let closed = false;
  const remember = async (record) => {
    writes = writes.then(async () => { await handle.write(`${JSON.stringify(record)}\n`); await handle.sync(); if (record.deleted) records.delete(record.sessionId); else records.set(record.sessionId, record); });
    await writes;
  };
  const authoritative = async (target) => {
    if (closed) throw new ApiError(503, 'conversation_closed', 'This conversation service has stopped');
    if (target.machine !== 'local') throw new ApiError(501, 'conversation_remote_pending', 'Structured remote conversations need a verified remote source driver');
    const reply = paneReply.parse(await bridge.rpc(target.machine, 'pane.get', { pane_id: target.paneId }));
    const pane = reply.result.pane;
    if (pane.pane_id !== target.paneId) throw new ApiError(409, 'conversation_target_changed', 'Herdr returned a different pane');
    const cwd = pane.foreground_cwd || pane.cwd;
    if (!path.isAbsolute(cwd)) throw new ApiError(422, 'conversation_directory_unavailable', 'Herdr has not reported an absolute working directory');
    let root;
    try { root = await fs.realpath(cwd); if (!(await fs.stat(root)).isDirectory()) throw new Error(); }
    catch { throw new ApiError(422, 'conversation_directory_unavailable', 'The pane working directory is unavailable'); }
    const native = pane.agent_session ?? null;
    if (Object.hasOwn(target, 'expectedAgentSession') && !same(target.expectedAgentSession, native)) throw new ApiError(409, 'conversation_target_changed', 'The pane native session changed');
    const identity = hash([target.machine, pane.pane_id, pane.terminal_id ?? null, pane.workspace_id, pane.tab_id, root, pane.agent ?? null, native]);
    if (target.identity && target.identity !== identity) throw new ApiError(409, 'conversation_target_changed', 'The selected conversation target changed');
    return { target: { machine: target.machine, paneId: target.paneId, expectedAgentSession: native, identity }, root, native, pane };
  };
  const verify = async (scope, signal) => { signal?.throwIfAborted(); await authoritative(scope.target); signal?.throwIfAborted(); };
  const nativeId = (scope) => scope.pane.agent === 'opencode' && scope.native?.agent === 'opencode' && scope.native.kind === 'id' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(scope.native.value) ? scope.native.value : null;
  const requireIdentity = (target) => { if (!target.identity) throw new ApiError(409, 'conversation_identity_required', 'Resolve and select the current pane before changing a conversation'); };
  const noNativeWriter = async (scope, sessionId) => {
    const snapshot = paneSnapshot.parse(await bridge.rpc(scope.target.machine, 'session.snapshot', {}));
    if (snapshot.result.snapshot.panes.some((p) => p.agent === 'opencode' && p.agent_session?.agent === 'opencode' && p.agent_session.kind === 'id' && p.agent_session.value === sessionId)) {
      throw new ApiError(409, 'conversation_read_only', 'A Herdr native agent already owns this OpenCode session');
    }
  };
  const historyRef = (owner) => {
    const reference = { machine: owner.machine ?? 'local', sessionId: owner.sessionId, directory: owner.directory };
    if (owner.paneId) reference.lastPaneId = owner.paneId;
    return reference;
  };
  const savedSession = async (sessionId, signal) => {
    const owner = records.get(sessionId);
    if (!owner) throw new ApiError(403, 'conversation_session_forbidden', 'This session has no OpenHerdr ownership record');
    const source = await runtime.get({ kind: owner.kind, allowStart: owner.kind === 'private', signal });
    const session = sessionRecordSchema.parse(await source.client.session.get({ sessionID: sessionId }, { signal }));
    const sessionRoot = await fs.realpath(session.location.directory).catch(() => path.resolve(session.location.directory));
    if (session.id !== sessionId || sessionRoot !== owner.directory || session.metadata?.openherdr?.owner !== owner.nonce) throw new ApiError(409, 'conversation_owner_changed', 'The saved session ownership or directory changed');
    signal?.throwIfAborted();
    return { ...source, owner, session };
  };
  const getSession = async (scope, sessionId, signal, write = false) => {
    const owner = records.get(sessionId);
    const owned = owner?.identity === scope.target.identity && owner.directory === scope.root;
    const native = nativeId(scope) === sessionId;
    if (!owned && !native) throw new ApiError(403, 'conversation_session_forbidden', 'This session does not belong to the selected pane');
    if (write && (!owned || native)) throw new ApiError(409, 'conversation_read_only', 'The existing native agent owns this session. Create an OpenHerdr conversation to control a new session');
    if (write) await noNativeWriter(scope, sessionId);
    const source = await runtime.get({ kind: owned ? owner.kind : 'registered', allowStart: owned && owner.kind === 'private', signal });
    const session = sessionRecordSchema.parse(await source.client.session.get({ sessionID: sessionId }, { signal }));
    let sessionRoot;
    try { sessionRoot = await fs.realpath(session.location.directory); } catch { throw new ApiError(409, 'conversation_location_changed', 'The session directory is unavailable'); }
    if (session.id !== sessionId || sessionRoot !== scope.root) throw new ApiError(409, 'conversation_location_changed', 'The session belongs to a different working directory');
    const marker = session.metadata?.openherdr;
    const writable = owned && !native && marker?.owner === owner.nonce;
    if (write && !writable) throw new ApiError(409, 'conversation_owner_changed', 'The session ownership marker changed');
    await verify(scope, signal);
    return { ...source, session, writable, owner };
  };
  const wrap = (schema, operation) => async (input) => {
    const request = parse(schema, Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'signal')));
    const capture = runtime.capture(input.signal);
    let dispatched = false;
    try { return await operation(request, capture.signal, () => { dispatched = true; }); }
    catch (error) {
      const normalized = normalizeError(error);
      if (!dispatched) normalized.confirmedNoEffect = true;
      else normalized.confirmedNoEffect = false;
      throw normalized;
    } finally { capture.release(); }
  };
  const describe = async (scope, signal) => {
    const id = nativeId(scope);
    if (!id) return { protocol, target: scope.target, directory: scope.root, native: scope.native, nativeAccess: scope.native?.kind === 'path' ? 'path-reader-pending' : 'unavailable', capabilities: { create: true, nativeHistory: false }, reason: 'Herdr has not provided a verified OpenCode session ID for this pane' };
    const source = await getSession(scope, id, signal);
    return { protocol, target: scope.target, directory: scope.root, native: scope.native, nativeAccess: 'read-only', session: source.session, capabilities: { ...capability(false), create: true } };
  };
  const create = async (scope, title, signal, dispatch) => {
    const source = await runtime.get({ allowStart: true, signal });
    const nonce = randomUUID();
    await verify(scope, signal);
    dispatch();
    const session = sessionRecordSchema.parse(await source.client.session.create({ title, location: { directory: scope.root }, metadata: { openherdr: { owner: nonce } } }, { signal }));
    // Remember even if the pane disappears after dispatch. Root receipts retain
    // the unknown result, and the session remains recoverable on this owner.
    await remember({ sessionId: session.id, identity: scope.target.identity, directory: scope.root, nonce, kind: source.kind, machine: 'local', paneId: scope.target.paneId });
    await verify(scope, signal);
    return { protocol, target: scope.target, session, access: 'owned', capabilities: capability(true) };
  };
  const service = {
    historyList: wrap(conversationHistoryListRequest, async ({ machine, cursor, limit }, signal) => {
      const ids = [...records.values()].filter((r) => (r.machine ?? 'local') === machine).map((r) => r.sessionId).reverse();
      const boundary = cursor ? ids.indexOf(cursor) : -1;
      if (cursor && boundary < 0) throw new ApiError(400, 'conversation_cursor_invalid', 'This cursor does not belong to saved OpenHerdr conversations');
      const selected = ids.slice(boundary + 1, boundary + 1 + limit);
      const loaded = await Promise.allSettled(selected.map(async (id) => {
        const source = await savedSession(id, signal);
        return { session: source.session, history: historyRef(source.owner), access: 'read-only', needsBinding: true, capabilities: { ...capability(false), events: false } };
      }));
      signal?.throwIfAborted();
      const conversations = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failures = loaded.flatMap((r, index) => r.status === 'rejected' ? [{ sessionId: selected[index], error: { code: normalizeError(r.reason).code, message: normalizeError(r.reason).message } }] : []);
      return { protocol, conversations, complete: failures.length === 0, failures, cursor: { next: boundary + 1 + limit < ids.length ? selected.at(-1) : null } };
    }),
    historyRead: wrap(conversationHistoryReadRequest, async ({ sessionId, cursor, limit }, signal) => {
      const source = await savedSession(sessionId, signal);
      const messages = messagePageSchema.parse(await source.client.message.list({ sessionID: sessionId, cursor, limit, order: cursor ? undefined : 'desc' }, { signal }));
      signal?.throwIfAborted();
      return { protocol, history: historyRef(source.owner), session: source.session, messages, permissions: null, forms: null, activity: null, access: 'read-only', needsBinding: true, capabilities: { ...capability(false), events: false }, pendingState: 'Bind a live pane to inspect live activity and approvals' };
    }),
    rebind: wrap(conversationRebindRequest, async ({ target, sessionId }, signal, dispatch) => {
      requireIdentity(target);
      const scope = await authoritative(target); const source = await savedSession(sessionId, signal);
      if (source.owner.directory !== scope.root) throw new ApiError(409, 'conversation_location_changed', 'Select a pane in the saved conversation directory');
      if (nativeId(scope) === sessionId) throw new ApiError(409, 'conversation_read_only', 'The Herdr native agent already owns this session');
      await noNativeWriter(scope, sessionId);
      await verify(scope, signal);
      dispatch();
      await remember({ ...source.owner, identity: scope.target.identity, machine: 'local', paneId: scope.target.paneId });
      await verify(scope, signal);
      return { protocol, target: scope.target, session: source.session, access: 'owned', capabilities: capability(true) };
    }),
    resolve: wrap(conversationResolveRequest, async ({ target }, signal) => { const scope = await authoritative(target); const result = await describe(scope, signal); await verify(scope, signal); return result; }),
    list: wrap(conversationListRequest, async ({ target, cursor, limit }, signal) => {
      const scope = await authoritative(target);
      const ids = [...records.values()].filter((r) => r.identity === scope.target.identity).map((r) => r.sessionId).reverse();
      const native = nativeId(scope); if (native && !ids.includes(native)) ids.unshift(native);
      const boundary = cursor ? ids.indexOf(cursor) : -1;
      if (cursor && boundary < 0) throw new ApiError(400, 'conversation_cursor_invalid', 'This session cursor does not belong to the selected target');
      const selected = ids.slice(boundary + 1, boundary + 1 + limit);
      const loaded = await Promise.allSettled(selected.map(async (id) => { const source = await getSession(scope, id, signal); return { session: source.session, access: source.writable ? 'owned' : 'read-only', capabilities: capability(source.writable) }; }));
      const sessions = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failures = loaded.flatMap((r, index) => r.status === 'rejected' ? [{ sessionId: selected[index], error: { code: normalizeError(r.reason).code, message: normalizeError(r.reason).message } }] : []);
      await verify(scope, signal);
      return { protocol, target: scope.target, sessions, complete: failures.length === 0, failures, cursor: { next: boundary + 1 + limit < ids.length ? selected.at(-1) : null } };
    }),
    read: wrap(conversationReadRequest, async ({ target, sessionId, cursor, limit }, signal) => {
      const scope = await authoritative(target); const source = await getSession(scope, sessionId, signal);
      const [messages, permissions, forms, active] = await Promise.all([
        source.client.message.list({ sessionID: sessionId, cursor, limit, order: cursor ? undefined : 'desc' }, { signal }),
        source.client.permission.list({ sessionID: sessionId }, { signal }),
        source.client.session.form.list({ sessionID: sessionId }, { signal }),
        source.client.session.active({ signal }),
      ]);
      await verify(scope, signal);
      return { protocol, target: scope.target, session: source.session, messages: messagePageSchema.parse(messages), permissions: z.array(pendingPermission).parse(permissions), forms: z.array(pendingForm).parse(forms), activity: active[sessionId] ?? null, access: source.writable ? 'owned' : 'read-only', capabilities: capability(source.writable) };
    }),
    catalog: wrap(conversationCatalogRequest, async ({ target }, signal) => {
      const scope = await authoritative(target); const source = await runtime.get({ signal });
      const [models, agents] = await Promise.all([source.client.model.list({ location: { directory: scope.root } }, { signal }), source.client.agent.list({ location: { directory: scope.root } }, { signal })]);
      await verify(scope, signal);
      return { protocol, target: scope.target, models: modelsSchema.parse(models).data, agents: agentsSchema.parse(agents).data, authoritative: false, completeness: 'OpenCode agent catalogs can be partial while location plugins activate; catalog events request a fresh read' };
    }),
    registry: wrap(conversationRegistryRequest, async ({ target, sessionId, kind }, signal) => {
      const scope = await authoritative(target); const source = await getSession(scope, sessionId, signal);
      const location = { directory: scope.root };
      const entries = kind === 'commands'
        ? commandsSchema.parse(await source.client.command.list({ location }, { signal })).data
        : skillsSchema.parse(await source.client.skill.list({ location }, { signal })).data;
      await verify(scope, signal);
      return { protocol, target: scope.target, sessionId, kind, [kind]: entries };
    }),
    create: wrap(conversationCreateRequest, async ({ target, title }, signal, dispatch) => { requireIdentity(target); return create(await authoritative(target), title, signal, dispatch); }),
    act: wrap(conversationActionRequest, async ({ target, sessionId, action, input }, signal, dispatch) => {
      requireIdentity(target); const scope = await authoritative(target); const source = await getSession(scope, sessionId, signal, true);
      const client = source.client; const options = { signal }; const sessionID = sessionId;
      // These lookups are session/directory scoped and cannot grant access to an
      // unrelated permission, form, agent, model or message.
      if (action === 'model') {
        const models = modelsSchema.parse(await client.model.list({ location: { directory: scope.root } }, options)).data;
        const model = models.find((m) => m.id === input.id && m.providerID === input.providerID && m.enabled);
        if (!model || (input.variant && !model.variants.some((v) => v.id === input.variant))) throw new ApiError(400, 'conversation_model_unavailable', 'Choose an enabled model and variant from this pane catalog');
      }
      if (action === 'agent') {
        const agents = agentsSchema.parse(await client.agent.list({ location: { directory: scope.root } }, options)).data;
        if (!agents.some((a) => a.id === input.agent && !a.hidden && a.mode !== 'subagent')) throw new ApiError(400, 'conversation_agent_unavailable', 'Choose a primary agent from this pane catalog');
      }
      if (action === 'permission') {
        const pending = z.array(pendingPermission).parse(await client.permission.list({ sessionID }, options));
        if (!pending.some((p) => p.id === input.requestId && p.sessionID === sessionID)) throw new ApiError(409, 'conversation_permission_settled', 'This permission is no longer pending in the selected session');
      }
      if (action.startsWith('form_')) {
        const forms = z.array(pendingForm).parse(await client.session.form.list({ sessionID }, options));
        if (!forms.some((f) => f.id === input.formId && f.sessionID === sessionID)) throw new ApiError(409, 'conversation_form_settled', 'This form is no longer pending in the selected session');
      }
      if (action === 'command') {
        const commands = commandsSchema.parse(await client.command.list({ location: { directory: scope.root } }, options)).data;
        if (!commands.some((command) => command.name === input.command)) throw new ApiError(409, 'conversation_command_unavailable', 'This command is no longer available in the selected conversation');
      }
      if (action === 'prompt' && input.skills?.length) {
        const available = skillsSchema.parse(await client.skill.list({ location: { directory: scope.root } }, options)).data;
        if (input.skills.some((skill) => !available.some((entry) => entry.id === skill.id))) throw new ApiError(409, 'conversation_skill_unavailable', 'A selected skill is no longer available in this conversation');
      }
      if (action === 'command' || (action === 'prompt' && input.skills?.length)) await noNativeWriter(scope, sessionId);
      await verify(scope, signal);
      dispatch();
      let result;
      switch (action) {
        case 'prompt': result = await client.session.prompt({ sessionID, ...input }, options); break;
        case 'abort': result = await client.session.interrupt({ sessionID }, options); break;
        case 'rename': await client.session.update({ sessionID, title: input.title }, options); break;
        case 'delete': await client.session.remove({ sessionID }, options); await remember({ ...source.owner, deleted: true }); break;
        case 'model': await client.session.switchModel({ sessionID, model: input }, options); break;
        case 'agent': await client.session.switchAgent({ sessionID, agent: input.agent }, options); break;
        case 'permission': await client.permission.reply({ sessionID, requestID: input.requestId, decision: input.decision, message: input.message }, options); break;
        case 'form_reply': await client.session.form.reply({ sessionID, formID: input.formId, answer: input.answer }, options); break;
        case 'form_cancel': await client.session.form.cancel({ sessionID, formID: input.formId }, options); break;
        case 'fork': {
          const forkRequest = { sessionID };
          if (input.messageId) forkRequest.before = input.messageId;
          result = sessionRecordSchema.parse(await client.session.fork(forkRequest, options));
          const nonce = randomUUID();
          await remember({ sessionId: result.id, identity: scope.target.identity, directory: scope.root, nonce, kind: source.kind, machine: 'local', paneId: scope.target.paneId });
          await client.session.update({ sessionID: result.id, metadata: { ...result.metadata, openherdr: { owner: nonce } } }, options);
          result = sessionRecordSchema.parse(await client.session.get({ sessionID: result.id }, options)); break;
        }
        case 'revert_stage': result = await client.session.revert.stage({ sessionID, messageID: input.messageId }, options); break;
        case 'revert_clear': await client.session.revert.clear({ sessionID }, options); break;
        case 'revert_commit': await client.session.revert.commit({ sessionID }, options); break;
        case 'compact': result = await client.session.compact({ sessionID }, options); break;
        case 'command': await client.session.command({ sessionID, name: input.command, text: input.arguments ?? '', files: input.files, delivery: input.delivery }, options); break;
        case 'skill': await client.session.skill({ sessionID, id: input.skill }, options); break;
      }
      await verify(scope, signal);
      return { protocol, target: scope.target, sessionId, action, result: result ?? null };
    }),
    async *events(input) {
      const { target, sessionId } = parse(conversationEventsRequest, Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'signal')));
      const capture = runtime.capture(input.signal);
      let upstream;
      try {
        const scope = await authoritative(target); const source = await getSession(scope, sessionId, capture.signal);
        // A fresh stream requires an authoritative snapshot. v2's global SSE
        // also includes transient text deltas/permissions/forms absent from the
        // durable session log. Clients reconnect, then read again; no replay is claimed.
        upstream = source.client.event.subscribe({ signal: capture.signal })[Symbol.asyncIterator]();
        let next = await upstream.next();
        await verify(scope, capture.signal);
        yield { protocol, type: 'conversation.resync', target: scope.target, sessionId };
        const seen = new Set();
        while (!next.done) {
          const event = eventRecordSchema.parse(next.value);
          const data = event.data;
          const matches = data?.sessionID === sessionId || data?.form?.sessionID === sessionId;
          const catalog = ['model.updated', 'agent.updated', 'provider.updated', 'command.updated', 'skill.updated'].includes(event.type) && event.location?.directory === scope.root;
          if ((matches || catalog) && !(event.id && seen.has(event.id))) {
            await verify(scope, capture.signal);
            if (event.id) { seen.add(event.id); if (seen.size > 2048) seen.delete(seen.values().next().value); }
            yield { protocol, type: 'conversation.event', target: scope.target, sessionId, event };
          }
          next = await upstream.next();
        }
      } catch (error) { throw normalizeError(error); } finally { await upstream?.return?.(); capture.release(); }
    },
    async close() { closed = true; await runtime.close(); await writes.catch(() => undefined); await handle.close(); },
  };
  return service;
}
