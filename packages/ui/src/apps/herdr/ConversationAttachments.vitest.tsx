import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import assert from 'node:assert/strict';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { z } from 'zod';
import type { FilePart } from '@openchamber/ui/lib/opencode/model';
import { getDefaultTheme } from '@openchamber/ui/lib/theme/themes';
import { HerdrTransport } from '../../../../web/src/herdr/transport';
import type { HerdrConversationAttachmentsProps } from '../../../../web/src/herdr/conversation-attachments';

const requestSchema = z.strictObject({ request: z.strictObject({ machine: z.string(), pane_id: z.string(), operation: z.literal('files.download'), path: z.string() }) });
const connection = { server: 'https://fixture.example', token: 'test-only-device' };
const transport = new HerdrTransport(connection);
const context = { transport, target: { machine: 'saved-ssh', paneId: 'w1:p1' }, directory: '/repo' };
const theme = getDefaultTheme(true);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL1DKsAAAAASUVORK5CYII=';
const inline = (text: string, mime = 'text/plain') => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;
const file = (url: string, mime = 'text/plain', filename = 'notes.txt', id = 'attachment'): FilePart => ({ type: 'file', id, sessionID: 'ses_owned', messageID: 'msg_owned', mime, filename, url });
const payload = (path: string, base64: string, mime = 'image/svg+xml', root = '/repo') => ({ root, path, base64, mime, bytes: Buffer.from(base64, 'base64').byteLength, revision: 'a'.repeat(64) });
let dom: Window;
let root: Root;
let host: HTMLDivElement;
let restore: () => void;
let requests: { url: string; options?: RequestInit }[];
let allRequests = 0;
let respond: (path: string, options?: RequestInit) => Promise<Response>;
let created: { url: string; blob: Blob }[];
let revoked: string[];
let openExternal: string[];
let HerdrConversationAttachments: typeof import('../../../../web/src/herdr/conversation-attachments')['HerdrConversationAttachments'];
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
let renderProps: HerdrConversationAttachmentsProps;

beforeEach(async () => {
  dom = new Window({ url: `${connection.server}/` });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment,
    HTMLStyleElement: dom.HTMLStyleElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom),
    NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, CustomEvent: dom.CustomEvent, Event: dom.Event,
    Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  created = []; revoked = []; requests = []; openExternal = [];
  URL.createObjectURL = (blob) => { if (!(blob instanceof Blob)) throw new Error('Expected an owned attachment Blob'); const url = `blob:owned-${created.length}`; created.push({ url, blob }); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const originalFetch = globalThis.fetch;
  respond = async (path) => Response.json(payload(path, Buffer.from('Confined source bytes').toString('base64')));
  globalThis.fetch = Object.assign(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input); requests.push({ url, options }); allRequests += 1;
    if (url !== `${connection.server}/api/herdr/host`) throw new Error('Unexpected source initialization or external fetch');
    const request = requestSchema.parse(JSON.parse(String(options?.body)));
    return respond(request.request.path, options);
  }, originalFetch);
  restore = () => {
    globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    for (const name of Object.keys(globals)) {
      const descriptor = descriptors[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    void dom.happyDOM.close();
  };
  ({ HerdrConversationAttachments } = await import('../../../../web/src/herdr/conversation-attachments'));
  ({ I18nProvider } = await import('@/lib/i18n'));
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  renderProps = { files: [], owner: 'server/saved-ssh/w1:p1/pane-identity/ses_owned/repo', ...context, theme, isMobile: true, onOpenExternal: (url) => openExternal.push(url) };
});
afterEach(async () => { await act(async () => root.unmount()); restore(); });
afterAll(() => { expect(allRequests).toBe(15); });
const render = async (props: Partial<HerdrConversationAttachmentsProps> = {}) => {
  renderProps = { ...renderProps, ...props };
  await act(async () => root.render(<I18nProvider><HerdrConversationAttachments {...renderProps} /></I18nProvider>));
};
const clickFile = async (name: string) => {
  const button = [...host.querySelectorAll('button')].find((element) => element.textContent?.includes(name));
  expect(Boolean(button)).toBe(true);
  await act(async () => { button?.click(); });
};

const forbiddenReferences = [
  'file:///repo/a/../secret', 'file:///repo/%2e%2e/secret', 'file:///repo/%252e%252e/secret',
  'file:///repo/a%2Fb', 'file:///repo/a%5Cb', 'file:///repo/a%252fb',
  'file:///repo/a%00b', 'file:///repo/a\0b', 'file:///repo/a\\b',
  'file:///repo-other/secret', 'file:///outside/secret', 'file://remote/repo/file',
  'file://user@localhost/repo/file', 'file:///repo/a?query', 'file:///repo/a#fragment',
  '../secret', '/repo/a/../../secret', 'a/./b', '/repo/.git/config', 'a//b',
  'file:/repo/a', '//remote/repo/a', 'javascript:alert(1)', 'blob:foreign', 'https://user:password@external.example/x',
];

