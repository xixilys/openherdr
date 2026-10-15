import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { EditorView } from '@codemirror/view';
import { closeTopmostBackLayer } from '@/lib/mobileBackLayers';
import { getDefaultTheme } from '@/lib/theme/themes';

let dom: Window;
let host: HTMLDivElement;
let tree: Root;
let mounted: boolean;
let restore: () => void;
let FilesPanel: typeof import('../../../../web/src/herdr/ContentPanel')['FilesPanel'];
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
let transport: import('../../../../web/src/herdr/transport').HerdrTransport;
type FixtureProps = Omit<React.ComponentProps<typeof FilesPanel>, 'transport'>;
let props: FixtureProps;
const origin = 'https://binary-assets-fixture.test';
const token = 'synthetic-binary-device';
const hash = 'a'.repeat(64);
const version = `stat-v1:${hash}`;
const largeSize = 12 * 1024 * 1024;
const hostWire = z.object({ request: z.object({ operation: z.string(), machine: z.string(), pane_id: z.string(), path: z.string().optional(), terminal_id: z.string().optional(), expectedRoot: z.string().optional() }) });
const mintWire = z.strictObject({ machine: z.string(), pane_id: z.string(), terminal_id: z.string(), path: z.string(), expectedRoot: z.string(), expectedAssetVersion: z.string(), purpose: z.enum(['preview', 'download']) });
type HostCall = z.infer<typeof hostWire>['request'] & { server: string; signal?: AbortSignal | null };
type Mint = z.infer<typeof mintWire>;
type AssetCall = { server: string; method: string; id: string | null; renewal: boolean; mint: Mint | null; signal?: AbortSignal | null; authorization: string | null };
type FixtureFile = { bytes: number; mime: string; sampleKind: 'text' | 'binary'; content?: string; assetVersion: string };
type Repository = { root: string; terminal: string; files: Map<string, FixtureFile> };
type Issued = { assetId: string; url: string; expiresAt: number; maxExpiresAt: number; root: string; path: string; terminal_id: string; assetVersion: string; bytes: number; sampleKind: 'text' | 'binary'; mime: string; fileName: string };
let repositories: Map<string, Repository>;
let hostCalls: HostCall[];
let assetCalls: AssetCall[];
let grants: Map<string, { result: Issued; mint: Mint; server: string }>;
let released: string[];
let badPaths: string[];
let anchorDownloads: { href: string; name: string }[];
let createdUrls: string[];
let revokedUrls: string[];
let hostReply: (request: HostCall) => Promise<Response>;
let assetReply: (request: AssetCall) => Promise<Response>;
let rawReply: (url: URL, signal: AbortSignal | null | undefined) => Promise<Response>;
let rawCalls: { url: string; signal: AbortSignal | null | undefined; authorization: string | null; redirect?: RequestRedirect; credentials?: RequestCredentials }[];
let leaseLifetime: number;
let maxLifetime: number;
let grantCounter: number;
let fontFaces: FixtureFontFace[];
let fontResult: 'resolve' | 'reject' | 'pending';
let sharedFiles: File[];

