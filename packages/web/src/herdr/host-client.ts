import { z } from 'zod';
import { prepareFileEditorContent, serializeEditorContent, type FileLineEnding } from '@openchamber/ui/components/views/fileEditorContent';
import { HerdrTransport, TransportError, type PendingDelivery } from './transport';

type HostTarget = { machine: string; pane_id: string };
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const fileBase = { root: z.string().min(1), path: z.string() };
const fileEntry = z.strictObject({ name: z.string(), path: z.string(), isDirectory: z.boolean(), size: z.number().nonnegative(), modifiedTime: z.number(), isSymbolicLink: z.boolean() });
const gitEntry = z.strictObject({ path: z.string(), index: z.string(), working_dir: z.string() });
const logEntry = z.strictObject({ hash: z.string(), date: z.string(), message: z.string(), refs: z.string(), body: z.string(), author_name: z.string(), author_email: z.string(), filesChanged: z.number(), insertions: z.number(), deletions: z.number(), parents: z.array(z.string()) });
export const hostSchemas = {
  list: z.strictObject({ ...fileBase, directory: z.string(), entries: z.array(fileEntry).max(500), truncated: z.boolean() }),
  file: z.strictObject({ ...fileBase, content: z.string(), bytes: z.number().nonnegative(), revision }),
  binary: z.strictObject({ ...fileBase, dataUrl: z.string().regex(/^data:[^;]+;base64,[A-Za-z0-9+/]*={0,2}$/), bytes: z.number().nonnegative(), revision }),
  download: z.strictObject({ ...fileBase, base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/), mime: z.string(), bytes: z.number().nonnegative(), revision }),
  search: z.strictObject({ root: z.string(), results: z.array(z.strictObject({ path: z.string(), preview: z.array(z.string()) })).max(200), truncated: z.boolean() }),
  fileMutation: z.strictObject({ ...fileBase, success: z.literal(true), revision: revision.nullable().optional() }),
  write: z.strictObject({ ...fileBase, success: z.literal(true), revision }),
  status: z.strictObject({ root: z.string(), current: z.string(), tracking: z.string().nullable(), ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(), files: z.array(gitEntry), isClean: z.boolean() }),
  diff: z.strictObject({ root: z.string(), diff: z.string() }),
  log: z.strictObject({ root: z.string(), all: z.array(logEntry).max(100), latest: logEntry.nullable(), total: z.number().int().nonnegative() }),
  branches: z.strictObject({ root: z.string(), current: z.string(), all: z.array(z.string()), branches: z.record(z.string(), z.strictObject({ current: z.boolean(), name: z.string(), commit: z.string(), label: z.string(), linkedWorktree: z.boolean() })) }),
  gitMutation: z.strictObject({ root: z.string(), success: z.literal(true) }),
  commit: z.strictObject({ root: z.string(), success: z.literal(true), commit: z.string(), branch: z.string(), summary: z.strictObject({ changes: z.number(), insertions: z.number(), deletions: z.number() }) }),
  branchMutation: z.strictObject({ root: z.string(), success: z.literal(true), branch: z.string() }),
};

type HostRead =
  | { operation: 'files.list' | 'files.read' | 'files.binary' | 'files.download'; path: string }
  | { operation: 'files.search'; path: string; query: string; maxResults: number; includeHidden: boolean }
  | { operation: 'git.status' | 'git.branches' }
  | { operation: 'git.log'; limit: number }
  | { operation: 'git.diff'; path?: string; staged: boolean };
export type HostMutation = { expectedRoot: string } & (
  | { operation: 'files.write'; path: string; content: string; expectedRevision: string | null }
  | { operation: 'files.upload'; path: string; base64: string; expectedRevision: string | null }
  | { operation: 'files.mkdir'; path: string }
  | { operation: 'files.rename'; path: string; newPath: string; expectedRevision: string | null }
  | { operation: 'files.delete'; path: string; expectedRevision: string | null }
  | { operation: 'git.stage' | 'git.unstage'; paths: string[] }
  | { operation: 'git.commit'; message: string }
  | { operation: 'git.branch'; name: string; startPoint?: string }
  | { operation: 'git.checkout'; branch: string }
);

