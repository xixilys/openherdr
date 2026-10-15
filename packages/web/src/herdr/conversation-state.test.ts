import { describe, expect, test } from 'bun:test';
import { ConversationDraftStore, draftIdentity, readConversationLines, reconcileConversationTail } from './conversation-state';
import type { ConversationRecord } from '@openchamber/ui/lib/opencode/herdr-driver';

const record = (id: string, created: number, text: string): ConversationRecord => ({ message: { id, sessionID: 'ses_real', role: 'user', time: { created } }, parts: [{ id: `${id}:text`, sessionID: 'ses_real', messageID: id, type: 'text', text }] });

describe('conversation draft ownership', () => {
  test('late enqueue confirmation clears only the captured unchanged draft', () => {
    const drafts = new ConversationDraftStore(); const old = draftIdentity('https://one.example', 'local', 'w1:p1', 'ses_old'); const selected = draftIdentity('https://one.example', 'local', 'w1:p2', 'ses_new');
    drafts.update(old, () => ({ text: 'Sending', files: [{ id: 'file-one', name: 'real.txt', mimeType: 'text/plain', uri: 'data:text/plain;base64,eA==' }] }));
    const revision = drafts.get(old).revision;
    drafts.update(selected, () => ({ text: 'Current draft', files: [] }));
    expect(drafts.acknowledge(old, revision)).toBe(true);
    expect(drafts.get(selected).text).toBe('Current draft');
    drafts.update(old, () => ({ text: 'Original', files: [] })); const sent = drafts.get(old).revision;
    drafts.update(old, () => ({ text: 'Edited while sending', files: [] }));
    expect(drafts.acknowledge(old, sent)).toBe(false); expect(drafts.get(old).text).toBe('Edited while sending');
  });
  test('an unknown delivery leaves text and prepared file bytes available', () => {
    const drafts = new ConversationDraftStore(); const key = draftIdentity('https://one.example', 'local', 'w1:p1', 'ses_old');
    drafts.update(key, () => ({ text: 'Unconfirmed', files: [{ id: 'f', name: 'actual.txt', mimeType: 'text/plain', uri: 'data:text/plain;base64,eA==' }] }));
    const before = drafts.get(key); expect(drafts.get(key)).toBe(before);
    expect(draftIdentity('https://other.example', 'local', 'w1:p1', 'ses_old')).not.toBe(key);
  });
});

test('authoritative tail replaces removed/newer records without duplicating paged history', () => {
  const previous = [record('m1', 1, 'Older page'), record('m2', 2, 'Old content'), record('m3', 3, 'Removed')];
  const incoming = [record('m2', 2, 'New content'), record('m4', 4, 'New reply')];
  const merged = reconcileConversationTail(previous, incoming, true);
  expect(merged.map((item) => item.message.id)).toEqual(['m1', 'm2', 'm4']);
  expect(merged[1].parts[0]).toMatchObject({ text: 'New content' });
  expect(reconcileConversationTail(previous, [], false)).toEqual([]);
});

test('NDJSON survives split frames and refuses incomplete or malformed payloads', async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"type":"one')); controller.enqueue(encoder.encode('"}\n{"type":"two"}\n')); controller.close(); } }));
  const values = []; for await (const value of readConversationLines(response, new AbortController().signal)) values.push(value);
  expect(values).toEqual([{ type: 'one' }, { type: 'two' }]);
  const incomplete = readConversationLines(new Response('{"type":"half"}'), new AbortController().signal);
  await expect(incomplete.next()).rejects.toThrow('conversationIncompleteFrame');
  const malformed = readConversationLines(new Response('{oops}\n'), new AbortController().signal);
  await expect(malformed.next()).rejects.toThrow();
});
