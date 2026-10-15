import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { z } from 'zod';
import type { Root } from 'react-dom/client';
import { CODE_FONT_OPTIONS, UI_FONT_OPTIONS } from '@/lib/fontOptions';
import type { PreferencesSnapshot } from '../../../../web/src/herdr/preferences-client';

const server = 'https://settings-owned.test';
const preferenceValues = z.strictObject({
  themeId: z.string().optional(), useSystemTheme: z.boolean().optional(), lightThemeId: z.string().optional(), darkThemeId: z.string().optional(),
  fontSize: z.number().optional(), uiFont: z.enum(UI_FONT_OPTIONS.map(option => option.id)).optional(), monoFont: z.enum(CODE_FONT_OPTIONS.map(option => option.id)).optional(),
  enterToSend: z.boolean().optional(), enterToSendConfigured: z.boolean().optional(), expandReasoningWhileStreaming: z.boolean().optional(),
});
const surface = z.enum(['web', 'desktop', 'vscode', 'mobile']);
const preferenceRead = z.strictObject({ operation: z.literal('read'), surface });
const preferenceUpdate = z.strictObject({ operation: z.literal('update'), surface, expectedRevision: z.number(), changes: preferenceValues });
const preferenceRequest = z.discriminatedUnion('operation', [preferenceRead, preferenceUpdate]);
const rpcRequest = z.object({ machine: z.string(), method: z.string(), params: z.object({ pane_id: z.string().optional(), source: z.string().optional() }), requestId: z.string().optional() });

type Update = z.infer<typeof preferenceUpdate>;
type CapturedRequest = { origin: string; path: string; authorization: string | null };
let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let cleanupConnection: () => Promise<void>;
let requests: CapturedRequest[];
let rejectedRequests: string[];
let rpcMethods: string[];
let writes: Update[];
let reads: number;
let authoritative: Pick<PreferencesSnapshot, 'revision' | 'values'>;
let loadFailure: boolean;
let replyUpdate: (request: Update) => Promise<Response>;
const pendingResponses: Array<{ settled: () => boolean; resolve: (response: Response) => void }> = [];

const wait = async (milliseconds = 40) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, Math.min(20, milliseconds - elapsed))); });
  }
};
const until = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) await wait(20);
  expect(condition()).toBe(true);
};
const deferredResponse = () => {
  let settled = false;
  let resolve: (value: Response) => void = () => { throw new Error('Uninitialized response gate'); };
  const promise = new Promise<Response>(accept => { resolve = value => { settled = true; accept(value); }; });
  const gate = { promise, resolve, settled: () => settled };
  pendingResponses.push(gate);
  return gate;
};
const snapshot = (selectedSurface: PreferencesSnapshot['surface']): PreferencesSnapshot => ({ version: 1, revision: authoritative.revision, surface: selectedSurface, values: { ...authoritative.values } });
const commit = (request: Update) => {
  authoritative = { revision: request.expectedRevision + 1, values: { ...authoritative.values, ...request.changes } };
  return Response.json(snapshot(request.surface));
};
const nativeSnapshot = { type: 'session_snapshot', snapshot: { version: '0.9.3', protocol: 22,
  workspaces: [{ workspace_id: 'w1', label: 'Existing owned research', focused: true, active_tab_id: 'w1:t1', agent_status: 'unknown', pane_count: 1, tab_count: 1 }],
  tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Existing task window', focused: true, agent_status: 'unknown', pane_count: 1 }],
  panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', terminal_id: 'terminal-owned-existing', focused: true, revision: 1, agent_status: 'unknown', label: 'Read-only dashboard', cwd: '/owned/existing' }], agents: [],
} };
const monitorText = () => host.querySelector('[data-pane-monitor] pre')?.textContent;
const visible = (element: Element) => !element.closest('[hidden],[aria-hidden="true"],[inert]');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
const findButton = (label: string) => buttons().find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label);
const click = async (label: string) => {
  const button = findButton(label);
  if (!button) throw new Error('Missing actual UI action: ' + label);
  await act(async () => button.click());
};
const inputText = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Browser input setter missing');
    setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = async (element: Element, value: string, options: { ctrlKey?: boolean; shiftKey?: boolean; isComposing?: boolean } = {}) => {
  await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })));
};

