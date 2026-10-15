import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorView } from '@codemirror/view';
import { z } from 'zod';
import type { Root } from 'react-dom/client';

const rpcBody = z.object({ machine: z.string(), method: z.string(), params: z.object({ pane_id: z.string().optional(), source: z.string().optional() }), requestId: z.string().optional() });
type ReadRequest = z.infer<typeof rpcBody>;
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let cleanupConnection: () => Promise<void>;
let requests: string[];
let rpcs: { body: ReadRequest; signal: AbortSignal | null | undefined }[];
let snapshotFailure: boolean;
let emptySnapshot: boolean;
let terminalSerial: number;
let readFailure: boolean;
let respondOutput: (request: ReadRequest) => Promise<Response>;
const server = 'https://existing-monitor.test';
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 100 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const pane = (machine: string, id = 'w1:p1', tabId = 'w1:t1', workspaceId = 'w1') => ({ pane_id: id, workspace_id: workspaceId, tab_id: tabId, terminal_id: `${machine}:${id}:terminal-${terminalSerial}`, focused: id === 'w1:p1', revision: 1, agent_status: 'unknown', label: id === 'w1:p1' ? 'Overview dashboard' : id === 'w1:p2' ? 'Worker watch' : 'Second workspace watch', agent: null, cwd: `/fixture/${machine}` });
const nativeSnapshot = (machine: string) => ({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: emptySnapshot ? [] : [
    { workspace_id: 'w1', label: 'Existing research', focused: true, active_tab_id: 'w1:t1', agent_status: 'working', pane_count: 2, tab_count: 1 },
    { workspace_id: 'w2', label: 'Operations', focused: false, active_tab_id: 'w2:t1', agent_status: 'unknown', pane_count: 1, tab_count: 1 },
  ], tabs: emptySnapshot ? [] : [
    { tab_id: 'w1:t1', workspace_id: 'w1', label: 'Research windows', focused: true, agent_status: 'working', pane_count: 2 },
    { tab_id: 'w2:t1', workspace_id: 'w2', label: 'Operations windows', focused: false, agent_status: 'unknown', pane_count: 1 },
  ], panes: emptySnapshot ? [] : [pane(machine), pane(machine, 'w1:p2'), pane(machine, 'w2:p1', 'w2:t1', 'w2')], agents: [],
} });
const outputReply = (request: ReadRequest, text = `${request.machine.toUpperCase()}_VISIBLE_${request.params.pane_id}`) => Response.json({ id: 'read', result: { type: 'pane_read', read: {
  pane_id: request.params.pane_id, workspace_id: request.params.pane_id?.startsWith('w2:') ? 'w2' : 'w1', tab_id: request.params.pane_id?.startsWith('w2:') ? 'w2:t1' : 'w1:t1',
  source: request.params.source, format: 'text', text, revision: 4, truncated: false,
} } });
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing UI action ${label}`);
  await act(async () => button.click());
};
const openWindows = () => click('Open sessions and projects');
const closeWindows = async () => {
  const close = document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Sessions"] button[aria-label="Close"]');
  if (!close) throw new Error('Missing original window drawer close');
  await act(async () => close.click());
};
const refresh = async () => { await openWindows(); await click('Refresh'); await closeWindows(); };
const changeMachine = async (machine: string) => {
  await openWindows();
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Machines"]');
  if (!select) throw new Error('Missing real machine selector');
  await act(async () => { select.value = machine; select.dispatchEvent(new Event('change', { bubbles: true })); });
};

beforeEach(async () => {
  dom = new Window({ url: server }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, CustomEvent: dom.CustomEvent,
    SVGElement: dom.SVGElement, customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(dom.navigator, 'locks', { value: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } }, configurable: true });
  const savedFetch = globalThis.fetch;
  requests = []; rpcs = []; snapshotFailure = false; emptySnapshot = false; terminalSerial = 1; readFailure = false;
  respondOutput = async request => outputReply(request);
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server); requests.push(url.pathname);
    if (url.pathname === '/api/herdr/machines') return Response.json({ machines: [{ id: 'local', label: 'Local Mac' }, { id: 'kansas', label: 'Kansas' }, { id: 'wsl', label: 'WSL' }], session: 'local-only-session' });
    if (url.pathname === '/api/herdr/info') return Response.json({ app: 'openherdr', version: '0.1.0', session: 'local-only-session', allowRemoteFonts: false });
    if (url.pathname === '/api/herdr/preferences') return Response.json({ version: 1, revision: 1, surface: 'mobile', values: {} });
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcBody.parse(JSON.parse(String(options?.body))); rpcs.push({ body, signal: options?.signal });
      if (body.method === 'session.snapshot') return snapshotFailure ? Response.json({ error: { code: 'snapshot_failed', message: 'Existing Herdr is offline' } }, { status: 503 }) : Response.json({ id: 'snapshot', result: nativeSnapshot(body.machine) });
      if (body.method === 'pane.read') return readFailure ? Response.json({ error: { code: 'read_failed', message: 'Visible pane read failed' } }, { status: 503 }) : respondOutput(body);
      throw new Error(`Unexpected mutation ${body.method}`);
    }
    if (url.pathname === '/api/herdr/terminal') return Response.json({ error: { code: 'observer_unavailable', message: 'Text fallback fixture' } }, { status: 503 });
    if (url.pathname.startsWith('/api/herdr/conversations/')) {
      const request = z.object({ request: z.object({ target: z.object({ machine: z.string(), paneId: z.string() }).optional() }) }).parse(JSON.parse(String(options?.body))).request;
      const source = { machine: request.target?.machine ?? 'local', paneId: request.target?.paneId ?? 'w1:p1', identity: 'a'.repeat(64), expectedAgentSession: null };
      const session = { id: 'ses_existing_chat', projectID: 'fixture', title: 'Existing saved chat', location: { directory: '/fixture/local' }, time: { created: 1, updated: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
      const capabilities = { prompt: true, events: true };
      if (url.pathname.endsWith('/history/list')) return Response.json({ protocol: 'opencode-v2', conversations: [], complete: true, failures: [], cursor: {} });
      if (url.pathname.endsWith('/resolve')) return Response.json({ protocol: 'opencode-v2', target: source, directory: '/fixture/local', nativeAccess: 'unavailable', session, capabilities });
      if (url.pathname.endsWith('/list')) return Response.json({ protocol: 'opencode-v2', target: source, sessions: [{ session, access: 'owned', capabilities }], complete: true, failures: [], cursor: {} });
      if (url.pathname.endsWith('/catalog')) return Response.json({ protocol: 'opencode-v2', target: source, models: [], agents: [], authoritative: true, completeness: 'complete' });
      if (url.pathname.endsWith('/read')) return Response.json({ protocol: 'opencode-v2', target: source, session, access: 'owned', capabilities, permissions: [], forms: [], activity: null, messages: { cursor: {}, data: [] } });
      if (url.pathname.endsWith('/events')) {
        let closed = false;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { options?.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.close(); } }, { once: true }); }, cancel() { closed = true; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      throw new Error('An explicit chat test must not create or send');
    }
    throw new Error(`Unexpected source I/O ${url.pathname}`);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server, token: 'fixture-only' }); cleanupConnection = () => forgetConnection(server);
  const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount()); await cleanupConnection(); await dom.happyDOM.close();
  try { expect(rpcs.every(item => ['session.snapshot', 'pane.read'].includes(item.body.method) && !item.body.requestId)).toBe(true); }
  finally { restore(); }
});

test('the default mobile entry reads existing windows without conversations or write controls', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
  expect(rpcs.filter(item => item.body.method === 'pane.read').every(item => item.body.params.source === 'visible')).toBe(true);
  expect(host.querySelector('header')?.textContent).toContain('Research windows');
  expect(host.querySelector('header')?.textContent).toContain('Existing research');
  expect(host.querySelector('header')?.textContent).not.toContain('New conversation');
  expect(document.querySelector('.herdr-composer')).toBeNull(); expect(document.querySelector('.herdr-keybar')).toBeNull();
  expect(document.querySelector('[data-herdr-composer]')).toBeNull();
  expect(document.querySelector('textarea:not([readonly])')).toBeNull();
  expect([...document.querySelectorAll('button')].some(button => /^(New workspace|Start agent|Split pane|Rename|Send)$/.test(button.textContent?.trim() ?? ''))).toBe(false);
  const machine = document.querySelector<HTMLSelectElement>('select[aria-label="Machines"]');
  expect(machine?.disabled).toBe(false); expect([...machine?.options ?? []].map(option => option.textContent)).toEqual(['Local Mac', 'Kansas', 'WSL']);
  await click('Open session switcher');
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
  expect(document.querySelector('[aria-label="Sessions"]')).not.toBeNull();
});

test('actual machine/workspace/tab/pane navigation includes ordinary watch panes and isolates repeated IDs', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  await changeMachine('kansas');
  expect(monitorText()).not.toContain('LOCAL_VISIBLE');
  await until(() => monitorText()?.includes('KANSAS_VISIBLE_w1:p1') === true);
  expect(host.querySelector('header')?.textContent).toContain('Kansas');
  expect(host.querySelector('header')?.textContent).not.toContain('local-only-session');
  await openWindows(); await click('Worker watch'); await until(() => monitorText()?.includes('KANSAS_VISIBLE_w1:p2') === true);
  await openWindows(); await click('Operations'); await click('Second workspace watch'); await until(() => monitorText()?.includes('KANSAS_VISIBLE_w2:p1') === true);
  expect(host.querySelector('header')?.textContent).toContain('Operations windows');
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
  expect(rpcs.filter(item => item.body.method === 'session.snapshot').map(item => item.body.machine)).toEqual(['local', 'kansas']);
});

test('a first snapshot failure remains unknown and machine switching stays available', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  snapshotFailure = true; await changeMachine('wsl');
  await until(() => document.body.textContent?.includes('Existing Herdr is offline') === true);
  expect(document.body.textContent).not.toContain('No panes are available on this machine.');
  expect(document.body.textContent).not.toContain('No workspaces yet');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Machines"]')?.disabled).toBe(false);
  snapshotFailure = false; await changeMachine('kansas'); await until(() => monitorText()?.includes('KANSAS_VISIBLE') === true);
});

test('same-machine snapshot failure retains the tree and displays its last successful time', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  snapshotFailure = true; await refresh();
  await until(() => document.body.textContent?.includes('Existing Herdr is offline') === true);
  expect(document.body.textContent).toContain('Research windows'); expect(document.body.textContent).toContain('Overview dashboard');
  expect(document.body.textContent).toContain('Showing the last successful read from');
  expect(document.body.textContent).not.toContain('No workspaces yet');
});

test('the explicit chat entry retains its draft across monitor while all conversation reads pause', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  await openWindows(); await click('Conversations'); await until(() => !!host.querySelector('[data-mobile-composer-pill]'));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-composer-morph-prompt]')?.click());
  await until(() => !!host.querySelector('.cm-content'));
  const node = host.querySelector<HTMLElement>('.cm-content'); const editor = node && EditorView.findFromDOM(node);
  if (!editor) throw new Error('Missing real explicit chat editor');
  await act(async () => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'Unsent existing chat draft' } }));
  await openWindows(); await click('Monitor'); await wait();
  const conversationReads = requests.filter(path => path.includes('/conversations/')).length;
  await refresh(); await wait(120);
  expect(requests.filter(path => path.includes('/conversations/'))).toHaveLength(conversationReads);
  expect(host.querySelector('.cm-content')).toBeNull(); expect(document.querySelector('.herdr-composer')).toBeNull();
  await openWindows(); await click('Conversations'); await until(() => !!host.querySelector('[data-mobile-composer-pill]'));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-composer-morph-prompt]')?.click());
  await until(() => !!host.querySelector('.cm-content'));
  expect(host.querySelector('.cm-content')?.textContent).toBe('Unsent existing chat draft');
});

test('offline and hidden application states abort selected-pane reads and resume without late output', async () => {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  let complete: (response: Response) => void = () => {};
  let held: ReadRequest | null = null;
  respondOutput = async request => { held = request; return new Promise(resolve => { complete = resolve; }); };
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!held);
  const signal = rpcs.filter(item => item.body.method === 'pane.read').at(-1)?.signal;
  Object.defineProperty(dom.navigator, 'onLine', { value: false, configurable: true });
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(signal?.aborted).toBe(true);
  const count = rpcs.length;
  await act(async () => complete(outputReply(rpcBody.parse(held), 'late offline bytes'))); await wait(1000);
  expect(monitorText()).not.toContain('late offline bytes'); expect(rpcs).toHaveLength(count);
  respondOutput = async request => outputReply(request, 'resumed selected pane');
  Object.defineProperty(dom.navigator, 'onLine', { value: true, configurable: true });
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => monitorText() === 'resumed selected pane');
  held = null;
  respondOutput = async request => { held = request; return new Promise(resolve => { complete = resolve; }); };
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!held);
  const hiddenSignal = rpcs.filter(item => item.body.method === 'pane.read').at(-1)?.signal;
  Object.defineProperty(dom.document, 'hidden', { value: true, configurable: true });
  Object.defineProperty(dom.document, 'visibilityState', { value: 'hidden', configurable: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(hiddenSignal?.aborted).toBe(true);
  const hiddenCount = rpcs.length;
  await act(async () => complete(outputReply(rpcBody.parse(held), 'late hidden bytes'))); await wait(1000);
  expect(monitorText()).toBe('resumed selected pane'); expect(rpcs).toHaveLength(hiddenCount);
  respondOutput = async request => outputReply(request, 'visible again');
  Object.defineProperty(dom.document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(dom.document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await until(() => monitorText() === 'visible again');
});