// Happy DOM has no font loader. This platform fixture exposes only FontFace's
// lifecycle; its completion is controlled metadata, never evidence of decoding.
class FixtureFontFace {
  readonly loaded: Promise<FixtureFontFace>;
  private resolveLoad!: (face: FixtureFontFace) => void;
  private rejectLoad!: (error: Error) => void;
  constructor(readonly family: string, readonly source: string) {
    this.loaded = new Promise((resolve, reject) => { this.resolveLoad = resolve; this.rejectLoad = reject; });
    fontFaces.push(this);
  }
  load() {
    if (fontResult === 'resolve') this.resolveLoad(this);
    if (fontResult === 'reject') this.rejectLoad(new Error('Fixture font cannot decode'));
    return this.loaded;
  }
  finish() { this.resolveLoad(this); }
}
const repo = (machine = 'local', pane = 'w1:p1', server = origin) => {
  const key = JSON.stringify([server, machine, pane]);
  let value = repositories.get(key);
  if (!value) {
    const binary = (mime: string): FixtureFile => ({ bytes: largeSize, mime, sampleKind: 'binary', assetVersion: version });
    value = { root: machine === 'local' ? '/repo' : '/remote-repo', terminal: `${pane}-terminal-1`, files: new Map([
      ['picture.png', binary('image/png')], ['movie.mp4', binary('video/mp4')], ['music.mp3', binary('audio/mpeg')],
      ['document.pdf', binary('application/pdf')], ['typeface.woff2', binary('font/woff2')], ['bundle.zip', binary('application/octet-stream')],
      ['unknown.dat', binary('application/octet-stream')],
      ['notes.txt', { bytes: 21, mime: 'text/plain', sampleKind: 'text', content: 'Saved text document.\n', assetVersion: version }],
    ]) };
    repositories.set(key, value);
  }
  return value;
};
const refusal = (code: string, message: string, status = 409) => Response.json({ error: { code, message } }, { status });
async function defaultHost(request: HostCall) {
  const repository = repo(request.machine, request.pane_id, request.server);
  if (request.operation === 'files.list') return Response.json({ root: repository.root, path: '', directory: '', entries: [...repository.files].map(([path, file]) => ({ path, name: path, isDirectory: false, size: file.bytes, modifiedTime: 1, isSymbolicLink: false })), truncated: false });
  const file = repository.files.get(request.path ?? '');
  if (!file) return refusal('not_found', 'Fixture file missing', 404);
  if (request.operation === 'files.describe') {
    if (request.expectedRoot !== repository.root || request.terminal_id !== repository.terminal) return refusal('target_changed', 'Fixture owner changed');
    return Response.json({ root: repository.root, path: request.path, terminal_id: repository.terminal, assetVersion: file.assetVersion, bytes: file.bytes, sampleKind: file.sampleKind });
  }
  if (request.operation === 'files.read' && file.sampleKind === 'text') return Response.json({ root: repository.root, path: request.path, content: file.content, bytes: file.bytes, revision: hash });
  throw new Error('Unexpected binary JSON operation ' + request.operation);
}
async function defaultAsset(request: AssetCall) {
  if (request.mint) {
    const mint = request.mint;
    const repository = repo(mint.machine, mint.pane_id, request.server);
    const file = repository.files.get(mint.path);
    if (!file || mint.expectedRoot !== repository.root || mint.terminal_id !== repository.terminal || mint.expectedAssetVersion !== file.assetVersion) return refusal('target_changed', 'Fixture asset owner changed');
    const assetId = String(++grantCounter).padStart(43, 'a');
    const result: Issued = { assetId, url: `/api/herdr/assets/${assetId}`, expiresAt: Date.now() + leaseLifetime, maxExpiresAt: Date.now() + maxLifetime,
      root: repository.root, path: mint.path, terminal_id: mint.terminal_id, assetVersion: file.assetVersion, bytes: file.bytes, sampleKind: file.sampleKind, mime: file.mime, fileName: mint.path };
    grants.set(assetId, { result, mint, server: request.server });
    return Response.json(result);
  }
  if (!request.id) throw new Error('Missing fixture asset ID');
  const grant = grants.get(request.id);
  if (!grant || grant.server !== request.server) return refusal('not_found', 'Fixture grant missing', 404);
  if (request.method === 'DELETE') { released.push(request.id); return Response.json({ released: true }); }
  if (request.renewal) return Response.json({ assetId: request.id, expiresAt: Math.min(Date.now() + leaseLifetime, grant.result.maxExpiresAt), maxExpiresAt: grant.result.maxExpiresAt });
  throw new Error('Unexpected asset operation');
}

