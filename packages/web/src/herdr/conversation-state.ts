import type { ConversationRecord } from '@openchamber/ui/lib/opencode/herdr-driver';
import { mergeConversationMessages } from '@openchamber/ui/lib/opencode/herdr-driver';
import { prepareAttachmentFiles } from '@openchamber/ui/sync/attachment-files';
import { z } from 'zod';

export type ConversationAttachment = { id: string; name: string; uri: string; mimeType: string };
export type ConversationDraft = { text: string; files: ConversationAttachment[]; revision: number };
const emptyDraft: ConversationDraft = { text: '', files: [], revision: 0 };

/** Drafts live for the page lifetime and belong to a server, target and session. */
export class ConversationDraftStore {
  private drafts = new Map<string, ConversationDraft>();
  private listeners = new Map<string, Set<() => void>>();
  get(key: string): ConversationDraft { return this.drafts.get(key) ?? emptyDraft; }
  subscribe(key: string, listener: () => void): () => void {
    const list = this.listeners.get(key) ?? new Set(); list.add(listener); this.listeners.set(key, list);
    return () => { list.delete(listener); if (!list.size) this.listeners.delete(key); };
  }
  update(key: string, change: (draft: ConversationDraft) => Pick<ConversationDraft, 'text' | 'files'>): void {
    const previous = this.get(key);
    this.drafts.set(key, { ...change(previous), revision: previous.revision + 1 });
    this.listeners.get(key)?.forEach((listener) => listener());
  }
  acknowledge(key: string, revision: number): boolean {
    if (this.get(key).revision !== revision) return false;
    this.update(key, () => ({ text: '', files: [] })); return true;
  }
}
export const conversationDrafts = new ConversationDraftStore();

export function draftIdentity(server: string, machine: string, paneId: string, sessionId: string | null): string {
  return JSON.stringify([server, machine, paneId, sessionId]);
}

/** A fresh tail replaces its window; older pages outside that window survive. */
export function reconcileConversationTail(previous: ConversationRecord[], incoming: ConversationRecord[], hasOlder: boolean): ConversationRecord[] {
  if (!hasOlder || !incoming.length) return incoming;
  const first = incoming[0].message;
  return mergeConversationMessages(previous.filter(({ message }) => message.time.created < first.time.created || (message.time.created === first.time.created && message.id < first.id)), incoming);
}

const readDataUrl = (file: File, signal?: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  const abort = () => { reader.abort(); reject(new DOMException('Attachment preparation cancelled', 'AbortError')); };
  if (signal?.aborted) return abort();
  signal?.addEventListener('abort', abort, { once: true });
  const cleanup = () => signal?.removeEventListener('abort', abort);
  reader.onerror = () => { cleanup(); reject(new Error('attachmentReadFailed')); };
  reader.onload = () => { cleanup(); const value = z.string().safeParse(reader.result); if (!value.success) reject(new Error('attachmentReadFailed')); else resolve(value.data); };
  reader.readAsDataURL(file);
});

export async function prepareConversationAttachments(files: File[], existing: ConversationAttachment[], signal?: AbortSignal): Promise<ConversationAttachment[]> {
  const result: ConversationAttachment[] = [];
  const reserved = existing.map((file) => file.name);
  for (const file of files) {
    signal?.throwIfAborted();
    if (file.size > 20 * 1024 * 1024) throw new Error('attachmentTooLarge');
    const prepared = await prepareAttachmentFiles(file, reserved);
    if (!prepared?.length) throw new Error('attachmentUnsupported');
    for (const item of prepared) {
      const name = [...item.file.name].map((char) => char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char).join('');
      const uri = await readDataUrl(new File([item.file], name, { type: item.mimeType }), signal);
      reserved.push(name); result.push({ id: crypto.randomUUID(), name, uri, mimeType: item.mimeType });
    }
  }
  if (existing.length + result.length > 10 || [...existing, ...result].reduce((size, file) => size + file.uri.length, 0) > 12 * 1024 * 1024) throw new Error('attachmentTooLarge');
  return result;
}

/** Framing is independent of the authenticated transport and wire projection. */
export async function* readConversationLines(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  if (!response.body) throw new Error('conversationDisconnected');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read(); buffered += decoder.decode(next.value, { stream: !next.done });
      if (buffered.length > 16 * 1024 * 1024) throw new Error('conversationFrameTooLarge');
      let boundary = buffered.indexOf('\n');
      while (boundary >= 0) {
        const line = buffered.slice(0, boundary).trim(); buffered = buffered.slice(boundary + 1);
        if (line) yield JSON.parse(line);
        boundary = buffered.indexOf('\n');
      }
      if (next.done) { if (buffered.trim()) throw new Error('conversationIncompleteFrame'); return; }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
