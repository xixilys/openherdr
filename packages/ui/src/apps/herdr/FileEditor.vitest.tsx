import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { Worker as NodeWorker } from 'node:worker_threads';
import { z } from 'zod';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { SearchQuery, setSearchQuery, replaceAll } from '@codemirror/search';
import { getDefaultTheme } from '@/lib/theme/themes';
import { closeTopmostBackLayer } from '@/lib/mobileBackLayers';
import type { WorkerRequest, WorkerResponse } from '@pierre/diffs/worker';
import { createMarkdownWorkerFixture } from '@/lib/codemirror/__tests__/markdownWorker.fixture';
import type { PendingDelivery } from '../../../../web/src/herdr/transport';

const nativeEventTarget = globalThis.EventTarget;
const nativeMessageEvent = globalThis.MessageEvent;
const workerThreads = new Set<NodeWorker>();
const pendingWorkerRequests = new Map<FixtureWorker, Set<string | number>>();
const workerErrors: Error[] = [];
const pierreEntry = import.meta.resolve('@pierre/diffs/worker/worker.js');
const markdownWorker = createMarkdownWorkerFixture();

// Run the installed Pierre worker unchanged through a Node message adapter.
class FixtureWorker extends nativeEventTarget {
  private worker: NodeWorker;
  constructor() {
    super();
    this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
      import { parentPort, workerData } from 'node:worker_threads';
      const queued = [];
      let ready = false;
      const listeners = [];
      globalThis.postMessage = data => parentPort.postMessage(data);
      globalThis.self = {
        postMessage: globalThis.postMessage,
        onmessage: null,
        addEventListener(type, listener) { if (type === 'message') listeners.push(listener); }
      };
      const deliver = data => {
        globalThis.self.onmessage?.({ data });
        for (const listener of listeners) listener({ data });
      };
      parentPort.on('message', data => { if (ready) deliver(data); else queued.push(data); });
      await import(workerData);
      ready = true;
      for (const data of queued) deliver(data);
    `)}`), { workerData: pierreEntry });
    workerThreads.add(this.worker);
    pendingWorkerRequests.set(this, new Set());
    this.worker.on('message', (data: WorkerResponse) => {
      pendingWorkerRequests.get(this)?.delete(data.id);
      const event = new nativeMessageEvent('message', { data });
      this.dispatchEvent(event);
    });
    this.worker.on('error', error => workerErrors.push(error));
  }
  postMessage(request: WorkerRequest) {
    if ('id' in request) pendingWorkerRequests.get(this)?.add(request.id);
    this.worker.postMessage(request);
  }
  terminate() { pendingWorkerRequests.delete(this); return this.worker.terminate(); }
}
function browserWorker(url: string | URL) {
  return String(url).includes('markdown-shiki') ? new markdownWorker.Worker() : new FixtureWorker();
}
afterAll(async () => {
  await markdownWorker.close();
  await Promise.all([...workerThreads].map(worker => worker.terminate()));
  expect(workerErrors).toEqual([]); expect(markdownWorker.failures).toEqual([]);
});

