import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { Worker as NodeWorker } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse } from '@pierre/diffs/worker';
import { z } from 'zod';
import { closeTopmostBackLayer, registerBackLayer } from '@/lib/mobileBackLayers';
import { getDefaultTheme } from '@/lib/theme/themes';
import type { PendingDelivery } from '../../../../web/src/herdr/transport';

const WorkerEventTarget = globalThis.EventTarget;
const WorkerMessageEvent = globalThis.MessageEvent;
const workerThreads = new Set<NodeWorker>();
const pendingHighlights = new Set<string>();
const workerFailures: Error[] = [];
const workerEntry = import.meta.resolve('@pierre/diffs/worker/worker.js');
// Run the installed renderer worker unchanged through a Node message adapter.
class FixtureHighlightWorker extends WorkerEventTarget {
  private worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
    import { parentPort, workerData } from 'node:worker_threads';
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    globalThis.self = { addEventListener(type, listener) {
      if (type === 'message') parentPort.on('message', (data) => listener({ data }));
    } };
    await import(workerData);
  `)}`), { workerData: workerEntry });
  constructor() {
    super();
    workerThreads.add(this.worker);
    this.worker.on('message', (data: WorkerResponse) => {
      pendingHighlights.delete(data.id);
      this.dispatchEvent(new WorkerMessageEvent('message', { data }));
    });
    this.worker.on('error', error => workerFailures.push(error));
  }
  postMessage(request: WorkerRequest) { pendingHighlights.add(request.id); this.worker.postMessage(request); }
  terminate() { return this.worker.terminate(); }
}
afterAll(async () => {
  await Promise.all([...workerThreads].map(worker => worker.terminate()));
  expect(workerFailures).toEqual([]);
});

