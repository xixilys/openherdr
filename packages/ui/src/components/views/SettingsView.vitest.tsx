import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID } from '@/lib/theme/themes';
import { DEFAULT_UI_FONT, DEFAULT_MONO_FONT } from '@/lib/fontOptions';
import type { RuntimeAPIs } from '@/lib/api/types';
import type { DesktopSettings } from '@/lib/desktop';

let dom: Window; let host: HTMLDivElement; let tree: Root; let restore: () => void;
let SettingsView: typeof import('./SettingsView')['SettingsView'];
let ThemeProvider: typeof import('@/contexts/ThemeSystemContext')['ThemeSystemProvider'];
let RuntimeProvider: typeof import('@/contexts/RuntimeAPIProvider')['RuntimeAPIProvider'];
let I18n: typeof import('@/lib/i18n')['I18nProvider'];
let apis: RuntimeAPIs;
let ui: typeof import('@/stores/useUIStore')['useUIStore'];
let snippets: typeof import('@/stores/useSnippetsStore')['useSnippetsStore'];
let originalUI: ReturnType<typeof ui.getState>;
let originalSnippets: ReturnType<typeof snippets.getState>;
let directory: typeof import('@/stores/useDirectoryStore')['useDirectoryStore'];
let originalDirectory: ReturnType<typeof directory.getState>;
let back: (() => boolean) | null; let closeCalls: number;
let calls: { method: string; path: string }[]; let unexpected: string[];
type RequestRun = { calls: typeof calls; unexpected: string[] };
const requestRuns: RequestRun[] = [];
afterAll(() => writeFile(new URL('../../../../../.tmp/settings-original-wrapper-requests.json', import.meta.url), JSON.stringify(requestRuns, null, 2)));
type FixtureSettings = Pick<DesktopSettings,
  | 'pwaAppName' | 'pwaOrientation' | 'fontSize' | 'uiFont' | 'monoFont'
  | 'useSystemTheme' | 'themeId' | 'lightThemeId' | 'darkThemeId' | 'homeDirectory'>;

const settingsPatch = z.object({ themeId: z.string().optional(), lightThemeId: z.string().optional(), darkThemeId: z.string().optional(), useSystemTheme: z.boolean().optional(), homeDirectory: z.string().optional() }).strict();

