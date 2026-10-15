import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorView } from '@codemirror/view';
import { z } from 'zod';
import type { Root } from 'react-dom/client';
import type { PendingDelivery } from '../../../../web/src/herdr/transport';

const server = 'https://paired-auth.test';
const otherServer = 'https://other-paired-auth.test';
const oldToken = 'synthetic-revoked-device';
const newToken = 'synthetic-replacement-device';
const rpcBody = z.object({ machine: z.string(), method: z.string(), params: z.object({ pane_id: z.string().optional(), source: z.string().optional() }), requestId: z.string().optional() });
type ReadRequest = z.infer<typeof rpcBody>;
type CapturedRequest = { origin: string; path: string; token: string | null; signal: AbortSignal | null | undefined };
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let cleanupConnections: () => Promise<void>;
let requests: CapturedRequest[];
let rpcs: ReadRequest[];
let redemptions: { server: string; pairingId: string; secret: string }[];
let mutations: number;
let replyRead: (request: ReadRequest, options: RequestInit) => Promise<Response>;
let restoreStorage: () => void;
let inlineAttachment: boolean;
let rejectConversationReads: boolean;

const wait = async (ms = 60) => { for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, ms - elapsed))); }); };
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 150 && !condition(); attempt++) await wait(20); expect(condition()).toBe(true); };
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const welcomeVisible = () => [...host.querySelectorAll('h1')].some(item => item.textContent === 'Connect to OpenHerdr');
const authNotice = () => host.textContent?.includes('has expired or was revoked. Sign in again.') === true;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const findButton = (label: string) => buttons().find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
const click = async (label: string) => {
  const button = findButton(label);
  if (!button) throw new Error(`Missing UI action ${label}`);
  await act(async () => button.click());
};
const openWindows = () => click('Open sessions and projects');
const readReply = (request: ReadRequest) => Response.json({ id: 'read', result: { type: 'pane_read', read: {
  pane_id: request.params.pane_id, workspace_id: 'w1', tab_id: 'w1:t1', source: request.params.source,
  format: 'text', text: `${request.machine.toUpperCase()}_PRIVATE_${request.params.pane_id}`, revision: 4, truncated: false,
} } });
const unauthorized = () => Response.json({ error: { code: 'unauthorized', message: 'Herdr device credential was revoked' } }, { status: 401 });
const pendingRecord = (): PendingDelivery => ({ requestId: 'synthetic-unknown-request', server, machine: 'kansas', session: null, workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p2', method: 'conversation.prompt' });
const snapshot = (machine: string) => ({ type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: [{ workspace_id: 'w1', label: 'Existing research', focused: true, active_tab_id: 'w1:t1', agent_status: 'working', pane_count: 2, tab_count: 1 }],
  tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Research windows', focused: true, agent_status: 'working', pane_count: 2 }],
  panes: ['w1:p1', 'w1:p2'].map(paneId => ({ pane_id: paneId, workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: `${machine}:${paneId}:terminal`, focused: paneId === 'w1:p1', revision: 1, agent_status: 'unknown', label: paneId === 'w1:p1' ? 'Overview dashboard' : 'Worker watch', agent: null, cwd: `/fixture/${machine}` })), agents: [],
} });

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
  requests = []; rpcs = []; redemptions = []; mutations = 0; restoreStorage = () => undefined;
  inlineAttachment = false; rejectConversationReads = false;
  replyRead = async request => readReply(request);
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server);
    requests.push({ origin: url.origin, path: url.pathname, token: new Headers(options.headers).get('Authorization'), signal: options.signal });
    if (url.pathname === '/api/pairing/redeem') {
      const payload = z.object({ pairingId: z.string(), secret: z.string() }).parse(JSON.parse(String(options.body)));
      redemptions.push({ server: url.origin, ...payload });
      return Response.json({ token: newToken, client: { id: 'synthetic-replacement-client' } });
    }
    if (url.pathname === '/api/herdr/machines') return Response.json({ machines: [{ id: 'local', label: 'Local Mac' }, { id: 'kansas', label: 'Kansas' }], session: 'local-only-session' });
    if (url.pathname === '/api/herdr/info') return Response.json({ app: 'openherdr', version: '0.1.0', session: 'local-only-session', allowRemoteFonts: false });
    if (url.pathname === '/api/herdr/preferences') return Response.json({ version: 1, revision: 1, surface: 'mobile', values: {} });
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcBody.parse(JSON.parse(String(options.body))); rpcs.push(body);
      if (body.method === 'session.snapshot') return Response.json({ id: 'snapshot', result: snapshot(body.machine) });
      if (body.method === 'pane.read') return replyRead(body, options);
      mutations += 1; throw new Error(`Unexpected mutation ${body.method}`);
    }
    if (url.pathname === '/api/herdr/terminal') return Response.json({ error: { code: 'observer_unavailable', message: 'Text fallback fixture' } }, { status: 503 });
    if (url.pathname === '/api/herdr/project-context') {
      const request = z.object({ request: z.object({ machine: z.string(), pane_id: z.string(), operation: z.string() }) }).parse(JSON.parse(String(options.body))).request;
      if (request.operation !== 'context.read') { mutations += 1; throw new Error(`Unexpected project-context write ${request.operation}`); }
      return Response.json({ owner: { id: 'b'.repeat(64), machine: request.machine, root: '/fixture/kansas', workspaceId: 'w1', paneId: request.pane_id }, revision: 'c'.repeat(64), context: { notes: [{ id: 'synthetic-private-note', body: 'Private recovery note title\nPrivate note body', source: 'manual', createdAt: 1, updatedAt: 2, pinned: false }], todos: [], plans: [] } });
    }
    if (url.pathname.startsWith('/api/herdr/conversations/')) {
      if (rejectConversationReads) return unauthorized();
      const request = z.object({ request: z.object({ target: z.object({ machine: z.string(), paneId: z.string() }).optional() }) }).parse(JSON.parse(String(options.body))).request;
      const source = { machine: request.target?.machine ?? 'local', paneId: request.target?.paneId ?? 'w1:p1', identity: 'a'.repeat(64), expectedAgentSession: null };
      const session = { id: 'ses_auth_recovery', projectID: 'fixture', title: 'Private saved chat', location: { directory: '/fixture/kansas' }, time: { created: 1, updated: 2 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
      const capabilities = { prompt: true, events: true };
      if (url.pathname.endsWith('/history/list')) return Response.json({ protocol: 'opencode-v2', conversations: [], complete: true, failures: [], cursor: {} });
      if (url.pathname.endsWith('/resolve')) return Response.json({ protocol: 'opencode-v2', target: source, directory: '/fixture/kansas', nativeAccess: 'unavailable', session, capabilities });
      if (url.pathname.endsWith('/list')) return Response.json({ protocol: 'opencode-v2', target: source, sessions: [{ session, access: 'owned', capabilities }], complete: true, failures: [], cursor: {} });
      if (url.pathname.endsWith('/catalog')) return Response.json({ protocol: 'opencode-v2', target: source, models: [], agents: [], authoritative: true, completeness: 'complete' });
      if (url.pathname.endsWith('/read')) return Response.json({ protocol: 'opencode-v2', target: source, session, access: 'owned', capabilities, permissions: [], forms: [], activity: null, messages: { cursor: {}, data: inlineAttachment ? [{ id: 'msg_private_attachment', type: 'user', time: { created: 100 }, text: 'Private historical attachment', files: [{ name: 'private-recovery.txt', mime: 'text/plain', data: btoa('PRIVATE_INLINE_AUTH_ATTACHMENT'), source: { type: 'inline' } }] }] : [] } });
      if (url.pathname.endsWith('/events')) {
        let closed = false;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { options.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.close(); } }, { once: true }); }, cancel() { closed = true; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      mutations += 1; throw new Error(`Unexpected conversation write ${url.pathname}`);
    }
    throw new Error(`Unexpected source I/O ${url.pathname}`);
  }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server, token: oldToken });
  cleanupConnections = async () => { await forgetConnection(server); await forgetConnection(otherServer); };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); restoreStorage(); await cleanupConnections(); await dom.happyDOM.close();
  try { expect(mutations).toBe(0); expect(rpcs.every(item => ['session.snapshot', 'pane.read'].includes(item.method) && !item.requestId)).toBe(true); }
  finally { restore(); }
});

