import { afterEach, expect, test } from 'bun:test';
import { HerdrAssetClient, type AssetLease, type FileDescription } from './asset-client';
import { HerdrTransport, TransportError } from './transport';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const connection = { server: 'https://paired.example', token: 'private-fixture-device' };
const target = { machine: 'saved-ssh', pane_id: 'w1:p1', terminal_id: 'terminal-a' };
const file: FileDescription = { root: '/repo', path: 'clip.mp4', terminal_id: target.terminal_id, assetVersion: 'stat-v1:' + 'a'.repeat(64), bytes: 4, sampleKind: 'binary' };
const source = (description = file) => new HerdrAssetClient(new HerdrTransport(connection), target, description);
const lease = (): AssetLease => ({ ...file, assetId: 'A'.repeat(43), url: '/api/herdr/assets/' + 'A'.repeat(43), resolvedUrl: connection.server + '/api/herdr/assets/' + 'A'.repeat(43), mime: 'video/mp4', fileName: 'clip.mp4', expiresAt: Date.now() + 600000, maxExpiresAt: Date.now() + 3600000 });
const signal = () => new AbortController().signal;
async function rejection(operation: Promise<AssetLease | File>, code: string) {
  try { await operation; } catch (error) { if (!(error instanceof TransportError)) throw error; expect(error.code).toBe(code); return; }
  throw new Error('Expected a transport refusal');
}

test('capability requests pin the saved host, occupant and stat version while bearer stays out of URLs', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const { resolvedUrl: _resolved, ...wire } = lease();
    return Response.json(wire);
  }, originalFetch);
  const result = await source().acquire('preview', signal());
  expect(result.resolvedUrl).toBe(connection.server + result.url);
  expect(calls[0]?.url).toBe(connection.server + '/api/herdr/assets');
  expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe('Bearer ' + connection.token);
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ ...target, expectedRoot: file.root, path: file.path, expectedAssetVersion: file.assetVersion, purpose: 'preview' });
  expect(result.resolvedUrl).not.toContain(connection.token);
});

test('wrong identity, unsafe resource URL and malformed metadata cannot become a preview URL', async () => {
  for (const changed of [{ root: '/other' }, { path: 'other.mp4' }, { terminal_id: 'replacement' }, { assetVersion: 'stat-v1:' + 'b'.repeat(64) }, { bytes: 5 }, { sampleKind: 'text' }, { url: 'https://elsewhere.example/raw' }, { url: '/api/herdr/assets/' + 'A'.repeat(43) + '?token=bad' }]) {
    globalThis.fetch = Object.assign(async () => { const { resolvedUrl: _resolved, ...wire } = lease(); return Response.json({ ...wire, ...changed }); }, originalFetch);
    await rejection(source().acquire('preview', signal()), 'INVALID_RESPONSE');
  }
});

test('same-ID renewal retains its URL and rejects a changed absolute expiry', async () => {
  const current = lease();
  globalThis.fetch = Object.assign(async () => Response.json({ assetId: current.assetId, expiresAt: current.expiresAt + 1000, maxExpiresAt: current.maxExpiresAt }), originalFetch);
  const renewed = await source().renew(current, signal());
  expect(renewed.resolvedUrl).toBe(current.resolvedUrl);
  expect(renewed.expiresAt).toBe(current.expiresAt + 1000);
  globalThis.fetch = Object.assign(async () => Response.json({ assetId: current.assetId, expiresAt: current.expiresAt, maxExpiresAt: current.maxExpiresAt + 1000 }), originalFetch);
  await rejection(source().renew(current, signal()), 'INVALID_RESPONSE');
});

test('native share materializes only its pinned capability body without sending bearer headers', async () => {
  const current = lease(); const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(new Uint8Array([0, 128, 255, 10]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } });
  }, originalFetch);
  const output = await source().nativeDownload(current, signal());
  expect(output.name).toBe('clip.mp4'); expect([...new Uint8Array(await output.arrayBuffer())]).toEqual([0, 128, 255, 10]);
  expect(calls).toHaveLength(1); expect(calls[0]?.url).toBe(current.resolvedUrl);
  expect(new Headers(calls[0]?.init?.headers).has('Authorization')).toBe(false);
  expect(calls[0]?.init?.redirect).toBe('error'); expect(calls[0]?.init?.credentials).toBe('omit');
});

test('native share refuses oversized metadata before making a raw request', async () => {
  let calls = 0; globalThis.fetch = Object.assign(async () => { calls++; throw new Error('Unexpected raw read'); }, originalFetch);
  await rejection(source().nativeDownload({ ...lease(), bytes: 8 * 1024 * 1024 + 1 }, signal()), 'native_download_limit');
  expect(calls).toBe(0);
});

test('native share rejects partial, excessive, MIME-changing and ranged responses', async () => {
  for (const response of [
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } }),
    () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } }),
    () => new Response(new Uint8Array(4), { headers: { 'Content-Type': 'text/html', 'Content-Length': '4' } }),
    () => new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } }),
    () => new Response(new Uint8Array(4), { headers: { 'Content-Type': 'video/mp4' } }),
  ]) {
    globalThis.fetch = Object.assign(async () => response(), originalFetch);
    await rejection(source().nativeDownload(lease(), signal()), 'INVALID_RESPONSE');
  }
});

test('native owner cancellation retires a blocked reader and returns no File', async () => {
  const controller = new AbortController(); let cancelled = 0;
  globalThis.fetch = Object.assign(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } }), originalFetch);
  const operation = source().nativeDownload(lease(), controller.signal);
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  try { await operation; throw new Error('Expected cancellation'); } catch (error) { expect(error).toBeInstanceOf(DOMException); }
  expect(cancelled).toBe(1);
});