beforeEach(async () => {
  dom = new Window({ url: server + '/?surface=mobile' }); dom.innerWidth = 412; dom.innerHeight = 915;
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement, HTMLAnchorElement: dom.HTMLAnchorElement, HTMLImageElement: dom.HTMLImageElement,
    HTMLTableElement: dom.HTMLTableElement, HTMLTableCellElement: dom.HTMLTableCellElement, HTMLTableRowElement: dom.HTMLTableRowElement,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, Event: dom.Event,
    KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, CustomEvent: dom.CustomEvent,
    SVGElement: dom.SVGElement, customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const locks = new Map<string, Promise<void>>();
  Object.defineProperty(dom.navigator, 'locks', { configurable: true, value: { request<T>(name: string, callback: () => Promise<T>) { const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.then(() => undefined, () => undefined)); return next; } } });
  requests = []; rejectedRequests = []; rpcMethods = []; writes = []; reads = 0; loadFailure = false;
  authoritative = { revision: 1, values: { fontSize: 100, expandReasoningWhileStreaming: false } };
  replyUpdate = async request => commit(request);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), server);
    requests.push({ origin: url.origin, path: url.pathname, authorization: new Headers(options.headers).get('Authorization') });
    if (url.pathname === '/api/herdr/info') return Response.json({ app: 'openherdr', version: '0.1.0', session: 'owned-existing', allowRemoteFonts: false });
    if (url.pathname === '/api/herdr/machines') return Response.json({ machines: [{ id: 'local', label: 'Local' }], session: 'owned-existing' });
    if (url.pathname === '/api/herdr/preferences') {
      const body = preferenceRequest.parse(JSON.parse(String(options.body)));
      if (body.operation === 'read') { reads++; return loadFailure ? Response.json({ error: { code: 'preferences_unavailable', message: 'Controlled load failure' } }, { status: 503 }) : Response.json(snapshot(body.surface)); }
      writes.push(body); return replyUpdate(body);
    }
    if (url.pathname === '/api/herdr/rpc') {
      const body = rpcRequest.parse(JSON.parse(String(options.body)));
      rpcMethods.push(body.method);
      if (body.requestId || !['session.snapshot', 'pane.read'].includes(body.method)) { rejectedRequests.push(body.method); throw new Error('Settings must not issue a Herdr mutation'); }
      expect(body.machine).toBe('local');
      if (body.method === 'pane.read') expect(body.params.pane_id).toBe('w1:p1');
      if (body.method === 'session.snapshot') return Response.json({ id: 'snapshot-owned', result: nativeSnapshot });
      return Response.json({ id: 'read-owned', result: { type: 'pane_read', read: { pane_id: body.params.pane_id, workspace_id: 'w1', tab_id: 'w1:t1', source: body.params.source, format: 'text', text: 'OWNED_EXISTING_MONITOR', revision: 1, truncated: false } } });
    }
    if (url.pathname === '/api/herdr/terminal') return Response.json({ error: { code: 'observer_unavailable', message: 'Use controlled text fallback' } }, { status: 503 });
    rejectedRequests.push(url.pathname); throw new Error('Unexpected Settings runtime request: ' + url.pathname);
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { useI18nStore } = await import('@/lib/i18n'); useI18nStore.getState().setLocale('en');
  const { saveConnection, forgetConnection } = await import('../../../../web/src/herdr/transport');
  await saveConnection({ server, token: 'owned-settings-fixture' }); cleanupConnection = () => forgetConnection(server);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  try {
    for (const response of pendingResponses.splice(0)) if (!response.settled()) response.resolve(Response.json({ error: { code: 'cleanup', message: 'Owned fixture cleanup' } }, { status: 503 }));
    await act(async () => root.unmount());
    await cleanupConnection();
    const { useI18nStore } = await import('@/lib/i18n'); useI18nStore.getState().setLocale('en');
    await dom.happyDOM.close();
    expect(rejectedRequests).toEqual([]);
    expect(rpcMethods.every(method => ['session.snapshot', 'pane.read'].includes(method))).toBe(true);
    expect(requests.every(request => request.origin === server && request.path.startsWith('/api/herdr/'))).toBe(true);
    expect(requests.every(request => request.authorization === 'Bearer owned-settings-fixture')).toBe(true);
  } finally { restore(); }
});