let dom: Window;
let host: HTMLDivElement;
let tree: Root;
let restore: () => void;
let FilesPanel: typeof import('../../../../web/src/herdr/ContentPanel')['FilesPanel'];
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
let transport: import('../../../../web/src/herdr/transport').HerdrTransport;
type FixtureProps = Omit<React.ComponentProps<typeof FilesPanel>, 'transport' | 'onPendingDelivery'>;
let props: FixtureProps;
const origin = 'https://file-editor-fixture.test';
const wire = z.object({ request: z.object({ operation: z.string(), machine: z.string(), pane_id: z.string(), terminal_id: z.string().optional(), path: z.string().optional(), content: z.string().optional(), expectedRoot: z.string().optional(), expectedRevision: z.string().nullable().optional() }), requestId: z.string().optional() });
type HostRequest = z.infer<typeof wire>['request'];
type LoggedRequest = HostRequest & { requestId?: string };
type StoredFile = { content: string; revision: string };
type Repository = { root: string; files: Map<string, StoredFile> };
let repositories: Map<string, Repository>;
let requests: LoggedRequest[];
let unexpectedPaths: string[];
let reported: (PendingDelivery | null)[];
let respond: (request: HostRequest) => Promise<Response>;
let revisionCounter: number;
const nextRevision = () => (++revisionCounter).toString(16).padStart(64, '0');
const repository = (machine = 'local', pane = 'w1:p1') => {
  const key = machine + ':' + pane;
  let repo = repositories.get(key);
  if (!repo) {
    repo = { root: machine === 'local' ? '/repo' : '/remote-repo', files: new Map([
      ['alpha.ts', { content: 'const alpha = 1;\r\nconst label = "中文";\r\n', revision: nextRevision() }],
      ['beta.ts', { content: 'const beta = 2;\n', revision: nextRevision() }],
      ['gamma.txt', { content: 'third document without final newline', revision: nextRevision() }],
    ]) };
    repositories.set(key, repo);
  }
  return repo;
};
const refusal = (code: string, message: string, status = 409) => Response.json({ error: { code, message } }, { status });
const conflictMessage = 'The file changed. Reload it before editing';
const stored = (path = 'alpha.ts', machine = 'local', pane = 'w1:p1') => {
  const result = repository(machine, pane).files.get(path);
  if (!result) throw new Error('Missing fixture file ' + path);
  return result;
};
const replaceSource = (path: string, content: string) => repository().files.set(path, { content, revision: nextRevision() });
async function defaultReply(request: HostRequest): Promise<Response> {
  const repo = repository(request.machine, request.pane_id);
  if (request.expectedRoot && request.expectedRoot !== repo.root) return refusal('target_changed', 'Fixture root changed');
  if (request.operation === 'files.list') return Response.json({ root: repo.root, path: request.path ?? '', directory: request.path ?? '', truncated: false,
    entries: [...repo.files].map(([path, file]) => ({ path, name: path, isDirectory: false, size: new TextEncoder().encode(file.content).length, modifiedTime: 1, isSymbolicLink: false })) });
  const path = request.path ?? '';
  const file = repo.files.get(path);
  if (request.operation === 'files.describe') return file ? Response.json({ root: repo.root, path, terminal_id: request.terminal_id, assetVersion: 'stat-v1:' + file.revision, bytes: new TextEncoder().encode(file.content).length, sampleKind: 'text' }) : refusal('not_found', 'Fixture file missing', 404);
  if (request.operation === 'files.read') return file ? Response.json({ root: repo.root, path, content: file.content, bytes: new TextEncoder().encode(file.content).length, revision: file.revision }) : refusal('not_found', 'Fixture file missing', 404);
  if (request.operation === 'files.write') {
    if (!file || file.revision !== request.expectedRevision) return refusal('file_conflict', conflictMessage);
    const revision = nextRevision();
    repo.files.set(path, { content: request.content ?? '', revision });
    return Response.json({ root: repo.root, path, success: true, revision });
  }
  if (request.operation === 'files.search') return Response.json({ root: repo.root, results: [], truncated: false });
  throw new Error('Unexpected fixture host operation ' + request.operation);
}

beforeEach(async () => {
  dom = new Window({ url: origin }); dom.happyDOM.setWindowSize({ width: 412, height: 915 });
  const globals = { window: dom, Window: dom.Window, Worker: browserWorker, document: dom.document, navigator: dom.navigator,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, customElements: dom.customElements,
    CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment, Range: dom.Range, HTMLStyleElement: dom.HTMLStyleElement,
    ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom), NodeList: dom.NodeList, NodeFilter: dom.NodeFilter,
    HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement, HTMLTableElement: dom.HTMLTableElement,
    HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement, Document: dom.Document,
    CustomEvent: dom.CustomEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent, Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element,
    HTMLElement: dom.HTMLElement, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    IntersectionObserver: dom.IntersectionObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  Object.defineProperty(dom.document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(dom.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(dom.navigator, 'locks', { value: { request: async <T,>(_name: string, callback: () => Promise<T>) => callback() }, configurable: true });
  document.documentElement.style.fontSize = '16px';
  requests = []; unexpectedPaths = []; reported = []; repositories = new Map(); revisionCounter = 0; respond = defaultReply;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.pathname !== '/api/herdr/host') { unexpectedPaths.push(url.pathname); throw new Error('Unexpected source API ' + url.pathname); }
    const parsed = wire.parse(JSON.parse(String(init?.body)));
    requests.push({ ...parsed.request, requestId: parsed.requestId });
    return respond(parsed.request);
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  ({ FilesPanel } = await import('../../../../web/src/herdr/ContentPanel'));
  ({ I18nProvider } = await import('@/lib/i18n'));
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  transport = new HerdrTransport({ server: origin, token: 'synthetic-editor-device' });
  props = { machine: 'local', paneId: 'w1:p1', terminalId: 'terminal-fixture', isMobile: true, theme: getDefaultTheme(true), themeMode: 'dark' };
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => {
  try {
    for (let i = 0; i < 250 && (markdownWorker.pendingRequests > 0 || [...pendingWorkerRequests.values()].some(pending => pending.size > 0)) && workerErrors.length === 0 && markdownWorker.failures.length === 0; i++) await pause(20);
    expect([...pendingWorkerRequests.values()].every(pending => pending.size === 0)).toBe(true);
    expect(workerErrors).toEqual([]); expect(markdownWorker.failures).toEqual([]); expect(markdownWorker.pendingRequests).toBe(0); expect(unexpectedPaths).toEqual([]);
  } finally { await act(async () => tree?.unmount()); await dom.happyDOM.close(); restore(); }
});
export const Harness = ({ inputs }: { inputs: FixtureProps }) => {
  const [blocked, setBlocked] = React.useState(false);
  return <FilesPanel transport={transport} {...inputs} mutationBlocked={blocked || inputs.mutationBlocked} onPendingDelivery={record => { reported.push(record); setBlocked(!!record); }} />;
};
const render = async (next: Partial<FixtureProps> = {}) => { props = { ...props, ...next }; await act(async () => tree.render(<I18nProvider><Harness inputs={props} /></I18nProvider>)); };
const pause = async (ms = 40) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (predicate: () => boolean) => { for (let i = 0; i < 250 && !predicate(); i++) await pause(20); expect(predicate()).toBe(true); };
const findButton = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
const click = async (label: string, root: ParentNode = document) => { const button = findButton(label, root); if (!button) throw new Error('Missing editor action ' + label); await act(async () => button.click()); };
const editor = () => { const node = host.querySelector<HTMLElement>('.cm-editor'); return node ? EditorView.findFromDOM(node) : null; };
const requireEditor = () => { const view = editor(); if (!view) throw new Error('Missing actual CodeMirror editor'); return view; };
const text = () => requireEditor().state.doc.toString();
const edit = async (content: string, view = requireEditor()) => { await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })); };
const fileRow = (path: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.querySelector('span[dir="auto"]')?.textContent === path);
const open = async (path = 'alpha.ts') => { await until(() => !!fileRow(path)); const row = fileRow(path); if (!row) throw new Error('Missing file row ' + path); await act(async () => row.click()); await until(() => !!editor()); };
const writes = () => requests.filter(request => request.operation === 'files.write');