async function render(pending?: PendingDelivery) {
  if (pending) localStorage.setItem(`openherdr.pending.v1:${server}`, JSON.stringify(pending));
  const { I18nProvider } = await import('@/lib/i18n');
  const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
  await until(() => monitorText()?.includes('LOCAL_PRIVATE') === true);
}
async function selectKansasWorker() {
  await openWindows();
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Machines"]');
  if (!select) throw new Error('Missing real machine selector');
  await act(async () => { select.value = 'kansas'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p1') === true);
  await openWindows(); await click('Worker watch');
  await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p2') === true);
}
async function triggerRead() { await act(async () => window.dispatchEvent(new Event('online'))); }
async function expireCredential() {
  replyRead = async () => unauthorized();
  await triggerRead(); await until(authNotice);
}
async function enterPairing(origin = server) {
  const pairing = { pairingId: 'synthetic-single-use', secret: 'synthetic-single-use-secret', server: origin };
  const input = host.querySelector<HTMLInputElement>('input[type="password"]');
  const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setValue) throw new Error('Missing real manual pairing input');
  await act(async () => { setValue.call(input, `${origin}/#pairing=${Buffer.from(JSON.stringify(pairing)).toString('base64url')}`); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(origin);
  expect(redemptions).toHaveLength(0);
  const connect = findButton('Connect'); if (!connect) throw new Error('Missing explicit Connect button');
  await act(async () => connect.click());
}
async function rePair(origin = server) {
  replyRead = async request => readReply(request);
  await enterPairing(origin);
  await until(() => !welcomeVisible());
  expect(redemptions).toEqual([{ server: origin, pairingId: 'synthetic-single-use', secret: 'synthetic-single-use-secret' }]);
}

test('a revoked Herdr credential hides the selected private monitor, blocks Cancel and saved reuse, and pauses reads', async () => {
  await render(); await selectKansasWorker();
  await expireCredential();
  expect(welcomeVisible()).toBe(true);
  expect(host.querySelector('[data-pane-monitor]')?.closest('[hidden]')).not.toBeNull();
  expect(findButton('Cancel')).toBeUndefined();
  const saved = findButton(server); expect(saved?.disabled).toBe(true);
  if (!saved) throw new Error('Missing rejected saved-origin row');
  const count = requests.length;
  await act(async () => saved.click()); await wait(3200);
  expect(authNotice()).toBe(true); expect(requests).toHaveLength(count); expect(redemptions).toHaveLength(0);
});

test('explicit same-origin re-pairing restores Kansas and its non-default pane with the unsent chat draft', async () => {
  await render(); await selectKansasWorker();
  await openWindows(); await click('Conversations'); await until(() => !!host.querySelector('[data-mobile-composer-pill]'));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-composer-morph-prompt]')?.click());
  await until(() => !!host.querySelector('.cm-content'));
  const node = host.querySelector<HTMLElement>('.cm-content'); const editor = node && EditorView.findFromDOM(node);
  if (!editor) throw new Error('Missing real chat editor');
  await act(async () => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'Unsent private recovery draft' } }));
  await openWindows(); await click('Monitor'); await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p2') === true);
  await expireCredential(); await rePair();
  await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p2') === true);
  expect(host.querySelector('header')?.textContent).toContain('Kansas');
  expect(host.querySelector('[data-herdr-pane]')?.getAttribute('data-herdr-pane')).toBe('w1:p2');
  expect(requests.some(request => request.token === `Bearer ${newToken}` && request.path === '/api/herdr/rpc')).toBe(true);
  await openWindows(); await click('Conversations'); await until(() => !!host.querySelector('[data-mobile-composer-pill]'));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-composer-morph-prompt]')?.click());
  await until(() => !!host.querySelector('.cm-content'));
  expect(host.querySelector('.cm-content')?.textContent).toBe('Unsent private recovery draft');
});