async function render(width = 412, height = 915, mobile = true) {
  dom.innerWidth = width; dom.innerHeight = height; dom.happyDOM.setURL(server + '/?surface=' + (mobile ? 'mobile' : 'desktop'));
  const { I18nProvider } = await import('@/lib/i18n');
  const { HerdrApp } = await import('../../../../web/src/herdr/HerdrApp');
  await act(async () => root.render(<I18nProvider><HerdrApp initialPairing={null} initialError={null} /></I18nProvider>));
  await until(() => monitorText()?.includes('OWNED_EXISTING_MONITOR') === true);
}

async function openSettings(mobile = true) {
  if (mobile) await click('Open sessions and projects');
  await click('Settings'); await until(() => !!findButton('Appearance'));
}

test('mobile Settings returns through inner Back and preserves the existing Monitor', async () => {
  await render(); await openSettings();
  expect(findButton('Appearance')).toBeDefined(); expect(findButton('Chat')).toBeDefined();
  expect(findButton('Providers')).toBeUndefined();
  await click('Appearance');
  expect(document.querySelector('[data-settings-item="appearance.interface-font-size"]')).not.toBeNull();
  const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
  expect(findButton('Appearance')).toBeDefined();
  await click('Chat');
  expect(document.querySelector('[data-settings-item="chat.expand-reasoning-while-streaming"]')).not.toBeNull();
  expect(document.querySelector('[data-settings-item="chat.enter-to-send"]')).toBeNull();
  await click('Back to settings'); expect(findButton('Appearance')).toBeDefined();
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
  await wait();
  expect(document.querySelector('[data-settings-item]')).toBeNull();
  expect(monitorText()).toContain('OWNED_EXISTING_MONITOR');
});