beforeEach(async () => {
  repositories = new Map(); hostCalls = []; assetCalls = []; grants = new Map(); released = []; badPaths = []; anchorDownloads = []; createdUrls = []; revokedUrls = []; rawCalls = []; sharedFiles = []; fontFaces = []; fontResult = 'resolve'; leaseLifetime = 600000; maxLifetime = 3600000; grantCounter = 0; mounted = false;
  hostReply = defaultHost; assetReply = defaultAsset;
  rawReply = async url => {
    const id = url.pathname.split('/').at(-1) ?? ''; const grant = grants.get(id); if (!grant) return refusal('not_found', 'Fixture grant missing', 404);
    return new Response(new Uint8Array(grant.result.bytes), { headers: { 'Content-Type': grant.result.mime, 'Content-Length': String(grant.result.bytes) } });
  };
  dom = new Window({ url: origin, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  dom.happyDOM.setWindowSize({ width: 412, height: 915 });
  const globals = { window: dom, Window: dom.Window, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment, Range: dom.Range, HTMLStyleElement: dom.HTMLStyleElement, ShadowRoot: dom.ShadowRoot,
    getComputedStyle: dom.getComputedStyle.bind(dom), NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement, HTMLMediaElement: dom.HTMLMediaElement, HTMLVideoElement: dom.HTMLVideoElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement, Document: dom.Document,
    CustomEvent: dom.CustomEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, WheelEvent: dom.WheelEvent, DOMRect: dom.DOMRect,
    Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, IntersectionObserver: dom.IntersectionObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), FontFace: FixtureFontFace, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  Object.defineProperty(document, 'fonts', { value: new Set<FixtureFontFace>(), configurable: true });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(navigator, 'locks', { value: { request: async <T,>(_name: string, callback: () => Promise<T>) => callback() }, configurable: true });
  document.addEventListener('click', event => {
    if (event.target instanceof HTMLAnchorElement && event.target.hasAttribute('download')) { anchorDownloads.push({ href: event.target.href, name: event.target.download }); event.preventDefault(); }
  }, true);
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL; const originalFetch = globalThis.fetch;
  URL.createObjectURL = blob => { const value = originalCreate(blob); createdUrls.push(value); return value; };
  URL.revokeObjectURL = value => { revokedUrls.push(value); originalRevoke(value); };
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const headers = new Headers(init?.headers);
    if (url.pathname === '/api/herdr/host') { const request = { ...hostWire.parse(JSON.parse(String(init?.body))).request, server: url.origin, signal: init?.signal }; hostCalls.push(request); return hostReply(request); }
    const route = /^\/api\/herdr\/assets(?:\/([a-zA-Z0-9_-]{43})(\/renew)?)?$/.exec(url.pathname);
    if (route) {
      const method = init?.method ?? 'GET';
      if (method === 'GET') { rawCalls.push({ url: url.href, signal: init?.signal, authorization: headers.get('Authorization'), redirect: init?.redirect, credentials: init?.credentials }); return rawReply(url, init?.signal); }
      const request: AssetCall = { server: url.origin, method, id: route[1] ?? null, renewal: !!route[2], mint: url.pathname === '/api/herdr/assets' ? mintWire.parse(JSON.parse(String(init?.body))) : null, signal: init?.signal, authorization: headers.get('Authorization') };
      assetCalls.push(request); return assetReply(request);
    }
    badPaths.push(url.pathname); throw new Error('Unexpected binary source API ' + url.pathname);
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client'); ({ FilesPanel } = await import('../../../../web/src/herdr/ContentPanel')); ({ I18nProvider } = await import('@/lib/i18n'));
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport'); transport = new HerdrTransport({ server: origin, token });
  props = { machine: 'local', paneId: 'w1:p1', terminalId: repo().terminal, isMobile: true, theme: getDefaultTheme(true) };
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => {
  try {
    if (mounted) await act(async () => tree.unmount()); await pause();
    expect(badPaths).toEqual([]); expect(createdUrls.every(url => revokedUrls.includes(url))).toBe(true);
    expect([...grants.keys()].every(id => released.includes(id))).toBe(true);
    expect(hostCalls.filter(call => call.operation === 'files.binary' || call.operation === 'files.download')).toEqual([]);
    expect(assetCalls.every(call => call.authorization === `Bearer ${token}` || call.authorization === 'Bearer synthetic-other-device')).toBe(true);
  } finally { await dom.happyDOM.close(); restore(); }
});
const render = async (next: Partial<FixtureProps> = {}) => { props = { ...props, ...next }; await act(async () => tree.render(<I18nProvider><FilesPanel transport={transport} {...props} /></I18nProvider>)); mounted = true; };
const pause = async (ms = 30) => { for (let elapsed = 0; elapsed < ms; elapsed += 10) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(10, ms - elapsed))); }); };
const until = async (predicate: () => boolean) => { for (let i = 0; i < 150 && !predicate(); i++) await pause(10); expect(predicate()).toBe(true); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label);
const click = async (label: string) => { const value = button(label); if (!value) throw new Error('Missing binary action ' + label); await act(async () => value.click()); };
const row = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.querySelector('span[dir="auto"]')?.textContent === name);
const open = async (name: string) => { await until(() => !!row(name)); const value = row(name); if (!value) throw new Error('Missing file ' + name); await act(async () => value.click()); };
const mints = (purpose?: 'preview' | 'download') => assetCalls.filter(call => call.mint && (!purpose || call.mint.purpose === purpose));
const media = () => host.querySelector<HTMLMediaElement>('audio,video');
const editor = () => { const element = host.querySelector<HTMLElement>('.cm-editor'); return element ? EditorView.findFromDOM(element) : null; };
const back = async () => { await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); };
const assertNoTextRead = () => { expect(hostCalls.filter(call => call.operation === 'files.read')).toEqual([]); expect(editor()).toBeNull(); expect(button('Save')).toBeUndefined(); };

