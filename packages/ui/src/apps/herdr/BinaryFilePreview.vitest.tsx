import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { HerdrAssetClient } from '../../../../web/src/herdr/asset-client';
import { HerdrTransport } from '../../../../web/src/herdr/transport';

let dom: Window; let host: HTMLDivElement; let tree: Root; let restore: () => void;
let Preview: typeof import('../../../../web/src/herdr/BinaryFilePreview')['BinaryFilePreview'];
let I18n: typeof import('@/lib/i18n')['I18nProvider'];
let requests: { method: string; path: string }[]; let downloads: number; let fontAdds: number; let fontDeletes: number;
const bodySchema = z.object({ path: z.string(), expectedRoot: z.string(), expectedAssetVersion: z.string(), terminal_id: z.string() });
const transport = () => new HerdrTransport({ server: 'https://binary-fixture.test', token: 'private-fixture' });
const source = (path: string, connection = transport()) => new HerdrAssetClient(connection, { machine: 'saved-ssh', pane_id: 'w:p', terminal_id: 'terminal-a' }, { root: '/repo', path, terminal_id: 'terminal-a', assetVersion: 'stat-v1:' + 'a'.repeat(64), bytes: 10 * 1024 * 1024, sampleKind: 'binary' });
class FixtureFontFace { constructor(readonly family: string) {} load() { return Promise.resolve(this); } }
beforeEach(async () => {
  dom = new Window({ url: 'https://binary-fixture.test', settings: { disableIframePageLoading: true, disableCSSFileLoading: true } });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLImageElement: dom.HTMLImageElement, HTMLVideoElement: dom.HTMLVideoElement,
    HTMLAudioElement: dom.HTMLAudioElement, Event: dom.Event, CustomEvent: dom.CustomEvent, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    FontFace: FixtureFontFace, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  fontAdds = 0; fontDeletes = 0;
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add() { fontAdds++; }, delete() { fontDeletes++; } } });
  requests = []; downloads = 0; let nextId = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input); const method = options?.method ?? 'GET'; requests.push({ method, path: url.pathname });
    if (method === 'DELETE') return Response.json({ released: true });
    if (url.pathname !== '/api/herdr/assets') throw new Error('Unexpected binary resource control ' + url.pathname);
    const body = bodySchema.parse(JSON.parse(String(options?.body)));
    const assetId = String(++nextId).padStart(43, 'A');
    return Response.json({ root: body.expectedRoot, path: body.path, terminal_id: body.terminal_id, assetVersion: body.expectedAssetVersion,
      bytes: 10 * 1024 * 1024, sampleKind: 'binary', assetId, url: '/api/herdr/assets/' + assetId, mime: 'application/octet-stream', fileName: body.path,
      expiresAt: Date.now() + 600000, maxExpiresAt: Date.now() + 3600000 });
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  ({ BinaryFilePreview: Preview } = await import('../../../../web/src/herdr/BinaryFilePreview'));
  ({ I18nProvider: I18n } = await import('@/lib/i18n'));
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => { await act(async () => tree.unmount()); await dom.happyDOM.close(); restore(); });
const render = (client: HerdrAssetClient, enabled = true) => act(async () => tree.render(<I18n><Preview source={client} enabled={enabled} onDownload={() => { downloads++; }} /></I18n>));

test('large image uses the original viewer with a capability URL and releases on image decode failure', async () => {
  await render(source('image.ico'));
  const image = host.querySelector('img'); expect(image).not.toBeNull(); expect(/^https:\/\/binary-fixture.test\/api\/herdr\/assets\//.test(image?.src ?? '')).toBe(true);
  expect(image?.src).not.toContain('private-fixture'); expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  await act(async () => image?.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
});

test('original media and PDF elements unmount on hide and regain a fresh grant on return', async () => {
  for (const [path, selector] of [['clip.mp4', 'video'], ['track.ogg', 'audio'], ['book.pdf', 'iframe']]) {
    const client = source(path);
    await render(client); const element = host.querySelector(selector); expect(element).not.toBeNull();
    if (selector === 'audio' || selector === 'video') expect(element?.hasAttribute('controls')).toBe(true);
    await render(client, false); expect(host.querySelector(selector)).toBeNull();
    const deletes = requests.filter(request => request.method === 'DELETE').length; expect(deletes).toBeGreaterThan(0);
    await render(client); expect(host.querySelector(selector)).not.toBe(element); expect(host.querySelector(selector)).not.toBeNull();
  }
});

test('font specimens use original FontArtifact and remove their FontFace when hidden', async () => {
  const client = source('font.woff2'); await render(client);
  expect(fontAdds).toBe(1); expect(host.textContent).toContain('The quick brown fox');
  await render(client, false); expect(fontDeletes).toBe(1); expect(host.textContent).toBe('');
});

test('unsupported binary shows its real byte size and download control without acquiring a preview', async () => {
  await render(source('archive.zip'));
  expect(requests).toEqual([]); expect(host.textContent).toContain('archive.zip'); expect(host.textContent).toContain('10 MB');
  const button = host.querySelector<HTMLButtonElement>('button'); expect(button).not.toBeNull();
  await act(async () => button?.click()); expect(downloads).toBe(1);
});

test('same-path credential transport replacement withdraws old media and releases only its old grant', async () => {
  const first = source('clip.mp4'); await render(first); const before = host.querySelector('video')?.getAttribute('src');
  const replacement = source('clip.mp4', new HerdrTransport({ server: 'https://binary-fixture.test', token: 'replacement-fixture' }));
  await render(replacement); expect(host.querySelector('video')?.getAttribute('src')).not.toBe(before);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(2); expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
});
