import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { z } from 'zod';
import type { Root } from 'react-dom/client';

const server = 'https://window-search-owned.test';
const rpcSchema = z.object({ machine: z.string(), method: z.string(), params: z.object({ pane_id: z.string().optional(), source: z.string().optional() }), requestId: z.string().optional() });
type ReadRequest = z.infer<typeof rpcSchema>;
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let cleanupConnection: () => Promise<void>;
let requests: string[];
let rejected: string[];
let rpcs: ReadRequest[];
let readSignals: Array<AbortSignal | null | undefined>;
let replySnapshot: (machine: string) => Promise<Response>;
let replyOutput: (request: ReadRequest) => Promise<Response>;
let snapshotFailure: boolean;
let deleted: boolean;
let terminalSerial: number;
const wait = async (ms = 40) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 100 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const nativeSnapshot = (machine: string) => ({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: [
    { workspace_id: 'w1', label: 'Existing research', focused: true, active_tab_id: 'w1:t1', agent_status: 'unknown', pane_count: 1, tab_count: 1 },
    { workspace_id: 'w2', label: 'Operations parent', focused: false, active_tab_id: 'w2:t2', agent_status: 'unknown', pane_count: deleted ? 1 : 2, tab_count: 1 },
  ], tabs: [
    { tab_id: 'w1:t1', workspace_id: 'w1', label: 'Current dashboard tab', focused: true, agent_status: 'unknown', pane_count: 1 },
    { tab_id: 'w2:t2', workspace_id: 'w2', label: 'Remote watchers parent', focused: false, agent_status: 'unknown', pane_count: deleted ? 1 : 2 },
  ], panes: [
    { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: machine + ':default-terminal', focused: true, revision: 1, agent_status: 'unknown', label: 'Overview dashboard', cwd: '/fixture/' + machine + '/default' },
    ...(!deleted ? [{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', terminal_id: machine + ':found-terminal-' + terminalSerial, focused: false, revision: 2, agent_status: 'unknown', terminal_title_stripped: 'TITLE_ONLY_DISCOVERY', cwd: '/fixture/' + machine + '/unique-cwd' }] : []),
    { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t2', terminal_id: machine + ':named-terminal', focused: false, revision: 3, agent_status: 'unknown', label: 'Named leaf discovery', title: 'Secondary native title', cwd: '/fixture/' + machine + '/leaf-cwd', foreground_cwd: '/fixture/' + machine + '/foreground-query' },
  ], agents: [],
} });
const outputReply = (body: ReadRequest, text = body.machine.toUpperCase() + '_VISIBLE_' + body.params.pane_id) => Response.json({ id: 'read-owned', result: { type: 'pane_read', read: { pane_id: body.params.pane_id, workspace_id: body.params.pane_id?.startsWith('w2:') ? 'w2' : 'w1', tab_id: body.params.pane_id?.startsWith('w2:') ? 'w2:t2' : 'w1:t1', source: body.params.source, format: 'text', text, revision: 2, truncated: false } } });
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const visibleButtons = () => [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.closest('[hidden],[aria-hidden="true"],[inert]'));
const findButton = (label: string) => visibleButtons().find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label || [...item.querySelectorAll('span')].some(span => span.textContent?.trim() === label));
const click = async (label: string) => { const button = findButton(label); if (!button) throw new Error('Missing actual UI action ' + label); await act(async () => button.click()); };
const openWindows = () => click('Open sessions and projects');
const drawer = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"][aria-hidden="false"]');
const searchInput = () => { const input = drawer()?.querySelector<HTMLInputElement>('input'); if (!input) throw new Error('Window search input missing'); return input; };
const typeSearch = async (value: string) => { const input = searchInput(); await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set; if (!setter) throw new Error('Input setter missing'); setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
const key = async (value: string, composing = false) => { await act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: value, isComposing: composing, bubbles: true, cancelable: true }))); };