for (const fixture of [
  { path: 'picture.png', selector: 'img', mime: 'image/png' },
  { path: 'movie.mp4', selector: 'video', mime: 'video/mp4' },
  { path: 'music.mp3', selector: 'audio', mime: 'audio/mpeg' },
  { path: 'document.pdf', selector: 'iframe', mime: 'application/pdf' },
]) {
  test(`large ${fixture.path} opens its original resource leaf through metadata and one exact selected-owner preview grant`, async () => {
    await render(); await open(fixture.path); await until(() => !!host.querySelector(fixture.selector));
    assertNoTextRead(); expect(hostCalls.filter(call => call.operation === 'files.describe')).toHaveLength(1);
    expect(mints('preview')).toHaveLength(1); expect(mints()[0]?.mint).toEqual({ machine: 'local', pane_id: 'w1:p1', terminal_id: repo().terminal, path: fixture.path, expectedRoot: '/repo', expectedAssetVersion: version, purpose: 'preview' });
    const resource = host.querySelector(fixture.selector); const src = resource?.getAttribute('src') ?? '';
    expect(src).toBe(`${origin}/api/herdr/assets/${[...grants.keys()][0]}`); expect(src.includes(token)).toBe(false); expect(src.includes('?')).toBe(false); expect(createdUrls).toEqual([]); expect(rawCalls).toEqual([]);
    expect([...host.querySelectorAll('button')].some(value => /fullscreen/i.test(value.getAttribute('aria-label') ?? value.textContent ?? ''))).toBe(false);
    if (fixture.selector === 'iframe') expect(resource?.getAttribute('title')).toBe('document.pdf');
    if (fixture.selector === 'audio' || fixture.selector === 'video') { expect(resource?.hasAttribute('controls')).toBe(true); expect(resource?.getAttribute('preload')).toBe('metadata'); }
  });
}

for (const path of ['bundle.zip', 'unknown.dat']) {
  test(`${path} shows the original binary metadata card without reading or granting a preview`, async () => {
    await render(); await open(path); await until(() => host.textContent?.includes('cannot be previewed') === true || !!button('Save file'));
    assertNoTextRead(); expect(host.textContent).toContain(path); expect(host.textContent).toContain('12 MB'); expect(host.querySelector('audio,video,iframe,img')).toBeNull(); expect(mints()).toEqual([]);
    await click('Save file'); await until(() => anchorDownloads.length === 1);
    expect(mints('download')).toHaveLength(1); expect(mints('preview')).toEqual([]); expect(anchorDownloads[0]?.name).toBe(path);
  });
}

test('original image dimensions and zoom controls use the granted URL and image decode failure withdraws it with a download fallback', async () => {
  await render(); await open('picture.png'); await until(() => !!host.querySelector('img'));
  const image = host.querySelector('img'); if (!image) throw new Error('Missing original image');
  Object.defineProperties(image, { naturalWidth: { value: 640, configurable: true }, naturalHeight: { value: 480, configurable: true }, clientWidth: { get: () => Number.parseFloat(image.style.width) || 640, configurable: true } });
  image.getBoundingClientRect = () => new DOMRect(0, 0, Number.parseFloat(image.style.width) || 640, 480);
  await act(async () => image.dispatchEvent(new Event('load'))); expect(host.textContent).toContain('640 × 480'); await click('Zoom in'); expect(image.style.width).toBe('960px'); await click('Fit'); expect(button('Fit')?.getAttribute('aria-pressed')).toBe('true');
  const previewId = [...grants.keys()][0]; await act(async () => image.dispatchEvent(new Event('error'))); await until(() => !!host.querySelector('[role="alert"]'));
  expect(host.querySelector('img')).toBeNull(); await until(() => released.includes(previewId ?? '')); await click('Save file'); await until(() => anchorDownloads.length === 1);
  expect(mints('download')).toHaveLength(1); expect(anchorDownloads[0]?.href).not.toBe(image.src); assertNoTextRead();
});

