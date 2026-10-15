import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { writeFile } from 'node:fs/promises';
import type { MobileSessionsSearchResultsViewProps } from './MobileSessionsSearchResultsView';

const dom = new Window({ url: 'https://session-search-view.test', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Text: dom.Text,
  HTMLInputElement: dom.HTMLInputElement, HTMLButtonElement: dom.HTMLButtonElement,
  customElements: dom.customElements, SVGElement: dom.SVGElement, DOMParser: dom.DOMParser,
  Event: dom.Event, MouseEvent: dom.MouseEvent, KeyboardEvent: dom.KeyboardEvent, PointerEvent: dom.PointerEvent, CustomEvent: dom.CustomEvent,
  MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const savedFetch = globalThis.fetch;
const requests: { method: string; path: string }[] = [];
const unexpected: string[] = [];
// Original startup reads stay failed; the fixture supplies its existing session snapshot.
const unavailableReads = new Set([
  'GET /api/location', 'GET /api/config', 'GET /api/project', 'GET /api/session',
  'GET /api/session/active', 'GET /api/form', 'GET /api/guests', 'GET /api/version',
  'GET /api/permission-auto-accept', 'GET /api/message-queue', 'GET /api/permission/request',
  'GET /api/vcs', 'GET /api/shell', 'GET /api/session/root-older/message',
  'GET /api/model', 'GET /api/model/default', 'GET /api/agent',
  'POST /auth/url-token', 'POST /api/git/projects',
]);
globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  requests.push({ method, path: url.pathname });
  if (url.pathname === '/api/fs/home' && method === 'GET') return Response.json({ home: '/search-fixture' });
  if (url.pathname === '/api/session-folders' && method === 'GET') return Response.json({ exists: false });
  if (url.pathname === '/api/config/themes' && method === 'GET') return Response.json({ themes: [] });
  if (url.pathname === '/api/config/settings' && method === 'GET') return Response.json({ homeDirectory: '/search-fixture', fontSize: 100, useSystemTheme: true });
  if (url.pathname === '/api/config/settings' && method === 'PUT') {
    expect(JSON.parse(String(init?.body))).toEqual({ homeDirectory: '/search-fixture' });
    return Response.json({ homeDirectory: '/search-fixture' });
  }
  if (!unavailableReads.has(method + ' ' + url.pathname)) unexpected.push(method + ' ' + url.pathname);
  return Response.json({ error: 'Unavailable fixture route' }, { status: 503 });
}, savedFetch);
const { MobileSessionsSearchResultsView } = await import('./MobileSessionsSearchResultsView');
const { MobileSessionRowView } = await import('./MobileSessionRowView');
const { createRoot } = await import('react-dom/client');
afterAll(async () => {
  globalThis.fetch = savedFetch;
  await writeFile(new URL('../../../../.tmp/window-search-original-requests.json', import.meta.url), JSON.stringify({ requests, unexpected }, null, 2));
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('source-neutral search keeps original section/card geometry, count/order and caller-owned row controls', async () => {
  expect(requests).toEqual([]);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const selected: string[] = []; let creates = 0;
  const sections: MobileSessionsSearchResultsViewProps['sections'] = [
    { id: 'empty', label: 'Hidden group', count: 0, rows: <button>Hidden row</button> },
    { id: 'panes', label: 'Windows', count: 2, rows: <><div><MobileSessionRowView title="Monitor" contextLabel="WSL · Research" active indent={12} onSelect={() => selected.push('pane-1')} /></div><div className="border-t border-border/70"><MobileSessionRowView title="Worker" active={false} indent={12} onSelect={() => selected.push('pane-2')} /></div></> },
    { id: 'projects', label: 'Projects', count: 1, rows: <div className="flex items-center"><button onClick={() => selected.push('project')}>Research</button><button onClick={() => { creates++; }}>Create</button></div> },
  ];
  try {
    await act(async () => root.render(<MobileSessionsSearchResultsView sections={sections} />));
    expect(host.firstElementChild?.className).toBe('flex flex-col gap-3 px-3 pt-2');
    const groups = host.querySelectorAll('section'); expect(groups.length).toBe(2);
    expect(groups[0].firstElementChild?.className).toBe('flex items-center justify-between px-1 pb-1.5');
    expect(groups[0].firstElementChild?.textContent).toBe('Windows2');
    expect(groups[1].firstElementChild?.textContent).toBe('Projects1');
    const card = groups[0].lastElementChild;
    expect(card?.className).toBe('overflow-hidden rounded-2xl border border-border/70 bg-[var(--surface-elevated)]');
    expect(card?.children.length).toBe(2);
    expect(card?.children[1].className).toBe('border-t border-border/70');
    const buttons = host.querySelectorAll('button');
    await act(async () => buttons[1].click()); await act(async () => buttons[3].click());
    expect(selected).toEqual(['pane-2']); expect(creates).toBe(1); expect(requests).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('original sheet submits search, excludes subsessions, keeps live/unread ownership and selects its real session', async () => {
  const { OpenCode } = await import('@opencode/client');
  const { MobileSessionsSheet } = await import('./MobileSessionsSheet');
  const { I18nProvider } = await import('@/lib/i18n');
  const { SyncProvider } = await import('@/sync/sync-context');
  const { RuntimeAPIProvider } = await import('@/contexts/RuntimeAPIProvider');
  const { ThemeSystemProvider } = await import('@/contexts/ThemeSystemContext');
  const { createWebAPIs } = await import('../../../web/src/api');
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  const { useProjectsStore } = await import('@/stores/useProjectsStore');
  const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useGlobalSessionStatusStore, replaceGlobalSessionStatusById } = await import('@/sync/global-session-status');
  const { useNotificationStore } = await import('@/sync/notification-store');
  const { useSessionDisplayStore } = await import('@/stores/useSessionDisplayStore');
  const { useMobileSessionTreeStore } = await import('@/stores/useMobileSessionTreeStore');
  const originals = { global: useGlobalSessionsStore.getState(), projects: useProjectsStore.getState(), directory: useDirectoryStore.getState(), ui: useSessionUIStore.getState(), status: useGlobalSessionStatusStore.getState(), notifications: useNotificationStore.getState(), display: useSessionDisplayStore.getState(), tree: useMobileSessionTreeStore.getState() };
  const sessions: import('@/lib/opencode/model').Session[] = [
    { id: 'root-older', projectID: 'fixture-project', directory: '/search-fixture', title: 'Needle older', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 100, updated: 100 } },
    { id: 'root-newer', projectID: 'fixture-project', directory: '/search-fixture', title: 'Needle newer', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 200, updated: 200 } },
    { id: 'hidden-child', parentID: 'root-newer', projectID: 'fixture-project', directory: '/search-fixture', title: 'Needle child', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 300, updated: 300 } },
  ];
  useGlobalSessionsStore.getState().applySnapshot(sessions, []);
  useProjectsStore.setState({ projects: [{ id: 'fixture-project', path: '/search-fixture', label: 'Search fixture' }], activeProjectId: 'fixture-project' });
  useDirectoryStore.setState({ currentDirectory: '/search-fixture' });
  useSessionUIStore.setState({ currentSessionId: null, currentSessionDirectory: null, availableWorktreesByProject: new Map() });
  useSessionDisplayStore.setState({ sidebarViewMode: 'projects', showPinnedSection: false, showWorkSection: false });
  replaceGlobalSessionStatusById(new Map());
  const index = useNotificationStore.getState().index;
  useNotificationStore.setState({ index: { ...index, session: { unseenCount: { 'root-newer': 1 }, unseenHasError: {} } } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const closes: boolean[] = [];
  // Existing sync tests keep bootstrap pending while their actual stores own the fixture.
  const sdk = OpenCode.make({ baseUrl: 'https://original-search-sdk.test', fetch: () => new Promise<Response>(() => undefined) });
  try {
    await act(async () => root.render(<RuntimeAPIProvider apis={createWebAPIs()}><ThemeSystemProvider><I18nProvider><SyncProvider sdk={sdk} directory="/search-fixture"><MobileSessionsSheet open variant="sidebar" onOpenChange={value => closes.push(value)} /></SyncProvider></I18nProvider></ThemeSystemProvider></RuntimeAPIProvider>));
    const input = host.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('Original session search input missing: ' + host.textContent);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set?.call(input, 'Needle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('section .rounded-2xl')).toBeNull();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const searchSection = [...host.querySelectorAll('section')].find(section => section.firstElementChild?.textContent === 'Sessions2');
    if (!searchSection) throw new Error('Original search session result section missing: ' + host.textContent);
    const rows = searchSection.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Needle newer');
    expect(rows[0].textContent).toContain('Search fixture');
    expect(searchSection.textContent).not.toContain('Needle child');
    expect(searchSection.querySelector('[data-session-activity-indicator="unread"]')).not.toBeNull();
    await act(async () => replaceGlobalSessionStatusById(new Map([['root-newer', { status: { type: 'busy' }, directory: '/search-fixture' }]])));
    expect(searchSection.querySelector('[data-session-activity-indicator="running"]')).not.toBeNull();
    expect(searchSection.querySelector('[data-session-activity-indicator="unread"]')).toBeNull();
    await act(async () => replaceGlobalSessionStatusById(new Map()));
    expect(searchSection.querySelector('[data-session-activity-indicator="unread"]')).not.toBeNull();
    await act(async () => rows[1].click());
    expect(useSessionUIStore.getState().currentSessionId).toBe('root-older');
    expect(useProjectsStore.getState().activeProjectId).toBe('fixture-project');
    expect(closes).toEqual([false]);
    expect(searchSection.querySelector('[data-active-session="true"]')?.textContent).toContain('Needle older');
    expect(unexpected).toEqual([]);
  } finally {
    await act(async () => root.unmount()); host.remove();
    useGlobalSessionsStore.setState(originals.global, true); useProjectsStore.setState(originals.projects, true); useDirectoryStore.setState(originals.directory, true);
    useSessionUIStore.setState(originals.ui, true); useGlobalSessionStatusStore.setState(originals.status, true); useNotificationStore.setState(originals.notifications, true); useSessionDisplayStore.setState(originals.display, true); useMobileSessionTreeStore.setState(originals.tree, true);
  }
});