const fill = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing browser input setter');
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
};

test('a CRLF code document is clean after real editor undo and manual save preserves host line endings', async () => {
  await render(); await open();
  expect(text()).toBe('const alpha = 1;\nconst label = "中文";\n');
  expect(findButton('Save')?.disabled).toBe(true);
  await edit('const alpha = 3;\nconst label = "中文";\n');
  expect(findButton('Save')?.disabled).toBe(false);
  await act(async () => { expect(undo(requireEditor())).toBe(true); });
  expect(text()).toBe('const alpha = 1;\nconst label = "中文";\n');
  expect(findButton('Save')?.disabled).toBe(true);
  const initialRevision = stored().revision;
  await edit('const alpha = 4;\nconst label = "保留 UTF-8";\n'); await click('Save');
  await until(() => writes().length === 1 && findButton('Save')?.disabled === true);
  expect(writes()[0]).toMatchObject({ machine: 'local', pane_id: 'w1:p1', path: 'alpha.ts', expectedRoot: '/repo', expectedRevision: initialRevision, content: 'const alpha = 4;\r\nconst label = "保留 UTF-8";\r\n' });
  expect(stored().content).toBe('const alpha = 4;\r\nconst label = "保留 UTF-8";\r\n');
});

for (const fixture of [
  { name: 'empty UTF-8', raw: '', normalized: '', edited: '新内容', written: '新内容' },
  { name: 'no final newline', raw: 'plain text', normalized: 'plain text', edited: 'plain text changed', written: 'plain text changed' },
  { name: 'UTF-8 BOM and non-ASCII', raw: '\uFEFF你好\n世界', normalized: '\uFEFF你好\n世界', edited: '\uFEFF你好\n世界🌍', written: '\uFEFF你好\n世界🌍' },
  { name: 'LF final newline', raw: 'first\nlast\n', normalized: 'first\nlast\n', edited: 'first\nchanged\n', written: 'first\nchanged\n' },
  { name: 'dominant CRLF mixed input', raw: 'one\r\ntwo\r\nthree\n', normalized: 'one\ntwo\nthree\n', edited: 'one\ntwo\nchanged\n', written: 'one\r\ntwo\r\nchanged\r\n' },
  { name: 'lone CR normalization', raw: 'one\rtwo', normalized: 'one\ntwo', edited: 'one\nchanged', written: 'one\nchanged' },
]) {
  test(`${fixture.name} keeps full normalized text and the original serialization policy`, async () => {
    replaceSource('encoding.txt', fixture.raw);
    await render(); await open('encoding.txt');
    expect(text()).toBe(fixture.normalized); expect(findButton('Save')?.disabled).toBe(true);
    await edit(fixture.edited); await click('Save'); await until(() => writes().length === 1 && findButton('Save')?.disabled === true);
    expect(writes()[0]?.content).toBe(fixture.written); expect(stored('encoding.txt').content).toBe(fixture.written);
  });
}

const previewText = () => [...host.querySelectorAll('diffs-container')].map(node => node.shadowRoot?.textContent ?? '').join('\n');
const tokenPalette = () => [...host.querySelectorAll<HTMLElement>('.cm-content span[style]')].map(node => node.style.color).filter(Boolean).sort().join('|');