beforeEach(async () => {
  dom = new Window({ url: server + '/?surface=mobile' }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent, CompositionEvent: dom.CompositionEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, CustomEvent: dom.CustomEvent,
    SVGElement: dom.SVGElement, customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(dom.navigator, 'locks', { configurable: true, value: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } } });
  requests = []; rejected = []; rpcs = []; readSignals = []; snapshotFailure = false; deleted = false; terminalSerial = 1;
  replySnapshot = async machine => snapshotFailure ? Response.json({ error: { code: 'snapshot_failed', message: 'Controlled snapshot failure' } }, { status: 503 }) : Response.json({ id: 'snapshot-owned', result: nativeSnapshot(machine) });
  replyOutput = async body => outputReply(body);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server);
    requests.push(url.pathname);
    if (url.origin !== server || new Headers(options.headers).get('Authorization') !== 'Bearer owned-window-fixture') rejected.push(url.origin + ':auth');
    if (url.pathname === '/api/herdr/info') return Response.json({ app: 'openherdr', version: '0.1.0', session: 'owned-existing', allowRemoteFonts: false });
    if (url.pathname === '/api/herdr/machines') return Response.json({ machines: [{ id: 'local', label: 'Local Mac' }, { id: 'kansas', label: 'Kansas' }], session: 'owned-existing' });
    if (url.pathname === '/api/herdr/preferences') return Response.json({ version: 1, revision: 1, surface: 'mobile', values: {} });
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcSchema.parse(JSON.parse(String(options.body))); rpcs.push(body);
      if (body.method === 'session.snapshot') return replySnapshot(body.machine);
      if (body.method === 'pane.read') { readSignals.push(options.signal); return replyOutput(body); }
      rejected.push(body.method); throw new Error('Search must remain read-only');
    }
    if (url.pathname === '/api/herdr/terminal') return Response.json({ error: { code: 'observer_unavailable', message: 'Controlled text fallback' } }, { status: 503 });
    rejected.push(url.pathname); throw new Error('Unexpected runtime request ' + url.pathname);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const previousValue = previous[name]; if (previousValue) Object.defineProperty(globalThis, name, previousValue); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { useI18nStore } = await import('@/lib/i18n'); useI18nStore.getState().setLocale('en');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server, token: 'owned-window-fixture' }); cleanupConnection = () => forgetConnection(server);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  try {
    await act(async () => root.unmount()); await cleanupConnection();
    const { useI18nStore } = await import('@/lib/i18n'); useI18nStore.getState().setLocale('en');
    await dom.happyDOM.close();
    expect(rejected).toEqual([]);
    expect(requests.every(path => path.startsWith('/api/herdr/'))).toBe(true);
    expect(rpcs.every(body => ['session.snapshot', 'pane.read'].includes(body.method) && !body.requestId)).toBe(true);
  } finally { restore(); }
});
async function start() { await render(); await until(() => monitorText() === 'LOCAL_VISIBLE_w1:p1'); }
async function render() {
  const { I18nProvider } = await import('@/lib/i18n'); const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
}

test('submitted terminal title discovers an unselected workspace pane with parent context', async () => {
  await start();
  await openWindows(); await typeSearch('TITLE_ONLY_DISCOVERY'); await key('Enter');
  expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY');
  expect(drawer()?.textContent).toContain('Operations parent'); expect(drawer()?.textContent).toContain('Remote watchers parent');
});

const closeWindows = async () => { const button = drawer()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]'); if (!button) throw new Error('Drawer Close missing'); await act(async () => button.click()); };
const submit = async (value: string) => { await typeSearch(value); await key('Enter'); };
const paneReads = () => rpcs.filter(body => body.method === 'pane.read');
const switchMachine = async (machine: string) => { const input = drawer()?.querySelector<HTMLSelectElement>('select[aria-label="Machines"]'); if (!input) throw new Error('Machine selector missing'); await act(async () => { input.value = machine; input.dispatchEvent(new Event('change', { bubbles: true })); }); };
const expectReadonly = () => {
  expect(host.querySelector('.herdr-composer, .herdr-keybar, .cm-content')).toBeNull();
  expect(paneReads().every(body => body.params.source === 'visible')).toBe(true);
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
};
async function coldRemount() {
  await act(async () => root.unmount()); host.remove();
  host = document.createElement('div'); document.body.append(host);
  const { createRoot } = await import('react-dom/client'); root = createRoot(host); await render();
}

