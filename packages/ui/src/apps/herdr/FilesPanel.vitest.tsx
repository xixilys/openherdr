import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { EditorView } from '@codemirror/view';
import type { WorkspaceFileRequest } from '../../../../web/src/herdr/workspace-navigation';
import { closeTopmostBackLayer, registerBackLayer } from '@/lib/mobileBackLayers';

let dom: Window;
let host: HTMLDivElement;
let tree: Root;
let restore: () => void;
let FilesPanel: typeof import('../../../../web/src/herdr/ContentPanel')['FilesPanel'];
let MobileFilesView: typeof import('../MobileFilesView')['MobileFilesView'];
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
let transport: import('../../../../web/src/herdr/transport').HerdrTransport;
const wire = z.object({ request: z.object({ operation: z.string(), machine: z.string(), pane_id: z.string(), path: z.string().optional(), content: z.string().optional(), expectedRoot: z.string().optional(), expectedRevision: z.string().nullable().optional() }) });
type Request = z.infer<typeof wire>['request'];
let requests: Request[];
let resolveRequests: { machine: string; paneId: string; identity: string }[];
let resolveIdentity: string;
let resolveFailure: boolean;
const resolveWire = z.object({ request: z.object({ target: z.object({ machine: z.string(), paneId: z.string(), identity: z.string() }) }) });
let respond: (request: Request) => Promise<Response>;
const hash = 'a'.repeat(64);
const request: WorkspaceFileRequest = { id: 'file-1', server: 'https://fixture.example', machine: 'local', paneId: 'w1:p1', paneIdentity: 'identity-1', sessionId: 'session-1', root: '/repo', path: 'notes.txt', line: 2 };
type FilePanelFixtureProps = Pick<React.ComponentProps<typeof FilesPanel>, 'machine' | 'paneId' | 'disabled' | 'visible' | 'requestedFile'>;
let props: FilePanelFixtureProps;
const entry = (path: string, isDirectory = false) => ({ path, name: path.split('/').at(-1) ?? path, isDirectory, size: 10, modifiedTime: 1, isSymbolicLink: false });
const listing = (directory = '', root = '/repo') => Response.json({ root, path: directory, directory, entries: directory ? [entry('sub/nested.txt')] : [entry('notes.txt'), entry('sub', true)], truncated: false });
const file = (path: string, content = 'first\nsecond\nthird', root = '/repo') => Response.json({ root, path, content, bytes: content.length, revision: hash });