test('original Find/Replace, undo, line navigation, wrapping and draft preview form one real code-editing flow', async () => {
  await render(); await open();
  const view = requireEditor();
  const original = text();
  await until(() => tokenPalette().length > 0);
  await click('Find in file'); await until(() => !!host.querySelector('.cm-search'));
  const search = host.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
  const replacement = host.querySelector<HTMLInputElement>('.cm-search input[name="replace"]');
  if (!search || !replacement) throw new Error('Missing original CodeMirror search and replace inputs');
  await fill(search, 'alpha'); await fill(replacement, 'renamed');
  const replace = host.querySelector<HTMLButtonElement>('.cm-search button[name="replaceAll"]');
  if (!replace) throw new Error('Missing original CodeMirror Replace all action');
  await act(async () => replace.click()); expect(text()).toContain('const renamed = 1;');
  await act(async () => { expect(undo(view)).toBe(true); }); expect(text()).toBe(original);
  expect(findButton('Save')?.disabled).toBe(true);
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
  expect(host.querySelector('.cm-search')).toBeNull(); expect(editor()).toBe(view);
  await click('Go to line'); const line = host.querySelector<HTMLInputElement>('[data-editor-overlay] input[type="number"]');
  if (!line) throw new Error('Missing original line navigation input');
  await fill(line, '2'); await act(async () => line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
  expect(line.closest('[hidden]')).not.toBeNull();
  expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
  await click('Disable line wrap'); expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
  await click('Enable line wrap'); expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
  await edit('const previewDraft = "完整草稿";\n');
  const selection = view.state.selection.main.head;
  await click('Switch to preview mode'); await until(() => previewText().includes('const previewDraft = "完整草稿";'));
  expect(editor()).toBeNull(); expect(writes()).toEqual([]);
  await click('Switch to edit mode'); await until(() => !!editor());
  expect(editor()).toBe(view); expect(text()).toBe('const previewDraft = "完整草稿";\n'); expect(view.state.selection.main.head).toBe(selection);
  await click('Save'); await until(() => writes().length === 1 && findButton('Save')?.disabled === true);
  expect(stored().content).toBe('const previewDraft = "完整草稿";\r\n');
});

test('a selected theme change retokenizes the actual editor without replacing its draft or view', async () => {
  await render(); await open(); await until(() => tokenPalette().length > 0);
  const view = requireEditor(); await edit('const retainedDraft = "theme";\n'); await pause(240); await until(() => tokenPalette().length > 0);
  const darkPalette = tokenPalette();
  await render({ theme: getDefaultTheme(false), themeMode: 'light' });
  await until(() => tokenPalette().length > 0 && tokenPalette() !== darkPalette);
  expect(editor()).toBe(view); expect(text()).toBe('const retainedDraft = "theme";\n'); expect(writes()).toEqual([]);
});

const selectDocument = async (path: string) => {
  await click('Open files'); await until(() => !!findButton('Close ' + path));
  const row = findButton('Close ' + path)?.closest<HTMLElement>('[role="menuitem"]');
  if (!row) throw new Error('Missing original open-file menu row ' + path);
  await act(async () => row.click()); await until(() => !!editor() && !document.querySelector('[role="menu"]'));
};
const closeDocument = async (path: string) => {
  await click('Open files'); await until(() => !!findButton('Close ' + path)); await click('Close ' + path);
};
const openNext = async (path: string) => { await click('Back'); await open(path); };
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const dirtyPair = async () => {
  await render(); await open(); await edit('const dirtyAlpha = 11;\n');
  await openNext('beta.ts'); await edit('const dirtyBeta = 22;\n');
};

test('multiple dirty documents switch freely and inactive close Cancel, Save and fresh reopen affect only that document', async () => {
  await dirtyPair(); await selectDocument('alpha.ts'); expect(text()).toBe('const dirtyAlpha = 11;\n');
  await selectDocument('beta.ts'); expect(text()).toBe('const dirtyBeta = 22;\n');
  await closeDocument('alpha.ts'); await until(() => !!dialog());
  expect(dialog()?.textContent).toContain('Unsaved changes'); await click('Cancel', dialog() ?? document);
  expect(text()).toBe('const dirtyBeta = 22;\n'); expect(writes()).toEqual([]);
  await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document);
  await until(() => !dialog() && writes().length === 1);
  expect(text()).toBe('const dirtyBeta = 22;\n');
  expect(writes()[0]).toMatchObject({ path: 'alpha.ts', expectedRoot: '/repo', content: 'const dirtyAlpha = 11;\r\n' });
  expect(stored('beta.ts').content).toBe('const beta = 2;\n');
  const reads = requests.filter(request => request.operation === 'files.read' && request.path === 'alpha.ts').length;
  await openNext('alpha.ts'); expect(text()).toBe('const dirtyAlpha = 11;\n');
  expect(requests.filter(request => request.operation === 'files.read' && request.path === 'alpha.ts')).toHaveLength(reads + 1);
  await selectDocument('beta.ts'); expect(text()).toBe('const dirtyBeta = 22;\n');
});

