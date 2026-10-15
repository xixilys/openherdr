import { afterEach, describe, expect, test } from 'bun:test';
import { HostClient, draftKey } from './host-client';
import { HerdrTransport, TransportError } from './transport';
import { createHerdrMarkdownAssetSource, FilePreviewSourceError } from './file-preview-source';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const connection = { server: 'https://paired.example', token: 'fixture-private-device' };
const target = { machine: 'saved-ssh', pane_id: 'w1:p1' };
const revision = 'a'.repeat(64);
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const base64 = btoa(String.fromCharCode(...image));

function fixture(root = '/repo', filePath = 'docs/readme.md') {
  const client = new HostClient(new HerdrTransport(connection), target);
  return { client, source: createHerdrMarkdownAssetSource(client, root, filePath) };
}

function download(path: string, options: { root?: string; mime?: string; base64?: string; bytes?: number } = {}) {
  return Response.json({ root: options.root ?? '/repo', path, base64: options.base64 ?? base64, bytes: options.bytes ?? image.length, mime: options.mime ?? 'image/png', revision });
}

function endpoint(response: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit; body: unknown }[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init, body: init?.body ? JSON.parse(String(init.body)) : null });
    return response();
  }, { preconnect() {} });
  return calls;
}

function expectSourceError(operation: () => string, reference: string, code: FilePreviewSourceError['code']) {
  let caught: Error | undefined;
  try { operation(); } catch (error) { if (error instanceof Error) caught = error; }
  expect(caught).toBeInstanceOf(FilePreviewSourceError);
  if (caught instanceof FilePreviewSourceError) {
    expect(caught.code).toBe(code);
    expect(caught.reference).toBe(reference);
  }
}

async function expectSourceRejection(read: Promise<Blob>, code: FilePreviewSourceError['code'], reference: string): Promise<void> {
  try { await read; }
  catch (error) {
    if (!(error instanceof FilePreviewSourceError)) throw error;
    expect(error).toBeInstanceOf(FilePreviewSourceError);
    expect(error.code).toBe(code);
    expect(error.reference).toBe(reference);
    return;
  }
  throw new Error('Expected the image source to reject the reference');
}

async function expectTransportRejection(read: Promise<Blob>, code: string): Promise<void> {
  try { await read; }
  catch (error) {
    if (!(error instanceof TransportError)) throw error;
    expect(error).toBeInstanceOf(TransportError);
    expect(error.code).toBe(code);
    return;
  }
  throw new Error('Expected the image transport to reject the request');
}

async function expectAbortRejection(read: Promise<Blob>, reason: Error): Promise<void> {
  try { await read; }
  catch (error) {
    if (error !== reason) throw error;
    expect(error).toBe(reason);
    return;
  }
  throw new Error('Expected the image read to reject with its abort reason');
}