beforeEach(async () => {
  dom = new Window({ url: 'https://fixture.example' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment, Range: dom.Range,
    HTMLStyleElement: dom.HTMLStyleElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom),
    NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, CustomEvent: dom.CustomEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent,
    Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  Object.defineProperty(dom.document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(dom.navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(dom.navigator, 'locks', { configurable: true, value: { request: async <T,>(_name: string, callback: () => Promise<T>) => callback() } });
  requests = []; resolveRequests = []; resolveIdentity = request.paneIdentity; resolveFailure = false;
  respond = async request => request.operation === 'files.list' ? listing(request.path) : request.operation === 'files.read' ? file(request.path ?? '') : Response.json({ root: '/repo', results: [], truncated: false });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    if (String(input).endsWith('/conversations/resolve')) {
      const target = resolveWire.parse(JSON.parse(String(init?.body))).request.target;
      resolveRequests.push(target);
      return resolveFailure ? Response.json({ error: { code: 'unavailable', message: 'Source unavailable' } }, { status: 503 }) : Response.json({ protocol: 'opencode-v2', target: { ...target, identity: resolveIdentity }, directory: '/repo', nativeAccess: 'unavailable', capabilities: {} });
    }
    const parsed = wire.parse(JSON.parse(String(init?.body))).request;
    requests.push(parsed);
    return respond(parsed);
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  ({ FilesPanel } = await import('../../../../web/src/herdr/ContentPanel'));
  ({ MobileFilesView } = await import('../MobileFilesView'));
  ({ I18nProvider } = await import('@/lib/i18n'));
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  transport = new HerdrTransport({ server: request.server, token: 'fixture-token' });
  props = { machine: 'local', paneId: 'w1:p1' };
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => { await act(async () => tree?.unmount()); await dom.happyDOM.close(); restore(); });
const render = async (next: Partial<FilePanelFixtureProps> = {}) => { props = { ...props, ...next }; await act(async () => tree.render(<I18nProvider><FilesPanel transport={transport} {...props} isMobile /></I18nProvider>)); };
const settle = async (predicate: () => boolean) => { for (let i = 0; i < 50 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); expect(predicate()).toBe(true); };
const editor = () => { const node = host.querySelector<HTMLElement>('.cm-editor'); return node ? EditorView.findFromDOM(node) : null; };
const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find(value => value.textContent?.startsWith(text) || value.getAttribute('aria-label') === text); if (!button) throw new Error(`Missing button ${text}`); await act(async () => button.click()); };

test('pure original browser and file header render without any source I/O', async () => {
  const calls: string[] = [];
  const common = { root: '/repo', entries: [entry('/repo/notes.txt')], isLoadingDirectory: false, query: '', searchResults: [], isSearching: false,
    onQueryChange: (value: string) => calls.push(value), onOpenDirectory: (value: string) => calls.push(value), onOpenFile: (value: string) => calls.push(value), onBack: () => calls.push('back'), onRefresh: () => calls.push('refresh') };
  await act(async () => tree.render(<I18nProvider><MobileFilesView {...common} route={{ type: 'browser', directory: '/repo/sub' }} /></I18nProvider>));
  expect(host.querySelector('h2')?.textContent).toBe('sub');
  expect(host.querySelector('button')?.className).toContain('size-10');
  await click('notes.txt');
  expect(calls).toEqual(['/repo/notes.txt']);
  await act(async () => tree.render(<I18nProvider><MobileFilesView {...common} route={{ type: 'file', path: '/repo/notes.txt', returnDirectory: '/repo' }} fileActions={<span>Save slot</span>}><p>Editor slot</p></MobileFilesView></I18nProvider>));
  expect(host.textContent).toContain('Save slot'); expect(host.textContent).toContain('Editor slot');
  await click('Back');
  expect(calls).toEqual(['/repo/notes.txt', 'back']);
  expect(requests).toEqual([]);
});

test('requested file waits for visibility and authoritative root, opens once and focuses its real line', async () => {
  let finish: ((response: Response) => void) | undefined;
  respond = async operation => operation.operation === 'files.list' ? new Promise(resolve => { finish = resolve; }) : file(operation.path ?? '');
  await render({ disabled: true, requestedFile: request }); expect(requests).toHaveLength(0);
  await render({ disabled: false }); expect(requests.map(value => value.operation)).toEqual(['files.list']);
  await act(async () => { finish?.(listing()); });
  await settle(() => !!editor());
  expect(editor()?.state.selection.main.head).toBe(6);
  expect(host.textContent).toContain('Current file');
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
  expect(resolveRequests).toEqual([{ machine: 'local', paneId: 'w1:p1', identity: request.paneIdentity }, { machine: 'local', paneId: 'w1:p1', identity: request.paneIdentity }]);
  await render({ requestedFile: { ...request } });
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
});

test('mismatched target/root cannot read or retarget the host, even after explicit root refresh', async () => {
  await render({ requestedFile: { ...request, machine: 'other' } });
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(0);
  await render({ requestedFile: { ...request, root: '/old-root', id: 'wrong-root' } });
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('directory');
  await click('Reload');
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(0);
  await render({ requestedFile: { ...request, id: 'correct-root' } });
  await settle(() => !!editor());
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
});

test('late file completion cannot select or expose another owner after switching away and back', async () => {
  let finish: ((response: Response) => void) | undefined;
  respond = async operation => operation.operation === 'files.read' ? new Promise(resolve => { finish = resolve; }) : listing(operation.path);
  await render({ requestedFile: request });
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
  await render({ paneId: 'w2:p2', requestedFile: null });
  await render({ paneId: 'w1:p1' });
  await act(async () => { finish?.(file('notes.txt', 'stale owner bytes')); });
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.textContent).not.toContain('stale owner bytes');
});

test('draft and editor scroll survive hide, then manual save keeps captured root and revision', async () => {
  await render({ requestedFile: request }); await settle(() => !!editor());
  const view = editor(); if (!view) throw new Error('Missing editor');
  await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'phone draft' } }); view.scrollDOM.scrollTop = 145; view.scrollDOM.dispatchEvent(new Event('scroll')); });
  const count = requests.length;
  await render({ disabled: true, visible: false });
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(requests).toHaveLength(count);
  await render({ disabled: false, visible: true }); await settle(() => !!editor());
  expect(editor()).toBe(view); expect(editor()?.state.doc.toString()).toBe('phone draft'); expect(editor()?.scrollDOM.scrollTop).toBe(145);
  respond = async operation => operation.operation === 'files.write' ? Response.json({ root: '/repo', path: 'notes.txt', success: true, revision: 'b'.repeat(64) }) : listing(operation.path);
  await click('Save');
  expect(requests.find(value => value.operation === 'files.write')).toMatchObject({ path: 'notes.txt', content: 'phone draft', expectedRoot: '/repo', expectedRevision: hash });
  expect(host.textContent).toContain('Saved');
});