let previewCounter = 0;
const showFile = async (source: FilePart, suppliedContext: Pick<HerdrConversationAttachmentsProps, 'target' | 'directory'> = context) => {
  await render({ ...suppliedContext, owner: `attachment-source-${++previewCounter}`, files: [source] });
  const button = host.querySelector('button');
  assert(button);
  await act(async () => button.click());
};
const expectUnavailable = () => {
  expect(host.querySelectorAll('[role="alert"]').length > 0).toBe(true);
  expect(document.body.querySelectorAll('img')).toHaveLength(0);
};

describe('attachment source validation', () => {
  test('imports and unsafe references make no HTTP requests', async () => {
    expect(requests).toHaveLength(0);
    for (const reference of forbiddenReferences) {
      await showFile(file(reference));
      expectUnavailable();
    }
    expect(requests).toHaveLength(0);
  });

  test('plain paths, decoded spaces and file localhost stay pinned to the captured host root', async () => {
    for (const reference of ['assets/a.txt', '/repo/assets/a.txt', 'file://localhost/repo/assets/a%20b.txt']) {
      await showFile(file(reference));
      expect(document.body.querySelector('pre')?.textContent).toBe('Confined source bytes');
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Current file');
    }
    expect(requests).toHaveLength(3);
    const final = requests[2];
    expect(new Headers(final.options?.headers).get('Authorization')).toBe('Bearer test-only-device');
    expect(final.options?.credentials).toBe('omit');
    expect(final.options?.redirect).toBe('error');
    expect(requestSchema.parse(JSON.parse(String(final.options?.body))).request).toEqual({ machine: 'saved-ssh', pane_id: 'w1:p1', operation: 'files.download', path: 'assets/a b.txt' });
  });

  test('different returned root/path, byte count and failed reads remain unavailable', async () => {
    respond = async (path) => Response.json(payload(path, png, 'image/png', '/other'));
    await showFile(file('file:///repo/a.png')); expectUnavailable();
    respond = async () => Response.json(payload('wrong.png', png));
    await showFile(file('file:///repo/a.png')); expectUnavailable();
    respond = async (path) => Response.json({ ...payload(path, png), bytes: 1 });
    await showFile(file('file:///repo/a.png')); expectUnavailable();
    respond = async () => Response.json({ error: { code: 'pane_closed', message: 'Pane closed' } }, { status: 404 });
    await showFile(file('file:///repo/a.png')); expectUnavailable();
    expect(created).toHaveLength(0);
  });

  test('history has no borrowed active pane and HTTP(S) is only an explicit opener', async () => {
    await showFile(file('file:///repo/private.txt'), { ...context, target: null }); expectUnavailable();
    await showFile(file('/repo/private.txt'), { ...context, directory: null }); expectUnavailable();
    await render({ owner: 'external', files: [file('https://external.example/image.png', 'image/png', 'external.png')], target: null, directory: null });
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect(openExternal).toEqual([]);
    await clickFile('external.png');
    expect(openExternal).toEqual(['https://external.example/image.png']);
    expect(requests).toHaveLength(0);
  });

  test('inline and downloaded bytes share size limits and content-based raster/text classification', async () => {
    await showFile(file(`data:image/svg+xml;base64,${png}`, 'image/svg+xml'));
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    expect(document.body.textContent ?? '').not.toContain('Current file');
    const active = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';
    await showFile(file(inline(active, 'image/png'), 'image/png'));
    expect(document.body.querySelector('pre')?.textContent).toBe(active);
    respond = async (path) => Response.json(payload(path, Buffer.from(active).toString('base64'), 'image/png'));
    await showFile(file('file:///repo/fake.png', 'image/png'));
    expect(document.body.querySelector('pre')?.textContent).toBe(active);
    respond = async (path) => Response.json(payload(path, png, 'text/html'));
    await showFile(file('file:///repo/fake.html', 'text/html'));
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    expect(created.at(-1)?.blob.type).toBe('image/png');
    await showFile(file('data:image/png;base64,AP8A', 'image/png'));
    expect(document.body.querySelectorAll('img,pre')).toHaveLength(0);
    expect([...document.body.querySelectorAll('button')].some((button) => button.textContent === 'Download')).toBe(true);
    await showFile(file('data:text/plain;base64,%%%=')); expectUnavailable();
    const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1, 65).toString('base64');
    await showFile(file(`data:text/plain;base64,${tooLarge}`)); expectUnavailable();
    respond = async (path) => Response.json({ ...payload(path, 'YQ=='), bytes: 8 * 1024 * 1024 + 1 });
    await showFile(file('file:///repo/large.txt')); expectUnavailable();
    respond = async (path) => Response.json(payload(path, tooLarge));
    await showFile(file('file:///repo/large.txt')); expectUnavailable();
  });
});

