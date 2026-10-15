import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const nativeSessionSchema = z.strictObject({
  source: z.string().min(1).max(80), agent: z.string().min(1).max(80),
  kind: z.enum(['id', 'path']), value: z.string().min(1).max(4096),
});
export const conversationTargetSchema = z.strictObject({
  machine: id, paneId: z.string().regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/),
  expectedAgentSession: nativeSessionSchema.nullable().optional(),
  identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
const target = conversationTargetSchema;
const page = { cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100).default(50) };
export const conversationResolveRequest = z.strictObject({ target });
export const conversationListRequest = z.strictObject({ target, ...page });
export const conversationReadRequest = z.strictObject({ target, sessionId: id, ...page });
export const conversationCatalogRequest = z.strictObject({ target });
export const conversationRegistryRequest = z.strictObject({ target, sessionId: id, kind: z.enum(['commands', 'skills']) });
const modelRefSchema = z.strictObject({ id, providerID: id, variant: z.string().min(1).max(200).optional() });
export const conversationCreateRequest = z.strictObject({ target, title: z.string().min(1).max(200).optional() });
const dataFile = z.strictObject({
  uri: z.string().max(12 * 1024 * 1024).regex(/^data:(?:text\/plain|image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/]*={0,2}$/).refine((value) => (value.length - value.indexOf(',') - 1) % 4 === 0, 'Invalid base64 length'),
  name: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/),
});
const fields = { target, sessionId: id };
const attachments = { files: z.array(dataFile).max(10).optional(), delivery: z.enum(['steer', 'queue']).optional() };
const attachmentLimit = (input) => (input.files ?? []).reduce((n, file) => n + file.uri.length, 0) <= 12 * 1024 * 1024;
const skills = z.array(z.strictObject({ id: z.string().min(1).max(4096) })).max(10).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Skill IDs must be unique');
const action = (name, input) => z.strictObject({ ...fields, action: z.literal(name), input });
const empty = z.strictObject({}).default({});
export const conversationActionRequest = z.discriminatedUnion('action', [
  action('prompt', z.strictObject({ text: z.string().max(256 * 1024), ...attachments, skills: skills.optional() }).refine((p) => p.text.trim() || p.files?.length, 'A prompt needs text or files').refine(attachmentLimit, 'Attachments exceed 12 MiB')),
  action('abort', empty), action('rename', z.strictObject({ title: z.string().min(1).max(200) })),
  action('delete', empty), action('model', modelRefSchema), action('agent', z.strictObject({ agent: id })),
  action('permission', z.strictObject({ requestId: id, decision: z.enum(['once', 'always', 'reject']), message: z.string().max(4096).optional() })),
  action('form_reply', z.strictObject({ formId: id, answer: z.record(z.string().max(200), z.union([z.string().max(65536), z.number().finite(), z.boolean(), z.array(z.string().max(4096)).max(100)])).refine((a) => Object.keys(a).length <= 100) })),
  action('form_cancel', z.strictObject({ formId: id })),
  action('fork', z.strictObject({ messageId: id.optional() })),
  action('revert_stage', z.strictObject({ messageId: id })), action('revert_clear', empty), action('revert_commit', empty),
  action('compact', empty), action('command', z.strictObject({ command: z.string().min(1).max(4096), arguments: z.string().max(65536).optional(), ...attachments, skills: skills.optional() }).refine(attachmentLimit, 'Attachments exceed 12 MiB')),
  action('skill', z.strictObject({ skill: id })),
]);
export const conversationEventsRequest = z.strictObject({ target, sessionId: id });
export const conversationHistoryListRequest = z.strictObject({ machine: z.literal('local'), ...page });
export const conversationHistoryReadRequest = z.strictObject({ sessionId: id, ...page });
export const conversationRebindRequest = z.strictObject({ target, sessionId: id });

// Preserve genuine v2 messages, including tool IDs and unknown optional usage.
// Text/reasoning content uses its native ordinal and has no upstream part ID.
export const sessionRecordSchema = z.object({
  id, location: z.object({ directory: z.string().min(1) }),
  time: z.object({ created: z.number(), updated: z.number() }).passthrough(),
  metadata: z.record(z.string(), z.json()).optional(),
}).passthrough();
const messageRecordSchema = z.object({ id, type: z.string().min(1), time: z.object({ created: z.number() }).passthrough() }).passthrough();
export const messagePageSchema = z.object({ data: z.array(messageRecordSchema), cursor: z.object({ previous: z.string().nullable().optional(), next: z.string().nullable().optional() }) });
export const eventRecordSchema = z.object({ type: z.string().min(1), id: z.string().optional(), created: z.number().optional(), data: z.json().optional() }).passthrough();

export const paneRecordSchema = z.object({
  pane_id: z.string(), terminal_id: z.string().optional(), workspace_id: z.string(), tab_id: z.string(),
  cwd: z.string(), foreground_cwd: z.string().optional(), agent: z.string().nullable().optional(),
  agent_session: nativeSessionSchema.nullable().optional(),
});