test('inactive dirty Discard is local and leaves the selected dirty neighbor unchanged', async () => {
  await dirtyPair(); await closeDocument('alpha.ts'); await click('Discard', dialog() ?? document);
  await until(() => !dialog()); expect(text()).toBe('const dirtyBeta = 22;\n'); expect(writes()).toEqual([]);
  await openNext('alpha.ts'); expect(text()).toBe('const alpha = 1;\nconst label = "中文";\n');
  await selectDocument('beta.ts'); expect(text()).toBe('const dirtyBeta = 22;\n');
});

test('closing the active clean tab selects its next neighbor, then previous, and a final close returns to Files', async () => {
  await render(); await open(); await openNext('beta.ts'); await openNext('gamma.txt');
  await selectDocument('beta.ts'); await closeDocument('beta.ts');
  await until(() => editor()?.state.doc.toString() === 'third document without final newline'); expect(dialog()).toBeNull();
  await closeDocument('gamma.txt'); await until(() => editor()?.state.doc.toString().includes('const alpha = 1;') === true);
  await closeDocument('alpha.ts'); await until(() => !editor()); expect(fileRow('alpha.ts')).toBeDefined();
  expect(writes()).toEqual([]);
});

test('a newer editor transaction during Save-and-close survives its older acknowledgement', async () => {
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.write' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await render(); await open(); await edit('const submitted = 1;\n'); const view = requireEditor();
  await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document);
  await until(() => writes().length === 1); await edit('const newer = 2;\n', view);
  await act(async () => finish?.()); await until(() => findButton('Save changes')?.disabled === false || !dialog());
  expect(text()).toBe('const newer = 2;\n'); expect(findButton('Save')?.disabled).toBe(false);
  expect(stored().content).toBe('const submitted = 1;\r\n');
  if (dialog()) await click('Cancel', dialog() ?? document);
  await closeDocument('alpha.ts'); expect(dialog()?.textContent).toContain('Unsaved changes');
});

for (const transition of ['hidden', 'owner'] as const) {
  test(`a ${transition} transition cancels a pending Save-and-close intent without discarding its document`, async () => {
    let finish: (() => void) | undefined;
    respond = async request => {
      const response = await defaultReply(request);
      return request.operation === 'files.write' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
    };
    await render(); await open(); await edit('const retainedAfterTransition = 1;\n');
    await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document); await until(() => writes().length === 1);
    await render(transition === 'hidden' ? { disabled: true, visible: false } : { machine: 'saved-ssh', paneId: 'w2:p2' });
    expect(dialog()).toBeNull(); await act(async () => finish?.());
    await render({ machine: 'local', paneId: 'w1:p1', disabled: false, visible: true }); await until(() => !!editor());
    expect(text()).toBe('const retainedAfterTransition = 1;\n');
    expect(writes()).toHaveLength(1); expect(writes()[0]).toMatchObject({ machine: 'local', pane_id: 'w1:p1', expectedRoot: '/repo' });
    await closeDocument('alpha.ts'); await until(() => !editor()); expect(dialog()).toBeNull();
  });
}

test('external revision refusal keeps the draft until explicit discard/reload adopts authoritative bytes', async () => {
  await render(); await open(); await edit('const localDraft = 3;\n');
  replaceSource('alpha.ts', 'const external = 9;\r\n'); await click('Save');
  await until(() => host.textContent?.includes(conflictMessage) === true);
  expect(text()).toBe('const localDraft = 3;\n'); expect(stored().content).toBe('const external = 9;\r\n');
  const reads = requests.filter(request => request.operation === 'files.read').length;
  await click('Refresh files'); expect(dialog()?.textContent).toContain('Unsaved changes');
  expect(requests.filter(request => request.operation === 'files.read')).toHaveLength(reads);
  await click('Cancel', dialog() ?? document); expect(text()).toBe('const localDraft = 3;\n');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(conflictMessage);
  await click('Refresh files'); await click('Discard', dialog() ?? document); await until(() => editor()?.state.doc.toString() === 'const external = 9;\n');
  expect(host.textContent).not.toContain(conflictMessage); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(requests.filter(request => request.operation === 'files.read')).toHaveLength(reads + 1);
  expect(findButton('Save')?.disabled).toBe(true);
  expect(writes()).toHaveLength(1);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect(await loadPendingDelivery(origin)).toBeNull();
});

