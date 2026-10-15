import { z } from 'zod';
import type { SessionInfo, SessionMessageInfo, FormInfo } from '@opencode/client';
import { projectMessage, projectSession } from './projection';

const id = z.string().min(1).max(256);
const json = z.record(z.string(), z.json());
const model = z.object({ id, providerID: id, variant: z.string().optional() });
const tokens = z.object({ input: z.number(), output: z.number(), reasoning: z.number(), cache: z.object({ read: z.number(), write: z.number() }) });
const error = z.object({ type: z.string(), message: z.string(), status: z.number().optional(), response: z.object({ body: z.string() }).optional() });
const time = z.object({ created: z.number(), streamed: z.number().optional(), completed: z.number().optional() });
const base = { id, time, metadata: json.optional() };
const location = z.object({ directory: z.string() });
const fileDiff = z.object({ file: z.string(), patch: z.string(), additions: z.number(), deletions: z.number(), status: z.enum(['added', 'deleted', 'modified']) });
const sessionWire: z.ZodType<SessionInfo> = z.object({
  id, parentID: id.optional(), projectID: id, location, subpath: z.string().optional(), title: z.string().optional(),
  agent: id.optional(), model: model.optional(), cost: z.number(), tokens,
  time: z.object({ created: z.number(), updated: z.number(), idle: z.number().optional(), viewed: z.number().optional(), archived: z.number().optional() }),
  outcome: z.enum(['succeeded', 'failed', 'interrupted']).optional(), metadata: json.optional(),
  permissions: z.array(z.object({ action: z.string(), resource: z.string(), effect: z.enum(['allow', 'deny', 'ask']) })).optional(),
  revert: z.object({ messageID: id, partID: id.optional(), snapshot: z.string().optional(), files: z.array(fileDiff).optional() }).optional(),
  fork: z.object({ sessionID: id, boundary: z.object({ type: z.enum(['before', 'through']), messageID: id }) }).optional(),
});
const attachment = z.object({ data: z.string(), mime: z.string(), source: z.discriminatedUnion('type', [z.object({ type: z.literal('inline') }), z.object({ type: z.literal('uri'), uri: z.string() })]), name: z.string().optional(), description: z.string().optional(), mention: z.object({ start: z.number(), end: z.number(), text: z.string() }).optional() });
const toolContent = z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('file'), uri: z.string(), mime: z.string(), name: z.string().nullable().optional() })]);
const toolContents = z.tuple([toolContent]).rest(toolContent);
const tool = z.object({ type: z.literal('tool'), id, name: z.string(), executed: z.boolean().optional(), time: z.object({ created: z.number(), ran: z.number().optional(), completed: z.number().optional() }), state: z.discriminatedUnion('status', [
  z.object({ status: z.literal('streaming'), input: z.string() }),
  z.object({ status: z.literal('running'), input: json, metadata: json }),
  z.object({ status: z.literal('completed'), input: json, content: toolContents, metadata: json.optional() }),
  z.object({ status: z.literal('error'), input: json, error, content: toolContents.optional(), metadata: json.optional() }),
]) });
const messageWire: z.ZodType<SessionMessageInfo> = z.union([
  z.object({ ...base, type: z.literal('user'), text: z.string(), files: z.array(attachment).optional(), agents: z.array(z.object({ name: z.string() })).optional(), skills: z.array(z.object({ id, name: z.string(), text: z.string().optional() })).optional() }),
  z.object({ ...base, type: z.literal('assistant'), agent: id, model, content: z.array(z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string(), state: json.optional() }), z.object({ type: z.literal('reasoning'), text: z.string(), state: json.optional(), time: z.object({ created: z.number(), completed: z.number().optional() }).optional() }), tool])), finish: z.enum(['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']).optional(), cost: z.number().optional(), tokens: tokens.optional(), error: error.optional(), retry: z.object({ attempt: z.number(), at: z.number(), error }).optional(), snapshot: z.object({ start: z.string().optional(), end: z.string().optional(), files: z.array(z.string()).optional() }).optional() }),
  z.object({ ...base, type: z.enum(['system', 'synthetic']), text: z.string(), description: z.string().optional() }),
  z.object({ ...base, type: z.literal('skill'), skill: id, name: z.string(), text: z.string() }),
  z.object({ ...base, type: z.literal('shell'), shellID: id, command: z.string(), status: z.enum(['running', 'exited', 'timeout', 'killed']), exit: z.union([z.number(), z.enum(['Infinity', '-Infinity', 'NaN'])]).optional(), output: z.object({ output: z.string(), cursor: z.number(), size: z.number(), truncated: z.boolean() }).optional() }),
  z.object({ ...base, type: z.literal('agent-switched'), agent: id, previous: id.optional() }),
  z.object({ ...base, type: z.literal('model-switched'), model, previous: model.optional() }),
  z.object({ ...base, type: z.literal('location-switched'), location, projectID: id.optional(), subpath: z.string().optional(), previous: z.object({ location, projectID: id.optional(), subpath: z.string().optional() }).nullable().optional() }),
  z.object({ ...base, type: z.literal('idle'), outcome: z.enum(['succeeded', 'failed', 'interrupted']), error: error.optional() }),
  z.object({ ...base, type: z.literal('compaction'), status: z.literal('running'), reason: z.enum(['auto', 'manual']), summary: z.string(), recent: z.string() }),
  z.object({ ...base, type: z.literal('compaction'), status: z.literal('completed'), reason: z.enum(['auto', 'manual']), summary: z.string(), recent: z.string(), cost: z.number().optional(), tokens: tokens.optional() }),
  z.object({ ...base, type: z.literal('compaction'), status: z.literal('failed'), reason: z.enum(['auto', 'manual']), error, cost: z.number().optional(), tokens: tokens.optional() }),
]);