for (const path of ['movie.mp4', 'music.mp3']) {
  test(`${path} keeps original media metadata and reports engine decode failure with an explicit independent download`, async () => {
    await render(); await open(path); await until(() => !!media());
    const element = media(); if (!element) throw new Error('Missing original media element');
    Object.defineProperty(element, 'duration', { value: 125, configurable: true });
    if (element instanceof HTMLVideoElement) Object.defineProperties(element, { videoWidth: { value: 1280, configurable: true }, videoHeight: { value: 720, configurable: true } });
    await act(async () => element.dispatchEvent(new Event('loadedmetadata'))); expect(host.textContent).toContain('2:05');
    if (path === 'movie.mp4') { expect(host.textContent).toContain('1280 × 720'); expect(element.hasAttribute('playsinline')).toBe(true); }
    await act(async () => element.dispatchEvent(new Event('error'))); await until(() => media() === null); expect(host.textContent).toContain('This file cannot be played here.');
    await click('Save file'); await until(() => anchorDownloads.length === 1); expect(mints('download')).toHaveLength(1); expect(mints('preview')).toHaveLength(1);
  });
}

test('the original font specimen owns a temporary face and ignores load completion after hide', async () => {
  fontResult = 'pending'; await render(); await open('typeface.woff2'); await until(() => fontFaces.length === 1);
  const face = fontFaces[0]; if (!face) throw new Error('Missing original FontFace lifecycle');
  expect(face.source).toContain(`${origin}/api/herdr/assets/`); expect(document.fonts.size).toBe(1); assertNoTextRead();
  await render({ visible: false, disabled: true }); expect(document.fonts.size).toBe(0); await act(async () => face.finish()); expect(host.textContent).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  fontResult = 'resolve'; await render({ visible: true, disabled: false }); await until(() => host.textContent?.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ') === true);
  expect(fontFaces).toHaveLength(2); expect(document.fonts.size).toBe(1); expect(mints('preview')).toHaveLength(2);
});

test('a font loading failure preserves the original failure text and current toolbar download', async () => {
  fontResult = 'reject'; await render(); await open('typeface.woff2'); await until(() => host.textContent?.includes('This font could not be loaded.') === true);
  expect(fontFaces).toHaveLength(1); assertNoTextRead(); await click('Download'); await until(() => anchorDownloads.length === 1); expect(mints('download')).toHaveLength(1);
});

for (const transition of ['hidden', 'file', 'machine', 'pane', 'terminal', 'server', 'transport', 'root'] as const) {
  test(`a ready media preview is withdrawn and its exact grant released on ${transition} replacement`, async () => {
    await render(); await open('movie.mp4'); await until(() => !!media());
    const previous = media(); const oldId = [...grants.keys()][0]; const oldSrc = previous?.src;
    if (transition === 'hidden') await render({ visible: false, disabled: true });
    if (transition === 'file') { await back(); await open('document.pdf'); await until(() => !!host.querySelector('iframe')); }
    if (transition === 'machine') await render({ machine: 'saved-ssh', paneId: 'w2:p2', terminalId: repo('saved-ssh', 'w2:p2').terminal });
    if (transition === 'pane') await render({ paneId: 'w1:p2', terminalId: repo('local', 'w1:p2').terminal });
    if (transition === 'terminal') { repo().terminal = 'replacement-terminal'; await render({ terminalId: repo().terminal }); }
    if (transition === 'server' || transition === 'transport') {
      const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
      transport = new HerdrTransport({ server: transition === 'server' ? 'https://other-binary-fixture.test' : origin, token: 'synthetic-other-device' });
      await render();
    }
    if (transition === 'root') { repo().root = '/replaced-root'; await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!host.querySelector('[role="alert"]')); }
    expect(previous?.isConnected).toBe(false); await until(() => released.includes(oldId ?? ''));
    if (transition === 'transport') { await until(() => !!media()); expect(media()?.src).not.toBe(oldSrc); }
    else expect(media()).toBeNull();
    if (transition === 'hidden') {
      const count = assetCalls.length; await pause(80); expect(assetCalls).toHaveLength(count);
      await render({ visible: true, disabled: false }); await until(() => !!media()); expect(media()?.src).not.toBe(oldSrc);
    }
    if (transition === 'machine' || transition === 'pane' || transition === 'terminal' || transition === 'server') {
      await open('movie.mp4'); await until(() => !!media()); const latest = mints('preview').at(-1);
      expect(latest?.mint).toMatchObject({ machine: props.machine, pane_id: props.paneId, terminal_id: props.terminalId, path: 'movie.mp4' }); expect(latest?.server).toBe(transport.connection.server);
      expect(media()?.src).not.toBe(oldSrc);
    }
    assertNoTextRead();
  });
}

