import crypto from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { z } from 'zod';
import { ApiError } from './contracts.js';
import { assetDescribeRequestSchema, assetMetadataSchema } from './asset-protocol.js';
import { resolveByteRange } from '../lib/fs/byte-range.js';

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ASSET_PREFIX = '/api/herdr/assets/';
const mintSchema = assetDescribeRequestSchema.omit({ operation: true }).extend({
  expectedAssetVersion: z.string().regex(/^stat-v1:[a-f0-9]{64}$/).optional(),
  purpose: z.enum(['preview', 'download']),
});
const descriptionSchema = z.strictObject({ binding: z.string().min(1).max(256), metadata: assetMetadataSchema });
const emptySchema = z.strictObject({});
const inlineTypes = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['ico', 'image/x-icon'],
  ['bmp', 'image/bmp'], ['avif', 'image/avif'], ['pdf', 'application/pdf'],
  ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'],
  ['wav', 'audio/wav'], ['flac', 'audio/flac'], ['ogg', 'audio/ogg'],
  ['oga', 'audio/ogg'], ['opus', 'audio/ogg'], ['weba', 'audio/webm'],
  ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['webm', 'video/webm'],
  ['mov', 'video/quicktime'], ['ogv', 'video/ogg'], ['mkv', 'video/x-matroska'],
  ['ttf', 'font/ttf'], ['otf', 'font/otf'], ['woff', 'font/woff'], ['woff2', 'font/woff2'],
]);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'invalid_asset_request', 'Choose one file in the selected pane');
  return result.data;
}

function unavailable() {
  return new ApiError(403, 'asset_unavailable', 'This file address has expired or is unavailable. Reopen the file.');
}

function invalidResponse() {
  return new ApiError(502, 'invalid_asset_response', 'The host returned an incomplete or invalid file');
}

