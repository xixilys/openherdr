import { describe, expect, test } from 'bun:test';
import { driverReadSchema, driverHistoryReadSchema, driverPromptSchema, driverCatalogSchema, driverForkSchema } from './herdr-driver';
import { partIds } from './model';

const target = { machine: 'local', paneId: 'w1:p1', identity: 'a'.repeat(64), expectedAgentSession: null };
const session = { id: 'ses_real', projectID: 'project_real', title: 'Source', location: { directory: '/owned/fixture' }, cost: 0.42, tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }, time: { created: 100, updated: 200 } };
const assistant = { id: 'msg_real', type: 'assistant', agent: 'build', model: { providerID: 'provider_real', id: 'model_real' }, time: { created: 150, completed: 180 }, content: [
  { type: 'text', text: 'Actual answer' },
  { type: 'reasoning', text: 'Actual reasoning', time: { created: 151, completed: 152 } },
  { type: 'tool', id: 'call_real', name: 'read', time: { created: 153, ran: 154, completed: 155 }, state: { status: 'completed', input: { path: 'file.ts' }, content: [{ type: 'text', text: 'Actual bytes' }] } },
] };
const page = { protocol: 'opencode-v2', target, session, messages: { data: [assistant], cursor: { next: 'opaque-older' } }, permissions: [], forms: [], activity: null, access: 'owned', capabilities: { prompt: true, fork: true } };

describe('real OpenCode driver projection', () => {
  test('uses original message/part identities and keeps optional usage unknown', () => {
    const result = driverReadSchema.parse(page);
    expect(result.session.cost).toBe(0.42); expect(result.session.tokens.cache.read).toBe(3);
    expect(result.messages[0].message.id).toBe('msg_real');
    expect(result.messages[0].message).not.toHaveProperty('tokens');
    expect(result.messages[0].parts[2].id).toBe(partIds.tool('call_real'));
    expect(result.messages[0].parts[2]).toMatchObject({ callID: 'call_real', state: { input: { path: 'file.ts' }, output: 'Actual bytes' } });
    expect(result.cursor.next).toBe('opaque-older');
  });
  test('missing required source fields and malformed parts fail instead of becoming empty chat', () => {
    const { cost: _cost, ...missingCost } = session;
    expect(driverReadSchema.safeParse({ ...page, session: missingCost }).success).toBe(false);
    expect(driverReadSchema.safeParse({ ...page, messages: { data: [{ ...assistant, model: undefined }], cursor: {} } }).success).toBe(false);
    expect(driverReadSchema.safeParse({ ...page, messages: { data: [{ ...assistant, content: [{ type: 'invented', text: 'No' }] }], cursor: {} } }).success).toBe(false);
  });
  test('saved history is distinct from a live writable binding and live unknown stays null', () => {
    const { target: _target, ...withoutTarget } = page;
    const result = driverHistoryReadSchema.parse({ ...withoutTarget, history: { machine: 'local', sessionId: session.id, directory: session.location.directory, lastPaneId: target.paneId }, access: 'read-only', permissions: null, forms: null });
    expect(result.target).toBeNull(); expect(result.activity).toBeNull(); expect(result.permissions).toBeNull(); expect(result.forms).toBeNull();
  });
  test('permission resources and conditional form defaults survive intact', () => {
    const result = driverReadSchema.parse({ ...page, permissions: [{ id: 'permission_real', sessionID: session.id, action: 'shell', resources: ['actual command'], save: ['actual command'] }], forms: [{ id: 'form_real', sessionID: session.id, title: 'Choose', fields: [{ type: 'boolean', key: 'enabled', default: true }, { type: 'string', key: 'detail', required: true, when: [{ key: 'enabled', op: 'eq', value: true }] }] }] });
    expect(result.permissions?.[0].resources).toEqual(['actual command']);
    expect(result.forms?.[0].fields[1]).toMatchObject({ required: true, when: [{ key: 'enabled', op: 'eq', value: true }] });
  });
  test('prompt confirmation requires a genuine inbox ID and matching source kind', () => {
    const response = { protocol: 'opencode-v2', target, sessionId: session.id, action: 'prompt', result: { id: 'msg_admitted', sessionID: session.id, type: 'user', time: { created: 300 }, delivery: 'queue' } };
    expect(driverPromptSchema.parse(response).result.id).toBe('msg_admitted');
    expect(driverPromptSchema.safeParse({ ...response, result: null }).success).toBe(false);
    expect(driverPromptSchema.safeParse({ ...response, result: { ...response.result, id: undefined } }).success).toBe(false);
  });
  test('fork results use the same original session projection', () => {
    const result = driverForkSchema.parse({ protocol: 'opencode-v2', target, sessionId: session.id, action: 'fork', result: { ...session, id: 'ses_fork' } });
    expect(result.result.id).toBe('ses_fork'); expect(result.result.directory).toBe('/owned/fixture');
  });
  test('model catalog has actual modality data and never invents provider fields', () => {
    const parsed = driverCatalogSchema.parse({ protocol: 'opencode-v2', target, models: [{ id: 'model_real', providerID: 'provider_real', name: 'Real', enabled: true, variants: [{ id: 'high' }], capabilities: { tools: true, input: ['text', 'image'], output: ['text'] }, limit: { context: 1000, output: 100 } }], agents: [], authoritative: false, completeness: 'cold' });
    expect(parsed.models[0].capabilities.input).toEqual(['text', 'image']); expect(parsed.agents).toEqual([]); expect(parsed.authoritative).toBe(false);
  });
});