for (const transition of ['hidden', 'file', 'machine', 'terminal', 'server', 'transport', 'root', 'unmount'] as const) {
  test(`a late minted preview cannot attach or leak across ${transition}`, async () => {
    let finish: (() => void) | undefined; let held = false;
    assetReply = async request => {
      const response = await defaultAsset(request);
      if (request.mint?.purpose === 'preview' && !held) {
        held = true; return new Promise(resolve => { finish = () => resolve(response); });
      }
      return response;
    };
    await render(); await open('movie.mp4'); await until(() => !!finish);
    const pending = mints('preview')[0]; const oldId = [...grants.keys()][0]; expect(media()).toBeNull();
    if (transition === 'hidden') await render({ visible: false, disabled: true });
    if (transition === 'file') { await back(); await open('document.pdf'); await until(() => !!host.querySelector('iframe')); }
    if (transition === 'machine') await render({ machine: 'saved-ssh', paneId: 'w2:p2', terminalId: repo('saved-ssh', 'w2:p2').terminal });
    if (transition === 'terminal') { repo().terminal = 'replacement-terminal'; await render({ terminalId: repo().terminal }); }
    if (transition === 'server' || transition === 'transport') {
      const { HerdrTransport } = await import('../../../../web/src/herdr/transport'); transport = new HerdrTransport({ server: transition === 'server' ? 'https://other-binary-fixture.test' : origin, token: 'synthetic-other-device' }); await render();
    }
    if (transition === 'root') { repo().root = '/replaced-root'; await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!host.querySelector('[role="alert"]')); }
    if (transition === 'unmount') { await act(async () => tree.unmount()); mounted = false; }
    expect(pending?.signal?.aborted).toBe(true);
    await act(async () => finish?.()); await until(() => released.includes(oldId ?? ''));
    expect([...host.querySelectorAll('[src]')].some(element => element.getAttribute('src')?.endsWith(oldId ?? 'missing'))).toBe(false);
    if (transition === 'transport') { await until(() => !!media()); expect(media()?.src).not.toContain(oldId ?? 'missing'); }
    else expect(media()).toBeNull();
    if (transition === 'hidden') { await render({ visible: true, disabled: false }); await until(() => !!media()); expect(mints('preview')).toHaveLength(2); }
    assertNoTextRead();
  });
}

test('a metadata result delayed past a terminal replacement cannot create a binary card or capability', async () => {
  let finish: (() => void) | undefined;
  hostReply = async request => { const response = await defaultHost(request); return request.operation === 'files.describe' ? new Promise(resolve => { finish = () => resolve(response); }) : response; };
  await render(); await open('movie.mp4'); await until(() => !!finish);
  const pending = hostCalls.find(call => call.operation === 'files.describe'); repo().terminal = 'another-terminal'; await render({ terminalId: repo().terminal });
  expect(pending?.signal?.aborted).toBe(true); await act(async () => finish?.()); await pause();
  expect(mints()).toEqual([]); expect(media()).toBeNull(); expect(button('Save file')).toBeUndefined();
});