let dom: Window;
let host: HTMLDivElement;
let tree: Root;
let restore: () => void;
let ChangesPanel: typeof import('../../../../web/src/herdr/ContentPanel')['ChangesPanel'];
let I18nProvider: typeof import('@/lib/i18n')['I18nProvider'];
let transport: import('../../../../web/src/herdr/transport').HerdrTransport;
type FixtureProps = Omit<React.ComponentProps<typeof ChangesPanel>, 'transport' | 'onPendingDelivery'>;
let props: FixtureProps;
let Harness: React.ComponentType<{ inputs: FixtureProps }>;
const wire = z.object({ request: z.object({ operation: z.string(), machine: z.string(), pane_id: z.string(), path: z.string().optional(), paths: z.array(z.string()).optional(), expectedRoot: z.string().optional(), staged: z.boolean().optional(), message: z.string().optional() }), requestId: z.string().optional() });
type HostRequest = z.infer<typeof wire>['request'];
type LoggedRequest = HostRequest & { requestId?: string; signal: AbortSignal | null | undefined };
type ChangedFile = { path: string; index: string; working_dir: string };
type Repo = { root: string; files: ChangedFile[]; commits: string[] };
let requests: LoggedRequest[];
let paths: string[];
let reported: (PendingDelivery | null)[];
let repos: Map<string, Repo>;
let respond: (request: HostRequest) => Promise<Response>;
const origin = 'https://changes-fixture.test';
const repository = (machine = 'local', pane = 'w1:p1') => {
  const key = machine + ':' + pane;
  let repo = repos.get(key);
  if (!repo) { repo = { root: machine === 'local' ? '/repo-a' : '/repo-b', files: [{ path: 'shared.txt', index: ' ', working_dir: 'M' }], commits: [] }; repos.set(key, repo); }
  return repo;
};
const errorReply = (code: string, message: string, status = 409) => Response.json({ error: { code, message } }, { status });
const patch = (path: string, content: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+${content}\n`;
async function defaultReply(request: HostRequest): Promise<Response> {
  const repo = repository(request.machine, request.pane_id);
  if (request.expectedRoot && request.expectedRoot !== repo.root) return errorReply('target_changed', 'Host root changed');
  if (request.operation === 'git.status') return Response.json({ root: repo.root, current: 'main', tracking: null, ahead: 0, behind: 0, files: repo.files, isClean: repo.files.length === 0 });
  if (request.operation === 'git.diff') return Response.json({ root: repo.root, diff: patch(request.path ?? '', `${request.machine}_${request.staged ? 'STAGED' : 'WORKING'}`) });
  if (request.operation === 'git.stage' || request.operation === 'git.unstage') {
    repo.files = repo.files.map(file => !request.paths?.includes(file.path) ? file : request.operation === 'git.stage'
      ? { ...file, index: file.index === '?' ? 'A' : file.working_dir.trim() || file.index, working_dir: ' ' }
      : { ...file, index: ' ', working_dir: file.index === 'D' ? 'D' : 'M' });
    return Response.json({ root: repo.root, success: true });
  }
  if (request.operation === 'git.commit') {
    repo.commits.push(request.message ?? '');
    repo.files = repo.files.filter(file => !file.index.trim() || file.index === '?' || file.working_dir.trim()).map(file => ({ ...file, index: file.index === '?' ? '?' : ' ' }));
    return Response.json({ root: repo.root, success: true, commit: 'a'.repeat(40), branch: 'main', summary: { changes: 1, insertions: 1, deletions: 0 } });
  }
  if (request.operation === 'git.branches') return Response.json({ root: repo.root, current: 'main', all: ['main'], branches: { main: { current: true, name: 'main', commit: 'a'.repeat(40), label: 'main', linkedWorktree: false } } });
  if (request.operation === 'git.log') return Response.json({ root: repo.root, all: [], latest: null, total: 0 });
  throw new Error('Unexpected host operation ' + request.operation);
}

beforeEach(async () => {
  dom = new Window({ url: origin }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, Window: dom.Window, Worker: FixtureHighlightWorker, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet, DocumentFragment: dom.DocumentFragment, Range: dom.Range,
    HTMLStyleElement: dom.HTMLStyleElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom),
    NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, CustomEvent: dom.CustomEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent,
    Node: dom.Node, Text: dom.Text, SVGElement: dom.SVGElement, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, IntersectionObserver: dom.IntersectionObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  Object.defineProperty(dom.document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(dom.navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(dom.navigator, 'locks', { configurable: true, value: { request: async <T,>(_name: string, callback: () => Promise<T>) => callback() } });
  requests = []; paths = []; reported = []; repos = new Map(); respond = defaultReply;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin); paths.push(url.pathname);
    if (url.pathname !== '/api/herdr/host') throw new Error('Unexpected source I/O ' + url.pathname);
    const envelope = wire.parse(JSON.parse(String(init?.body)));
    requests.push({ ...envelope.request, requestId: envelope.requestId, signal: init?.signal });
    return respond(envelope.request);
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  ({ ChangesPanel } = await import('../../../../web/src/herdr/ContentPanel'));
  ({ I18nProvider } = await import('@/lib/i18n'));
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  transport = new HerdrTransport({ server: origin, token: 'synthetic-changes-device' });
  Harness = ({ inputs }: { inputs: FixtureProps }) => {
    const [blocked, setBlocked] = React.useState(false);
    return <ChangesPanel transport={transport} {...inputs} mutationBlocked={blocked || inputs.mutationBlocked} onPendingDelivery={record => { reported.push(record); setBlocked(!!record); }} />;
  };
  props = { machine: 'local', paneId: 'w1:p1', terminalId: 'terminal-a', theme: getDefaultTheme(true), themeMode: 'light' };
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => {
  try {
    for (let i = 0; i < 250 && pendingHighlights.size && !workerFailures.length; i++) await wait(20);
    expect(pendingHighlights.size).toBe(0); expect(workerFailures).toEqual([]);
    expect(paths.every(path => path === '/api/herdr/host')).toBe(true);
  }
  finally { await act(async () => tree?.unmount()); await dom.happyDOM.close(); restore(); }
});
const render = async (next: Partial<FixtureProps> = {}) => { props = { ...props, ...next }; await act(async () => tree.render(<I18nProvider><Harness inputs={props} /></I18nProvider>)); };
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (predicate: () => boolean) => { for (let i = 0; i < 100 && !predicate(); i++) await wait(20); expect(predicate()).toBe(true); };
const findButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label);
const click = async (label: string) => { const button = findButton(label); if (!button) throw new Error('Missing action ' + label); await act(async () => button.click()); };
const fillMessage = async (message: string) => {
  const input = host.querySelector('textarea'); if (!input) throw new Error('Missing original multiline commit editor');
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('No textarea setter');
  await act(async () => { setter.call(input, message); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const message = () => host.querySelector('textarea')?.value;
const renderedPatch = () => host.querySelector('diffs-container')?.shadowRoot?.textContent ?? '';
const openFileDiff = async (path: string, staged = false) => {
  const label = (staged ? 'Unstage ' : 'Stage ') + path;
  const action = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const row = action?.closest<HTMLElement>('[role="button"]');
  if (!row) throw new Error('Missing change row ' + label);
  await act(async () => row.click());
};
const refresh = () => click('Refresh');
const mutations = () => requests.filter(request => request.requestId);

test('working diff, staged diff, Back, unstage and multiline current-index commit complete one real panel flow', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt'));
  await fillMessage('Local subject\n\nMultiline details');
  expect(findButton('Commit')?.disabled).toBe(true);
  expect([...host.querySelectorAll('button')].some(button => /^(Generate|Commit & Push|Push)$/.test(button.textContent?.trim() ?? ''))).toBe(false);
  await openFileDiff('shared.txt'); await until(() => requests.some(request => request.operation === 'git.diff'));
  expect(requests.find(request => request.operation === 'git.diff')).toMatchObject({ machine: 'local', path: 'shared.txt', staged: false });
  await until(() => renderedPatch().includes('local_WORKING')); expect(renderedPatch()).toContain('before');
  await click('Back'); expect(message()).toBe('Local subject\n\nMultiline details');
  await click('Stage shared.txt'); await until(() => !!findButton('Unstage shared.txt'));
  await openFileDiff('shared.txt', true); await until(() => requests.some(request => request.operation === 'git.diff' && request.staged));
  await until(() => renderedPatch().includes('local_STAGED')); expect(renderedPatch()).not.toContain('local_WORKING');
  await click('Back'); await click('Unstage shared.txt'); await until(() => !!findButton('Stage shared.txt'));
  await click('Stage shared.txt'); await until(() => findButton('Commit')?.disabled === false);
  await click('Commit'); await until(() => repository().files.length === 0 && host.textContent?.includes('There are no changed files') === true);
  repository().files = [{ path: 'shared.txt', index: ' ', working_dir: 'M' }]; await refresh(); await until(() => message() === '');
  const commit = mutations().find(request => request.operation === 'git.commit');
  expect(commit).toMatchObject({ expectedRoot: '/repo-a', machine: 'local', pane_id: 'w1:p1', message: 'Local subject\n\nMultiline details' });
  expect(commit?.paths).toBeUndefined();
  expect(mutations().map(request => request.operation)).toEqual(['git.stage', 'git.unstage', 'git.stage', 'git.commit']);
  expect(repository().commits).toEqual(['Local subject\n\nMultiline details']);
});

test('mixed paths keep staged and working diffs distinct and deletion remains a valid changed file', async () => {
  repository().files = [{ path: 'shared.txt', index: 'M', working_dir: 'M' }, { path: 'deleted.txt', index: ' ', working_dir: 'D' }, { path: 'new.txt', index: '?', working_dir: '?' }];
  respond = async request => {
    if (request.operation === 'git.diff' && request.path === 'deleted.txt') return Response.json({ root: '/repo-a', diff: 'diff --git a/deleted.txt b/deleted.txt\ndeleted file mode 100644\n--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n' });
    if (request.operation === 'git.diff' && request.path === 'new.txt') return Response.json({ root: '/repo-a', diff: 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new untracked content\n' });
    return defaultReply(request);
  };
  await render(); await until(() => !!findButton('Stage deleted.txt'));
  await openFileDiff('shared.txt'); await until(() => requests.some(request => request.operation === 'git.diff' && !request.staged)); await click('Back');
  await openFileDiff('shared.txt', true); await until(() => requests.some(request => request.operation === 'git.diff' && request.staged)); await click('Back');
  await openFileDiff('deleted.txt'); await until(() => requests.some(request => request.path === 'deleted.txt'));
  expect(host.textContent).not.toContain('File is no longer changed');
  expect(requests.some(request => request.operation.startsWith('files.'))).toBe(false);
  await click('Back'); expect(findButton('Stage new.txt')).toBeDefined(); await openFileDiff('new.txt');
  await until(() => requests.some(request => request.operation === 'git.diff' && request.path === 'new.txt'));
  expect(host.querySelector('h2')?.textContent).toBe('new.txt'); expect(host.textContent).not.toContain('File is no longer changed');
});

for (const kind of ['binary', 'failure'] as const) {
  test(`${kind} diff is explicit and remains inside the working-file route`, async () => {
    respond = async request => request.operation === 'git.diff' ? kind === 'binary'
      ? Response.json({ root: '/repo-a', diff: 'diff --git a/shared.txt b/shared.txt\nBinary files a/shared.txt and b/shared.txt differ\n' })
      : errorReply('diff_failed', 'Source diff failed', 503) : defaultReply(request);
    await render(); await until(() => !!findButton('Stage shared.txt')); await openFileDiff('shared.txt');
    await until(() => host.textContent?.includes(kind === 'binary' ? 'Content of this file cannot be viewed.' : 'Source diff failed') === true);
    expect(host.textContent).not.toContain('There are no changed files');
    await click('Back'); expect(findButton('Stage shared.txt')).toBeDefined();
  });
}

test('status failure preserves the current list and draft instead of claiming a clean checkout', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Keep after failed status');
  respond = async request => request.operation === 'git.status' ? errorReply('status_failed', 'Source status failed', 503) : defaultReply(request);
  await refresh(); await until(() => host.textContent?.includes('Source status failed') === true);
  expect(message()).toBe('Keep after failed status'); expect(findButton('Stage shared.txt')).toBeDefined();
  expect(host.textContent).not.toContain('There are no changed files');
});

test('colliding file names across owners do not inherit a diff route or commit draft', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Local draft');
  await openFileDiff('shared.txt'); await until(() => requests.some(request => request.operation === 'git.diff'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!findButton('Stage shared.txt'));
  expect(message()).toBe(''); expect(requests.filter(request => request.machine === 'saved-ssh' && request.operation === 'git.diff')).toEqual([]);
  await fillMessage('Remote draft'); await render({ machine: 'local', terminalId: 'terminal-a' });
  await until(() => !!findButton('Back')); await click('Back'); expect(message()).toBe('Local draft');
});

test('late diff reads after an owner change cannot publish a patch in a colliding new-owner route', async () => {
  let finish: (response: Response) => void = () => {};
  respond = async request => request.operation === 'git.diff' && request.machine === 'local' ? new Promise(resolve => { finish = resolve; }) : defaultReply(request);
  await render(); await until(() => !!findButton('Stage shared.txt')); await openFileDiff('shared.txt');
  await until(() => requests.some(request => request.operation === 'git.diff'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!findButton('Stage shared.txt'));
  await act(async () => finish(Response.json({ root: '/repo-a', diff: patch('shared.txt', 'LATE_OLD_OWNER') }))); await wait();
  expect(findButton('Back')).toBeUndefined(); expect(message()).toBe('');
  expect(requests.filter(request => request.machine === 'saved-ssh' && request.operation === 'git.diff')).toEqual([]);
});

test('canonical-root drift requires explicit reload and retains separate old/new commit drafts', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Old root draft');
  repository().root = '/new-root'; await refresh(); await until(() => !!findButton('Reload'));
  expect(message()).toBe('Old root draft');
  await click('Reload'); await until(() => message() === ''); await fillMessage('New root draft');
  repository().root = '/repo-a'; await refresh(); await until(() => !!findButton('Reload')); await click('Reload');
  await until(() => message() === 'Old root draft');
  expect(mutations()).toEqual([]);
});

test('hidden panel pauses reads and retains its route and multiline draft on return', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Hidden\nDraft'); await openFileDiff('shared.txt');
  await until(() => requests.some(request => request.operation === 'git.diff'));
  await render({ disabled: true }); const count = requests.length;
  await act(async () => window.dispatchEvent(new Event('online'))); await wait(100); expect(requests).toHaveLength(count);
  await render({ disabled: false }); await until(() => !!findButton('Back')); await click('Back'); expect(message()).toBe('Hidden\nDraft');
});

test('diff Back layer and Escape return to list before the containing workspace closes', async () => {
  const calls: string[] = []; const release = registerBackLayer(() => calls.push('shell'));
  try {
    await render(); await until(() => !!findButton('Stage shared.txt')); await openFileDiff('shared.txt');
    await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
    expect(message()).toBe(''); expect(calls).toEqual([]);
    await openFileDiff('shared.txt');
    await act(async () => host.querySelector('section')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(message()).toBe('');
    await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); expect(calls).toEqual(['shell']);
  } finally { release(); }
});

for (const operation of ['git.stage', 'git.commit'] as const) {
  test(`${operation} confirmed refusal preserves the draft and permits explicit correction without retry`, async () => {
    if (operation === 'git.commit') repository().files = [{ path: 'shared.txt', index: 'M', working_dir: ' ' }];
    respond = async request => request.operation === operation ? errorReply('identity_missing', 'Synthetic Git refusal') : defaultReply(request);
    await render(); await until(() => !!host.querySelector('textarea')); await fillMessage('Keep refused\nMessage');
    await click(operation === 'git.commit' ? 'Commit' : 'Stage shared.txt'); await until(() => host.textContent?.includes('Synthetic Git refusal') === true);
    expect(message()).toBe('Keep refused\nMessage'); expect(mutations().filter(request => request.operation === operation)).toHaveLength(1);
    await refresh(); expect(mutations().filter(request => request.operation === operation)).toHaveLength(1);
    const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect(await loadPendingDelivery(origin)).toBeNull();
  });
}

test('unknown stage persists a durable lock and refresh or repeated clicks never retry it', async () => {
  respond = async request => { if (request.operation === 'git.stage') throw new TypeError('Synthetic lost stage response'); return defaultReply(request); };
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Keep unknown'); await click('Stage shared.txt');
  await until(() => reported.some(record => record?.method === 'git.stage'));
  await click('Stage shared.txt'); await refresh(); await wait();
  expect(mutations().filter(request => request.operation === 'git.stage')).toHaveLength(1); expect(message()).toBe('Keep unknown');
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); const record = await loadPendingDelivery(origin);
  expect(record?.method).toBe('git.stage'); expect(record?.paneId).toBe('w1:p1');
});

test('a newer programmatic editor event during confirmed commit is retained despite the disabled UI', async () => {
  repository().files = [{ path: 'shared.txt', index: 'M', working_dir: ' ' }]; let finish: (response: Response) => void = () => {};
  respond = async request => request.operation === 'git.commit' ? new Promise(resolve => { finish = resolve; }) : defaultReply(request);
  await render(); await until(() => !!host.querySelector('textarea')); await fillMessage('Sent message'); await click('Commit');
  await until(() => mutations().some(request => request.operation === 'git.commit')); expect(host.querySelector('textarea')?.disabled).toBe(true); await fillMessage('Newer message');
  await act(async () => finish(Response.json({ root: '/repo-a', success: true, commit: 'a'.repeat(40), branch: 'main', summary: { changes: 1, insertions: 1, deletions: 0 } })));
  expect(message()).toBe('Newer message');
});

test('late old-owner commit completion preserves a new owner draft and cannot target its index', async () => {
  repository().files = [{ path: 'shared.txt', index: 'M', working_dir: ' ' }]; let finish: (response: Response) => void = () => {};
  respond = async request => request.operation === 'git.commit' ? new Promise(resolve => { finish = resolve; }) : defaultReply(request);
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!host.querySelector('textarea')); await fillMessage('Owner B draft');
  await render({ machine: 'local', terminalId: 'terminal-a' }); await until(() => !!host.querySelector('textarea')); await fillMessage('Owner A sent'); await click('Commit');
  await until(() => mutations().some(request => request.operation === 'git.commit'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!host.querySelector('textarea'));
  await act(async () => finish(Response.json({ root: '/repo-a', success: true, commit: 'a'.repeat(40), branch: 'main', summary: { changes: 1, insertions: 1, deletions: 0 } })));
  expect(message()).toBe('Owner B draft'); expect(mutations().every(request => request.machine === 'local' && request.expectedRoot === '/repo-a')).toBe(true);
});

test('explicit diff requests require the exact owner/terminal, consume once, and new IDs can reopen the same path', async () => {
  const initial = { id: 'wrong', server: origin, machine: 'local', paneId: 'w1:p1', terminalId: 'different-terminal', path: '/repo-a/shared.txt', staged: false };
  await render({ initialDiff: initial }); await until(() => !!findButton('Stage shared.txt'));
  expect(requests.filter(request => request.operation === 'git.diff')).toEqual([]);
  await render({ initialDiff: { ...initial, id: 'valid', terminalId: 'terminal-a' } });
  await until(() => !!findButton('Back')); expect(requests.filter(request => request.operation === 'git.diff')).toHaveLength(1);
  expect(requests.find(request => request.operation === 'git.diff')?.path).toBe('shared.txt');
  await click('Back'); await render({ initialDiff: { ...initial, id: 'valid', terminalId: 'terminal-a' } });
  expect(findButton('Back')).toBeUndefined();
  await render({ initialDiff: { ...initial, id: 'second-click', terminalId: 'terminal-a' } }); await until(() => !!findButton('Back'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!findButton('Stage shared.txt'));
  expect(requests.filter(request => request.machine === 'saved-ssh' && request.operation === 'git.diff')).toEqual([]);
});

test('requests outside the authoritative repository and hidden requests do not cause a diff read', async () => {
  const initial = { id: 'outside', server: origin, machine: 'local', paneId: 'w1:p1', terminalId: 'terminal-a', path: '/outside/shared.txt' };
  await render({ initialDiff: initial }); await until(() => !!findButton('Stage shared.txt'));
  expect(requests.filter(request => request.operation === 'git.diff')).toEqual([]);
  await render({ disabled: true, initialDiff: { ...initial, id: 'hidden', path: 'shared.txt' } }); const count = requests.length;
  await wait(); expect(requests).toHaveLength(count);
  await render({ disabled: false }); await until(() => !!findButton('Back'));
  expect(requests.filter(request => request.operation === 'git.diff')).toHaveLength(1);
});

test('unknown commit keeps its draft and pending record without automatic or repeated dispatch', async () => {
  repository().files = [{ path: 'shared.txt', index: 'M', working_dir: ' ' }];
  respond = async request => { if (request.operation === 'git.commit') throw new TypeError('Synthetic lost commit response'); return defaultReply(request); };
  await render(); await until(() => !!host.querySelector('textarea')); await fillMessage('Unknown commit\nKeep text'); await click('Commit');
  await until(() => reported.some(record => record?.method === 'git.commit')); await click('Commit'); await refresh(); await wait();
  expect(mutations().filter(request => request.operation === 'git.commit')).toHaveLength(1); expect(message()).toBe('Unknown commit\nKeep text');
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport'); expect((await loadPendingDelivery(origin))?.method).toBe('git.commit');
});

test('offline and background pause authoritative reads without clearing the commit draft', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await fillMessage('Offline draft');
  Object.defineProperty(dom.navigator, 'onLine', { value: false, configurable: true }); await act(async () => window.dispatchEvent(new Event('offline'))); const count = requests.length;
  await wait(100); expect(requests).toHaveLength(count); expect(message()).toBe('Offline draft');
  Object.defineProperty(dom.navigator, 'onLine', { value: true, configurable: true }); Object.defineProperty(dom.document, 'hidden', { value: true, configurable: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await wait(60); expect(requests).toHaveLength(count);
  Object.defineProperty(dom.document, 'hidden', { value: false, configurable: true }); await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await until(() => requests.length > count); expect(message()).toBe('Offline draft');
});

test('late confirmed stage does not refresh or change a different owner with the same path', async () => {
  let finish: (response: Response) => void = () => {};
  respond = async request => request.operation === 'git.stage' ? new Promise(resolve => { finish = resolve; }) : defaultReply(request);
  await render(); await until(() => !!findButton('Stage shared.txt')); await click('Stage shared.txt');
  await until(() => mutations().some(request => request.operation === 'git.stage'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !!findButton('Stage shared.txt'));
  const reads = requests.filter(request => request.machine === 'saved-ssh' && request.operation === 'git.status').length;
  await act(async () => finish(Response.json({ root: '/repo-a', success: true }))); await wait();
  expect(requests.filter(request => request.machine === 'saved-ssh' && request.operation === 'git.status')).toHaveLength(reads);
  expect(findButton('Stage shared.txt')).toBeDefined(); expect(findButton('Unstage shared.txt')).toBeUndefined();
  expect(mutations()).toHaveLength(1); expect(mutations()[0]).toMatchObject({ machine: 'local', expectedRoot: '/repo-a' });
});

test('the original mode menu portal closes when hidden or changed to another owner', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt')); await click('Select change mode'); await until(() => !!document.querySelector('[role="menu"]'));
  await render({ disabled: true }); await until(() => !document.querySelector('[role="menu"]'));
  await render({ disabled: false }); await click('Select change mode'); await until(() => !!document.querySelector('[role="menu"]'));
  await render({ machine: 'saved-ssh', terminalId: 'terminal-b' }); await until(() => !document.querySelector('[role="menu"]'));
});

test('a failed first authoritative status is unavailable rather than a clean repository', async () => {
  respond = async () => errorReply('status_failed', 'Initial repository unavailable', 503);
  await render(); await until(() => host.textContent?.includes('Initial repository unavailable') === true);
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('There are no changed files'); expect(mutations()).toEqual([]);
});

test('selecting History or Local branches closes the mode menu and loads that host mode', async () => {
  await render(); await until(() => !!findButton('Stage shared.txt'));
  for (const [label, operation] of [['History', 'git.log'], ['Local branches', 'git.branches']]) {
    await click('Select change mode');
    const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === label);
    if (!choice) throw new Error('Missing mode ' + label);
    await act(async () => choice.click());
    await until(() => !document.querySelector('[role="menu"]') && requests.some(request => request.operation === operation));
    expect(findButton('Select change mode')?.textContent).toContain(label);
  }
});