beforeEach(async () => {
  dom = new Window({ url: 'https://original-settings-fixture.test', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  dom.happyDOM.setWindowSize({ width: 1200, height: 900 });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    Node: dom.Node, Text: dom.Text, NodeList: dom.NodeList, NodeFilter: dom.NodeFilter, Element: dom.Element, HTMLElement: dom.HTMLElement,
    HTMLButtonElement: dom.HTMLButtonElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLSelectElement: dom.HTMLSelectElement, HTMLVideoElement: dom.HTMLVideoElement, HTMLImageElement: dom.HTMLImageElement,
    customElements: dom.customElements, SVGElement: dom.SVGElement, DOMParser: dom.DOMParser, Range: dom.Range, XMLSerializer: dom.XMLSerializer, Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, CSSStyleSheet: dom.CSSStyleSheet, HTMLStyleElement: dom.HTMLStyleElement,
    PointerEvent: dom.PointerEvent, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, CustomEvent: dom.CustomEvent, FocusEvent: dom.FocusEvent, MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  calls = []; unexpected = []; back = null; closeCalls = 0;
  let settings: FixtureSettings = { pwaAppName: 'Original Settings fixture', pwaOrientation: 'system', fontSize: 100, uiFont: DEFAULT_UI_FONT, monoFont: DEFAULT_MONO_FONT, useSystemTheme: false, themeId: DEFAULT_LIGHT_THEME_ID, lightThemeId: DEFAULT_LIGHT_THEME_ID, darkThemeId: DEFAULT_DARK_THEME_ID, homeDirectory: '/settings-fixture' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin); const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    calls.push({ method, path: url.pathname });
    if (url.pathname === '/api/fs/home' && method === 'GET') return Response.json({ home: '/settings-fixture' });
    if (url.pathname === '/api/session-folders' && method === 'GET') return Response.json({ exists: false });
    if (url.pathname === '/api/config/themes' && method === 'GET') return Response.json({ themes: [] });
    if (url.pathname === '/api/config/settings' && method === 'GET') return Response.json(settings);
    if (url.pathname === '/api/config/settings' && method === 'PUT') {
      const body = init?.body ? String(init.body) : input instanceof Request ? await input.text() : '';
      settings = { ...settings, ...settingsPatch.parse(JSON.parse(body)) }; return Response.json(settings);
    }
    if (url.pathname === '/api/openchamber/message-search/status' && method === 'GET') return Response.json({ state: 'off', sizeBytes: 0, index: null });
    if (url.pathname === '/api/config/snippets' && method === 'GET') return Response.json([{ name: 'fixture-note', content: 'Original snippet body', aliases: [], description: 'A real owned fixture row', filePath: '/settings-fixture/snippets/fixture-note.md', source: 'global' }]);
    unexpected.push(method + ' ' + url.pathname); return Response.json({ error: 'Unexpected fixture route' }, { status: 503 });
  }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const [name] of Object.entries(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  ({ SettingsView } = await import('./SettingsView'));
  ({ ThemeSystemProvider: ThemeProvider } = await import('@/contexts/ThemeSystemContext'));
  ({ RuntimeAPIProvider: RuntimeProvider } = await import('@/contexts/RuntimeAPIProvider'));
  ({ I18nProvider: I18n } = await import('@/lib/i18n'));
  ({ useUIStore: ui } = await import('@/stores/useUIStore'));
  ({ useSnippetsStore: snippets } = await import('@/stores/useSnippetsStore'));
  ({ useDirectoryStore: directory } = await import('@/stores/useDirectoryStore'));
  originalUI = ui.getState(); originalSnippets = snippets.getState(); originalDirectory = directory.getState();
  ui.setState({ settingsPage: 'appearance', isSettingsDialogOpen: true, settingsJumpRequest: null, largeTextPasteBehavior: 'attach', messageSearchEnabled: false });
  snippets.setState({ snippets: [], selectedSnippetName: null, snippetDraft: null });
  directory.setState({ currentDirectory: '/settings-fixture' });
  const { createWebAPIs } = await import('../../../../web/src/api'); apis = createWebAPIs();
  const { createRoot } = await import('react-dom/client'); host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => {
  try { await act(async () => tree?.unmount()); await dom.happyDOM.close(); expect(unexpected).toEqual([]); expect(back).toBeNull(); }
  finally { requestRuns.push({ calls: [...calls], unexpected: [...unexpected] }); ui?.setState(originalUI, true); snippets?.setState(originalSnippets, true); directory?.setState(originalDirectory, true); restore(); }
});
const register = (handler: (() => boolean) | null) => { back = handler; };
const render = (mobile = true) => act(async () => tree.render(<RuntimeProvider apis={apis}><ThemeProvider><I18n><SettingsView forceMobile={mobile} isWindowed visiblePageSlugs={['appearance', 'chat', 'snippets']} onClose={() => { closeCalls++; }} registerBackHandler={register} /></I18n></ThemeProvider></RuntimeProvider>));
const pause = (ms = 50) => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
const until = async (predicate: () => boolean) => { for (let attempt = 0; attempt < 40 && !predicate(); attempt++) await pause(25); expect(predicate()).toBe(true); };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
const click = async (label: string) => { const node = button(label); if (!node) throw new Error('Missing original Settings action ' + label); await act(async () => node.click()); };
const anchor = (id: string) => host.querySelector<HTMLElement>(`[data-settings-item="${id}"]`);
const toggle = async (id: string) => { const control = anchor(id)?.querySelector<HTMLButtonElement>('[role="checkbox"]'); if (!control) throw new Error('Missing original checkbox ' + id); await act(async () => control.click()); };
const query = async (value: string) => act(async () => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]'); if (!input) throw new Error('Missing original search');
  const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set; setValue?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
});

test('the original mobile wrapper keeps global page ownership and mounts operational Appearance and Chat pages', async () => {
  await render(); expect(anchor('appearance.scrollbars')).toBeNull(); expect(back?.()).toBe(false);
  await click('Appearance'); await until(() => !!anchor('appearance.scrollbars')); expect(ui.getState().settingsPage).toBe('appearance');
  const before = ui.getState().alwaysShowScrollbars; await toggle('appearance.scrollbars'); expect(ui.getState().alwaysShowScrollbars).toBe(!before);
  await act(async () => { expect(back?.()).toBe(true); }); expect(anchor('appearance.scrollbars')).toBeNull();
  await click('Chat'); await until(() => !!anchor('chat.large-text-paste')); expect(ui.getState().settingsPage).toBe('chat');
  const choice = anchor('chat.large-text-paste')?.querySelector<HTMLButtonElement>('[aria-label="Large text paste: Paste inline, double-paste to attach"]');
  if (!choice) throw new Error('Missing actual original large-paste option'); await act(async () => choice.click());
  expect(ui.getState().largeTextPasteBehavior).toBe('inline-double-paste'); expect(choice.getAttribute('aria-checked')).toBe('true');
  await act(async () => { expect(back?.()).toBe(true); }); expect(back?.()).toBe(false); await click('Close settings'); expect(closeCalls).toBe(1);
});

test('the original desktop wrapper retains its selected page and consumes a page-only null-target jump', async () => {
  await render(false); await until(() => !!anchor('appearance.scrollbars'));
  expect(button('Appearance')?.getAttribute('aria-current')).toBe('page'); expect(ui.getState().settingsPage).toBe('appearance');
  await act(async () => ui.getState().requestSettingsJump('chat'));
  await until(() => !!anchor('chat.large-text-paste')); expect(ui.getState().settingsPage).toBe('chat'); expect(ui.getState().settingsJumpRequest).toBeNull();
  expect(host.querySelector('[data-settings-search-highlight]')).toBeNull();
  await render(false); expect(ui.getState().settingsPage).toBe('chat'); expect(anchor('chat.large-text-paste')).not.toBeNull();
});

test('original split sidebar dispatch and search preparation use the real Snippets owner without creating a server resource', async () => {
  await render(); await click('Snippets'); await until(() => [...host.querySelectorAll('button')].some(node => node.textContent?.includes('#fixture-note')));
  expect(calls.some(call => call.path === '/api/config/snippets' && call.method === 'GET')).toBe(true); expect(ui.getState().settingsPage).toBe('snippets');
  const row = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes('#fixture-note'));
  if (!row) throw new Error('Missing real snippet sidebar row'); await act(async () => row.click());
  await until(() => !!host.querySelector('textarea')); expect(snippets.getState().selectedSnippetName).toBe('fixture-note');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Original snippet body');
  await act(async () => ui.getState().requestSettingsJump('snippets', 'snippets.content')); await pause();
  expect(anchor('snippets.content')?.getAttribute('data-settings-search-highlight')).toBe('true'); expect(ui.getState().settingsJumpRequest).toBeNull();
  await act(async () => { window.history.replaceState({}, '', window.location.href); expect(back?.()).toBe(true); });
  await act(async () => { expect(back?.()).toBe(true); }); await query('new snippet');
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === 'Create snippet');
  if (!result) throw new Error('Missing original snippet search result'); await act(async () => result.click()); await pause();
  expect(snippets.getState().snippetDraft?.name).toBe('new-snippet'); expect(snippets.getState().selectedSnippetName).toBe('new-snippet');
  expect(anchor('snippets.content')?.getAttribute('data-settings-search-highlight')).toBe('true');
  expect(calls.filter(call => call.path.startsWith('/api/config/snippets') && call.method !== 'GET')).toEqual([]);
});
