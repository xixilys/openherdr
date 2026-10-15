import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { Worker as NodeWorker } from 'node:worker_threads';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { getDefaultTheme } from '@/lib/theme/themes';
import { closeTopmostBackLayer } from '@/lib/mobileBackLayers';
import type { WorkerRequest, WorkerResponse } from '@pierre/diffs/worker';
import { createMarkdownWorkerFixture } from '@/lib/codemirror/__tests__/markdownWorker.fixture';
import type { PendingDelivery } from '../../../../web/src/herdr/transport';
import type { WorkspaceFileRequest } from '../../../../web/src/herdr/workspace-navigation';

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
const origin = 'https://text-artifact-fixture.test';
const wire = z.object({ request: z.object({ operation: z.string(), machine: z.string(), pane_id: z.string(), terminal_id: z.string().optional(), path: z.string().optional(), content: z.string().optional(), expectedRoot: z.string().optional(), expectedRevision: z.string().nullable().optional() }), requestId: z.string().optional() });
type HostRequest = z.infer<typeof wire>['request'];
const resolveWire = z.object({ request: z.object({ target: z.object({ machine: z.string(), paneId: z.string(), identity: z.string() }) }) });
let resolvedTargets: z.infer<typeof resolveWire>['request']['target'][];
type LoggedRequest = HostRequest & { requestId?: string; server: string; signal?: AbortSignal | null };
type StoredFile = { content: string; revision: string; mime: string; binary?: Uint8Array };
type Repository = { root: string; files: Map<string, StoredFile> };
let repositories: Map<string, Repository>;
let requests: LoggedRequest[];
let unexpectedPaths: string[];
let reported: (PendingDelivery | null)[];
let respond: (request: LoggedRequest) => Promise<Response>;
let revisionCounter: number;
let createdUrls: string[];
let revokedUrls: string[];
let createdBlobs: Map<string, Blob>;
const nextRevision = () => (++revisionCounter).toString(16).padStart(64, '0');
const repository = (machine = 'local', pane = 'w1:p1', server = origin) => {
  const key = JSON.stringify([server, machine, pane]);
  let repo = repositories.get(key);
  if (!repo) {
    repo = { root: machine === 'local' ? '/repo' : '/remote-repo', files: new Map([
      ['docs/README.md', { content: '# Artifact fixture\n\nSaved **Markdown** with findable text.\n', revision: nextRevision(), mime: 'text/markdown' }],
      ['docs/other.md', { content: '# Other document\n\nAnother saved document.\n', revision: nextRevision(), mime: 'text/markdown' }],
      ['docs/config.json', { content: '{"nested":{"value":"saved JSON"},"array":[1,2]}', revision: nextRevision(), mime: 'application/json' }],
      ['docs/diagram.mmd', { content: 'flowchart TD\n  A[Start] --> B[Finished]', revision: nextRevision(), mime: 'text/plain' }],
      ['docs/drawing.svg', { content: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>', revision: nextRevision(), mime: 'image/svg+xml' }],
      ['docs/data.csv', { content: 'name,note\nalpha,"comma, quote ""kept"""\nbeta,"two\nlines"\n', revision: nextRevision(), mime: 'text/csv' }],
      ['docs/code.ts', { content: 'const savedCode = 1;\n', revision: nextRevision(), mime: 'text/plain' }],
      ['assets/pixel.png', { content: '', binary: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3GZAAAAABJRU5ErkJggg==', 'base64')), revision: nextRevision(), mime: 'image/png' }],
      ['assets/dark.svg', { content: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><text>dark</text></svg>', revision: nextRevision(), mime: 'image/svg+xml' }],
      ['assets/light.svg', { content: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><text>light</text></svg>', revision: nextRevision(), mime: 'image/svg+xml' }],
    ]) };
    repositories.set(key, repo);
  }
  return repo;
};
const refusal = (code: string, message: string, status = 409) => Response.json({ error: { code, message } }, { status });
const conflictMessage = 'The file changed. Reload it before editing';
const stored = (path = 'docs/README.md', machine = 'local', pane = 'w1:p1') => {
  const result = repository(machine, pane).files.get(path);
  if (!result) throw new Error('Missing fixture file ' + path);
  return result;
};
const replaceSource = (path: string, content: string) => repository().files.set(path, { content, revision: nextRevision(), mime: stored(path).mime });
const addText = (path: string, content: string, mime = 'text/plain') => repository().files.set(path, { content, revision: nextRevision(), mime });
async function defaultReply(request: LoggedRequest): Promise<Response> {
  const repo = repository(request.machine, request.pane_id, request.server);
  if (request.expectedRoot && request.expectedRoot !== repo.root) return refusal('target_changed', 'Fixture root changed');
  if (request.operation === 'files.list') {
    const directory = request.path ?? '';
    const prefix = directory ? directory + '/' : '';
    const entries = new Map<string, { path: string; name: string; isDirectory: boolean; size: number; modifiedTime: number; isSymbolicLink: boolean }>();
    for (const [path, file] of repo.files) {
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      const name = relative.split('/')[0]; if (!name) continue;
      const isDirectory = relative.includes('/');
      entries.set(name, { path: prefix + name, name, isDirectory, size: file.binary?.length ?? new TextEncoder().encode(file.content).length, modifiedTime: 1, isSymbolicLink: false });
    }
    return Response.json({ root: repo.root, path: directory, directory, truncated: false, entries: [...entries.values()] });
  }
  const path = request.path ?? '';
  const file = repo.files.get(path);
  if (request.operation === 'files.read' && file?.binary) return refusal('binary_file', 'Fixture binary file', 400);
  if (request.operation === 'files.download') {
    if (!file) return refusal('not_found', 'Fixture asset missing', 404);
    const bytes = file.binary ?? new TextEncoder().encode(file.content);
    return Response.json({ root: repo.root, path, base64: Buffer.from(bytes).toString('base64'), bytes: bytes.length, mime: file.mime, revision: file.revision });
  }
  if (request.operation === 'files.describe') return file ? Response.json({ root: repo.root, path, terminal_id: request.terminal_id, assetVersion: 'stat-v1:' + file.revision, bytes: new TextEncoder().encode(file.content).length, sampleKind: 'text' }) : refusal('not_found', 'Fixture file missing', 404);
  if (request.operation === 'files.read') return file ? Response.json({ root: repo.root, path, content: file.content, bytes: new TextEncoder().encode(file.content).length, revision: file.revision }) : refusal('not_found', 'Fixture file missing', 404);
  if (request.operation === 'files.write') {
    if (!file || file.revision !== request.expectedRevision) return refusal('file_conflict', conflictMessage);
    const revision = nextRevision();
    repo.files.set(path, { content: request.content ?? '', revision, mime: file.mime });
    return Response.json({ root: repo.root, path, success: true, revision });
  }
  if (request.operation === 'files.search') return Response.json({ root: repo.root, results: [], truncated: false });
  throw new Error('Unexpected fixture host operation ' + request.operation);
}

beforeEach(async () => {
  dom = new Window({ url: origin, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); dom.happyDOM.setWindowSize({ width: 412, height: 915 });
  const globals = { window: dom, Window: dom.Window, Worker: browserWorker, document: dom.document, navigator: dom.navigator,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, customElements: dom.customElements,
    CSSStyleSheet: dom.CSSStyleSheet, CSSStyleRule: dom.CSSStyleRule, XMLSerializer: dom.XMLSerializer, DocumentFragment: dom.DocumentFragment, Range: dom.Range, HTMLStyleElement: dom.HTMLStyleElement,
    ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom), NodeList: dom.NodeList, NodeFilter: dom.NodeFilter,
    HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement, HTMLTableElement: dom.HTMLTableElement,
    HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement, Document: dom.Document,
    CustomEvent: dom.CustomEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent, WheelEvent: dom.WheelEvent, TouchEvent: dom.TouchEvent, Touch: dom.Touch, DOMParser: dom.DOMParser, DOMRect: dom.DOMRect, CSS: dom.CSS, HTMLPictureElement: dom.HTMLPictureElement, HTMLSourceElement: dom.HTMLSourceElement, HTMLDetailsElement: dom.HTMLDetailsElement, SVGSVGElement: dom.SVGSVGElement, Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element,
    HTMLElement: dom.HTMLElement, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    IntersectionObserver: dom.IntersectionObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  Object.defineProperty(dom.document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(dom.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(dom.navigator, 'locks', { value: { request: async <T,>(_name: string, callback: () => Promise<T>) => callback() }, configurable: true });
  if (!document.doctype) document.insertBefore(document.implementation.createDocumentType('html', '', ''), document.documentElement);
  document.documentElement.style.fontSize = '16px';
  const htmlDescriptor = Object.getOwnPropertyDescriptor(dom.Element.prototype, 'innerHTML');
  const htmlSetter = htmlDescriptor?.set;
  if (!htmlDescriptor || !htmlSetter) throw new Error('Missing browser innerHTML descriptor');
  // Happy DOM's HTML parser drops every sibling after SVG style. Preserve the
  // real generated SVG through its XML parser without filtering any content.
  Object.defineProperty(dom.Element.prototype, 'innerHTML', { ...htmlDescriptor, set(this: Element, value: string) {
    if (this.getAttribute('data-markdown') === 'mermaid' && /^\s*<svg\b/.test(value)) {
      const parsed = new DOMParser().parseFromString(value, 'image/svg+xml');
      this.replaceChildren(document.importNode(parsed.documentElement, true));
    } else htmlSetter.call(this, value);
  } });
  requests = []; resolvedTargets = []; unexpectedPaths = []; reported = []; repositories = new Map(); revisionCounter = 0; respond = defaultReply; createdUrls = []; revokedUrls = []; createdBlobs = new Map();
  const originalCreateUrl = URL.createObjectURL; const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = value => { const url = originalCreateUrl(value); createdUrls.push(url); if (value instanceof Blob) createdBlobs.set(url, value); return url; };
  URL.revokeObjectURL = value => { revokedUrls.push(value); originalRevokeUrl(value); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.pathname === '/api/herdr/conversations/resolve') {
      const target = resolveWire.parse(JSON.parse(String(init?.body))).request.target; resolvedTargets.push(target);
      return Response.json({ protocol: 'opencode-v2', target, directory: repository(target.machine, target.paneId, url.origin).root, nativeAccess: 'unavailable', capabilities: {} });
    }
    if (url.pathname !== '/api/herdr/host') { unexpectedPaths.push(url.pathname); throw new Error('Unexpected source API ' + url.pathname); }
    const parsed = wire.parse(JSON.parse(String(init?.body)));
    const captured = { ...parsed.request, requestId: parsed.requestId, server: url.origin, signal: init?.signal };
    requests.push(captured);
    return respond(captured);
  }, originalFetch);
  restore = () => { Object.defineProperty(dom.Element.prototype, 'innerHTML', htmlDescriptor); URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl; globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  ({ FilesPanel } = await import('../../../../web/src/herdr/ContentPanel'));
  ({ I18nProvider } = await import('@/lib/i18n'));
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  transport = new HerdrTransport({ server: origin, token: 'synthetic-artifact-device' });
  props = { machine: 'local', paneId: 'w1:p1', terminalId: 'terminal-fixture', isMobile: true, theme: getDefaultTheme(true), themeMode: 'dark' };
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => {
  try {
    for (let i = 0; i < 250 && (markdownWorker.pendingRequests > 0 || [...pendingWorkerRequests.values()].some(pending => pending.size > 0)) && workerErrors.length === 0 && markdownWorker.failures.length === 0; i++) await pause(20);
    expect([...pendingWorkerRequests.values()].every(pending => pending.size === 0)).toBe(true);
    expect(workerErrors).toEqual([]); expect(markdownWorker.failures).toEqual([]); expect(markdownWorker.pendingRequests).toBe(0); expect(unexpectedPaths).toEqual([]);
  } finally { await act(async () => tree?.unmount()); await dom.happyDOM.close(); try { expect(createdUrls.every(url => revokedUrls.includes(url))).toBe(true); } finally { restore(); } }
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
const openEntry = async (name: string) => { await until(() => !!fileRow(name)); const row = fileRow(name); if (!row) throw new Error('Missing artifact row ' + name); await act(async () => row.click()); };
const openDocs = async () => { await until(() => !!fileRow('docs')); await openEntry('docs'); };
const open = async (name = 'README.md') => { await openEntry(name); await until(() => !!host.querySelector('[data-text-artifact], [data-code-preview]') || !!editor()); };
const writes = () => requests.filter(request => request.operation === 'files.write');

const clickMode = async (labels: readonly string[]) => { const label = labels.find(value => !!findButton(value)); if (!label) throw new Error('Missing original artifact mode control'); await click(label); };
const enterEdit = async () => { await clickMode(['Switch to edit mode', 'Switch to Text View', 'Show source']); await until(() => !!editor()); };
const enterPreview = async () => { await clickMode(['Switch to preview mode', 'Switch to Tree View', 'Show as table']); await until(() => !!host.querySelector('[data-text-artifact], [data-code-preview]') && !editor()); };
const markdownContent = () => host.querySelector<HTMLElement>('[data-markdown-content]');
const renderedMarkdown = () => markdownContent()?.textContent ?? '';
const fill = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing browser input setter');
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const selectDocument = async (name: string) => {
  await click('Open files'); await until(() => !!findButton('Close ' + name));
  const row = findButton('Close ' + name)?.closest<HTMLElement>('[role="menuitem"]');
  if (!row) throw new Error('Missing original file menu row ' + name);
  await act(async () => row.click()); await until(() => !document.querySelector('[role="menu"]'));
};
const closeDocument = async (name: string) => { await click('Open files'); await until(() => !!findButton('Close ' + name)); await click('Close ' + name); };
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const openNext = async (name: string) => { await click('Back'); await open(name); };

for (const fixture of [
  { path: 'docs/tree.json', source: '{"deep":{"child":{"value":"actual JSON leaf"}},"list":[1,2]}' },
  { path: 'docs/tree.jsonc', source: '// retained comment\n{"deep":{"child":{"value":"actual JSON leaf",},},"list":[1,2,],}' },
  { path: 'docs/tree.geojson', source: '{"type":"Feature","deep":{"child":{"value":"actual JSON leaf"}},"geometry":{"type":"Point","coordinates":[1,2]}}' },
]) {
  test(`${fixture.path} uses the original JSON tree and retains saved-preview content until manual Save`, async () => {
    addText(fixture.path, fixture.source, 'application/json'); await render(); await openDocs(); await open(fixture.path.split('/').at(-1) ?? '');
    await until(() => !!findButton('Expand All')); expect(editor()).toBeNull(); expect(findButton('Expand All')).toBeDefined(); expect(findButton('Collapse All')).toBeDefined();
    await click('Expand All'); expect(host.textContent).toContain('actual JSON leaf');
    await click('Collapse All'); expect(host.textContent).not.toContain('actual JSON leaf');
    await click('Expand All'); expect(host.textContent).toContain('actual JSON leaf');
    await enterEdit(); expect(text()).toBe(fixture.source);
    await edit('{"deep":{"value":"UNSAVED JSON leaf"}}'); await enterPreview();
    await click('Expand All'); expect(host.textContent).toContain('actual JSON leaf'); expect(host.textContent).not.toContain('UNSAVED JSON leaf'); expect(writes()).toEqual([]);
    await click('Save'); await until(() => host.textContent?.includes('UNSAVED JSON leaf') === true);
    expect(writes()).toHaveLength(1); expect(stored(fixture.path).content).toBe('{"deep":{"value":"UNSAVED JSON leaf"}}');
  });
}

test('JSON5 retains strict parser error and recovers to the real tree after editing and saving valid JSON', async () => {
  const source = "{unquoted: 'strict parser must reject',}";
  addText('docs/strict.json5', source, 'application/json'); await render(); await openDocs(); await open('strict.json5');
  await until(() => host.textContent?.includes('Invalid JSON') === true); expect(findButton('Expand All')).toBeUndefined();
  await enterEdit(); expect(text()).toBe(source); await edit('{"recovered":"strict valid JSON"}');
  await enterPreview(); expect(host.textContent).toContain('Invalid JSON'); expect(writes()).toEqual([]);
  await click('Save'); await until(() => !!findButton('Expand All')); expect(host.textContent).toContain('strict valid JSON'); expect(host.textContent).not.toContain('Invalid JSON');
});

for (const fixture of [
  { path: 'docs/quoted.csv', source: 'name,note\nalpha,"comma, quote ""kept"""\nbeta,"two\nlines"\n', cells: ['alpha', 'comma, quote "kept"', 'beta', 'two\nlines'] },
  { path: 'docs/quoted.tsv', source: 'name\tnote\nalpha\t"tab\tinside"\nbeta\t"two\nlines"\n', cells: ['alpha', 'tab\tinside', 'beta', 'two\nlines'] },
]) {
  test(`${fixture.path} renders real quoted table cells and edits its complete source independently of the saved preview`, async () => {
    addText(fixture.path, fixture.source); await render(); await openDocs(); await open(fixture.path.split('/').at(-1) ?? '');
    await until(() => host.querySelectorAll('tbody td').length > 0); expect([...host.querySelectorAll('tbody td')].map(cell => cell.textContent)).toEqual(fixture.cells);
    expect(host.querySelector('table')?.parentElement?.className).toContain('overflow-auto');
    await enterEdit(); expect(text()).toBe(fixture.source); const view = requireEditor();
    await edit(fixture.source.replace('alpha', 'newName')); await enterPreview();
    expect([...host.querySelectorAll('tbody td')].map(cell => cell.textContent)).toEqual(fixture.cells); expect(writes()).toEqual([]);
    await enterEdit(); expect(editor()).toBe(view); await act(async () => { expect(undo(view)).toBe(true); }); expect(text()).toBe(fixture.source);
  });
}

test('CSV display cap states truncation while source editing and saving retain every row and final byte', async () => {
  const source = 'id,value\n' + Array.from({ length: 2_005 }, (_, i) => `${i},full-row-${i}`).join('\n');
  addText('docs/large.csv', source, 'text/csv'); await render(); await openDocs(); await open('large.csv');
  await until(() => host.querySelectorAll('tbody tr').length === 2_000); expect(host.querySelectorAll('tbody tr')).toHaveLength(2_000); expect(host.textContent).toContain('2000'); expect(host.textContent).toContain('2005');
  expect(host.textContent).not.toContain('full-row-2004'); await enterEdit(); expect(text()).toBe(source);
  const changed = source.replace('full-row-2004', 'FULL_TAIL_2004'); await edit(changed); await click('Save');
  await until(() => writes().length === 1 && findButton('Save')?.disabled === true);
  expect(stored('docs/large.csv').content).toBe(changed); expect(writes()[0]?.content?.endsWith('2004,FULL_TAIL_2004')).toBe(true);
});

test('Markdown preview/search, saved-content rendering, active undo, per-document modes, dirty close and fresh read form one real flow', async () => {
  replaceSource('docs/README.md', '---\ntitle: Hidden frontmatter\n---\n# Artifact fixture\n\nNeedle in **Markdown**, another needle, and a final needle.\n');
  await render(); await openDocs(); await open(); await until(() => renderedMarkdown().includes('Artifact fixture'));
  expect(renderedMarkdown()).not.toContain('Hidden frontmatter'); expect(markdownContent()?.querySelector('strong')?.textContent).toBe('Markdown');
  await click('Find in file');
  const search = host.querySelector<HTMLInputElement>('input[aria-label="Find in preview"]'); if (!search) throw new Error('Missing original Markdown rendered-search widget');
  await fill(search, 'needle'); await until(() => host.querySelectorAll('mark[data-md-find]').length === 3);
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('1/3');
  await click('Next match'); expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('2/3');
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); expect(host.querySelector('input[aria-label="Find in preview"]')).toBeNull();
  await enterEdit(); const view = requireEditor(); const savedSource = text();
  await edit('# Unsaved Markdown\n\nFull new draft.\n'); await enterPreview(); await until(() => renderedMarkdown().includes('Artifact fixture'));
  expect(renderedMarkdown()).not.toContain('Unsaved Markdown'); expect(writes()).toEqual([]);
  await enterEdit(); expect(editor()).toBe(view); expect(text()).toBe('# Unsaved Markdown\n\nFull new draft.\n');
  await act(async () => { expect(undo(view)).toBe(true); }); expect(text()).toBe(savedSource);
  await edit('# Saved Markdown\n\nThis survives a fresh read.\n');
  await openNext('config.json'); await until(() => !!findButton('Expand All')); await enterEdit(); await edit('{"otherDraft":"independent"}');
  await selectDocument('README.md'); await until(() => !!editor()); expect(text()).toBe('# Saved Markdown\n\nThis survives a fresh read.\n');
  await enterPreview(); await until(() => renderedMarkdown().includes('Artifact fixture')); await click('Save');
  await until(() => renderedMarkdown().includes('Saved Markdown')); expect(stored().content).toBe('# Saved Markdown\n\nThis survives a fresh read.\n');
  await selectDocument('config.json'); expect(text()).toBe('{"otherDraft":"independent"}'); expect(host.querySelector('[data-text-artifact]')).toBeNull();
  await closeDocument('config.json'); await until(() => !!dialog()); await click('Cancel', dialog() ?? document); expect(text()).toBe('{"otherDraft":"independent"}');
  await selectDocument('README.md'); await until(() => renderedMarkdown().includes('Saved Markdown'));
  const reads = requests.filter(request => request.operation === 'files.read' && request.path === 'docs/README.md').length;
  await closeDocument('README.md'); await until(() => !!editor()); expect(text()).toBe('{"otherDraft":"independent"}');
  await openNext('README.md'); await until(() => renderedMarkdown().includes('Saved Markdown'));
  expect(requests.filter(request => request.operation === 'files.read' && request.path === 'docs/README.md')).toHaveLength(reads + 1);
  expect(writes()).toHaveLength(1);
});

test('failed and uncertain Markdown saves preserve the draft while the preview keeps confirmed saved content', async () => {
  await render(); await openDocs(); await open(); await enterEdit(); await edit('# Retained after refusal\n');
  replaceSource('docs/README.md', '# External saved bytes\n'); await click('Save');
  await until(() => host.querySelector('[role="alert"]')?.textContent?.includes(conflictMessage) === true);
  await enterPreview(); await until(() => renderedMarkdown().includes('Artifact fixture')); expect(renderedMarkdown()).not.toContain('Retained after refusal');
  await enterEdit(); expect(text()).toBe('# Retained after refusal\n');
  respond = async request => { if (request.operation === 'files.write') throw new TypeError('Synthetic lost artifact save response'); return defaultReply(request); };
  await click('Save'); await until(() => reported.some(record => record?.method === 'files.write'));
  await enterPreview(); await until(() => renderedMarkdown().includes('Artifact fixture')); await enterEdit(); expect(text()).toBe('# Retained after refusal\n');
  await click('Save'); await pause(); expect(writes()).toHaveLength(2);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect((await loadPendingDelivery(origin))?.method).toBe('files.write');
});

test('a delayed successful artifact save updates only the submitted saved preview while a newer source edit remains dirty', async () => {
  let finish: (() => void) | undefined;
  respond = async request => { const result = await defaultReply(request); return request.operation === 'files.write' ? new Promise(resolve => { finish = () => resolve(result); }) : result; };
  await render(); await openDocs(); await open(); await enterEdit(); await edit('# Submitted Markdown\n'); await click('Save');
  await until(() => !!finish); await edit('# Newer unsaved Markdown\n'); await act(async () => finish?.());
  await until(() => findButton('Save')?.disabled === false); await enterPreview(); await until(() => renderedMarkdown().includes('Submitted Markdown'));
  expect(renderedMarkdown()).not.toContain('Newer unsaved Markdown'); await enterEdit(); expect(text()).toBe('# Newer unsaved Markdown\n');
  expect(findButton('Save')?.disabled).toBe(false); expect(stored().content).toBe('# Submitted Markdown\n'); expect(writes()).toHaveLength(1);
});

test('the existing generic code preview continues to show its current draft and Excalidraw Markdown remains source-only', async () => {
  addText('docs/board.excalidraw.md', '# Excalidraw source\n');
  await render(); await openDocs(); await open('code.ts'); await until(() => !!editor()); await edit('const currentDraft = "CODE_PREVIEW";\n'); await enterPreview();
  await until(() => host.querySelector('diffs-container')?.shadowRoot?.textContent?.includes('CODE_PREVIEW') === true);
  expect(writes()).toEqual([]); await openNext('board.excalidraw.md'); await until(() => !!editor());
  expect(text()).toBe('# Excalidraw source\n'); expect(findButton('Switch to preview mode')).toBeUndefined(); expect(host.querySelector('[data-text-artifact]')).toBeNull();
});

test('SVG stays inside the original image boundary and its real zoom/fit/pinch controls preserve saved-source preview', async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" id="artifact-active-svg" width="200" height="100" onload="globalThis.artifactProbe=1"><script>globalThis.artifactProbe=2</script><rect width="200" height="100" fill="red"/></svg>';
  replaceSource('docs/drawing.svg', source); await render(); await openDocs(); await open('drawing.svg');
  await until(() => !!host.querySelector('[data-text-artifact="svg"] img'));
  const image = host.querySelector<HTMLImageElement>('[data-text-artifact="svg"] img'); if (!image) throw new Error('Missing original ImageArtifact');
  expect(decodeURIComponent(image.src.split(',', 2)[1] ?? '')).toBe(source);
  expect(host.querySelector('#artifact-active-svg')).toBeNull(); expect(host.querySelector('[data-text-artifact="svg"] script')).toBeNull();
  expect(image.getAttribute('onload')).toBeNull();
  const viewport = image.parentElement?.parentElement; if (!viewport) throw new Error('Missing image viewport');
  Object.defineProperties(image, { naturalWidth: { value: 200, configurable: true }, naturalHeight: { value: 100, configurable: true }, clientWidth: { get: () => Number.parseFloat(image.style.width) || 200, configurable: true } });
  image.getBoundingClientRect = () => new DOMRect(0, 0, Number.parseFloat(image.style.width) || 200, Number.parseFloat(image.style.height) || 100);
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 412, 600);
  await act(async () => image.dispatchEvent(new Event('load'))); expect(host.textContent).toContain('200 × 100');
  await click('Zoom in'); expect(image.style.width).toBe('300px');
  await click('Zoom out'); expect(image.style.width).toBe('200px');
  const wheel = new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, clientX: 30, clientY: 30, bubbles: true, cancelable: true });
  Object.defineProperty(wheel, 'ctrlKey', { value: true }); // Happy DOM WheelEvent omits MouseEvent modifiers.
  await act(async () => viewport.dispatchEvent(wheel)); expect(wheel.defaultPrevented).toBe(true); expect(Number.parseFloat(image.style.width)).toBeGreaterThan(200);
  await click('Fit'); expect(image.style.width).toBe(''); expect(findButton('Fit')?.getAttribute('aria-pressed')).toBe('true');
  const touch = (identifier: number, clientX: number) => new Touch({ identifier, target: viewport, clientX, clientY: 30 });
  await act(async () => viewport.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(1, 10), touch(2, 110)], bubbles: true, cancelable: true })));
  const pinch = new TouchEvent('touchmove', { touches: [touch(1, 10), touch(2, 210)], bubbles: true, cancelable: true });
  await act(async () => viewport.dispatchEvent(pinch)); expect(pinch.defaultPrevented).toBe(true); expect(image.style.width).toBe('400px');
  await enterEdit(); await edit(source.replace('fill="red"', 'fill="blue"')); await enterPreview();
  const savedImage = host.querySelector<HTMLImageElement>('[data-text-artifact="svg"] img'); expect(savedImage && decodeURIComponent(savedImage.src.split(',', 2)[1] ?? '')).toBe(source);
  await click('Save'); await until(() => host.querySelector<HTMLImageElement>('[data-text-artifact="svg"] img')?.src.includes('blue') === true);
  expect(stored('docs/drawing.svg').content).toContain('fill="blue"');
});

const mermaidSvg = () => host.querySelector<SVGSVGElement>('[data-markdown="mermaid"] > svg');

test('Mermaid uses the installed SVG renderer, original controls and source recovery after invalid saved syntax', async () => {
  await render(); await openDocs(); await open('diagram.mmd'); await until(() => !!mermaidSvg());
  const svg = mermaidSvg(); const viewport = host.querySelector<HTMLElement>('[data-markdown="mermaid-viewport"]'); if (!svg || !viewport) throw new Error('Missing real Mermaid viewer');
  expect(svg.textContent).toContain('Start'); expect(svg.textContent).toContain('Finished');
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 412, 600);
  await click('Reset view'); const fitBox = svg.getAttribute('viewBox');
  await click('Zoom in'); expect(svg.getAttribute('viewBox')).not.toBe(fitBox);
  await click('Reset view'); expect(svg.getAttribute('viewBox')).toBe(fitBox);
  await click('Copy source'); await pause(); expect(await dom.navigator.clipboard.readText()).toBe(stored('docs/diagram.mmd').content);
  const urls = createdUrls.length; await click('Download SVG'); expect(createdUrls).toHaveLength(urls + 1);
  const exportedUrl = createdUrls.at(-1); if (!exportedUrl) throw new Error('Missing generated SVG download');
  expect(await createdBlobs.get(exportedUrl)?.text()).toContain('<svg'); expect(revokedUrls).toContain(exportedUrl);
  await enterEdit(); await edit('this is not a Mermaid diagram'); await click('Save'); await until(() => findButton('Save')?.disabled === true); await enterPreview();
  await until(() => !!host.querySelector('[data-markdown="mermaid-ascii"]')); expect(mermaidSvg()).toBeNull();
  expect(host.querySelector('[data-markdown="mermaid-ascii"]')?.textContent).toBe('this is not a Mermaid diagram');
  await enterEdit(); expect(text()).toBe('this is not a Mermaid diagram'); await edit('flowchart LR\n  C[Recovered] --> D[Actual SVG]');
  await enterPreview(); expect(mermaidSvg()).toBeNull(); await click('Save'); await until(() => mermaidSvg()?.textContent?.includes('Recovered') === true);
});

test('actual Mermaid-generated SVG contains no executable injection or external paint reference from adversarial source', async () => {
  const source = 'flowchart TD\n  A["<img src=x onerror=artifactProbe()>"] --> B["<script>artifactProbe()</script>"]\n  classDef hostile fill:url(https://artifact-external.invalid/paint.svg#paint),stroke:#f00\n  class A hostile';
  replaceSource('docs/diagram.mmd', source); await render(); await openDocs(); await open('diagram.mmd'); await until(() => !!mermaidSvg());
  const svg = mermaidSvg(); if (!svg) throw new Error('Adversarial source did not reach actual installed Mermaid SVG renderer');
  expect(svg.querySelectorAll('text').length).toBeGreaterThan(0);
  const elements = [svg, ...svg.querySelectorAll('*')];
  const activeElements = [...svg.querySelectorAll('script,foreignObject,iframe,object,embed,animate,set,animateTransform')].map(element => element.outerHTML);
  const handlers = elements.flatMap(element => [...element.attributes].filter(attribute => /^on/i.test(attribute.name)).map(attribute => `${element.tagName}.${attribute.name}=${attribute.value}`));
  const urlAttributes = new Set(['href', 'xlink:href', 'src', 'fill', 'stroke', 'style', 'filter', 'clip-path', 'mask', 'cursor']);
  const unsafeReferences = elements.flatMap(element => [...element.attributes].filter(attribute => urlAttributes.has(attribute.name) && /javascript:|vbscript:|artifact-external\.invalid|url\(\s*["']?\s*(?:https?:|data:|\/\/)/i.test(attribute.value)).map(attribute => `${element.tagName}.${attribute.name}=${attribute.value}`));
  const externalStyles = [...svg.querySelectorAll('style')].map(element => element.textContent ?? '').filter(style => /@import|artifact-external\.invalid|url\(\s*["']?\s*(?:https?:|data:|\/\/)/i.test(style));
  await click('Download SVG'); const exportedUrl = createdUrls.at(-1);
  const exportedSvg = exportedUrl ? await createdBlobs.get(exportedUrl)?.text() : undefined;
  await writeFile(new URL('../../../../../.tmp/artifact-preview-test-mermaid-adversarial.json', import.meta.url), JSON.stringify({ source, svg: svg.outerHTML, exportedSvg, activeElements, handlers, unsafeReferences, externalStyles }, null, 2));
  expect(activeElements).toEqual([]); expect(handlers).toEqual([]); expect(unsafeReferences).toEqual([]); expect(externalStyles).toEqual([]);
  expect(exportedSvg).toContain('<svg'); expect(exportedSvg?.match(/artifact-external\.invalid|@import|javascript:/i)).toBeNull();
  expect(requests.filter(request => request.operation !== 'files.list' && request.operation !== 'files.describe' && request.operation !== 'files.read')).toEqual([]);
});

const downloads = () => requests.filter(request => request.operation === 'files.download');
const clickLink = async (label: string) => {
  const link = [...(markdownContent()?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].find(anchor => anchor.textContent === label);
  if (!link) throw new Error('Missing actual rendered Markdown link ' + label);
  const event = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
  await act(async () => link.dispatchEvent(event)); return event;
};

test('actual sanitized Markdown owns relative image/picture/srcset resources, app-theme selection, heading links and local file navigation', async () => {
  replaceSource('docs/README.md', '# Safe document\n\n[Jump](#target-heading) and [Next file](other.md).\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/dark.svg 1x, ../assets/pixel.png 2x"><source media="(prefers-color-scheme: light)" srcset="../assets/light.svg 1x"><img src="../assets/pixel.png" alt="owned picture" onerror="artifactProbe()"></picture>\n\n<details><summary>Safe details</summary><kbd>Kept</kbd></details>\n<div onclick="artifactProbe()" class="unsafe-author-class" style="position:fixed">Safe inline HTML</div>\n<a href="javascript:artifactProbe()">Unsafe link</a>\n\n## Target heading\n\nThe local heading target.\n');
  await render(); await openDocs(); await open();
  await until(() => !!markdownContent()?.querySelector('picture img[src^="blob:"]') && [...(markdownContent()?.querySelectorAll('source') ?? [])].every(source => source.getAttribute('srcset')?.startsWith('blob:')));
  let content = markdownContent(); if (!content) throw new Error('Missing real Markdown document');
  expect(downloads().map(request => request.path).sort()).toEqual(['assets/dark.svg', 'assets/light.svg', 'assets/pixel.png']);
  expect(downloads().every(request => request.server === origin && request.machine === 'local' && request.pane_id === 'w1:p1')).toBe(true);
  expect(/blob:.* 1x, blob:.* 2x/.test(content.querySelector('source')?.getAttribute('srcset') ?? '')).toBe(true);
  const sources = [...content.querySelectorAll('picture source')];
  expect(sources[0]?.getAttribute('media')).toBe('(min-width: 0px)'); expect(sources[1]?.getAttribute('media')).toBe('(max-width: -1px)');
  await render({ theme: getDefaultTheme(false), themeMode: 'light' });
  await until(() => markdownContent()?.querySelector('picture source')?.getAttribute('media') === '(max-width: -1px)');
  const updated = markdownContent(); if (!updated) throw new Error('Missing current themed Markdown document'); content = updated;
  expect(content.querySelectorAll('picture source')[1]?.getAttribute('media')).toBe('(min-width: 0px)'); expect(downloads()).toHaveLength(3);
  expect(content.querySelector('details summary')?.textContent).toBe('Safe details'); expect(content.querySelector('kbd')?.textContent).toBe('Kept');
  expect(content.querySelector('script,iframe,form,input,object,embed')).toBeNull();
  expect([...content.querySelectorAll('*')].flatMap(element => [...element.attributes].filter(attribute => /^on/i.test(attribute.name)))).toEqual([]);
  expect(content.querySelector('.unsafe-author-class')).toBeNull();
  expect([...content.querySelectorAll('a[href],img[src],source[srcset]')].some(element => /javascript:|vbscript:/i.test(element.getAttribute('href') ?? element.getAttribute('src') ?? element.getAttribute('srcset') ?? ''))).toBe(false);
  const heading = [...content.querySelectorAll<HTMLElement>('h2')].find(element => element.textContent === 'Target heading'); if (!heading) throw new Error('Missing actual heading');
  let scrolls = 0; heading.scrollIntoView = () => { scrolls += 1; };
  const reads = requests.length; expect((await clickLink('Jump')).defaultPrevented).toBe(true); expect(scrolls).toBe(1); expect(requests).toHaveLength(reads);
  const localEvent = await clickLink('Next file'); expect(localEvent.defaultPrevented).toBe(true);
  await until(() => renderedMarkdown().includes('Other document'));
  expect(requests.filter(request => request.operation === 'files.read').at(-1)).toMatchObject({ server: origin, machine: 'local', pane_id: 'w1:p1', path: 'docs/other.md' });
  expect(createdUrls.every(url => revokedUrls.includes(url))).toBe(true);
});

// Adjacent removed siblings are covered in real Chrome by
// .tmp/artifact-browser/raw-html-security.json. Happy DOM 18's NodeIterator is
// backed by TreeWalker and stops after its current node is removed. Keep these
// independent inputs so that environment bug cannot skip a later assertion.
for (const markup of [
  '<script>artifactProbe()</script>',
  '<iframe src="about:blank"></iframe>',
  '<form>Unsafe form wrapper</form>',
  '<input value="unsafe">',
  '<a href="javascript:artifactProbe()">Unsafe link</a>',
]) {
  test(`actual raw-HTML Markdown sanitization rejects ${markup.split('>')[0]}>`, async () => {
    replaceSource('docs/README.md', `# Sanitizer fixture\n\n${markup}\n`);
    await render(); await openDocs(); await open();
    await until(() => renderedMarkdown().includes('Sanitizer fixture'));
    const content = markdownContent(); if (!content) throw new Error('Missing real sanitized Markdown');
    expect(content.querySelector('script,iframe,form,input,object,embed')).toBeNull();
    expect([...content.querySelectorAll('*')].flatMap(element => [...element.attributes].filter(attribute => /^on/i.test(attribute.name)))).toEqual([]);
    expect([...content.querySelectorAll('a[href]')].some(element => /javascript:|vbscript:/i.test(element.getAttribute('href') ?? ''))).toBe(false);
    expect(writes()).toEqual([]); expect(downloads()).toEqual([]);
  });
}

for (const fixture of [
  { reference: '../../outside.png', kind: 'outside', message: 'This file is outside the current project.', reads: 0 },
  { reference: '../assets/missing.png', kind: 'missing', message: 'Failed to read file', reads: 1 },
  { reference: '../docs/config.json', kind: 'not-image', message: 'This file cannot be shown as an image.', reads: 1 },
  { reference: '../assets/pixel.png', kind: 'wrong-root', message: 'This file is outside the current project.', reads: 1 },
]) {
  test(`Markdown ${fixture.kind} resources fail explicitly through the confined host adapter`, async () => {
    replaceSource('docs/README.md', `# Resource failure\n\n![owned reference](${fixture.reference})\n`);
    if (fixture.kind === 'wrong-root') respond = async request => {
      if (request.operation !== 'files.download') return defaultReply(request);
      const result = stored('assets/pixel.png'); const bytes = result.binary ?? new Uint8Array();
      return Response.json({ root: '/different-root', path: request.path, base64: Buffer.from(bytes).toString('base64'), mime: result.mime, bytes: bytes.length, revision: result.revision });
    };
    await render(); await openDocs(); await open();
    await until(() => host.querySelector('[role="alert"]')?.textContent?.includes(fixture.message) === true);
    expect(downloads()).toHaveLength(fixture.reads); expect(createdUrls).toEqual([]); expect(renderedMarkdown()).toContain('Resource failure');
    expect(requests.some(request => request.path?.includes('outside.png'))).toBe(false);
  });
}

test('a failed Markdown image retries after hide/show and clears its own stale error after successful binding', async () => {
  replaceSource('docs/README.md', '# Retriable image\n\n![picture](../assets/pixel.png)\n');
  let failures = 1;
  respond = async request => request.operation === 'files.download' && failures-- > 0
    ? refusal('not_found', 'Fixture transient image failure', 404)
    : defaultReply(request);
  await render(); await openDocs(); await open();
  await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('pixel.png') === true);
  expect(downloads()).toHaveLength(1); expect(createdUrls).toEqual([]);
  await render({ disabled: true, visible: false }); await render({ disabled: false, visible: true });
  await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
  expect(downloads()).toHaveLength(2); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(renderedMarkdown()).toContain('Retriable image'); expect(writes()).toEqual([]);
});

test('a successful Markdown image binding does not clear another reference failure in the same saved document', async () => {
  replaceSource('docs/README.md', '# Separate image results\n\n![missing](../assets/missing.png)\n\n![late success](../assets/pixel.png)\n');
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.download' && request.path === 'assets/pixel.png'
      ? new Promise(resolve => { finish = () => resolve(response); })
      : response;
  };
  await render(); await openDocs(); await open();
  await until(() => !!finish && host.querySelector('[role="alert"]')?.textContent?.includes('missing.png') === true);
  await act(async () => finish?.()); await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('missing.png');
  expect([...new Set(downloads().map(request => request.path))].sort()).toEqual(['assets/missing.png', 'assets/pixel.png']);
  expect(downloads().filter(request => request.path === 'assets/pixel.png')).toHaveLength(1);
});

test('failed Markdown resources recover after an explicit source Save without leaving stale error banners', async () => {
  replaceSource('docs/README.md', '# Fixable image\n\n![picture](../assets/missing.png)\n');
  await render(); await openDocs(); await open(); await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('missing.png') === true);
  await enterEdit(); await edit('# Fixable image\n\n![picture](../assets/pixel.png)\n'); await click('Save'); await until(() => findButton('Save')?.disabled === true); await enterPreview();
  await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(downloads().map(request => request.path)).toEqual(['assets/missing.png', 'assets/pixel.png']);
});

test('root-escaping and unreadable local Markdown links do not borrow another file or widen the host path', async () => {
  replaceSource('docs/README.md', '# Link boundary\n\n[Outside](../../outside.md) [Unreadable](missing.md)\n');
  await render(); await openDocs(); await open(); await until(() => renderedMarkdown().includes('Link boundary'));
  const reads = requests.filter(request => request.operation === 'files.read').length;
  expect((await clickLink('Outside')).defaultPrevented).toBe(true); await until(() => host.querySelector('[role="alert"]')?.textContent?.includes('outside the current project') === true);
  expect(requests.filter(request => request.operation === 'files.read')).toHaveLength(reads); expect(renderedMarkdown()).toContain('Link boundary');
  expect((await clickLink('Unreadable')).defaultPrevented).toBe(true); await until(() => host.textContent?.includes('Fixture file missing') === true);
  expect(requests.filter(request => request.operation === 'files.describe').at(-1)?.path).toBe('docs/missing.md'); expect(renderedMarkdown()).toContain('Link boundary');
});

for (const transition of ['hidden', 'file', 'machine', 'server', 'transport'] as const) {
  test(`pending Markdown image reads cannot attach across a ${transition} transition and the current source can load freshly`, async () => {
    replaceSource('docs/README.md', '# Pending local image\n\n![image](../assets/pixel.png)\n');
    let finish: (() => void) | undefined; let held = false;
    respond = async request => {
      const response = await defaultReply(request);
      if (request.operation === 'files.download' && request.server === origin && request.machine === 'local' && !held) {
        held = true; return new Promise(resolve => { finish = () => resolve(response); });
      }
      return response;
    };
    await render(); await openDocs(); await open(); await until(() => !!finish);
    const original = downloads()[0]; if (!original) throw new Error('Missing pending original image request');
    if (transition === 'hidden') {
      await render({ disabled: true, visible: false }); const count = requests.length;
      await act(async () => window.dispatchEvent(new Event('online'))); await pause(); expect(requests).toHaveLength(count);
    } else if (transition === 'file') {
      await openNext('other.md'); await until(() => renderedMarkdown().includes('Other document'));
    } else if (transition === 'machine') {
      repository('saved-ssh', 'w2:p2').files.set('docs/README.md', { content: '# New machine image\n\n![image](../assets/pixel.png)\n', revision: nextRevision(), mime: 'text/markdown' });
      await render({ machine: 'saved-ssh', paneId: 'w2:p2' }); await openDocs(); await open();
      await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
      expect(downloads().at(-1)).toMatchObject({ server: origin, machine: 'saved-ssh', pane_id: 'w2:p2', path: 'assets/pixel.png' });
    } else if (transition === 'server') {
      const server = 'https://other-artifact-fixture.test';
      repository('local', 'w1:p1', server).files.set('docs/README.md', { content: '# New server image\n\n![image](../assets/pixel.png)\n', revision: nextRevision(), mime: 'text/markdown' });
      const { HerdrTransport } = await import('../../../../web/src/herdr/transport'); transport = new HerdrTransport({ server, token: 'synthetic-other-artifact-device' });
      await render(); await openDocs(); await open(); await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
      expect(downloads().at(-1)).toMatchObject({ server, machine: 'local', pane_id: 'w1:p1', path: 'assets/pixel.png' });
    } else {
      const { HerdrTransport } = await import('../../../../web/src/herdr/transport'); transport = new HerdrTransport({ server: origin, token: 'synthetic-replaced-artifact-device' });
      await render(); await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
      expect(downloads()).toHaveLength(2);
    }
    expect(original.signal?.aborted).toBe(true);
    const currentUrl = markdownContent()?.querySelector('img')?.getAttribute('src'); const urlCount = createdUrls.length;
    await act(async () => finish?.()); await pause(); expect(createdUrls).toHaveLength(urlCount);
    if (transition === 'hidden') {
      expect(markdownContent()).toBeNull(); await render({ disabled: false, visible: true });
      await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]')); expect(downloads()).toHaveLength(2);
    } else if (transition === 'file') {
      expect(renderedMarkdown()).toContain('Other document'); expect(markdownContent()?.querySelector('img')).toBeNull();
      await selectDocument('README.md'); await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]')); expect(downloads()).toHaveLength(2);
    } else {
      expect(markdownContent()?.querySelector('img')?.getAttribute('src')).toBe(currentUrl);
    }
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
}

test('canonical-root invalidation withdraws a pending Markdown image and never borrows the new root for the old document', async () => {
  replaceSource('docs/README.md', '# Root-bound image\n\n![image](../assets/pixel.png)\n');
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.download' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await render(); await openDocs(); await open(); await until(() => !!finish);
  const original = downloads()[0]; repository().root = '/changed-pane-root';
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!findButton('Reload'));
  expect(original?.signal?.aborted).toBe(true); await act(async () => finish?.()); await pause();
  expect(createdUrls).toEqual([]); expect(downloads()).toHaveLength(1); expect(renderedMarkdown()).toContain('Root-bound image');
  await click('Reload'); await pause(); expect(downloads()).toHaveLength(1); expect(createdUrls).toEqual([]);
});

test('a saved Markdown image-reference change cannot receive the previous pending resource result', async () => {
  replaceSource('docs/README.md', '# Reference transition\n\n![image](../assets/dark.svg)\n');
  let finish: (() => void) | undefined;
  respond = async request => {
    const response = await defaultReply(request);
    return request.operation === 'files.download' && request.path === 'assets/dark.svg' ? new Promise(resolve => { finish = () => resolve(response); }) : response;
  };
  await render(); await openDocs(); await open(); await until(() => !!finish);
  const oldRequest = downloads()[0]; await enterEdit(); await edit('# Reference transition\n\n![image](../assets/light.svg)\n'); await click('Save');
  await until(() => findButton('Save')?.disabled === true); await enterPreview();
  await until(() => !!markdownContent()?.querySelector('img[src^="blob:"]'));
  expect(downloads().map(request => request.path)).toEqual(['assets/dark.svg', 'assets/light.svg']); expect(oldRequest?.signal?.aborted).toBe(true);
  const image = markdownContent()?.querySelector('img'); const current = image?.getAttribute('src'); const count = createdUrls.length;
  await act(async () => finish?.()); await pause(); expect(createdUrls).toHaveLength(count); expect(image?.getAttribute('src')).toBe(current);
  expect(image?.getAttribute('data-oc-local-asset')).toBe('assets/light.svg'); expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('an owned source-line request opens Markdown in its real source editor instead of hiding the requested line behind preview', async () => {
  const request: WorkspaceFileRequest = { id: 'artifact-requested-line', server: origin, machine: 'local', paneId: 'w1:p1', paneIdentity: 'synthetic-artifact-pane', sessionId: 'synthetic-artifact-session', root: '/repo', path: 'docs/README.md', line: 3 };
  await render({ requestedFile: request }); await until(() => !!editor());
  const view = requireEditor(); expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
  expect(text()).toBe(stored().content); expect(host.querySelector('[data-text-artifact]')).toBeNull();
  expect(resolvedTargets).toEqual([{ machine: 'local', paneId: 'w1:p1', identity: request.paneIdentity }, { machine: 'local', paneId: 'w1:p1', identity: request.paneIdentity }]);
  expect(requests.filter(request => request.operation === 'files.read')).toHaveLength(1); expect(writes()).toEqual([]);
});
