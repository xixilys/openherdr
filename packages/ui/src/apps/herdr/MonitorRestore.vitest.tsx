import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
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
let requestOrigins: string[];
const observationBody = z.object({ machine: z.string(), pane_id: z.string() });
let observations: z.infer<typeof observationBody>[];
let rpcs: { body: ReadRequest; signal: AbortSignal | null | undefined }[];
let snapshotFailure: boolean;
let cloudflareFailure: boolean;
let terminalSerial: number;
const server = 'https://monitor-restore.test';
const otherServer = 'https://other-monitor-restore.test';
let machinesFailure: boolean;
let missingMachine: boolean;
let missingAncestor: 'workspace' | 'tab' | null;
let restoreStorage: () => void;
let deletedTarget: boolean;
let respondSnapshot: (machine: string) => Promise<Response>;
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 100 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const pane = (machine: string, id = 'w1:p1', tabId = 'w1:t1', workspaceId = 'w1') => ({ pane_id: id, workspace_id: workspaceId, tab_id: tabId, terminal_id: `${machine}:${id}:terminal-${terminalSerial}`, focused: id === 'w1:p1', revision: 1, agent_status: 'unknown', label: id === 'w1:p1' ? 'Overview dashboard' : id === 'w1:p2' ? 'Worker watch' : id === 'w2:p2' ? 'Kansas long run' : 'Second workspace watch', agent: null, cwd: `/fixture/${machine}` });
const nativeSnapshot = (machine: string) => ({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: [
    { workspace_id: 'w1', label: 'Existing research', focused: true, active_tab_id: 'w1:t1', agent_status: 'working', pane_count: 2, tab_count: 1 },
    ...(missingAncestor !== 'workspace' ? [{ workspace_id: 'w2', label: 'Operations', focused: false, active_tab_id: 'w2:t1', agent_status: 'unknown', pane_count: 2, tab_count: 2 }] : []),
  ], tabs: [
    { tab_id: 'w1:t1', workspace_id: 'w1', label: 'Research windows', focused: true, agent_status: 'working', pane_count: 2 },
    { tab_id: 'w2:t1', workspace_id: 'w2', label: 'Operations windows', focused: false, agent_status: 'unknown', pane_count: 1 },
    ...(missingAncestor !== 'tab' ? [{ tab_id: 'w2:t2', workspace_id: 'w2', label: 'Remote watchers', focused: false, agent_status: 'unknown', pane_count: 1 }] : []),
  ], panes: [pane(machine), pane(machine, 'w1:p2'), pane(machine, 'w2:p1', 'w2:t1', 'w2'), ...(!deletedTarget ? [pane(machine, 'w2:p2', 'w2:t2', 'w2')] : [])], agents: [],
} });
const outputReply = (request: ReadRequest, text = `${request.machine.toUpperCase()}_VISIBLE_${request.params.pane_id}`) => Response.json({ id: 'read', result: { type: 'pane_read', read: {
  pane_id: request.params.pane_id, workspace_id: request.params.pane_id?.startsWith('w2:') ? 'w2' : 'w1', tab_id: request.params.pane_id === 'w2:p2' ? 'w2:t2' : request.params.pane_id?.startsWith('w2:') ? 'w2:t1' : 'w1:t1',
  source: request.params.source, format: 'text', text, revision: 4, truncated: false,
} } });
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing UI action ${label}`);
  await act(async () => button.click());
};
const openWindows = () => click('Open sessions and projects');
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
  requests = []; requestOrigins = []; observations = []; rpcs = []; machinesFailure = false; missingMachine = false; missingAncestor = null; restoreStorage = () => {}; deletedTarget = false; snapshotFailure = false; cloudflareFailure = false; terminalSerial = 1; 
  respondSnapshot = async machine => cloudflareFailure ? new Response('<html>Cloudflare origin unavailable</html>', { status: 530, headers: { 'Content-Type': 'text/html' } }) : snapshotFailure ? Response.json({ error: { code: 'snapshot_failed', message: 'Existing Herdr is offline' } }, { status: 503 }) : Response.json({ id: 'snapshot', result: nativeSnapshot(machine) });
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server); requests.push(url.pathname); requestOrigins.push(url.origin);
    if (url.pathname === '/api/pairing/redeem') return Response.json({ token: 'replacement-fixture-only', client: { id: 'synthetic-client' } });
    if (url.pathname === '/api/herdr/machines') return machinesFailure ? Response.json({ error: { code: 'machines_failed', message: 'Machines unavailable' } }, { status: 503 }) : Response.json({ machines: [{ id: 'local', label: 'Local Mac' }, ...(!missingMachine ? [{ id: 'kansas', label: 'Kansas' }] : []), { id: 'wsl', label: 'WSL' }], session: 'local-only-session' });
    if (url.pathname === '/api/herdr/info') return Response.json({ app: 'openherdr', version: '0.1.0', session: 'local-only-session', allowRemoteFonts: false });
    if (url.pathname === '/api/herdr/preferences') return Response.json({ version: 1, revision: 1, surface: 'mobile', values: {} });
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcBody.parse(JSON.parse(String(options?.body))); rpcs.push({ body, signal: options?.signal });
      if (body.method === 'session.snapshot') return respondSnapshot(body.machine);
      if (body.method === 'pane.read') return outputReply(body);
      throw new Error(`Unexpected mutation ${body.method}`);
    }
    if (url.pathname === '/api/herdr/terminal') { observations.push(observationBody.parse(JSON.parse(String(options?.body)))); return Response.json({ error: { code: 'observer_unavailable', message: 'Text fallback fixture' } }, { status: 503 }); }
    throw new Error(`Unexpected source I/O ${url.pathname}`);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server, token: 'fixture-only' }); cleanupConnection = async () => { await forgetConnection(server); await forgetConnection(otherServer); };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); restoreStorage(); await cleanupConnection(); localStorage.clear(); await dom.happyDOM.close();
  try { expect(rpcs.every(item => ['session.snapshot', 'pane.read'].includes(item.body.method) && !item.body.requestId)).toBe(true); }
  finally { restore(); }
});


async function render() {
  const { I18nProvider } = await import('@/lib/i18n');
  const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
}
async function coldRestart() {
  await act(async () => root.unmount()); host.remove();
  host = document.createElement('div'); document.body.append(host);
  const { createRoot } = await import('react-dom/client'); root = createRoot(host);
  rpcs = []; requests = []; requestOrigins = []; observations = []; await render();
}
async function chooseKansasTarget() {
  await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  await changeMachine('kansas'); await until(() => monitorText()?.includes('KANSAS_VISIBLE_w1:p1') === true);
  await openWindows(); await click('Operations'); await click('Remote watchers'); await click('Kansas long run');
  await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
  expect(host.querySelector('header')?.textContent).toContain('Remote watchers');
}
function pointerEntry() {
  const key = `openherdr.last-target.v1:${server}`;
  const value = localStorage.getItem(key);
  expect(value).not.toBeNull();
  expect(value).toContain('kansas'); expect(value).toContain('w2:p2');
  return { key, value: value ?? '' };
}
const paneReads = () => rpcs.filter(item => item.body.method === 'pane.read').map(item => ({ machine: item.body.machine, pane: item.body.params.pane_id, source: item.body.params.source }));
function expectReadOnlyMonitor() {
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
  expect(host.querySelector('.herdr-composer, .herdr-keybar, [data-herdr-composer], .cm-content')).toBeNull();
  expect(rpcs.every(item => ['session.snapshot', 'pane.read'].includes(item.body.method) && !item.body.requestId)).toBe(true);
  expect(paneReads().every(item => item.source === 'visible')).toBe(true);
}

test('cold remount restores Kansas non-first workspace/tab/pane only after fresh snapshot in read-only monitor', async () => {
  await chooseKansasTarget(); const saved = pointerEntry();
  expect(JSON.parse(saved.value)).toEqual({ version: 1, target: { machine: 'kansas', workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2', terminalId: 'kansas:w2:p2:terminal-1' } });
  await coldRestart(); await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
  expect(paneReads().length).toBeGreaterThan(0);
  expect(paneReads().every(item => item.machine === 'kansas' && item.pane === 'w2:p2')).toBe(true);
  expect(observations.every(item => item.machine === 'kansas' && item.pane_id === 'w2:p2')).toBe(true);
  expect(host.querySelector('header')?.textContent).toContain('Kansas');
  expect(host.querySelector('header')?.textContent).toContain('Operations');
  expect(host.querySelector('header')?.textContent).toContain('Remote watchers');
  expectReadOnlyMonitor();
});

test('a new machine selection wins over the saved target late startup snapshot', async () => {
  await chooseKansasTarget();
  let finish: (response: Response) => void = () => {};
  respondSnapshot = async machine => machine === 'kansas' ? new Promise(resolve => { finish = resolve; }) : Response.json({ id: 'snapshot', result: nativeSnapshot(machine) });
  await coldRestart(); await until(() => rpcs.some(item => item.body.method === 'session.snapshot' && item.body.machine === 'kansas'));
  await changeMachine('wsl'); await until(() => monitorText()?.includes('WSL_VISIBLE') === true);
  await act(async () => finish(Response.json({ id: 'snapshot', result: nativeSnapshot('kansas') })));
  await wait(100);
  expect(monitorText()).toContain('WSL_VISIBLE');
  expect(paneReads().every(item => item.machine === 'wsl')).toBe(true);
  expectReadOnlyMonitor();
});

for (const changed of ['deleted', 'occupant', 'workspace', 'tab'] as const) {
  test(`successful snapshot with ${changed} saved target stays unavailable without reading a sibling`, async () => {
    await chooseKansasTarget(); const previous = pointerEntry();
    if (changed === 'deleted') deletedTarget = true; else if (changed === 'occupant') terminalSerial = 2; else missingAncestor = changed;
    await coldRestart();
    await until(() => rpcs.some(item => item.body.method === 'session.snapshot' && item.body.machine === 'kansas'));
    await wait(120);
    expect(paneReads()).toEqual([]); expect(observations).toEqual([]); expect(monitorText()).toBeUndefined();
    expect(host.textContent).not.toContain('KANSAS_VISIBLE');
    expect(localStorage.getItem(previous.key) ?? '').not.toContain('w2:p2');
    expectReadOnlyMonitor();
  });
}

for (const failed of ['snapshot', 'machines', 'cloudflare-530'] as const) {
  test(`${failed} failure preserves the pointer for later successful cold restoration`, async () => {
    await chooseKansasTarget(); const previous = pointerEntry();
    if (failed === 'snapshot') snapshotFailure = true; else if (failed === 'machines') machinesFailure = true; else cloudflareFailure = true;
    await coldRestart(); await until(() => document.body.textContent?.includes(failed === 'snapshot' ? 'Existing Herdr is offline' : failed === 'machines' ? 'Machines unavailable' : 'HTTP 530') === true);
    expect(localStorage.getItem(previous.key)).toBe(previous.value);
    expect(paneReads()).toEqual([]); expect(observations).toEqual([]);
    snapshotFailure = false; machinesFailure = false; cloudflareFailure = false;
    await act(async () => window.dispatchEvent(new Event('online')));
    await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
    expectReadOnlyMonitor();
  });
}

test('saved target IDs are isolated by authenticated origin even when pane IDs collide', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  const { saveConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server: otherServer, token: 'other-fixture-only' });
  await coldRestart(); await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  expect(paneReads().every(item => item.machine === 'local')).toBe(true);
  expect(requestOrigins.length).toBeGreaterThan(0); expect(requestOrigins.every(origin => origin === otherServer)).toBe(true);
  expect(localStorage.getItem(previous.key)).toBe(previous.value);
  expectReadOnlyMonitor();
});

test('corrupt stored target does not crash startup or create a control view', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  localStorage.setItem(previous.key, '{invalid target json');
  await coldRestart(); await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  expectReadOnlyMonitor();
});

test('unknown mutation delivery stays locked and is never cleared or replayed by cold target restore', async () => {
  await chooseKansasTarget();
  const record = { requestId: 'synthetic-unresolved', server, machine: 'kansas', session: null, workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2', method: 'pane.send_input' };
  localStorage.setItem(`openherdr.pending.v1:${server}`, JSON.stringify(record));
  await coldRestart(); await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport');
  expect(await loadPendingDelivery(server)).toEqual(record);
  expect(host.textContent).toContain(record.requestId);
  expectReadOnlyMonitor();
});


test('offline cold start retains the pointer without borrowing cached output, then restores after reconnect', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  Object.defineProperty(dom.navigator, 'onLine', { value: false, configurable: true });
  await coldRestart(); await wait(100);
  expect(localStorage.getItem(previous.key)).toBe(previous.value);
  expect(paneReads()).toEqual([]); expect(observations).toEqual([]); expect(monitorText()).toBeUndefined();
  Object.defineProperty(dom.navigator, 'onLine', { value: true, configurable: true });
  await act(async () => window.dispatchEvent(new Event('online')));
  await until(() => monitorText() === 'KANSAS_VISIBLE_w2:p2');
  expectReadOnlyMonitor();
});


test('successful removal of the saved machine clears its hint and shows an unavailable selector without Local substitution', async () => {
  await chooseKansasTarget(); const previous = pointerEntry(); missingMachine = true;
  await coldRestart(); await until(() => requests.includes('/api/herdr/machines')); await wait(120);
  expect(paneReads()).toEqual([]); expect(observations).toEqual([]);
  expect(localStorage.getItem(previous.key) ?? '').not.toContain('w2:p2');
  await openWindows();
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Machines"]');
  expect(select?.value).toBe('kansas');
  expect(select?.selectedOptions[0]?.textContent).toContain('kansas');
  expect(select?.selectedOptions[0]?.textContent).not.toBe('Local Mac');
  expect(rpcs.filter(item => item.body.method === 'session.snapshot')).toHaveLength(0);
  expectReadOnlyMonitor();
});

test('blocked target storage does not prevent manual navigation or selected-pane monitoring', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  const descriptor = Object.getOwnPropertyDescriptor(dom.localStorage, 'setItem'); const write = dom.localStorage.setItem.bind(dom.localStorage);
  Object.defineProperty(dom.localStorage, 'setItem', { configurable: true, value: (key: string, value: string) => { if (key === previous.key) throw new Error('Synthetic blocked target storage'); write(key, value); } });
  restoreStorage = () => { if (descriptor) Object.defineProperty(dom.localStorage, 'setItem', descriptor); else Reflect.deleteProperty(dom.localStorage, 'setItem'); };
  await changeMachine('wsl'); await until(() => monitorText()?.includes('WSL_VISIBLE') === true);
  expectReadOnlyMonitor();
  expect(localStorage.getItem(previous.key)).toBe(previous.value);
});

test('explicit pending-target inspection wins over a late cold-restore snapshot without replay', async () => {
  await chooseKansasTarget();
  const record = { requestId: 'synthetic-inspect', server, machine: 'wsl', session: null, workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p2', method: 'pane.send_input' };
  localStorage.setItem(`openherdr.pending.v1:${server}`, JSON.stringify(record));
  let finish: (response: Response) => void = () => {};
  respondSnapshot = async machine => machine === 'kansas' ? new Promise(resolve => { finish = resolve; }) : Response.json({ id: 'snapshot', result: nativeSnapshot(machine) });
  await coldRestart(); await until(() => host.textContent?.includes(record.requestId) === true);
  await click('Terminal');
  await until(() => paneReads().some(item => item.machine === 'wsl' && item.pane === 'w1:p2'));
  await act(async () => finish(Response.json({ id: 'snapshot', result: nativeSnapshot('kansas') }))); await wait(100);
  expect(paneReads().every(item => item.machine === 'wsl' && item.pane === 'w1:p2')).toBe(true);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport');
  expect(await loadPendingDelivery(server)).toEqual(record);
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
});

test('same-origin credential replacement keeps the current target instead of reapplying an older disk hint', async () => {
  await chooseKansasTarget(); const older = pointerEntry();
  await changeMachine('wsl'); await until(() => monitorText()?.includes('WSL_VISIBLE') === true);
  localStorage.setItem(older.key, older.value);
  await openWindows(); await click('Server URL');
  const input = host.querySelector<HTMLInputElement>('input[type="password"]');
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('Missing real pairing form');
  const pairing = { pairingId: 'synthetic-pairing', secret: 'synthetic-secret', server };
  await act(async () => { setter.call(input, `${server}/#pairing=${Buffer.from(JSON.stringify(pairing)).toString('base64url')}`); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Connect'); await until(() => monitorText()?.includes('WSL_VISIBLE') === true);
  expect(host.querySelector('header')?.textContent).toContain('WSL');
  expectReadOnlyMonitor();
});


