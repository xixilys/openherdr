import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { z } from 'zod';
import type { Root } from 'react-dom/client';
import type { snapshotSchema, HerdrTransport } from '../../../../web/src/herdr/transport';

type Pane = z.infer<typeof snapshotSchema>['snapshot']['panes'][number];
const readRequest = z.object({ machine: z.string(), method: z.literal('pane.read'), params: z.object({ pane_id: z.string(), source: z.literal('visible'), format: z.literal('text'), strip_ansi: z.literal(true), lines: z.literal(500) }) });
type ReadRequest = z.infer<typeof readRequest>;
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let render: () => Promise<void>;
let machine: string;
let pane: Pane;
let transport: HerdrTransport;
let active: boolean;
let reads: { request: ReadRequest; signal: AbortSignal | null | undefined }[];
let respond: (request: ReadRequest) => Promise<Response>;
const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 80 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const output = () => host.querySelector('pre')?.textContent;
const reply = (request: ReadRequest, text: string) => Response.json({ id: 'read', result: { type: 'pane_read', read: { pane_id: request.params.pane_id, workspace_id: 'w1', tab_id: 'w1:t1', source: 'visible', format: 'text', text, revision: 2, truncated: false } } });
const defer = <T,>() => { let finish: (value: T) => void = () => {}; const promise = new Promise<T>(resolve => { finish = resolve; }); return { promise, resolve: (value: T) => finish(value) }; };

beforeEach(async () => {
  dom = new Window({ url: 'https://monitor-leaf.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, Event: dom.Event,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const savedFetch = globalThis.fetch;
  reads = []; respond = async request => reply(request, `${request.machine} visible screen`);
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/api/herdr/rpc') { const request = readRequest.parse(JSON.parse(String(options?.body))); reads.push({ request, signal: options?.signal }); return respond(request); }
    if (url.pathname === '/api/herdr/terminal') return Response.json({ error: { code: 'screen_unavailable', message: 'Visible fallback fixture' } }, { status: 503 });
    throw new Error(`Unexpected source operation ${url.pathname}`);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { getDefaultTheme } = await import('@/lib/theme/themes');
  const { PaneMonitor } = await import('../../../../web/src/herdr/PaneMonitor');
  const { HerdrTransport: Transport } = await import('../../../../web/src/herdr/transport');
  transport = new Transport({ server: 'https://monitor-leaf.test', token: 'fixture-only' }); machine = 'local'; active = true;
  pane = { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: 'terminal-one', focused: true, revision: 1, agent_status: 'unknown', label: 'Existing dashboard', agent: null };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  render = () => act(async () => root.render(<I18nProvider><PaneMonitor transport={transport} machine={machine} pane={pane} theme={getDefaultTheme(false)} active={active} snapshotStale={false} /></I18nProvider>));
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); restore(); });

test('official screen failure uses only visible text and does not expose an editable input', async () => {
  await until(() => output() === 'local visible screen');
  expect(reads.length).toBeGreaterThan(0);
  await until(() => host.textContent?.includes("The screen stream is unavailable. Showing the pane's visible text.") === true);
  expect(host.querySelector('textarea:not([readonly])')).toBeNull();
  expect(host.textContent).toContain('Read-only view');
  expect(reads.every(read => read.request.params.source === 'visible')).toBe(true);
});

test('a failed visible read retains its bytes and displays the last successful time', async () => {
  await until(() => output() === 'local visible screen');
  respond = async () => Response.json({ error: { code: 'read_failed', message: 'Visible output unavailable' } }, { status: 503 });
  await act(async () => window.dispatchEvent(new Event('online')));
  await until(() => host.textContent?.includes('Visible output unavailable') === true);
  expect(output()).toBe('local visible screen');
  expect(host.textContent).toContain('Showing the last successful read from');
  expect(host.textContent).toContain('Last read');
});

test('matching pane IDs on different machines never expose the previous machine output', async () => {
  await until(() => output() === 'local visible screen');
  const response = defer<Response>(); let incoming: ReadRequest | null = null;
  respond = async request => { incoming = request; return response.promise; };
  machine = 'kansas'; await render();
  expect(output()).not.toContain('local visible screen');
  await until(() => !!incoming);
  const request = readRequest.parse(incoming);
  await act(async () => response.resolve(reply(request, 'kansas visible screen')));
  await until(() => output() === 'kansas visible screen');
});

test('a changed terminal occupant clears old output and rejects an old in-flight completion', async () => {
  await until(() => output() === 'local visible screen');
  const old = defer<Response>(); let oldRequest: ReadRequest | null = null;
  respond = async request => { oldRequest = request; return old.promise; };
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!oldRequest);
  const oldSignal = reads.at(-1)?.signal;
  const next = defer<Response>(); let nextRequest: ReadRequest | null = null;
  respond = async request => { nextRequest = request; return next.promise; };
  pane = { ...pane, terminal_id: 'terminal-two' }; await render();
  expect(oldSignal?.aborted).toBe(true); expect(output()).not.toContain('local visible screen');
  await act(async () => old.resolve(reply(readRequest.parse(oldRequest), 'old occupant late reply'))); await wait();
  expect(output()).not.toContain('old occupant late reply');
  await until(() => !!nextRequest);
  await act(async () => next.resolve(reply(readRequest.parse(nextRequest), 'new occupant visible screen')));
  await until(() => output() === 'new occupant visible screen');
});

test('pausing aborts a pending read, retains its last result and resumes the same owner', async () => {
  await until(() => output() === 'local visible screen');
  const pending = defer<Response>(); let request: ReadRequest | null = null;
  respond = async incoming => { request = incoming; return pending.promise; };
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => !!request);
  const signal = reads.at(-1)?.signal;
  active = false; await render(); expect(signal?.aborted).toBe(true);
  expect(output()).toBe('local visible screen'); expect(host.textContent).toContain('Monitoring paused.');
  await act(async () => pending.resolve(reply(readRequest.parse(request), 'late hidden bytes'))); await wait();
  expect(output()).toBe('local visible screen');
  respond = async incoming => reply(incoming, 'resumed visible screen'); active = true; await render();
  await until(() => output() === 'resumed visible screen');
});

test('a successful empty visible pane stays empty rather than claiming it is still waiting', async () => {
  await until(() => output() === 'local visible screen');
  respond = async incoming => reply(incoming, '');
  await act(async () => window.dispatchEvent(new Event('online'))); await until(() => output() === '');
  expect(host.textContent).not.toContain('Waiting for a successful read.');
});

test('a fresh snapshot of the same occupant keeps output and its existing read lifecycle', async () => {
  await until(() => output() === 'local visible screen');
  const count = reads.length;
  pane = { ...pane, revision: pane.revision + 1, agent_status: 'working' }; await render();
  expect(output()).toBe('local visible screen'); expect(reads).toHaveLength(count);
});
