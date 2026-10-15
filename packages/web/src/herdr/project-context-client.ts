import { z } from 'zod';
import { HerdrTransport, TransportError, type PendingDelivery } from './transport';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(160);
const timestamp = z.number().nonnegative();
const note = z.strictObject({ id: identifier, body: z.string().max(3000), source: z.enum(['manual', 'selection', 'agent']), createdAt: timestamp, updatedAt: timestamp, pinned: z.boolean(), origin: z.strictObject({ sessionId: z.string(), messageId: z.string().optional() }).optional() });
const todo = z.strictObject({ id: identifier, text: z.string().max(1000), completed: z.boolean(), createdAt: timestamp });
const planLink = z.strictObject({ id: identifier, file: z.string(), title: z.string(), createdAt: timestamp, pinned: z.boolean(), source: z.literal('personal') });
const plan = z.strictObject({ id: identifier, file: z.string(), title: z.string(), createdAt: timestamp, body: z.string(), raw: z.string().max(200000), source: z.literal('personal') });
export const projectContextSchema = z.strictObject({
  owner: z.strictObject({ id: digest, machine: identifier, root: z.string().min(1), workspaceId: identifier, paneId: identifier }),
  revision: digest,
  context: z.strictObject({ notes: z.array(note).max(200), todos: z.array(todo).max(500), plans: z.array(planLink).max(500) }),
  plan: plan.optional(),
});
export type ProjectContext = z.infer<typeof projectContextSchema>;
export type ProjectContextMutation = { expectedOwner: string; expectedRevision: string } & (
  | { operation: 'context.note.create'; body: string }
  | { operation: 'context.note.update'; noteId: string; body: string }
  | { operation: 'context.note.delete'; noteId: string }
  | { operation: 'context.todo.create'; text: string }
  | { operation: 'context.todo.update'; todoId: string; text?: string; completed?: boolean }
  | { operation: 'context.todo.delete'; todoId: string }
  | { operation: 'context.todo.reorder'; todoIds: string[] }
  | { operation: 'context.plan.create'; title: string; body: string }
  | { operation: 'context.plan.update'; planId: string; raw: string }
  | { operation: 'context.plan.delete'; planId: string }
);
export type ProjectEntryKind = 'note' | 'todo' | 'plan';
export type ProjectEntryDraft = {
  server: string;
  owner: ProjectContext['owner'];
  revision: string;
  kind: ProjectEntryKind;
  id: string;
  text: string;
  baseText: string;
};
export const projectDraftKey = (draft: Pick<ProjectEntryDraft, 'server' | 'owner' | 'kind' | 'id'>) => JSON.stringify([draft.server, draft.owner.machine, draft.owner.id, draft.kind, draft.id]);

export function projectDraftMutation(draft: ProjectEntryDraft, server: string, owner: ProjectContext['owner'], disabled: boolean): ProjectContextMutation {
  if (disabled || server !== draft.server || owner.id !== draft.owner.id || owner.machine !== draft.owner.machine) throw new TransportError('project_owner_changed', 'The selected project changed. Your edits were kept');
  const pinned = { expectedOwner: draft.owner.id, expectedRevision: draft.revision };
  if (draft.kind === 'note') return { ...pinned, operation: 'context.note.update', noteId: draft.id, body: draft.text };
  if (draft.kind === 'todo') return { ...pinned, operation: 'context.todo.update', todoId: draft.id, text: draft.text };
  return { ...pinned, operation: 'context.plan.update', planId: draft.id, raw: draft.text };
}
export function confirmProjectDraft(current: ProjectEntryDraft, sent: ProjectEntryDraft, response: ProjectContext): ProjectEntryDraft {
  if (projectDraftKey(current) !== projectDraftKey(sent) || response.owner.id !== sent.owner.id || response.owner.machine !== sent.owner.machine) throw new TransportError('INVALID_RESPONSE', 'The response belongs to a different project', true);
  const stored = sent.kind === 'note' ? response.context.notes.find((entry) => entry.id === sent.id)?.body : sent.kind === 'todo' ? response.context.todos.find((entry) => entry.id === sent.id)?.text : response.plan?.id === sent.id ? response.plan.raw : undefined;
  if (stored === undefined) throw new TransportError('INVALID_RESPONSE', 'The saved project entry is missing', true);
  return { ...current, revision: response.revision, baseText: stored, text: current.text === sent.text ? stored : current.text };
}

export class ProjectContextClient {
  constructor(readonly transport: HerdrTransport, readonly target: { machine: string; pane_id: string }) {}
  private responseSchema(expectedOwner?: string, planId?: string) {
    return projectContextSchema.refine((response) => response.owner.machine === this.target.machine && response.owner.paneId === this.target.pane_id && response.owner.workspaceId === this.target.pane_id.split(':')[0] && (!expectedOwner || response.owner.id === expectedOwner) && (!planId || response.plan?.id === planId));
  }
  read(signal?: AbortSignal): Promise<ProjectContext> {
    return this.transport.request('/api/herdr/project-context', this.responseSchema(), { method: 'POST', body: JSON.stringify({ request: { ...this.target, operation: 'context.read' } }), signal });
  }
  readPlan(planId: string, expectedOwner: string, signal?: AbortSignal): Promise<ProjectContext> {
    return this.transport.request('/api/herdr/project-context', this.responseSchema(expectedOwner, planId), { method: 'POST', body: JSON.stringify({ request: { ...this.target, operation: 'context.plan.read', planId } }), signal });
  }
  async mutate(request: ProjectContextMutation) {
    const record: PendingDelivery = { requestId: crypto.randomUUID(), server: this.transport.connection.server, machine: this.target.machine, session: null, workspaceId: this.target.pane_id.split(':')[0] ?? '', tabId: '', paneId: this.target.pane_id, method: request.operation };
    const schema = this.responseSchema(request.expectedOwner, request.operation === 'context.plan.update' ? request.planId : undefined).refine((response) => {
      switch (request.operation) {
        case 'context.note.create': return response.context.notes.some((entry) => entry.body === request.body.trim());
        case 'context.note.update': return response.context.notes.some((entry) => entry.id === request.noteId && entry.body === request.body.trim());
        case 'context.note.delete': return !response.context.notes.some((entry) => entry.id === request.noteId);
        case 'context.todo.create': return response.context.todos.some((entry) => entry.text === request.text.trim());
        case 'context.todo.update': return response.context.todos.some((entry) => entry.id === request.todoId && (request.text === undefined || entry.text === request.text.trim()) && (request.completed === undefined || entry.completed === request.completed));
        case 'context.todo.delete': return !response.context.todos.some((entry) => entry.id === request.todoId);
        case 'context.todo.reorder': return JSON.stringify(response.context.todos.map((entry) => entry.id)) === JSON.stringify(request.todoIds);
        case 'context.plan.create': return response.plan !== undefined && response.context.plans.some((entry) => entry.id === response.plan?.id);
        case 'context.plan.update': return response.plan?.raw === request.raw;
        case 'context.plan.delete': return !response.context.plans.some((entry) => entry.id === request.planId);
      }
    });
    return { record, outcome: await this.transport.trackedRequest(record, '/api/herdr/project-context', { ...this.target, ...request }, schema) };
  }
}