test('metadata refusal keeps the browser route and never falls back to legacy text or base64 reads', async () => {
  hostReply = async request => request.operation === 'files.describe' ? refusal('unavailable', 'Fixture metadata unavailable', 503) : defaultHost(request);
  await render(); await open('picture.png'); await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('Fixture metadata unavailable') === true);
  expect(row('picture.png')).toBeDefined(); expect(mints()).toEqual([]); assertNoTextRead();
});

test('external replacement after opening refuses the displayed-version download instead of adopting a new description', async () => {
  await render(); await open('movie.mp4'); await until(() => !!media());
  const original = repo().files.get('movie.mp4'); if (!original) throw new Error('Missing movie fixture');
  repo().files.set('movie.mp4', { ...original, assetVersion: `stat-v1:${'b'.repeat(64)}` });
  await click('Download'); await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('The pane directory changed.') === true);
  expect(hostCalls.filter(call => call.operation === 'files.describe')).toHaveLength(1); expect(mints('download')[0]?.mint?.expectedAssetVersion).toBe(version); expect(anchorDownloads).toEqual([]); expect(rawCalls).toEqual([]);
});

test('browser attachment uses its own captured grant and survives preview hiding and file navigation', async () => {
  await render(); await open('movie.mp4'); await until(() => !!media()); await click('Download'); await until(() => anchorDownloads.length === 1);
  const previewId = [...grants].find(([, grant]) => grant.mint.purpose === 'preview')?.[0];
  const downloadId = [...grants].find(([, grant]) => grant.mint.purpose === 'download')?.[0]; if (!downloadId) throw new Error('Missing separate attachment grant');
  expect(downloadId).not.toBe(previewId); expect(anchorDownloads[0]).toEqual({ href: `${origin}/api/herdr/assets/${downloadId}`, name: 'movie.mp4' });
  await render({ visible: false, disabled: true }); await until(() => released.includes(previewId ?? '')); expect(released.includes(downloadId)).toBe(false);
  await render({ visible: true, disabled: false }); await back(); await open('document.pdf'); await until(() => !!host.querySelector('iframe'));
  expect(released.includes(downloadId)).toBe(false); expect(anchorDownloads).toHaveLength(1); expect(grants.get(downloadId)?.mint.path).toBe('movie.mp4');
});

test('Back from a binary view retains the complete unsaved text draft without writing it', async () => {
  await render(); await open('notes.txt'); await until(() => !!editor()); const view = editor(); if (!view) throw new Error('Missing actual source editor');
  const draft = 'Unsaved retained text.\n第二行\n'; await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: draft } }));
  await back(); await open('movie.mp4'); await until(() => !!media()); const id = [...grants.keys()][0]; await back(); await until(() => released.includes(id ?? ''));
  await open('notes.txt'); await until(() => !!editor()); expect(editor()?.state.doc.toString()).toBe(draft); expect(button('Save')?.disabled).toBe(false); expect(hostCalls.filter(call => call.operation === 'files.write')).toEqual([]);
});

const nativePlatform = () => {
  Object.defineProperty(window, 'Capacitor', { value: { isNativePlatform: () => true, getPlatform: () => 'ios' }, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => { sharedFiles.push(...data.files ?? []); }, configurable: true });
};
const smallMovie = () => { const file = repo().files.get('movie.mp4'); if (!file) throw new Error('Missing movie fixture'); repo().files.set('movie.mp4', { ...file, bytes: 4 }); };

test('native large-file download fails visibly before minting or materializing a body', async () => {
  await render(); await open('movie.mp4'); await until(() => !!media()); nativePlatform(); await click('Download');
  await until(() => !!host.querySelector('[role="alert"]')); expect(mints('download')).toEqual([]); expect(rawCalls).toEqual([]); expect(sharedFiles).toEqual([]); expect(anchorDownloads).toEqual([]); assertNoTextRead();
});