test('same-origin credential replacement preserves an unknown delivery record and never resends it', async () => {
  const record = pendingRecord(); await render(record); await selectKansasWorker();
  await expireCredential(); await rePair();
  await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p2') === true);
  const { loadPendingDelivery } = await import('../../../../web/src/herdr/transport');
  expect(await loadPendingDelivery(server)).toEqual(record);
  expect(host.textContent).toContain(record.requestId);
  expect(requests.some(request => /\/conversations\/(action|send|prompt)$/.test(request.path))).toBe(false);
});

test('a failed credential save leaves private content hidden and retries only storage before restoring the same target', async () => {
  await render(); await selectKansasWorker(); await expireCredential();
  const setItem = dom.localStorage.setItem.bind(dom.localStorage);
  const descriptor = Object.getOwnPropertyDescriptor(dom.localStorage, 'setItem');
  let fail = true;
  Object.defineProperty(dom.localStorage, 'setItem', { configurable: true, value: (key: string, value: string) => {
    if (fail && key === 'openherdr.connections.v1') throw new Error('Synthetic credential storage failure');
    setItem(key, value);
  } });
  restoreStorage = () => { if (descriptor) Object.defineProperty(dom.localStorage, 'setItem', descriptor); else Reflect.deleteProperty(dom.localStorage, 'setItem'); };
  replyRead = async request => readReply(request);
  await enterPairing();
  await until(() => host.textContent?.includes('Connection approved. It could not be saved on this device.') === true);
  expect(welcomeVisible()).toBe(true); expect(host.querySelector('[data-pane-monitor]')?.closest('[hidden]')).not.toBeNull();
  expect(requests.some(request => request.token === `Bearer ${newToken}`)).toBe(false);
  const { savedConnections } = await import('../../../../web/src/herdr/transport');
  expect(savedConnections().find(item => item.server === server)?.token).toBe(oldToken);
  fail = false; await click('Connect'); await until(() => !welcomeVisible());
  await until(() => monitorText()?.includes('KANSAS_PRIVATE_w1:p2') === true);
  expect(redemptions).toHaveLength(1); expect(savedConnections().find(item => item.server === server)?.token).toBe(newToken);
});