test('a late explicit reload cannot replace a newer edit made while it was reading', async () => {
  let finish: (() => void) | undefined;
  await render(); await open(); await edit('const beforeReload = 1;\n');
  replaceSource('alpha.ts', 'const externalReload = 2;\r\n');
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.read' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await click('Refresh files'); await click('Discard', dialog() ?? document);
  await until(() => !!finish); const view = requireEditor(); await edit('const newerDuringReload = 3;\n', view);
  await act(async () => finish?.()); await until(() => host.textContent?.includes('Unsaved changes') === true);
  expect(text()).toBe('const newerDuringReload = 3;\n'); expect(writes()).toEqual([]);
});

test('a confirmed Save-and-close refusal keeps the original tab and dirty text without replay', async () => {
  respond = async request => request.operation === 'files.write' ? refusal('file_write_failed', 'Fixture write refused') : defaultReply(request);
  await render(); await open(); await edit('const refused = 1;\n'); await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document);
  await until(() => host.textContent?.includes('Fixture write refused') === true);
  expect(text()).toBe('const refused = 1;\n'); expect(dialog()).not.toBeNull(); expect(writes()).toHaveLength(1);
  await click('Cancel', dialog() ?? document); expect(findButton('Save')?.disabled).toBe(false);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect(await loadPendingDelivery(origin)).toBeNull();
});

test('unknown Save-and-close keeps its tab and durable pending record and never dispatches again', async () => {
  respond = async request => { if (request.operation === 'files.write') throw new TypeError('Fixture lost save response'); return defaultReply(request); };
  await render(); await open(); await edit('const uncertain = 1;\n'); await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document);
  await until(() => reported.some(record => record?.method === 'files.write'));
  expect(text()).toBe('const uncertain = 1;\n'); expect(dialog()).not.toBeNull();
  await click('Save changes', dialog() ?? document); await pause(); expect(writes()).toHaveLength(1);
  await click('Cancel', dialog() ?? document); await click('Save'); await click('Refresh files'); await click('Cancel', dialog() ?? document);
  await pause(); expect(writes()).toHaveLength(1); expect(text()).toBe('const uncertain = 1;\n');
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); const pending = await loadPendingDelivery(origin);
  expect(pending).toMatchObject({ method: 'files.write', machine: 'local', paneId: 'w1:p1' });
  await closeDocument('alpha.ts'); await click('Discard', dialog() ?? document); await until(() => !editor());
  expect((await loadPendingDelivery(origin))?.requestId).toBe(pending?.requestId);
});

test('hidden editors pause reads and worker requests while actual replacement and undo commands remain read-only', async () => {
  await render(); await open(); await edit('const hiddenDraft = 4;\n'); const view = requireEditor();
  await click('Find in file'); await until(() => !!host.querySelector('.cm-search'));
  await render({ disabled: true, visible: false }); const reads = requests.length;
  const workerRequests = markdownWorker.requests.length;
  expect(editor()).toBeNull(); expect(view.state.readOnly).toBe(true);
  await act(async () => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'hiddenDraft', replace: 'forbidden' })) });
    expect(replaceAll(view)).toBe(false); expect(undo(view)).toBe(false);
    window.dispatchEvent(new Event('online'));
  });
  await pause(250); expect(requests).toHaveLength(reads); expect(markdownWorker.requests).toHaveLength(workerRequests);
  expect(view.state.doc.toString()).toBe('const hiddenDraft = 4;\n');
  await render({ disabled: false, visible: true }); await until(() => !!editor());
  expect(editor()).toBe(view); expect(host.querySelector('.cm-search')).toBeNull(); expect(text()).toBe('const hiddenDraft = 4;\n');
  await act(async () => { expect(undo(view)).toBe(true); }); expect(text()).toContain('const alpha = 1;'); expect(writes()).toEqual([]);
});

test('native Back and keyboard Escape close the original file menu and dirty dialog before leaving the editor', async () => {
  await render(); await open(); const view = requireEditor();
  await click('Open files'); await until(() => !!document.querySelector('[role="menu"]'));
  const item = document.querySelector<HTMLElement>('[role="menuitem"]'); if (!item) throw new Error('Missing original menu item');
  await act(async () => { item.focus(); expect(closeTopmostBackLayer()).toBe(true); });
  await until(() => !document.querySelector('[role="menu"]')); expect(editor()).toBe(view);
  await click('Open files'); await until(() => !!document.querySelector('[role="menu"]'));
  const focusedItem = document.querySelector<HTMLElement>('[role="menuitem"]');
  await act(async () => focusedItem?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await until(() => !document.querySelector('[role="menu"]')); expect(editor()).toBe(view);
  await edit('const dialogDraft = 1;\n'); await closeDocument('alpha.ts'); await until(() => !!dialog());
  const cancel = findButton('Cancel', dialog() ?? document); if (!cancel) throw new Error('Missing original dialog Cancel');
  await act(async () => { cancel.focus(); expect(closeTopmostBackLayer()).toBe(true); });
  await until(() => !dialog()); expect(text()).toBe('const dialogDraft = 1;\n'); expect(writes()).toEqual([]);
});

test('a detected canonical-root change prevents an older Save-and-close acknowledgement from closing its document', async () => {
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.write' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await render(); await open(); await edit('const oldRootSaved = 1;\n');
  await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document); await until(() => writes().length === 1);
  repository().root = '/new-canonical-root'; await act(async () => window.dispatchEvent(new Event('online')));
  await until(() => !!findButton('Reload'));
  await act(async () => finish?.()); await pause();
  expect(editor()).not.toBeNull(); expect(text()).toBe('const oldRootSaved = 1;\n');
  expect(writes()).toHaveLength(1); expect(writes()[0]?.expectedRoot).toBe('/repo');
});