describe('attachment preview ownership and actions', () => {
  test('raster previews use owned URLs, reuse unchanged input and release on scope change/unmount', async () => {
    const source = file(`data:image/png;base64,${png}`, 'image/png', 'preview.png');
    await render({ files: [source] });
    expect(created).toHaveLength(1);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:owned-0');
    await render({ files: [{ ...source }] });
    expect(created).toHaveLength(1);
    await clickFile('preview.png');
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    await render({ owner: 'different-pane-identity', files: [] });
    expect(document.body.querySelectorAll('img')).toHaveLength(0);
    expect(revoked).toContain('blob:owned-0');
    await render({ files: [source] });
    expect(created).toHaveLength(2);
    await act(async () => root.render(null));
    expect(revoked).toContain('blob:owned-1');
  });

  test('fifty mounted message file refs read only the explicitly opened item once', async () => {
    const references = Array.from({ length: 50 }, (_, index) => file(`file:///repo/image-${index}.png`, 'image/png', `image-${index}.png`, String(index)));
    respond = async (path) => Response.json(payload(path, png, 'application/octet-stream'));
    await act(async () => root.render(<I18nProvider>{references.map((source) => <HerdrConversationAttachments key={source.id} {...renderProps} files={[source]} />)}</I18nProvider>));
    expect(host.querySelectorAll('button')).toHaveLength(50);
    expect(requests).toHaveLength(0);
    expect(created).toHaveLength(0);
    await clickFile('image-25.png');
    expect(requests).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    expect(Boolean(document.body.querySelector('img[alt="image-25.png · Current file"]'))).toBe(true);
    expect(requestSchema.parse(JSON.parse(String(requests[0].options?.body))).request.path).toBe('image-25.png');
  });

  test('an owner switch removes an open preview before passive effects clean resources', async () => {
    const snapshots: { owner: string; images: number }[] = [];
    const commit = async () => act(async () => root.render(<I18nProvider><React.Profiler id={renderProps.owner} onRender={(owner) => { snapshots.push({ owner, images: document.body.querySelectorAll('img').length }); }}><HerdrConversationAttachments {...renderProps} /></React.Profiler></I18nProvider>));
    renderProps = { ...renderProps, files: [file(`data:image/png;base64,${png}`, 'image/png', 'old.png')] };
    await commit();
    await clickFile('old.png');
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    renderProps = { ...renderProps, owner: 'new-session-and-pane-identity', files: [] };
    await commit();
    expect(snapshots.find((snapshot) => snapshot.owner === 'new-session-and-pane-identity')).toEqual({ owner: 'new-session-and-pane-identity', images: 0 });
    expect(revoked).toHaveLength(1);
  });

  test('replacing an attachment URI withdraws the old popup and requires a new path click', async () => {
    const original = file(`data:image/png;base64,${png}`, 'image/png', 'old.png');
    await render({ files: [original] });
    await clickFile('old.png');
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    await render({ files: [{ ...original, url: 'file:///repo/new.png', filename: 'new.png' }] });
    expect(Boolean(document.body.querySelector('[role="dialog"]'))).toBe(false);
    expect(document.body.querySelectorAll('img')).toHaveLength(0);
    expect(requests).toHaveLength(0);
    await render({ files: [original] });
    expect(document.body.querySelectorAll('img')).toHaveLength(1);
    await render({ files: [{ ...original, url: 'file:///repo/new.png', filename: 'new.png' }] });
    expect(Boolean(document.body.querySelector('[role="dialog"]'))).toBe(false);
    respond = async (path) => Response.json(payload(path, png));
    await clickFile('new.png');
    expect(requests).toHaveLength(1);
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    expect(revoked).toContain('blob:owned-0');
  });

  test('late host replies after a pane identity/session change cannot create previews', async () => {
    let finish: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | null | undefined;
    respond = async (_path, options) => { requestSignal = options?.signal; return new Promise<Response>((resolve) => { finish = resolve; }); };
    await render({ files: [file('file:///repo/a.png', 'image/png', 'old.png')] });
    expect(requests).toHaveLength(0);
    await clickFile('old.png');
    expect(requests).toHaveLength(1);
    await clickFile('old.png');
    expect(requests).toHaveLength(1);
    expect(Boolean(document.body.querySelector('[role="status"]'))).toBe(true);
    await render({ owner: 'reborn-pane/different-session', files: [] });
    expect(requestSignal?.aborted).toBe(true);
    expect(Boolean(document.body.querySelector('[role="dialog"]'))).toBe(false);
    await act(async () => { finish?.(Response.json(payload('a.png', png))); });
    expect(created).toHaveLength(0);
    expect(document.body.querySelectorAll('img')).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  test('HTML and SVG remain inert text and downloads use safe names with delayed URL cleanup', async () => {
    const active = '<html><script>window.executed = true</script><svg onload="alert(1)" /></html>';
    await render({ files: [file(inline(active, 'image/svg+xml'), 'image/svg+xml', '../bad\\name\0.html')] });
    await clickFile('bad_name');
    expect(document.body.querySelector('pre')?.textContent).toBe(active);
    expect(document.body.querySelectorAll('script, iframe, img')).toHaveLength(0);
    const anchorClick = dom.HTMLAnchorElement.prototype.click;
    let downloadedName = '';
    dom.HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };
    try {
      const download = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Download');
      expect(Boolean(download)).toBe(true);
      await act(async () => { download?.click(); });
      assert(![...downloadedName].some((char) => char === '/' || char === '\\' || char.charCodeAt(0) === 0));
      expect(downloadedName).toContain('html');
      expect(created).toHaveLength(1);
      expect(created[0].blob.type).toBe('text/plain');
      expect(revoked).toEqual([]);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
      expect(revoked).toEqual(['blob:owned-0']);
    } finally { dom.HTMLAnchorElement.prototype.click = anchorClick; }
    expect(requests).toHaveLength(0);
  });

  test('current disk bytes have a translated provenance label, while inline history retains its bytes', async () => {
    const { useI18nStore } = await import('@/lib/i18n/store');
    const { LOCALES } = await import('@/lib/i18n/runtime');
    const labels = { en: 'Current file', de: 'Aktuelle Datei', fr: 'Fichier actuel', nl: 'Huidig bestand', 'zh-CN': '当前文件', 'zh-TW': '目前檔案', uk: 'Поточний файл', es: 'Archivo actual', 'pt-BR': 'Arquivo atual', ko: '현재 파일', pl: 'Bieżący plik', ja: '現在のファイル', tr: 'Güncel dosya', ar: 'الملف الحالي', he: 'הקובץ הנוכחי' };
    await render({ files: [file('file:///repo/current.txt', 'text/plain', 'current.txt')] });
    await clickFile('current.txt');
    try {
      for (const locale of LOCALES) {
        await act(async () => {
          useI18nStore.getState().setLocale(locale);
          if (useI18nStore.getState().loadingLocale) await new Promise<void>((resolve) => {
            const unsubscribe = useI18nStore.subscribe((state) => { if (!state.loadingLocale) { unsubscribe(); resolve(); } });
          });
        });
        expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(labels[locale]);
      }
    } finally { await act(async () => useI18nStore.getState().setLocale('en')); }
    expect(requests).toHaveLength(1);
    await render({ owner: 'history-owned-session', target: null, directory: null, files: [file(inline('Original inline history bytes'), 'text/plain', 'history.txt')] });
    await clickFile('history.txt');
    expect(document.body.querySelector('pre')?.textContent).toBe('Original inline history bytes');
    expect(document.body.textContent ?? '').not.toContain('Current file');
    expect(requests).toHaveLength(1);
  });

  test('native text download reuses the Android file share helper without a browser URL', async () => {
    const shared: { fileName: string; mimeType: string; data: string }[] = [];
    Object.defineProperty(window, 'Capacitor', { configurable: true, value: { isNativePlatform: () => true, getPlatform: () => 'android', registerPlugin: (name: string) => {
      expect(name).toBe('FileShare');
      return { share: async (options: { fileName: string; mimeType: string; data: string }) => { shared.push(options); } };
    } } });
    await render({ files: [file(inline('Native owned text'), 'text/plain', 'safe/name.txt')] });
    await clickFile('safe_name.txt');
    const download = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Download');
    await act(async () => { download?.click(); });
    expect(shared).toEqual([{ fileName: 'safe_name.txt', mimeType: 'text/plain', data: Buffer.from('Native owned text').toString('base64') }]);
    expect(created).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});