test('Back leaves file, clears search and climbs folders before the shell closes; drafts stay available', async () => {
  const calls: string[] = []; const releaseShell = registerBackLayer(() => calls.push('shell'));
  try {
    await render({ requestedFile: request }); await settle(() => !!editor());
    await act(async () => { closeTopmostBackLayer(); });
    expect(host.querySelector('.cm-editor')).toBeNull(); expect(calls).toEqual([]);
    await click('sub'); expect(host.querySelector('h2')?.textContent).toBe('sub');
    await act(async () => { closeTopmostBackLayer(); });
    expect(host.querySelector('h2')?.textContent).toBe('Project files'); expect(calls).toEqual([]);
    const input = host.querySelector('input');
    if (!input) throw new Error('Missing file search');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'notes'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
    expect(input.value).toBe('notes');
    await act(async () => { closeTopmostBackLayer(); });
    expect(input.value).toBe(''); expect(calls).toEqual([]);
    await click('notes.txt'); await settle(() => !!editor());
    expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
    await act(async () => { closeTopmostBackLayer(); });
    await act(async () => { closeTopmostBackLayer(); });
    expect(calls).toEqual(['shell']);
  } finally { releaseShell(); }
});


test('binary requests keep the existing download path and display the host artifact', async () => {
  respond = async operation => operation.operation === 'files.list' ? listing() : operation.operation === 'files.read'
    ? Response.json({ error: { code: 'binary_file', message: 'Binary file' } }, { status: 400 })
    : Response.json({ root: '/repo', path: 'notes.txt', base64: 'aGVsbG8=', mime: 'application/octet-stream', bytes: 5, revision: hash });
  await render({ requestedFile: request });
  expect(requests.map(value => value.operation)).toEqual(['files.list', 'files.read', 'files.download']);
  expect(host.querySelector('h2')?.textContent).toBe('notes.txt');
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.textContent).toContain('Current file');
  await act(async () => { closeTopmostBackLayer(); });
  expect(host.querySelector('h2')?.textContent).toBe('Project files');
});

test('failed listing keeps the error visible and does not authorize the pending file request', async () => {
  respond = async () => Response.json({ error: { code: 'pane_not_found', message: 'Pane closed' } }, { status: 404 });
  await render({ requestedFile: request });
  expect(host.textContent).toContain('Pane closed');
  expect(requests.map(value => value.operation)).toEqual(['files.list']);
  expect(host.textContent).not.toContain('No files');
});


test('same pane and root with a changed occupant rejects a request before selecting an existing draft', async () => {
  await render({ requestedFile: request }); await settle(() => !!editor());
  const view = editor(); if (!view) throw new Error('Missing editor');
  await act(async () => { view.dispatch({ changes: { from: 0, insert: 'kept draft ' } }); closeTopmostBackLayer(); });
  resolveIdentity = 'replacement-identity';
  await render({ requestedFile: { ...request, id: 'changed-occupant' } });
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('directory');
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
  resolveFailure = true;
  await render({ requestedFile: { ...request, id: 'source-failed' } });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Source unavailable');
  await click('notes.txt'); await settle(() => !!editor());
  expect(editor()?.state.doc.toString()).toContain('kept draft');
});

test('same pane and root changing occupant during a read cannot publish its returned bytes', async () => {
  let finish: ((response: Response) => void) | undefined;
  respond = async operation => operation.operation === 'files.read' ? new Promise(resolve => { finish = resolve; }) : listing(operation.path);
  await render({ requestedFile: request });
  expect(requests.filter(value => value.operation === 'files.read')).toHaveLength(1);
  resolveIdentity = 'replacement-identity';
  await act(async () => { finish?.(file('notes.txt', 'wrong occupant file')); });
  expect(resolveRequests).toHaveLength(2);
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.textContent).not.toContain('wrong occupant file');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('directory');
});