const settings = () => document.querySelector<HTMLElement>('[data-settings-view]');
const searchInput = () => {
  const input = settings()?.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');
  if (!input) throw new Error('Settings search missing');
  return input;
};
const results = () => [...(settings()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter(button => button.querySelector('span.typography-ui-label.text-foreground'));
const fontValue = () => {
  const anchor = document.querySelector('[data-settings-item="appearance.interface-font-size"]');
  if (!anchor) throw new Error('Font control missing');
  return anchor.querySelector<HTMLInputElement>('input')?.value ?? anchor.querySelector('[aria-live="polite"]')?.textContent;
};
const reasoning = () => {
  const control = document.querySelector<HTMLElement>('[data-settings-item="chat.expand-reasoning-while-streaming"]');
  if (!control) throw new Error('Reasoning control missing');
  return control;
};
const backToNav = async () => { await click('Back to settings'); await click('Clear settings search'); };

test('mobile search exposes exactly implemented targets and reveals each actual control', async () => {
  await render(); await openSettings();
  const targets: Array<[string, string]> = [
    ['language', 'appearance.language'], ['light theme', 'appearance.light-theme'], ['dark theme', 'appearance.dark-theme'],
    ['interface font', 'appearance.interface-font'], ['code font', 'appearance.code-font'],
    ['interface font size', 'appearance.interface-font-size'], ['expand reasoning', 'chat.expand-reasoning-while-streaming'],
  ];
  const titles = new Set<string>();
  for (const [query, id] of targets) {
    await inputText(searchInput(), query);
    for (const result of results()) titles.add(result.querySelector('span')?.textContent ?? '');
    const title = query === 'interface font' ? 'Interface font' : undefined;
    const selected = title ? results().find(button => button.querySelector('span')?.textContent === title) : results()[0];
    expect(selected).toBeDefined();
    await act(async () => selected?.click());
    await until(() => document.querySelector(`[data-settings-item="${id}"]`)?.getAttribute('data-settings-search-highlight') === 'true');
    const anchor = document.querySelector(`[data-settings-item="${id}"]`);
    expect(anchor).not.toBeNull(); expect(document.activeElement).toBe(anchor);
    await backToNav();
  }
  expect(titles.size).toBe(7);
  for (const query of ['provider', 'import theme', 'time format', 'enter to send']) {
    await inputText(searchInput(), query); expect(results()).toHaveLength(0);
  }
  await click('Clear settings search'); expect(findButton('Appearance')).toBeDefined();
});

test('actual mobile search keeps keyboard focus, navigates arrows and Ctrl keys, and clears Escape before close', async () => {
  await render(); await openSettings();
  const input = searchInput(); await act(async () => input.focus());
  await inputText(input, 'font'); expect(results().length).toBe(3);
  const active = () => results().findIndex(button => button.classList.contains('bg-interactive-selection'));
  expect(active()).toBe(0);
  await key(input, 'ArrowDown'); expect(active()).toBe(1); expect(document.activeElement).toBe(input);
  await key(input, 'n', { ctrlKey: true }); expect(active()).toBe(2);
  await key(input, 'ArrowUp'); expect(active()).toBe(1);
  await key(input, 'p', { ctrlKey: true }); expect(active()).toBe(0);
  await key(input, 'ArrowDown', { isComposing: true }); expect(active()).toBe(0);
  await key(input, 'n', { ctrlKey: true, shiftKey: true }); expect(active()).toBe(0);
  await key(input, 'Enter', { isComposing: true }); expect(searchInput()).toBe(input);
  await key(input, 'Enter');
  await until(() => !!document.querySelector('[data-settings-search-highlight]'));
  await click('Back to settings');
  await key(searchInput(), 'Escape');
  expect(settings()).not.toBeNull(); expect(searchInput().value).toBe(''); expect(findButton('Appearance')).toBeDefined();
  await key(searchInput(), 'Escape'); await wait(); expect(settings()).toBeNull();
});

test('desktop dialog retains shared navigation, Enter setting and real close', async () => {
  await render(1365, 900, false); await openSettings(false);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelectorAll('[data-settings-view]')).toHaveLength(1);
  await inputText(searchInput(), 'e'); expect(results()).toHaveLength(8); await click('Clear settings search');
  await click('Chat'); expect(document.querySelector('[data-settings-item="chat.enter-to-send"]')).not.toBeNull();
  await inputText(searchInput(), 'keyboard'); expect(results()).toHaveLength(1);
  await key(searchInput(), 'Enter');
  await until(() => document.querySelector('[data-settings-item="chat.enter-to-send"]')?.getAttribute('data-settings-search-highlight') === 'true');
  await click('Clear settings search'); await click('Appearance'); expect(fontValue()).toBe('100');
  await click('Close settings'); await until(() => !settings());
  expect(monitorText()).toContain('OWNED_EXISTING_MONITOR');
});

test('cross-page autosaves serialize and retain newer values through close and reopen', async () => {
  const first = deferredResponse(); const second = deferredResponse();
  replyUpdate = async () => writes.length === 1 ? first.promise : second.promise;
  await render(); await openSettings(); await click('Appearance');
  await click('Increase value'); await until(() => writes.length === 1);
  expect(writes[0].changes).toEqual({ fontSize: 105 });
  await click('Increase value'); expect(fontValue()).toBe('110');
  await click('Back to settings'); await click('Chat');
  await act(async () => reasoning().click()); expect(writes).toHaveLength(1);
  await click('Close settings'); await openSettings(); await click('Appearance');
  expect(fontValue()).toBe('110'); expect(writes).toHaveLength(1);
  await act(async () => first.resolve(commit(writes[0])));
  await until(() => writes.length === 2);
  expect(writes[1]).toMatchObject({ expectedRevision: 2, changes: { fontSize: 110, expandReasoningWhileStreaming: true } });
  expect(fontValue()).toBe('110');
  await act(async () => second.resolve(commit(writes[1]))); await until(() => !findButton('Save changes'));
  await click('Refresh'); await until(() => reads === 2); expect(fontValue()).toBe('110');
  expect(authoritative.values).toMatchObject({ fontSize: 110, expandReasoningWhileStreaming: true });
  expect(document.documentElement.style.fontSize).toBe('110%');
});

test('load and save failures retain drafts and explicit retry reaches the authoritative server', async () => {
  loadFailure = true;
  await render(); await openSettings(); await click('Appearance');
  expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(findButton('Increase value')?.disabled).toBe(true);
  loadFailure = false; await click('Refresh'); await until(() => findButton('Increase value')?.disabled === false);
  replyUpdate = async () => Response.json({ error: { code: 'preferences_unavailable', message: 'Controlled save failure' } }, { status: 503 });
  await click('Increase value'); await until(() => !!findButton('Save changes') && !findButton('Save changes')?.disabled);
  expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(fontValue()).toBe('105');
  await click('Close settings'); await openSettings(); await click('Appearance'); expect(fontValue()).toBe('105');
  expect(writes).toHaveLength(1);
  replyUpdate = async request => commit(request); await click('Save changes');
  await until(() => writes.length === 2 && !findButton('Save changes'));
  expect(authoritative.values.fontSize).toBe(105); expect(document.querySelector('[role="alert"]')).toBeNull();
});

test('conflict blocks autosave across page and close until explicit refresh preserves the draft', async () => {
  replyUpdate = async () => Response.json({ error: { code: 'preferences_conflict', message: 'Controlled conflict' } }, { status: 409 });
  await render(); await openSettings(); await click('Appearance'); await click('Increase value');
  await until(() => findButton('Save changes')?.disabled === true);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await click('Increase value'); await click('Back to settings'); await click('Chat'); await act(async () => reasoning().click());
  await click('Close settings'); await openSettings(); await click('Appearance');
  expect(fontValue()).toBe('110'); expect(writes).toHaveLength(1);
  authoritative = { revision: 9, values: { fontSize: 95, expandReasoningWhileStreaming: false } };
  await click('Refresh'); await until(() => reads === 2 && findButton('Save changes')?.disabled === false);
  expect(fontValue()).toBe('110'); expect(writes).toHaveLength(1);
  replyUpdate = async request => commit(request); await click('Save changes'); await until(() => writes.length === 2 && !findButton('Save changes'));
  expect(writes[1]).toMatchObject({ expectedRevision: 9, changes: { fontSize: 110, expandReasoningWhileStreaming: true } });
});

test('hosted landscape retains mobile Back and locale rerenders preserve the current page and preference', async () => {
  await render(915, 412); await openSettings(); await click('Appearance'); await click('Increase value');
  await until(() => writes.length === 1 && !findButton('Save changes'));
  const view = settings();
  const { useI18nStore } = await import('@/lib/i18n');
  await act(async () => { useI18nStore.getState().setLocale('zh-CN'); });
  await until(() => document.documentElement.lang === 'zh-CN');
  expect(settings()).toBe(view); expect(fontValue()).toBe('105'); expect(document.querySelector('[data-settings-item="chat.enter-to-send"]')).toBeNull();
  await act(async () => { useI18nStore.getState().setLocale('ar'); });
  await until(() => document.documentElement.dir === 'rtl');
  expect(settings()).toBe(view); expect(fontValue()).toBe('105'); expect(writes).toHaveLength(1);
  const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
  expect(settings()).toBe(view); expect(document.querySelector('[data-settings-item]')).toBeNull();
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
  expect(settings()).toBeNull(); expect(monitorText()).toContain('OWNED_EXISTING_MONITOR');
});

test('unsent terminal draft and exact existing target survive the Settings round trip', async () => {
  await render(); await click('Open sessions and projects'); await click('Terminal controls');
  await until(() => !!document.querySelector('textarea'));
  const input = document.querySelector<HTMLTextAreaElement>('textarea');
  if (!input) throw new Error('Existing terminal composer missing');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Textarea setter missing');
    setter.call(input, 'OWNED_UNSENT_DRAFT'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await openSettings(); await click('Appearance'); await click('Close settings');
  await click('Open workspace panel'); await click('Terminal controls');
  await until(() => !!document.querySelector('textarea'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('OWNED_UNSENT_DRAFT');
  expect(document.querySelector('.herdr-target')?.textContent).toContain('local · owned-existing · w1:p1');
  expect(writes).toHaveLength(0); expect(rejectedRequests).toEqual([]);
});

test('existing unknown-delivery lock survives Settings without clearing or replaying the operation', async () => {
  const pending = { requestId: 'owned-pending-request', server, machine: 'local', session: 'owned-existing', workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:p1', method: 'pane.send_text' };
  localStorage.setItem('openherdr.pending.v1:' + server, JSON.stringify(pending));
  await render(); await openSettings(); await click('Chat'); await click('Close settings');
  await click('Open sessions and projects'); await click('Terminal controls');
  await until(() => !!document.querySelector('textarea'));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('openherdr.pending.v1:' + server) ?? 'null')).toEqual(pending);
  expect(document.body.textContent).toContain('owned-pending-request'); expect(rejectedRequests).toEqual([]);
});