test('late file reads cannot publish old text into another owner with a colliding filename', async () => {
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.read' && request.machine === 'local' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  repository('saved-ssh', 'w2:p2').files.set('alpha.ts', { content: 'const remoteOwner = 7;\n', revision: nextRevision() });
  await render(); await until(() => !!fileRow('alpha.ts'));
  await act(async () => fileRow('alpha.ts')?.click()); await until(() => !!finish);
  await render({ machine: 'saved-ssh', paneId: 'w2:p2' }); await open(); expect(text()).toBe('const remoteOwner = 7;\n');
  await act(async () => finish?.()); await pause(); expect(text()).toBe('const remoteOwner = 7;\n'); expect(writes()).toEqual([]);
});

test('large text preview and same-length middle edits retain the entire writable source and final tail', async () => {
  const source = 'prefix ' + 'a'.repeat(100_005) + 'MID_OLD' + 'a'.repeat(100_005) + '\nFULL_TAIL_WITHOUT_NEWLINE';
  replaceSource('large.txt', source);
  await render(); await until(() => !!fileRow('large.txt')); await act(async () => fileRow('large.txt')?.click());
  await until(() => !!host.querySelector('[data-code-preview]'));
  expect(editor()).toBeNull(); await until(() => previewText().includes('MID_OLD'));
  await click('Switch to edit mode'); await until(() => !!editor());
  expect(text()).toBe(source); expect(text().endsWith('FULL_TAIL_WITHOUT_NEWLINE')).toBe(true);
  const changed = source.replace('MID_OLD', 'MID_NEW'); expect(changed.length).toBe(source.length);
  const view = requireEditor(); await edit(changed);
  await click('Switch to preview mode'); await until(() => previewText().includes('MID_NEW'));
  expect(previewText()).not.toContain('MID_OLD'); expect(writes()).toEqual([]);
  await click('Switch to edit mode'); await until(() => !!editor()); expect(editor()).toBe(view); expect(text()).toBe(changed);
  await click('Save'); await until(() => writes().length === 1 && findButton('Save')?.disabled === true);
  expect(writes()[0]?.content).toBe(changed); expect(stored('large.txt').content).toBe(changed);
});

test('a save acknowledgement and newer CodeMirror edit queued in the same React batch keep the document open', async () => {
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.write' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await render(); await open(); await edit('const beforeBatch = 1;\n'); const view = requireEditor();
  await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document); await until(() => !!finish);
  await act(async () => {
    finish?.();
    await Promise.resolve();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'const queuedInBatch = 2;\n' } });
  });
  await until(() => findButton('Save changes')?.disabled === false || !dialog());
  expect(editor()).toBe(view); expect(text()).toBe('const queuedInBatch = 2;\n');
  expect(stored().content).toBe('const beforeBatch = 1;\r\n'); expect(writes()).toHaveLength(1);
});

for (const cancellation of ['toolbar', 'native Back', 'Find'] as const) {
  test(`Go to line ${cancellation} cancellation restores the prior selection and hides its input`, async () => {
    await render(); await open(); const view = requireEditor();
    await act(async () => view.dispatch({ selection: { anchor: 2, head: 4 } }));
    const initial = view.state.selection.toJSON();
    const line = host.querySelector<HTMLInputElement>('[data-editor-overlay] input[type="number"]');
    if (!line) throw new Error('Missing retained original line dialog');
    expect(line.closest('[hidden]')).not.toBeNull();
    await click('Go to line'); expect(line.closest('[hidden]')).toBeNull(); await fill(line, '2');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
    if (cancellation === 'toolbar') await click('Go to line');
    else if (cancellation === 'Find') await click('Find in file');
    else await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
    expect(view.state.selection.toJSON()).toEqual(initial); expect(line.closest('[hidden]')).not.toBeNull();
    expect(editor()).toBe(view); expect(writes()).toEqual([]);
  });
}