export function targetKey(server: string, target: HostTarget): string {
  return JSON.stringify([server, target.machine, target.pane_id]);
}

export class HostClient {
  constructor(readonly transport: HerdrTransport, readonly target: HostTarget) {}
  read<T>(request: HostRead, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.transport.request('/api/herdr/host', schema, { method: 'POST', body: JSON.stringify({ request: { ...this.target, ...request } }), signal });
  }
  async mutate<T extends { root: string }>(request: HostMutation, schema: z.ZodType<T>) {
    const record: PendingDelivery = { requestId: crypto.randomUUID(), server: this.transport.connection.server, machine: this.target.machine, session: null, workspaceId: this.target.pane_id.split(':')[0] ?? '', tabId: '', paneId: this.target.pane_id, method: request.operation };
    const expectedPath = request.operation === 'files.rename' ? request.newPath : 'path' in request ? request.path : null;
    const pinnedResponse = schema.refine((value) => value.root === request.expectedRoot && (expectedPath === null || ('path' in value && value.path === expectedPath)));
    try {
      const outcome = await this.transport.trackedRequest(record, '/api/herdr/host', { ...this.target, ...request }, pinnedResponse);
      return { record, outcome };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError('OUTCOME_UNKNOWN', 'The host did not confirm this request', true, record.requestId);
    }
  }
}

export type FileDraft = {
  server: string;
  target: HostTarget;
  root: string;
  path: string;
  revision: string | null;
  baseContent: string;
  content: string;
  lineEnding: FileLineEnding;
  editVersion: number;
  reloadConflict?: boolean;
};
export function createFileDraft(input: Pick<FileDraft, 'server' | 'target' | 'root' | 'path' | 'revision' | 'content'>): FileDraft {
  const prepared = prepareFileEditorContent(input.content);
  return { ...input, baseContent: prepared.content, content: prepared.content, lineEnding: prepared.lineEnding, editVersion: 0 };
}
export function draftKey(draft: Pick<FileDraft, 'server' | 'target' | 'root' | 'path'>): string {
  return JSON.stringify([draft.server, draft.target.machine, draft.target.pane_id, draft.root, draft.path]);
}
export function editFileDraft(draft: FileDraft, content: string): FileDraft {
  return { ...draft, content, editVersion: draft.editVersion + 1 };
}
export function prepareFileSave(draft: FileDraft, client: HostClient, currentRoot: string | null, disabled: boolean): HostMutation & { operation: 'files.write' } {
  if (disabled || targetKey(draft.server, draft.target) !== targetKey(client.transport.connection.server, client.target) || currentRoot !== draft.root) throw new TransportError('target_changed', 'The pane directory changed. Your edits are kept');
  return { operation: 'files.write', expectedRoot: draft.root, path: draft.path, expectedRevision: draft.revision, content: serializeEditorContent(draft.content, draft.lineEnding) };
}
export function finishFileSave(current: FileDraft, saved: FileDraft, result: z.infer<typeof hostSchemas.write>): FileDraft {
  if (draftKey(current) !== draftKey(saved) || result.root !== saved.root || result.path !== saved.path) throw new TransportError('INVALID_RESPONSE', 'The saved file does not match this editor', true);
  return { ...current, revision: result.revision, baseContent: saved.content, reloadConflict: false };
}


export function acceptFileReload(current: FileDraft | undefined, captured: FileDraft | undefined, incoming: FileDraft): FileDraft {
  if (current && (!captured || draftKey(current) !== draftKey(captured) || current.editVersion !== captured.editVersion || current.content !== captured.content || current.revision !== captured.revision || current.baseContent !== captured.baseContent || current.lineEnding !== captured.lineEnding)) return { ...current, reloadConflict: true };
  return incoming;
}

export function isConfirmedHostRefusal(error: Error): error is TransportError & { requestId: string } {
  return error instanceof TransportError && !error.uncertain && !!error.requestId && !['DELIVERY_STORAGE', 'INVALID_RESPONSE', 'OUTCOME_UNKNOWN'].includes(error.code);
}

export function fileBytesToBase64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}
export function downloadBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}