describe('captured Markdown preview source', () => {
  test('source keys include the exact file owner and never contain credentials', () => {
    const { source } = fixture();
    expect(source.key).toBe(draftKey({ server: connection.server, target, root: '/repo', path: 'docs/readme.md' }));
    expect(source.key).not.toContain(connection.token);
    const changes = [
      createHerdrMarkdownAssetSource(new HostClient(new HerdrTransport({ ...connection, server: 'https://other.example' }), target), '/repo', 'docs/readme.md'),
      createHerdrMarkdownAssetSource(new HostClient(new HerdrTransport(connection), { ...target, machine: 'other' }), '/repo', 'docs/readme.md'),
      createHerdrMarkdownAssetSource(new HostClient(new HerdrTransport(connection), { ...target, pane_id: 'w2:p1' }), '/repo', 'docs/readme.md'),
      fixture('/other').source,
      fixture('/repo', 'other.md').source,
    ];
    for (const changed of changes) expect(changed.key).not.toBe(source.key);
    const replacedCredential = createHerdrMarkdownAssetSource(new HostClient(new HerdrTransport({ ...connection, token: 'replacement-device' }), target), '/repo', 'docs/readme.md');
    expect(replacedCredential.key).toBe(source.key);
  });
  test('resolves relative references against the Markdown directory and permits parent paths within root', () => {
    const { source } = fixture();
    expect(source.resolve('./shot.png')).toBe('docs/shot.png');
    expect(source.resolve('../images/shot.png')).toBe('images/shot.png');
    expect(source.resolve('./images/../shot.png')).toBe('docs/shot.png');
    expect(source.resolve('/repo/images/shot.png')).toBe('images/shot.png');
    expect(source.resolve('../notes.md?view=source#heading')).toBe('notes.md');
    expect(fixture('/', 'docs/readme.md').source.resolve('/images/shot.png')).toBe('images/shot.png');
  });
  test('decodes UTF-8, spaces and reserved filename characters once after stripping raw query/hash', () => {
    const { source } = fixture();
    expect(source.resolve('../%E5%9B%BE%E7%89%87/%E6%B5%8B%E8%AF%95%20image.png?size=2#part')).toBe('图片/测试 image.png');
    expect(source.resolve('name%23part%3Fquery.png?discard=this#also')).toBe('docs/name#part?query.png');
    expect(source.resolve('name%2523literal.png')).toBe('docs/name%23literal.png');
    expect(source.resolve('%252e%252e/shot.png')).toBe('docs/%2e%2e/shot.png');
    expect(source.resolve('literal%25.png')).toBe('docs/literal%.png');
  });
  test('malformed references, schemes, network paths and controls are rejected locally', () => {
    const { source } = fixture();
    const calls = endpoint(() => { throw new Error('Unexpected request'); });
    for (const reference of ['', '#heading', '?only=query', 'broken%.png', '%E0%A4.png', 'https://outside.example/a.png', 'file:///repo/a.png', 'data:image/png;base64,AA==', 'javascript:alert(1)', '//outside.example/a.png', '%2F%2Foutside.example/a.png', 'images\\a.png', 'image%5Ca.png', 'bad\x00.png', 'bad%00.png', 'bad\x7f.png', 'bad%0a.png']) {
      expectSourceError(() => source.resolve(reference), reference, 'invalid_reference');
    }
    expect(calls).toHaveLength(0);
  });
  test('root escape, sibling roots and .git paths are rejected before any download', async () => {
    const { source } = fixture();
    const calls = endpoint(() => { throw new Error('Unexpected request'); });
    for (const reference of ['../../outside.png', '../%2e%2e/outside.png', '/repo-other/a.png', '/etc/a.png', '/repo/../outside.png', '../.git/config', '../.GiT/objects/a.png', '../%2egit/config', 'hidden/.git/../a.png']) {
      expectSourceError(() => source.resolve(reference), reference, 'outside_root');
    }
    await expectSourceRejection(source.readImage('../../outside.png', new AbortController().signal), 'outside_root', '../../outside.png');
    await expectSourceRejection(source.readImage('.git/config', new AbortController().signal), 'outside_root', '.git/config');
    expect(calls).toHaveLength(0);
    expect(() => fixture('/repo', '/outside/readme.md')).toThrow(FilePreviewSourceError);
    expect(() => fixture('relative-root')).toThrow(FilePreviewSourceError);
  });
  test('image reads use only the captured authenticated host download operation', async () => {
    const { source } = fixture();
    const calls = endpoint(() => download('images/shot.png'));
    const controller = new AbortController();
    const blob = await source.readImage(source.resolve('../images/shot.png'), controller.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://paired.example/api/herdr/host');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].body).toEqual({ request: { ...target, operation: 'files.download', path: 'images/shot.png' } });
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer fixture-private-device');
    expect(calls[0].init?.signal).toBe(controller.signal);
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.cache).toBe('no-store');
    expect(calls[0].init?.redirect).toBe('error');
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(image);
  });
  test('readImage preserves decoded percent, query and fragment characters without a second URL pass', async () => {
    const { source } = fixture();
    for (const [reference, path] of [
      ['name%23part%3Fquery.png?ignored=1', 'docs/name#part?query.png'],
      ['image%252e.png', 'docs/image%2e.png'],
      ['literal%25.png', 'docs/literal%.png'],
      ['%E5%9B%BE%20image.png', 'docs/图 image.png'],
    ]) {
      const calls = endpoint(() => download(path));
      const blob = await source.readImage(source.resolve(reference), new AbortController().signal);
      expect(calls[0].body).toEqual({ request: { ...target, operation: 'files.download', path } });
      expect(blob.size).toBe(image.length);
    }
  });
  test('a root-level Markdown filename and image filenames may contain literal colons', async () => {
    const { source } = fixture('/repo', 'report:2026.md');
    expect(source.key).toBe(draftKey({ server: connection.server, target, root: '/repo', path: 'report:2026.md' }));
    for (const [reference, path] of [
      ['icon%3Aone.svg', 'icon:one.svg'],
      ['./icon:two.svg', 'icon:two.svg'],
      ['icon%253Athree.svg', 'icon%3Athree.svg'],
    ]) {
      const calls = endpoint(() => download(path, { mime: 'image/svg+xml' }));
      expect(source.resolve(reference)).toBe(path);
      const blob = await source.readImage(source.resolve(reference), new AbortController().signal);
      expect(blob.type).toBe('image/svg+xml');
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ request: { ...target, operation: 'files.download', path } });
    }
    expectSourceError(() => source.resolve('javascript:alert(1)'), 'javascript:alert(1)', 'invalid_reference');
    expectSourceError(() => source.resolve('https://outside.example/a.png'), 'https://outside.example/a.png', 'invalid_reference');
  });
  test('returned root and path must match before decoding any bytes', async () => {
    const { source } = fixture();
    for (const [root, path] of [['/outside', 'docs/a.png'], ['/repo', 'different.png']]) {
      const calls = endpoint(() => download(path, { root, base64: 'A', bytes: 1 }));
      await expectSourceRejection(source.readImage('docs/a.png', new AbortController().signal), 'outside_root', 'docs/a.png');
      expect(calls).toHaveLength(1);
    }
  });
  test('known raster and SVG MIME types are retained and generic downloads use only known image extensions', async () => {
    const { source } = fixture();
    for (const [path, mime, expected] of [
      ['docs/a.png', 'image/png', 'image/png'],
      ['docs/vector.svg', 'image/svg+xml; charset=UTF-8', 'image/svg+xml'],
      ['docs/photo.jpg', 'IMAGE/JPEG', 'image/jpeg'],
      ['docs/photo.jpg', 'image/jpg', 'image/jpeg'],
      ['docs/icon.webp', 'application/octet-stream', 'image/webp'],
      ['docs/vector.svg', 'text/plain', 'image/svg+xml'],
      ['docs/IMAGE.AVIF', '', 'image/avif'],
      ['docs/extensionless', 'image/gif', 'image/gif'],
    ]) {
      endpoint(() => download(path, { mime }));
      expect((await source.readImage(path, new AbortController().signal)).type).toBe(expected);
    }
  });
  test('HTML and other active or non-image MIME types never become an image Blob', async () => {
    const { source } = fixture();
    for (const [path, mime] of [['docs/a.png', 'text/html'], ['docs/a.svg', 'application/xhtml+xml'], ['docs/a.png', 'application/javascript'], ['docs/a.html', 'text/plain'], ['docs/a.png', 'image/unknown'], ['docs/a.pdf', 'application/pdf'], ['docs/a.bin', 'application/octet-stream']]) {
      endpoint(() => download(path, { mime }));
      await expectSourceRejection(source.readImage(path, new AbortController().signal), 'not_image', path);
    }
  });
  test('missing files, backend limits, malformed responses and network failures bubble without fallback', async () => {
    const { source } = fixture();
    for (const response of [{ status: 404, code: 'file_not_found' }, { status: 413, code: 'file_too_large' }, { status: 401, code: 'unauthorized' }]) {
      const calls = endpoint(() => Response.json({ error: { code: response.code, message: 'Host refused the read' } }, { status: response.status }));
      await expectTransportRejection(source.readImage('docs/a.png', new AbortController().signal), response.code);
      expect(calls).toHaveLength(1);
    }
    const calls = endpoint(() => { throw new TypeError('Offline'); });
    await expectTransportRejection(source.readImage('docs/a.png', new AbortController().signal), 'DISCONNECTED');
    expect(calls).toHaveLength(1);
    endpoint(() => Response.json({ root: '/repo', path: 'docs/a.png' }));
    await expect(source.readImage('docs/a.png', new AbortController().signal)).rejects.toBeInstanceOf(TransportError);
  });
  test('malformed base64 and inconsistent byte counts stay explicit errors', async () => {
    const { source } = fixture();
    for (const options of [{ base64: 'A', bytes: 1 }, { base64, bytes: image.length + 1 }]) {
      endpoint(() => download('docs/a.png', options));
      await expectTransportRejection(source.readImage('docs/a.png', new AbortController().signal), 'INVALID_RESPONSE');
    }
  });
  test('an already aborted read performs no request', async () => {
    const { source } = fixture();
    const calls = endpoint(() => { throw new Error('Unexpected request'); });
    const controller = new AbortController();
    const reason = new Error('Preview hidden');
    controller.abort(reason);
    await expectAbortRejection(source.readImage('docs/a.png', controller.signal), reason);
    expect(calls).toHaveLength(0);
  });
  test('abort after a download response prevents committing a Blob even if fetch ignores cancellation', async () => {
    const { source } = fixture();
    const controller = new AbortController();
    const gate = deferred<Response>();
    const calls = endpoint(() => gate.promise);
    const read = source.readImage('docs/a.png', controller.signal);
    expect(calls).toHaveLength(1);
    const reason = new Error('Preview superseded');
    controller.abort(reason);
    gate.resolve(download('docs/a.png'));
    await expectAbortRejection(read, reason);
    expect(calls).toHaveLength(1);
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