const when = z.array(z.object({ key: z.string(), op: z.enum(['eq', 'neq']), value: z.union([z.string(), z.number(), z.boolean()]) }));
const fieldBase = { key: z.string(), title: z.string().optional(), description: z.string().optional(), required: z.boolean().optional(), hidden: z.boolean().optional(), when: when.optional() };
const option = z.object({ value: z.string(), label: z.string(), description: z.string().optional() });
const nonfinite = z.union([z.number(), z.enum(['Infinity', '-Infinity', 'NaN'])]);
const formField = z.discriminatedUnion('type', [
  z.object({ ...fieldBase, type: z.literal('string'), format: z.enum(['email', 'uri', 'date', 'date-time']).optional(), minLength: z.number().optional(), maxLength: z.number().optional(), pattern: z.string().optional(), placeholder: z.string().optional(), default: z.string().optional(), options: z.array(option).optional(), custom: z.boolean().optional() }),
  z.object({ ...fieldBase, type: z.enum(['number', 'integer']), minimum: nonfinite.optional(), maximum: nonfinite.optional(), default: nonfinite.optional() }),
  z.object({ ...fieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({ ...fieldBase, type: z.literal('multiselect'), options: z.array(option), minItems: z.number().optional(), maxItems: z.number().optional(), custom: z.boolean().optional(), default: z.array(z.string()).optional() }),
  z.object({ type: z.literal('external'), key: z.string(), url: z.string().url().refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)), title: z.string().optional(), description: z.string().optional() }),
]);
const formSchema: z.ZodType<FormInfo> = z.object({ id, sessionID: id, title: z.string(), fields: z.tuple([formField]).rest(formField), metadata: json.optional() });
const permissionSchema = z.object({ id, sessionID: id, action: z.string(), resources: z.array(z.string()), save: z.array(z.string()).optional(), message: z.string().optional(), metadata: json.optional(), source: z.object({ type: z.literal('tool'), messageID: id, id }).optional() });
export const driverTargetSchema = z.object({ machine: id, paneId: id, identity: z.string(), expectedAgentSession: z.object({ source: z.string(), agent: z.string(), kind: z.enum(['id', 'path']), value: z.string() }).nullable().optional() });
export type ConversationTarget = z.infer<typeof driverTargetSchema>;
const protocol = z.literal('opencode-v2');
const capabilities = z.object({ create: z.boolean().optional(), prompt: z.boolean().optional(), abort: z.boolean().optional(), permissions: z.boolean().optional(), forms: z.boolean().optional(), modelSelection: z.boolean().optional(), agentSelection: z.boolean().optional(), attachments: z.union([z.boolean(), z.literal('inline-data-uri')]).optional(), rename: z.boolean().optional(), delete: z.boolean().optional(), fork: z.boolean().optional(), revert: z.boolean().optional(), compact: z.boolean().optional(), commands: z.boolean().optional(), skills: z.boolean().optional(), events: z.boolean().optional() });
const sessionSchema = sessionWire.transform(projectSession);
const cursor = z.object({ previous: z.string().nullable().optional(), next: z.string().nullable().optional() });
const history = z.object({ machine: id, sessionId: id, directory: z.string(), lastPaneId: id.optional() });
const failure = z.object({ sessionId: id, error: z.object({ code: z.string(), message: z.string() }) });
const row = z.object({ session: sessionSchema, access: z.enum(['owned', 'read-only']), capabilities });
export const driverResolveSchema = z.object({ protocol, target: driverTargetSchema, directory: z.string(), nativeAccess: z.enum(['read-only', 'unavailable', 'path-reader-pending']), session: sessionSchema.optional(), capabilities });
export const driverListSchema = z.object({ protocol, target: driverTargetSchema, sessions: z.array(row), complete: z.boolean(), failures: z.array(failure), cursor });
export const driverHistoryListSchema = z.object({ protocol, conversations: z.array(row.extend({ history, needsBinding: z.boolean() })), complete: z.boolean(), failures: z.array(failure), cursor });
const snapshotWire = {
  protocol, session: sessionWire,
  messages: z.object({ data: z.array(messageWire), cursor }),
  permissions: z.array(permissionSchema).nullable(), forms: z.array(formSchema).nullable(),
  activity: z.object({ type: z.literal('running') }).nullable(), access: z.enum(['owned', 'read-only']), capabilities,
};
function projectSnapshot(value: z.infer<z.ZodObject<typeof snapshotWire>>) {
  return { ...value, session: projectSession(value.session), messages: value.messages.data.map((item) => projectMessage(item, value.session.id)).sort((a, b) => a.message.time.created - b.message.time.created || a.message.id.localeCompare(b.message.id)), cursor: value.messages.cursor };
}
export const driverReadSchema = z.object({ ...snapshotWire, target: driverTargetSchema }).transform((value) => ({ ...projectSnapshot(value), target: value.target, history: null }));
export const driverHistoryReadSchema = z.object({ ...snapshotWire, history }).transform((value) => ({ ...projectSnapshot(value), target: null, history: value.history }));
export type ConversationSnapshot = z.infer<typeof driverReadSchema> | z.infer<typeof driverHistoryReadSchema>;
export type ConversationRecord = ConversationSnapshot['messages'][number];
export type ConversationForm = NonNullable<ConversationSnapshot['forms']>[number];
export const driverCreateSchema = z.object({ protocol, target: driverTargetSchema, session: sessionSchema, access: z.literal('owned'), capabilities });
export const driverActionSchema = z.object({ protocol, target: driverTargetSchema, sessionId: id, action: z.string(), result: z.json() });
export const driverForkSchema = z.object({ protocol, target: driverTargetSchema, sessionId: id, action: z.literal('fork'), result: sessionSchema });
export const driverPromptSchema = z.object({ protocol, target: driverTargetSchema, sessionId: id, action: z.literal('prompt'), result: z.object({ id, sessionID: id, type: z.literal('user'), time: z.object({ created: z.number() }), delivery: z.enum(['steer', 'queue']) }) });
export const driverCatalogSchema = z.object({ protocol, target: driverTargetSchema, models: z.array(z.object({ id, providerID: id, modelID: id.optional(), name: z.string(), enabled: z.boolean(), variants: z.array(z.object({ id })), capabilities: z.object({ tools: z.boolean(), input: z.array(z.string()), output: z.array(z.string()) }), limit: z.object({ context: z.number(), output: z.number(), input: z.number().optional() }) })), agents: z.array(z.object({ id, name: z.string(), description: z.string().optional(), hidden: z.boolean(), mode: z.enum(['primary', 'subagent', 'all']) })), authoritative: z.boolean(), completeness: z.string() });
export type ConversationCatalog = z.infer<typeof driverCatalogSchema>;
export const driverEventSchema = z.discriminatedUnion('type', [
  z.object({ protocol, type: z.literal('conversation.resync'), target: driverTargetSchema, sessionId: id }),
  z.object({ protocol, type: z.literal('conversation.event'), target: driverTargetSchema, sessionId: id, event: z.object({ type: z.string(), id: z.string().optional(), data: z.json().optional() }) }),
  z.object({ protocol, type: z.literal('conversation.error'), sessionId: id, error: z.object({ code: z.string(), message: z.string() }) }),
]);

/** Merge an authoritative fresh tail without dropping already paged history. */
export function mergeConversationMessages(previous: ConversationRecord[], incoming: ConversationRecord[]): ConversationRecord[] {
  const items = new Map(previous.map((record) => [record.message.id, record]));
  for (const record of incoming) items.set(record.message.id, record);
  return [...items.values()].sort((a, b) => a.message.time.created - b.message.time.created || a.message.id.localeCompare(b.message.id));
}