function fileDisposition(kind, fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function checkedMetadata(value, request, expectedVersion, mismatch = new ApiError(409, 'asset_changed', 'The file or pane changed. Reopen the file.')) {
  const parsed = assetMetadataSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  const metadata = parsed.data;
  if (metadata.root !== request.expectedRoot || metadata.path !== request.path || metadata.terminal_id !== request.terminal_id || (expectedVersion && metadata.assetVersion !== expectedVersion)) {
    throw mismatch;
  }
  return metadata;
}

// Capabilities delegate one file read. They are not evidence of physical device
// identity, and the metadata version is not an immutable content snapshot.
export function createHerdrAssets({ bridge, getClient, requirePolicy, clock = { now: Date.now, setTimeout, clearTimeout } }) {
  const grants = new Map();
  const operations = new Set();
  let closed = false;

  const abortGrant = (grant) => {
    for (const operation of operations) if (operation.grant === grant) operation.controller.abort();
  };
  const removeGrant = (grant) => {
    grant.released = true;
    clock.clearTimeout(grant.timer);
    grants.delete(grant.id);
    abortGrant(grant);
  };
  const expireGrant = (grant) => {
    if (grant.released || grant.expiresAt > clock.now()) return;
    grant.expired = true;
    if (grant.purpose === 'preview') abortGrant(grant);
    // An admitted download retains its client/grant cancellation owner after
    // expiry. It cannot start another request through this capability.
    if (![...operations].some((operation) => operation.grant === grant)) grants.delete(grant.id);
  };
  const armExpiry = (grant) => {
    clock.clearTimeout(grant.timer);
    const generation = ++grant.timerGeneration;
    grant.timer = clock.setTimeout(() => {
      if (generation === grant.timerGeneration) expireGrant(grant);
    }, Math.max(0, grant.expiresAt - clock.now()));
    grant.timer?.unref?.();
  };
  const prune = () => {
    for (const grant of grants.values()) expireGrant(grant);
  };
  const reserve = (clientId, req, res, grant = null, createsGrant = false) => {
    prune();
    if (closed) throw unavailable();
    const ownOperations = [...operations].filter((operation) => operation.clientId === clientId);
    if (operations.size >= 32 || ownOperations.length >= 8 || (grant && [...operations].filter((operation) => operation.grant === grant).length >= 4)) {
      throw new ApiError(429, 'asset_capacity', 'Too many file reads are already in progress. Try again when one finishes.');
    }
    if (createsGrant) {
      const liveGrants = [...grants.values()].filter((entry) => !entry.expired && !entry.released);
      const pendingMints = [...operations].filter((operation) => operation.createsGrant);
      if (liveGrants.length + pendingMints.length >= 128 || liveGrants.filter((entry) => entry.clientId === clientId).length + ownOperations.filter((operation) => operation.createsGrant).length >= 16) {
        throw new ApiError(429, 'asset_capacity', 'Too many file previews are open. Close one before opening another.');
      }
    }
    const controller = new AbortController();
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const operation = { clientId, grant, createsGrant, controller, done };
    operations.add(operation);
    const deadline = clock.setTimeout(() => controller.abort(new ApiError(504, 'asset_timeout', 'The file read exceeded its one-hour limit')), ONE_HOUR);
    deadline?.unref?.();
    const abort = () => controller.abort();
    const requestClosed = () => { if (!req.complete) abort(); };
    req.once('aborted', abort); req.once('close', requestClosed); res.once('close', abort);
    if (req.aborted || res.destroyed) abort();
    let finished = false;
    return {
      signal: controller.signal,
      finish() {
        if (finished) return;
        finished = true;
        clock.clearTimeout(deadline);
        req.off('aborted', abort); req.off('close', requestClosed); res.off('close', abort);
        controller.abort();
        operations.delete(operation);
        if (grant?.expired && ![...operations].some((entry) => entry.grant === grant)) grants.delete(grant.id);
        resolveDone();
      },
    };
  };
  const clientAuthority = async (clientId) => {
    if (closed) throw unavailable();
    requirePolicy();
    const client = await getClient(clientId);
    if (closed || !client || client.revokedAt) throw unavailable();
    const expiry = client.expiresAt ? Date.parse(client.expiresAt) : Infinity;
    if (!(expiry > clock.now())) throw unavailable();
    requirePolicy();
    return expiry;
  };
  const authority = async (grant, signal, admitted = false) => {
    signal.throwIfAborted();
    if (grant.released || ((!admitted || grant.purpose === 'preview') && grant.expiresAt <= clock.now())) throw unavailable();
    const expiry = await clientAuthority(grant.clientId);
    signal.throwIfAborted();
    if (grant.released || ((!admitted || grant.purpose === 'preview') && grant.expiresAt <= clock.now())) throw unavailable();
    return expiry;
  };
  const ownedGrant = (clientId, id) => {
    const grant = grants.get(id);
    if (!grant || grant.clientId !== clientId || grant.released) throw new ApiError(404, 'asset_not_found', 'This file address is no longer available');
    return grant;
  };
  const describe = async (request, signal, binding, expectedVersion) => {
    if (!bridge.describeAsset) throw new ApiError(501, 'assets_unavailable', 'File streaming is unavailable on this host');
    signal.throwIfAborted();
    const value = await bridge.describeAsset(request, { signal, expectedBinding: binding });
    signal.throwIfAborted();
    const parsed = descriptionSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse();
    if (binding && parsed.data.binding !== binding) throw new ApiError(409, 'asset_changed', 'The selected machine changed. Reopen the file.');
    return { binding: parsed.data.binding, metadata: checkedMetadata(parsed.data.metadata, request, expectedVersion) };
  };

  return {
    async inspect(clientId, value, req, res) {
      const request = parse(assetDescribeRequestSchema, value);
      const capture = reserve(clientId, req, res);
      try {
        await clientAuthority(clientId);
        const { metadata } = await describe(request, capture.signal);
        await clientAuthority(clientId);
        capture.signal.throwIfAborted();
        return metadata;
      } finally { capture.finish(); }
    },
    async mint(clientId, value, req, res) {
      const body = parse(mintSchema, value);
      const capture = reserve(clientId, req, res, null, true);
      try {
        const clientExpiry = await clientAuthority(clientId);
        capture.signal.throwIfAborted();
        const { purpose, expectedAssetVersion, ...target } = body;
        const request = { operation: 'files.describe', ...target };
        const description = await describe(request, capture.signal, undefined, expectedAssetVersion);
        await clientAuthority(clientId);
        capture.signal.throwIfAborted();
        const now = clock.now();
        const metadata = description.metadata;
        const fileName = path.posix.basename(metadata.path);
        const extension = path.posix.extname(fileName).slice(1).toLowerCase();
        const mime = inlineTypes.get(extension) ?? 'application/octet-stream';
        const id = crypto.randomBytes(32).toString('base64url');
        const maxExpiresAt = Math.min(now + ONE_HOUR, clientExpiry);
        const grant = { id, clientId, request, binding: description.binding, metadata, purpose, mime, fileName, maxExpiresAt,
          expiresAt: Math.min(now + TEN_MINUTES, maxExpiresAt), expired: false, released: false, timerGeneration: 0, timer: null };
        grants.set(id, grant);
        armExpiry(grant);
        return { ...metadata, assetId: id, url: `${ASSET_PREFIX}${id}`, expiresAt: grant.expiresAt, maxExpiresAt, mime, fileName };
      } finally { capture.finish(); }
    },
    async renew(clientId, id, value, req, res) {
      parse(emptySchema, value);
      const grant = ownedGrant(clientId, id);
      const capture = reserve(clientId, req, res, grant);
      try {
        const clientExpiry = await authority(grant, capture.signal);
        await describe(grant.request, capture.signal, grant.binding, grant.metadata.assetVersion);
        await authority(grant, capture.signal);
        grant.expiresAt = Math.min(clock.now() + TEN_MINUTES, grant.maxExpiresAt, clientExpiry);
        armExpiry(grant);
        return { assetId: id, expiresAt: grant.expiresAt, maxExpiresAt: grant.maxExpiresAt };
      } finally { capture.finish(); }
    },
    release(clientId, id) {
      removeGrant(ownedGrant(clientId, id));
      return { released: true };
    },
    async read(id, req, res) {
      prune();
      const grant = grants.get(id);
      if (!grant || grant.released || grant.expired || grant.expiresAt <= clock.now()) throw unavailable();
      const capture = reserve(grant.clientId, req, res, grant);
      let opened;
      try {
        await authority(grant, capture.signal);
        const span = req.method === 'HEAD' || req.headers['if-range'] ? { kind: 'whole' } : resolveByteRange(req.headers.range, grant.metadata.bytes);
        const headOnly = req.method === 'HEAD' || span.kind === 'unsatisfiable' || grant.metadata.bytes === 0;
        if (!bridge.openAsset) throw new ApiError(501, 'assets_unavailable', 'File streaming is unavailable on this host');
        const request = { ...grant.request, operation: 'files.raw', expectedAssetVersion: grant.metadata.assetVersion };
        opened = await bridge.openAsset(request, { signal: capture.signal, expectedBinding: grant.binding, range: span.kind === 'range' ? { start: span.start, end: span.end } : null, headOnly });
        capture.signal.throwIfAborted();
        const metadata = checkedMetadata(opened.metadata, grant.request, grant.metadata.assetVersion, invalidResponse());
        if (metadata.bytes !== grant.metadata.bytes || metadata.sampleKind !== grant.metadata.sampleKind) throw invalidResponse();
        // HEAD, zero-byte files and 416 have no tail to withhold. Confirm their
        // metadata-only helper completion before emitting their response headers.
        if (headOnly) for await (const chunk of opened.body) if (chunk.byteLength) throw invalidResponse();
        await authority(grant, capture.signal);
        const length = span.kind === 'range' ? span.end - span.start + 1 : metadata.bytes;
        const headers = {
          'Content-Type': grant.mime,
          'Content-Length': span.kind === 'unsatisfiable' ? 0 : length,
          'Content-Disposition': fileDisposition(grant.purpose === 'preview' && grant.mime !== 'application/octet-stream' ? 'inline' : 'attachment', grant.fileName),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition, Content-Type',
        };
        if (span.kind === 'range') headers['Content-Range'] = `bytes ${span.start}-${span.end}/${metadata.bytes}`;
        if (span.kind === 'unsatisfiable') headers['Content-Range'] = `bytes */${metadata.bytes}`;
        res.writeHead(span.kind === 'unsatisfiable' ? 416 : span.kind === 'range' ? 206 : 200, headers);
        if (headOnly) { res.end(); return; }
        const write = async (chunk) => {
          capture.signal.throwIfAborted();
          if (chunk.length && !res.write(chunk)) await once(res, 'drain', { signal: capture.signal });
        };
        let received = 0;
        let tail;
        for await (const chunk of opened.body) {
          capture.signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw invalidResponse();
          received += chunk.byteLength;
          if (received > length) throw invalidResponse();
          if (!chunk.byteLength) continue;
          if (tail) await write(tail);
          const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          await write(bytes.subarray(0, bytes.length - 1));
          tail = Buffer.from(bytes.subarray(bytes.length - 1));
        }
        if (received !== length) throw invalidResponse();
        // Auth and policy changes are checked before headers and at completion,
        // not continuously while an admitted body's descriptor is being read.
        await authority(grant, capture.signal, true);
        if (tail) await write(tail);
        res.end();
      } finally {
        try { await opened?.close(); } finally { capture.finish(); }
      }
    },
    revoke(clientId) {
      for (const grant of grants.values()) if (grant.clientId === clientId) removeGrant(grant);
      for (const operation of operations) if (operation.clientId === clientId) operation.controller.abort();
    },
    async close() {
      closed = true;
      for (const grant of grants.values()) removeGrant(grant);
      for (const operation of operations) operation.controller.abort();
      await Promise.all([...operations].map((operation) => operation.done));
    },
  };
}