test('a project-note delete confirmation closes its private portal when the connected panel becomes inactive', async () => {
  const { I18nProvider } = await import('@/lib/i18n');
  const { ProjectContextPanel } = await import('../../../../web/src/herdr/ProjectContextPanel');
  const { HerdrTransport } = await import('../../../../web/src/herdr/transport');
  const transport = new HerdrTransport({ server, token: oldToken });
  const renderPanel = async (active: boolean) => {
    await act(async () => root.render(<I18nProvider><div hidden={!active}><ProjectContextPanel transport={transport} machine="kansas" paneId="w1:p2" active={active} /></div></I18nProvider>));
  };
  await renderPanel(true);
  await until(() => host.textContent?.includes('Private recovery note title') === true);
  await click('Delete');
  await until(() => !!document.querySelector('[role="dialog"]'));
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('Private recovery note title');
  expect(host.contains(dialog)).toBe(false);
  const count = requests.length;
  await renderPanel(false);
  await until(() => !document.querySelector('[role="dialog"]'));
  expect(host.querySelector('section')?.closest('[hidden]')).not.toBeNull();
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  expect(buttons().filter(button => button.textContent?.trim() === 'Delete' && !button.closest('[hidden]'))).toHaveLength(0);
  await wait(100);
  expect(requests).toHaveLength(count); expect(mutations).toBe(0);
});

