import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ApiError } from './contracts.js';
import { z } from 'zod';

const receiptEntry = z.strictObject({
  key: z.string().min(1),
  requestId: z.string().min(8).max(128),
  machine: z.string().min(1).max(160),
  method: z.string().min(1).max(80),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['unknown', 'complete', 'rejected']),
  recordedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  response: z.strictObject({ id: z.string(), result: z.json() }).optional(),
});

export async function createReceiptStore(file) {
  const entries = new Map();
  try {
    const raw = await fs.readFile(file, 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      const entry = receiptEntry.parse(JSON.parse(line));
      entries.set(entry.key, entry);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let queue = Promise.resolve();
  const serialized = async (operation) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  };
  const save = async (entry) => {
    const handle = await fs.open(file, 'a', 0o600);
    try { await handle.writeFile(`${JSON.stringify(entry)}\n`); await handle.sync(); } finally { await handle.close(); }
    entries.set(entry.key, entry);
  };
  return {
    async begin(clientId, request) {
      return serialized(async () => {
        const key = `${clientId}:${request.requestId}`;
        const existing = entries.get(key);
        if (existing) {
          const error = new ApiError(409, 'request_already_recorded', 'This request was already recorded. Check its receipt before sending new input.');
          error.receipt = existing;
          throw error;
        }
        const entry = { key, requestId: request.requestId, machine: request.machine, method: request.method, hash: createHash('sha256').update(JSON.stringify(request)).digest('hex'), status: 'unknown', recordedAt: new Date().toISOString() };
        await save(entry);
        return entry;
      });
    },
    finish(entry, status, response) {
      const completed = { ...entry, status, completedAt: new Date().toISOString() };
      if (response) completed.response = response;
      return serialized(() => save(completed));
    },
    get(clientId, requestId) { return entries.get(`${clientId}:${requestId}`) || null; },
  };
}