test('blocked target storage reads keep first-launch manual monitoring usable', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  const descriptor = Object.getOwnPropertyDescriptor(dom.localStorage, 'getItem'); const read = dom.localStorage.getItem.bind(dom.localStorage);
  Object.defineProperty(dom.localStorage, 'getItem', { configurable: true, value: (key: string) => { if (key === previous.key) throw new Error('Synthetic blocked target read'); return read(key); } });
  restoreStorage = () => { if (descriptor) Object.defineProperty(dom.localStorage, 'getItem', descriptor); else Reflect.deleteProperty(dom.localStorage, 'getItem'); };
  await coldRestart(); await until(() => monitorText()?.includes('LOCAL_VISIBLE') === true);
  await changeMachine('wsl'); await until(() => monitorText()?.includes('WSL_VISIBLE') === true);
  expectReadOnlyMonitor();
});


test('authentication expiry during cold restoration preserves the hint and pending lock without exposing a pane', async () => {
  await chooseKansasTarget(); const previous = pointerEntry();
  const record = { requestId: 'synthetic-auth-pending', server, machine: 'kansas', session: null, workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2', method: 'pane.send_input' };
  localStorage.setItem(`openherdr.pending.v1:${server}`, JSON.stringify(record));
  respondSnapshot = async () => Response.json({ error: { code: 'unauthorized', message: 'Herdr device credential was revoked' } }, { status: 401 });
  await coldRestart(); await until(() => host.textContent?.includes('has expired or was revoked') === true);
  expect(localStorage.getItem(previous.key)).toBe(previous.value);
  expect(paneReads()).toEqual([]); expect(observations).toEqual([]);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport');
  expect(await loadPendingDelivery(server)).toEqual(record);
  expectReadOnlyMonitor();
});

test('same-machine pending inspection wins while the original non-aborted snapshot completes', async () => {
  await chooseKansasTarget();
  const record = { requestId: 'synthetic-same-machine-inspect', server, machine: 'kansas', session: null, workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p2', method: 'pane.send_input' };
  localStorage.setItem(`openherdr.pending.v1:${server}`, JSON.stringify(record));
  let finish: (response: Response) => void = () => {};
  respondSnapshot = async () => new Promise(resolve => { finish = resolve; });
  await coldRestart();
  await until(() => host.textContent?.includes(record.requestId) === true && rpcs.some(item => item.body.method === 'session.snapshot'));
  const held = rpcs.find(item => item.body.method === 'session.snapshot');
  expect(held?.body.machine).toBe('kansas'); expect(held?.signal?.aborted).toBe(false);
  await openWindows();
  expect([...document.querySelectorAll('button')].some(item => item.textContent?.trim() === 'Worker watch')).toBe(false);
  const close = document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Sessions"] button[aria-label="Close"]');
  if (!close) throw new Error('Missing original window drawer close');
  await act(async () => close.click());
  await click('Terminal');
  expect(held?.signal?.aborted).toBe(false);
  expect(rpcs.filter(item => item.body.method === 'session.snapshot')).toHaveLength(1);
  await act(async () => finish(Response.json({ id: 'snapshot', result: nativeSnapshot('kansas') })));
  await until(() => paneReads().some(item => item.machine === 'kansas' && item.pane === 'w1:p2'));
  expect(paneReads().every(item => item.machine === 'kansas' && item.pane === 'w1:p2')).toBe(true);
  expect(observations.every(item => item.machine === 'kansas' && item.pane_id === 'w1:p2')).toBe(true);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport');
  expect(await loadPendingDelivery(server)).toEqual(record);
  expect(requests.some(path => path.includes('/conversations/'))).toBe(false);
});