test('an opened inline text attachment portal disappears when real conversation authentication expires', async () => {
  inlineAttachment = true;
  await render(); await selectKansasWorker();
  await openWindows(); await click('Conversations');
  await until(() => !!findButton('private-recovery.txt'));
  await click('private-recovery.txt');
  const attachmentDialog = () => [...document.querySelectorAll('[role="dialog"]')].find(dialog => dialog.querySelector('pre')?.textContent === 'PRIVATE_INLINE_AUTH_ATTACHMENT');
  await until(() => !!attachmentDialog());
  expect(host.contains(attachmentDialog() ?? null)).toBe(false);
  rejectConversationReads = true;
  await triggerRead(); await until(authNotice);
  expect(welcomeVisible()).toBe(true);
  await until(() => !attachmentDialog());
  const retainedDialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
  expect(retainedDialogs().every(dialog => dialog.getAttribute('aria-hidden') === 'true' && dialog.style.pointerEvents === 'none')).toBe(true);
  await until(() => retainedDialogs().every(dialog => dialog.style.visibility === 'hidden'));
  expect(document.body.textContent).not.toContain('PRIVATE_INLINE_AUTH_ATTACHMENT');
  expect(host.querySelector('[data-mobile-composer-pill]')?.closest('[hidden]')).not.toBeNull();
  expect(requests.some(request => /\/conversations\/(action|send|prompt)$/.test(request.path))).toBe(false);
  expect(mutations).toBe(0);
});

for (const origin of [server, otherServer]) {
  test(`a delayed old 401 cannot replace a newer connection to ${origin}`, async () => {
    await render(); await selectKansasWorker();
    let finish: (response: Response) => void = () => { throw new Error('Missing captured old read'); };
    let held = false;
    replyRead = async (request, options) => {
      if (new Headers(options.headers).get('Authorization') !== `Bearer ${oldToken}`) return readReply(request);
      held = true; return new Promise(resolve => { finish = resolve; });
    };
    await triggerRead(); await until(() => held);
    const captured = requests.filter(request => request.path === '/api/herdr/rpc').at(-1);
    expect(captured?.token).toBe(`Bearer ${oldToken}`);
    await openWindows(); await click('Server URL'); await until(welcomeVisible);
    expect(captured?.signal?.aborted).toBe(true);
    await enterPairing(origin); await until(() => !welcomeVisible());
    await until(() => monitorText()?.includes(origin === server ? 'KANSAS_PRIVATE_w1:p2' : 'LOCAL_PRIVATE_w1:p1') === true);
    expect(requests.some(request => request.origin === origin && request.token === `Bearer ${newToken}`)).toBe(true);
    await act(async () => finish(unauthorized())); await wait(200);
    expect(welcomeVisible()).toBe(false); expect(authNotice()).toBe(false);
    expect(monitorText()).toBe(origin === server ? 'KANSAS_PRIVATE_w1:p2' : 'LOCAL_PRIVATE_w1:p1');
  });
}

for (const failure of ['cloudflare-530', 'timeout', 'html-401', 'upstream-401']) {
  test(`${failure} remains a read failure without expiring the Herdr credential`, async () => {
    await render(); await selectKansasWorker();
    replyRead = async () => {
      if (failure === 'timeout') throw new DOMException('Synthetic fetch timeout', 'TimeoutError');
      if (failure === 'cloudflare-530') return new Response('<html>Cloudflare origin unavailable</html>', { status: 530, headers: { 'Content-Type': 'text/html' } });
      if (failure === 'html-401') return new Response('<html>Cloudflare access challenge</html>', { status: 401, headers: { 'Content-Type': 'text/html' } });
      return Response.json({ error: { code: 'conversation_request_refused', message: 'Upstream OpenCode rejected its own authorization' } }, { status: 401 });
    };
    const count = requests.length; await triggerRead();
    await until(() => requests.length > count && !!host.querySelector('[data-pane-monitor] [role="alert"]'));
    expect(welcomeVisible()).toBe(false); expect(authNotice()).toBe(false);
    expect(monitorText()).toBe('KANSAS_PRIVATE_w1:p2');
    expect(host.querySelector('[data-pane-monitor]')?.closest('[hidden]')).toBeNull();
    expect(redemptions).toHaveLength(0);
  });
}