test('draft search does not change selection or issue I/O and IME Enter does not submit', async () => {
  await start();
  await openWindows(); const before = rpcs.length;
  await typeSearch('TITLE_ONLY_DISCOVERY');
  expect(drawer()?.textContent).toContain('Existing research'); expect(drawer()?.textContent).toContain('Operations parent');
  expect(host.querySelector('[data-pane-monitor]')?.getAttribute('data-pane-monitor')).toContain('local');
  await key('Enter', true); expect(drawer()?.textContent).toContain('Existing research');
  await act(async () => searchInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await key('Enter'); expect(drawer()?.textContent).toContain('Existing research');
  const assertCompositionEscape = async (options: Pick<KeyboardEventInit, 'isComposing' | 'keyCode'> = {}) => {
    const input = searchInput(); const contents = drawer()?.textContent;
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options });
    await act(async () => input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(drawer()?.getAttribute('aria-hidden')).toBe('false');
    expect(searchInput()).toBe(input); expect(searchInput().value).toBe('TITLE_ONLY_DISCOVERY');
    expect(drawer()?.textContent).toBe(contents);
  };
  await assertCompositionEscape();
  await act(async () => searchInput().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await assertCompositionEscape({ isComposing: true });
  await assertCompositionEscape({ keyCode: 229 });
  expect(rpcs).toHaveLength(before);
  await key('Enter'); expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY');
  expect(rpcs).toHaveLength(before);
  await key('Escape'); expect(searchInput().value).toBe(''); expect(drawer()?.getAttribute('aria-hidden')).toBe('false');
  expect(drawer()?.textContent).toContain('Existing research');
  await submit('unique-cwd'); expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY');
  await click('Clear search'); expect(searchInput().value).toBe(''); expect(drawer()?.textContent).toContain('Existing research');
  expect(rpcs).toHaveLength(before);
  await key('Escape'); expect(drawer()).toBeNull();
});

test('workspace tab pane title IDs and both cwd fields find exact pane results with their ancestors', async () => {
  await start();
  await openWindows(); const before = rpcs.length;
  for (const query of ['Operations parent', 'w2']) {
    await submit(query); expect(drawer()?.textContent).toContain('Workspaces'); expect(drawer()?.textContent).toContain('Operations parent');
  }
  for (const query of ['Remote watchers parent', 'w2:t2']) {
    await submit(query); expect(drawer()?.textContent).toContain('Tabs'); expect(drawer()?.textContent).toContain('Remote watchers parent'); expect(drawer()?.textContent).toContain('Operations parent');
  }
  for (const query of ['TITLE_ONLY_DISCOVERY', 'w2:p2', 'unique-cwd']) {
    await submit(query); expect(drawer()?.textContent).toContain('Panes'); expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY');
    expect(drawer()?.textContent).toContain('Operations parent'); expect(drawer()?.textContent).toContain('Remote watchers parent');
  }
  for (const query of ['Named leaf discovery', 'Secondary native title', 'w2:p3', 'leaf-cwd', 'foreground-query']) {
    await submit(query); expect(drawer()?.textContent).toContain('Panes'); expect(drawer()?.textContent).toContain('Named leaf discovery');
    expect(drawer()?.textContent).toContain('Operations parent'); expect(drawer()?.textContent).toContain('Remote watchers parent');
  }
  expect(rpcs).toHaveLength(before); expectReadonly();
});

test('result in an unselected workspace selects full ancestry and returns and cold restores the same readonly pane', async () => {
  await start();
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY'); await click('TITLE_ONLY_DISCOVERY');
  await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2'); expectReadonly();
  const key = 'openherdr.last-target.v1:' + server;
  await until(() => localStorage.getItem(key)?.includes('w2:p2') === true);
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ version: 1, target: { machine: 'local', workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2', terminalId: 'local:found-terminal-1' } });
  expect(host.querySelector('header')?.textContent).toContain('Remote watchers parent'); expect(host.querySelector('header')?.textContent).toContain('Operations parent');
  await openWindows(); expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY'); await closeWindows();
  const before = rpcs.length; await coldRemount(); await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2');
  expect(rpcs.slice(before).filter(body => body.method === 'pane.read').every(body => body.machine === 'local' && body.params.pane_id === 'w2:p2')).toBe(true);
  expectReadonly();
});

test('machine change clears submitted and draft queries and never applies same-ID local results to Kansas', async () => {
  await start();
  await openWindows(); await submit('unique-cwd'); await typeSearch('unsubmitted-local-draft');
  let finish: (response: Response) => void = () => { throw new Error('Snapshot gate not ready'); };
  replySnapshot = async machine => machine === 'kansas' ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json({ id: 'snapshot-owned', result: nativeSnapshot(machine) });
  await switchMachine('kansas'); await openWindows();
  expect(searchInput().value).toBe(''); expect(drawer()?.textContent).not.toContain('TITLE_ONLY_DISCOVERY');
  expect(paneReads().every(body => body.machine === 'local')).toBe(true);
  await act(async () => finish(Response.json({ id: 'snapshot-owned', result: nativeSnapshot('kansas') })));
  await closeWindows(); await until(() => monitorText() === 'KANSAS_VISIBLE_w1:p1');
  await openWindows(); await submit('unique-cwd');
  expect(drawer()?.textContent).toContain('/fixture/kansas/unique-cwd'); expect(drawer()?.textContent).not.toContain('/fixture/local/unique-cwd');
  await click('TITLE_ONLY_DISCOVERY'); await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
  const owner = host.querySelector('[data-pane-monitor]')?.getAttribute('data-pane-monitor');
  expect(owner).toContain('kansas'); expect(owner).toContain('kansas:found-terminal-1');
  expect(JSON.parse(localStorage.getItem('openherdr.last-target.v1:' + server) ?? 'null')).toMatchObject({ target: { machine: 'kansas', workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2' } });
  expectReadonly();
});

test('failed snapshots preserve stale searchable rows and successful removal removes the result without reading it', async () => {
  await start();
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY');
  snapshotFailure = true; await click('Refresh');
  await until(() => document.body.textContent?.includes('Controlled snapshot failure') === true);
  expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY'); expect(drawer()?.querySelector('[role="status"]')).not.toBeNull();
  expect(findButton('TITLE_ONLY_DISCOVERY')?.disabled).toBe(true);
  expect(drawer()?.textContent).not.toContain('No workspaces');
  snapshotFailure = false; deleted = true; await click('Refresh');
  await until(() => !drawer()?.textContent?.includes('TITLE_ONLY_DISCOVERY'));
  expect(paneReads().some(body => body.params.pane_id === 'w2:p2')).toBe(false);
  await closeWindows(); expect(monitorText()).toBe('LOCAL_VISIBLE_w1:p1'); expectReadonly();
});

test('selected result removal becomes unavailable and a replaced terminal cannot display an old occupant response', async () => {
  await start();
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY'); await click('TITLE_ONLY_DISCOVERY');
  await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2');
  let finish: (response: Response) => void = () => { throw new Error('Read gate not ready'); };
  let held: ReadRequest | null = null;
  replyOutput = async request => { held = request; return new Promise<Response>(resolve => { finish = resolve; }); };
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => held !== null);
  const previousReadSignal = readSignals.at(-1);
  await openWindows(); terminalSerial = 2; replyOutput = async request => outputReply(request, 'NEW_OCCUPANT_VISIBLE');
  await click('Refresh'); await closeWindows();
  await until(() => host.querySelector('[data-pane-monitor]')?.getAttribute('data-pane-monitor')?.includes('found-terminal-2') === true);
  await until(() => monitorText() === 'NEW_OCCUPANT_VISIBLE');
  expect(previousReadSignal?.aborted).toBe(true);
  if (!held) throw new Error('Held response missing');
  const oldReply: ReadRequest = held;
  await act(async () => finish(outputReply(oldReply, 'OLD_OCCUPANT_MUST_STAY_HIDDEN')));
  await wait(); expect(monitorText()).toBe('NEW_OCCUPANT_VISIBLE');
  await openWindows(); deleted = true; await click('Refresh'); await closeWindows();
  await until(() => !host.querySelector('[data-pane-monitor]'));
  expect(host.textContent).not.toContain('OLD_OCCUPANT_MUST_STAY_HIDDEN');
  const afterRemoval = paneReads().length; await wait(80); expect(paneReads()).toHaveLength(afterRemoval);
  expectReadonly();
});

test('submitted and cleared search retains an unsent terminal draft while an intentional pane switch clears it', async () => {
  await start();
  await openWindows(); await click('Terminal controls');
  await until(() => !!document.querySelector('textarea'));
  const input = document.querySelector<HTMLTextAreaElement>('textarea');
  if (!input) throw new Error('Existing terminal composer missing');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Textarea setter missing');
    setter.call(input, 'OWNED_UNSENT_WINDOW_DRAFT'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY'); await key('Escape'); await closeWindows();
  await click('Open workspace panel'); await click('Terminal controls'); await until(() => !!document.querySelector('textarea'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('OWNED_UNSENT_WINDOW_DRAFT');
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY'); await click('TITLE_ONLY_DISCOVERY');
  await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2');
  await openWindows(); await click('Terminal controls'); await until(() => !!document.querySelector('textarea'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(document.querySelector('.herdr-target')?.textContent).toContain('local · owned-existing · w2:p2');
});

test('search and exact pane selection retain an unknown-delivery record without replay or unlock', async () => {
  await start();
  const pending = { requestId: 'owned-search-pending', server, machine: 'local', session: 'owned-existing', workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', method: 'pane.send_text' };
  const key = 'openherdr.pending.v1:' + server;
  localStorage.setItem(key, JSON.stringify(pending)); await coldRemount();
  await until(() => monitorText() === 'LOCAL_VISIBLE_w1:p1');
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY'); await click('Clear search');
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(pending);
  await submit('TITLE_ONLY_DISCOVERY'); await click('TITLE_ONLY_DISCOVERY'); await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2');
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(pending);
  await openWindows(); await click('Terminal controls'); await until(() => !!document.querySelector('textarea'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual(pending);
  expect(rejected).toEqual([]);
});

test('phone and hosted landscape reuse the real submitted input and translated Chinese and RTL results', async () => {
  await start();
  await openWindows(); expect(searchInput().getAttribute('enterkeyhint')).toBe('search');
  expect(searchInput().getAttribute('aria-label')).toBe('Search windows');
  await submit('TITLE_ONLY_DISCOVERY'); const input = searchInput();
  const { useI18nStore } = await import('@/lib/i18n');
  for (const locale of ['zh-CN', 'ar'] as const) {
    await act(async () => { useI18nStore.getState().setLocale(locale); });
    await until(() => useI18nStore.getState().loadingLocale === null);
    expect(searchInput()).toBe(input); expect(searchInput().value).toBe('TITLE_ONLY_DISCOVERY');
    expect(searchInput().getAttribute('aria-label')).toBe(useI18nStore.getState().dictionary['herdr.monitor.search']);
    expect(drawer()?.textContent).toContain('Operations parent'); expect(drawer()?.textContent).toContain('Remote watchers parent');
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
  }
  await act(async () => { dom.innerWidth = 915; dom.innerHeight = 412; window.dispatchEvent(new Event('resize')); });
  expect(searchInput()).toBe(input); expect(searchInput().getAttribute('enterkeyhint')).toBe('search');
  expect(drawer()?.textContent).toContain('TITLE_ONLY_DISCOVERY');
  expect(host.querySelector('.herdr-sidebar')).toBeNull(); expectReadonly();
});


test('first snapshot failure keeps submitted search unavailable without claiming authoritative empty results', async () => {
  snapshotFailure = true; await render();
  await until(() => document.body.textContent?.includes('Controlled snapshot failure') === true);
  await openWindows(); await submit('TITLE_ONLY_DISCOVERY');
  const { useI18nStore } = await import('@/lib/i18n');
  const dictionary = useI18nStore.getState().dictionary;
  expect(document.body.textContent).toContain('Controlled snapshot failure');
  expect(drawer()?.textContent).not.toContain(dictionary['mobile.sessions.empty.searchTitle']);
  expect(drawer()?.textContent).not.toContain(dictionary['mobile.sessions.empty.searchDescription']);
  expect(drawer()?.textContent).not.toContain('No workspaces');
  expect(findButton('TITLE_ONLY_DISCOVERY')).toBeUndefined();
  expect(paneReads()).toHaveLength(0); expectReadonly();
  snapshotFailure = false; await click('Refresh');
  await until(() => !!findButton('TITLE_ONLY_DISCOVERY'));
  expect(findButton('TITLE_ONLY_DISCOVERY')?.disabled).toBe(false);
  await click('TITLE_ONLY_DISCOVERY'); await until(() => monitorText() === 'LOCAL_VISIBLE_w2:p2');
  expectReadonly();
});