test('native small sharing reads the dedicated pinned download body without bearer or preview URL reuse', async () => {
  smallMovie(); await render(); await open('movie.mp4'); await until(() => !!media()); nativePlatform(); await click('Download'); await until(() => sharedFiles.length === 1);
  const download = [...grants].find(([, grant]) => grant.mint.purpose === 'download'); if (!download) throw new Error('Missing native dedicated download');
  expect(rawCalls).toHaveLength(1); expect(rawCalls[0]).toMatchObject({ url: `${origin}${download[1].result.url}`, authorization: null, redirect: 'error', credentials: 'omit' });
  expect(sharedFiles[0]?.name).toBe('movie.mp4'); expect(sharedFiles[0]?.type).toBe('video/mp4'); expect(sharedFiles[0]?.size).toBe(4); const shared = sharedFiles[0]; if (!shared) throw new Error('Missing shared File'); expect(new Uint8Array(await shared.arrayBuffer())).toEqual(new Uint8Array(4));
  await until(() => released.includes(download[0])); expect(mints('preview')).toHaveLength(1); expect(anchorDownloads).toEqual([]);
});

for (const invalid of ['mime', 'short', 'over-limit'] as const) {
  test(`native small sharing rejects a ${invalid} response and never invokes sharing`, async () => {
    smallMovie();
    rawReply = async () => new Response(new Uint8Array(invalid === 'short' ? 3 : invalid === 'over-limit' ? 8 * 1024 * 1024 + 1 : 4), { headers: { 'Content-Type': invalid === 'mime' ? 'text/html' : 'video/mp4', 'Content-Length': '4' } });
    await render(); await open('movie.mp4'); await until(() => !!media()); nativePlatform(); await click('Download'); await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('Invalid server response') === true);
    expect(rawCalls).toHaveLength(1); expect(sharedFiles).toEqual([]); expect(anchorDownloads).toEqual([]);
  });
}

test('visible lease renewal preserves the original resource URL and a hidden preview stops renewal', async () => {
  leaseLifetime = 250; maxLifetime = 5000;
  await render(); await open('music.mp3'); await until(() => !!media()); const original = media(); const src = original?.src;
  await until(() => assetCalls.some(call => call.renewal)); expect(media()).toBe(original); expect(media()?.src).toBe(src); expect(mints('preview')).toHaveLength(1);
  await render({ visible: false, disabled: true }); const count = assetCalls.filter(call => call.renewal).length; await pause(350); expect(assetCalls.filter(call => call.renewal)).toHaveLength(count); expect(media()).toBeNull();
});

test('absolute lease lifetime reacquires the same version and releases the previous URL', async () => {
  leaseLifetime = 180; maxLifetime = 180;
  await render(); await open('music.mp3'); await until(() => !!media()); const previous = media()?.src; const id = [...grants.keys()][0];
  await until(() => mints('preview').length === 2); await until(() => !!media() && media()?.src !== previous); expect(released.includes(id ?? '')).toBe(true);
  expect(mints('preview').map(call => call.mint?.expectedAssetVersion)).toEqual([version, version]);
});

test('an admitted small native download remains independent while the preview hides', async () => {
  smallMovie(); let finish: (() => void) | undefined;
  rawReply = async () => new Promise(resolve => { finish = () => resolve(new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' } })); });
  await render(); await open('movie.mp4'); await until(() => !!media()); nativePlatform(); await click('Download'); await until(() => !!finish);
  const preview = [...grants].find(([, grant]) => grant.mint.purpose === 'preview'); const download = [...grants].find(([, grant]) => grant.mint.purpose === 'download');
  if (!preview || !download) throw new Error('Missing independent native/preview grant pair');
  await render({ visible: false, disabled: true }); await until(() => released.includes(preview[0]));
  expect(rawCalls[0]?.signal?.aborted).toBe(false); expect(released.includes(download[0])).toBe(false); expect(media()).toBeNull();
  await act(async () => finish?.()); await until(() => sharedFiles.length === 1);
  const shared = sharedFiles[0]; if (!shared) throw new Error('Missing shared File'); expect(new Uint8Array(await shared.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4])); await until(() => released.includes(download[0]));
});

test('native sharing accepts exactly the existing 8 MiB limit from the pinned body', async () => {
  const file = repo().files.get('movie.mp4'); if (!file) throw new Error('Missing movie fixture'); repo().files.set('movie.mp4', { ...file, bytes: 8 * 1024 * 1024 });
  await render(); await open('movie.mp4'); await until(() => !!media()); nativePlatform(); await click('Download'); await until(() => sharedFiles.length === 1);
  expect(sharedFiles[0]?.size).toBe(8 * 1024 * 1024); expect(rawCalls).toHaveLength(1); expect(mints('download')).toHaveLength(1);
});