test('a failed explicit conflict reload shows the new read error and retains the full dirty draft', async () => {
  await render(); await open(); await edit('const retainedAfterReloadFailure = 3;\n');
  replaceSource('alpha.ts', 'const authoritativeAfterConflict = 9;\r\n'); await click('Save');
  await until(() => host.textContent?.includes(conflictMessage) === true);
  respond = async request => request.operation === 'files.read' ? refusal('file_read_failed', 'Fixture explicit reload failed', 503) : defaultReply(request);
  await click('Refresh files'); await click('Discard', dialog() ?? document);
  await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('Fixture explicit reload failed') === true);
  expect(host.textContent).not.toContain(conflictMessage);
  expect(text()).toBe('const retainedAfterReloadFailure = 3;\n'); expect(writes()).toHaveLength(1);
  expect(stored().content).toBe('const authoritativeAfterConflict = 9;\r\n');
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect(await loadPendingDelivery(origin)).toBeNull();
  respond = defaultReply;
  await click('Refresh files'); await click('Discard', dialog() ?? document);
  await until(() => editor()?.state.doc.toString() === 'const authoritativeAfterConflict = 9;\n');
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(findButton('Save')?.disabled).toBe(true); expect(writes()).toHaveLength(1);
});

test('attempted conflict recovery cannot bypass an uncertain save lock or replay another write', async () => {
  respond = async request => { if (request.operation === 'files.write') throw new TypeError('Fixture uncertain save before reload'); return defaultReply(request); };
  await render(); await open(); await edit('const uncertainBeforeReload = 1;\n'); await click('Save');
  await until(() => reported.some(record => record?.method === 'files.write'));
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); const pending = await loadPendingDelivery(origin);
  const unknownMessage = host.querySelector('[role="alert"]')?.textContent;
  expect(unknownMessage).toBeTruthy();
  const reads = requests.filter(request => request.operation === 'files.read').length;
  await click('Refresh files'); expect(findButton('Discard', dialog() ?? document)?.disabled).toBe(true);
  await click('Discard', dialog() ?? document); await pause();
  expect(requests.filter(request => request.operation === 'files.read')).toHaveLength(reads);
  expect(text()).toBe('const uncertainBeforeReload = 1;\n');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(unknownMessage);
  expect((await loadPendingDelivery(origin))?.requestId).toBe(pending?.requestId); expect(writes()).toHaveLength(1);
  await click('Cancel', dialog() ?? document);
  await edit('const newDraftWhileLocked = 2;\n'); expect(findButton('Save')?.disabled).toBe(true);
  await click('Save'); await pause(); expect(writes()).toHaveLength(1);
});

test('a confirmed file conflict stays scoped to its retained document across another editable file', async () => {
  await render(); await open(); await edit('const alphaConflictDraft = 3;\n');
  replaceSource('alpha.ts', 'const alphaExternal = 9;\r\n'); await click('Save');
  await until(() => host.querySelector('[role="alert"]')?.textContent?.includes(conflictMessage) === true);
  const reads = requests.filter(request => request.operation === 'files.read' && request.path === 'alpha.ts').length;
  await openNext('beta.ts'); expect(host.querySelector('[role="alert"]')).toBeNull();
  await edit('const editableBeta = 4;\n'); expect(findButton('Save')?.disabled).toBe(false);
  await selectDocument('alpha.ts'); expect(text()).toBe('const alphaConflictDraft = 3;\n');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(conflictMessage);
  expect(requests.filter(request => request.operation === 'files.read' && request.path === 'alpha.ts')).toHaveLength(reads);
  await closeDocument('alpha.ts'); await click('Discard', dialog() ?? document);
  await until(() => editor()?.state.doc.toString() === 'const editableBeta = 4;\n');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await openNext('alpha.ts'); expect(text()).toBe('const alphaExternal = 9;\n');
  expect(requests.filter(request => request.operation === 'files.read' && request.path === 'alpha.ts')).toHaveLength(reads + 1);
  expect(host.textContent).not.toContain(conflictMessage); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(findButton('Save')?.disabled).toBe(true);
  await selectDocument('beta.ts'); expect(text()).toBe('const editableBeta = 4;\n'); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(writes()).toHaveLength(1); expect(writes()[0]?.path).toBe('alpha.ts');
});

test('inactive Save-and-close reports a real file conflict in that document dialog and leaves its neighbor usable', async () => {
  await dirtyPair(); replaceSource('alpha.ts', 'const externalInactiveAlpha = 9;\r\n');
  await closeDocument('alpha.ts'); await click('Save changes', dialog() ?? document);
  await until(() => dialog()?.querySelector('[role="alert"]')?.textContent?.includes(conflictMessage) === true);
  expect(dialog()?.textContent).toContain('alpha.ts'); expect(text()).toBe('const dirtyBeta = 22;\n');
  expect(writes()).toHaveLength(1); expect(writes()[0]).toMatchObject({ path: 'alpha.ts', expectedRoot: '/repo' });
  await click('Cancel', dialog() ?? document); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(text()).toBe('const dirtyBeta = 22;\n'); expect(findButton('Save')?.disabled).toBe(false);
  await selectDocument('alpha.ts'); expect(text()).toBe('const dirtyAlpha = 11;\n');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(conflictMessage);
});
