import { z } from 'zod';
import { hostSchemas } from './host-client';
import { HerdrTransport, TransportError } from './transport';

export type FileDescription = z.infer<typeof hostSchemas.describe>;
export type AssetTarget = { machine: string; pane_id: string; terminal_id: string };
const assetId = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const leaseSchema = hostSchemas.describe.extend({
  assetId, url: z.string(), expiresAt: timestamp, maxExpiresAt: timestamp,
  mime: z.string().min(1), fileName: z.string().min(1),
});
const renewalSchema = z.strictObject({ assetId, expiresAt: timestamp, maxExpiresAt: timestamp });
const releaseSchema = z.strictObject({ released: z.boolean() });
export type AssetLease = z.infer<typeof leaseSchema> & { resolvedUrl: string };
const nativeDownloadLimit = 8 * 1024 * 1024;

/** An exact-file capability client. The paired bearer stays in this transport. */
export class HerdrAssetClient {
  constructor(readonly transport: HerdrTransport, readonly target: AssetTarget, readonly file: FileDescription) {}

  private async control<T>(path: string, schema: z.ZodType<T>, options: Pick<RequestInit, 'method' | 'body'>, signal: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const deadline = setTimeout(abort, 20000);
    try { return await this.transport.request(path, schema, { ...options, signal: controller.signal }); }
    finally { clearTimeout(deadline); signal.removeEventListener('abort', abort); }
  }

  async acquire(purpose: 'preview' | 'download', signal: AbortSignal): Promise<AssetLease> {
    signal.throwIfAborted();
    const value = await this.control('/api/herdr/assets', leaseSchema, {
      method: 'POST', body: JSON.stringify({ ...this.target, expectedRoot: this.file.root, path: this.file.path, expectedAssetVersion: this.file.assetVersion, purpose }),
    }, signal);
    if (value.root !== this.file.root || value.path !== this.file.path || value.terminal_id !== this.target.terminal_id
      || value.assetVersion !== this.file.assetVersion || value.bytes !== this.file.bytes || value.sampleKind !== this.file.sampleKind
      || value.url !== `/api/herdr/assets/${value.assetId}` || value.expiresAt <= Date.now() || value.expiresAt > value.maxExpiresAt) {
      throw new TransportError('INVALID_RESPONSE', 'Invalid server response');
    }
    const lease = { ...value, resolvedUrl: new URL(value.url, this.transport.connection.server).href };
    if (signal.aborted) { void this.release(lease).catch(() => {}); signal.throwIfAborted(); }
    return lease;
  }

  async renew(lease: AssetLease, signal: AbortSignal): Promise<AssetLease> {
    signal.throwIfAborted();
    const result = await this.control(`${lease.url}/renew`, renewalSchema, { method: 'POST', body: '{}' }, signal);
    signal.throwIfAborted();
    if (result.assetId !== lease.assetId || result.maxExpiresAt !== lease.maxExpiresAt || result.expiresAt <= Date.now() || result.expiresAt > result.maxExpiresAt) {
      throw new TransportError('INVALID_RESPONSE', 'Invalid server response');
    }
    return { ...lease, ...result };
  }

  async release(lease: AssetLease): Promise<boolean> {
    const result = await this.control(lease.url, releaseSchema, { method: 'DELETE' }, new AbortController().signal);
    return result.released;
  }

  async nativeDownload(lease: AssetLease, signal: AbortSignal): Promise<File> {
    if (lease.bytes > nativeDownloadLimit) throw new TransportError('native_download_limit', 'native_download_limit');
    signal.throwIfAborted();
    const response = await fetch(lease.resolvedUrl, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const mime = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    const expectedMime = lease.mime.split(';', 1)[0]?.trim().toLowerCase();
    const declaredLength = response.headers.get('Content-Length');
    if (response.status !== 200 || mime !== expectedMime || declaredLength === null || !/^\d+$/.test(declaredLength) || Number(declaredLength) !== lease.bytes) {
      await response.body?.cancel();
      throw new TransportError('INVALID_RESPONSE', 'Invalid server response');
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const reader = response.body?.getReader();
    let bytes = 0;
    const abort = () => { void reader?.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (reader) {
        while (true) {
          signal.throwIfAborted();
          const result = await reader.read();
          signal.throwIfAborted();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > nativeDownloadLimit || bytes > lease.bytes) throw new TransportError('INVALID_RESPONSE', 'Invalid server response');
          chunks.push(new Uint8Array(result.value));
        }
      }
      if (bytes !== lease.bytes) throw new TransportError('INVALID_RESPONSE', 'Invalid server response');
      return new File(chunks, lease.fileName, { type: lease.mime });
    } finally {
      signal.removeEventListener('abort', abort);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
