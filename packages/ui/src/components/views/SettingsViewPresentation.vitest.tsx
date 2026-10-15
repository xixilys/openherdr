import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { SettingsPageSlug, SettingsRuntimeContext } from '@/lib/settings/metadata';
import { buildSettingsSearchResults, type SettingsSearchItem, type SettingsSearchResult } from '@/lib/settings/search-index';
import type { SettingsViewPresentationProps } from './SettingsViewPresentation';

let dom: Window; let host: HTMLDivElement; let tree: Root; let restore: () => void;
let View: typeof import('./SettingsViewPresentation')['SettingsViewPresentation'];
let I18n: typeof import('@/lib/i18n')['I18nProvider'];
let page: SettingsPageSlug; let mobile: boolean; let closeCalls: number; let prepared: string[]; let requests: string[];
let back: (() => boolean) | null; let jump: SettingsViewPresentationProps['jumpRequest']; let jumpConsumed: number;
let paint: () => void;
let historyBackCalls: number;
let nestedSurface: boolean;
let Surface: typeof import('@/apps/MobileFullscreenSurface')['MobileFullscreenSurface'];
const runtime: SettingsRuntimeContext = { isVSCode: false, isDesktop: false, isWeb: true, isMobile: true, routingAvailable: false, enterpriseMode: false, jevBlockedByEnterprise: false };
const items: readonly SettingsSearchItem[] = [
  { id: 'appearance.light-theme', page: 'appearance', titleKey: 'settings.openchamber.visual.field.lightTheme', keywords: ['fixture'] },
  { id: 'appearance.dark-theme', page: 'appearance', titleKey: 'settings.openchamber.visual.field.darkTheme', keywords: ['fixture'] },
  { id: 'agents.create', page: 'agents', titleKey: 'settings.page.agents.title', keywords: ['new fixture'] },
];
const changePage = (next: SettingsPageSlug) => { page = next; paint(); };
const register = (handler: (() => boolean) | null) => { back = handler; };
const prepare = (result: SettingsSearchResult) => { prepared.push(result.id); return result.id === 'agents.create' ? 'agents.name' : result.id; };
const renderPageContent = (slug: SettingsPageSlug) => <div><h1 data-settings-page-heading tabIndex={-1}>{slug} content</h1>{['appearance.light-theme', 'appearance.dark-theme', 'agents.name'].map(id => <section key={id} data-settings-item={id}><label>{id}<input aria-label={id} /></label></section>)}</div>;
const renderPageSidebar = (_slug: SettingsPageSlug, options: { onItemSelect?: () => void }) => <button onClick={options.onItemSelect}>Select existing item</button>;
beforeEach(async () => {
  dom = new Window({ url: 'https://settings-fixture.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLButtonElement: dom.HTMLButtonElement, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, CustomEvent: dom.CustomEvent, PopStateEvent: dom.PopStateEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const originalFetch = globalThis.fetch; requests = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => { requests.push(String(input)); throw new Error('Presentation must not initialize a runtime'); }, originalFetch);
  restore = () => { globalThis.fetch = originalFetch; for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  ({ SettingsViewPresentation: View } = await import('./SettingsViewPresentation'));
  ({ I18nProvider: I18n } = await import('@/lib/i18n'));
  ({ MobileFullscreenSurface: Surface } = await import('@/apps/MobileFullscreenSurface'));
  const { formatMessage } = await import('@/lib/i18n/store'); const { dict: dictionary } = await import('@/lib/i18n/messages/en');
  const buildResults: SettingsViewPresentationProps['buildSearchResults'] = (query, getPageTitle) => buildSettingsSearchResults({ query, items, runtimeCtx: { ...runtime, isMobile: mobile, isDesktopLocalOrigin: false, isMac: false, isWindows: false, isLinux: false }, t: key => formatMessage(dictionary, key), getPageTitle });
  historyBackCalls = 0; const originalBack = window.history.back.bind(window.history); window.history.back = () => { historyBackCalls++; originalBack(); };
  nestedSurface = false; page = 'appearance'; mobile = true; closeCalls = 0; prepared = []; back = null; jump = null; jumpConsumed = 0;
  const { createRoot } = await import('react-dom/client'); host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
  paint = () => { const content = <View page={page} onPageChange={changePage} runtimeCtx={{ ...runtime, isMobile: mobile }} visiblePageSlugs={['appearance', 'chat', 'agents']}
    buildSearchResults={buildResults} prepareSearchTarget={prepare} renderPageContent={renderPageContent} renderPageSidebar={renderPageSidebar}
    onClose={() => { closeCalls++; }} registerBackHandler={register} jumpRequest={jump} onJumpRequestConsumed={() => { jumpConsumed++; jump = null; paint(); }} />;
    tree.render(<I18n>{nestedSurface ? <Surface open headerless onClose={() => { closeCalls++; }}>{content}</Surface> : content}</I18n>);
  };
});
afterEach(async () => { await act(async () => tree.unmount()); await dom.happyDOM.close(); try { expect(requests).toEqual([]); expect(back).toBeNull(); } finally { restore(); } });
const render = () => act(async () => paint());
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
const click = async (label: string) => { const node = button(label); if (!node) throw new Error('Missing Settings action ' + label); await act(async () => node.click()); };
const pause = (ms = 40) => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
const searchInput = () => { const node = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]'); if (!node) throw new Error('Missing original search input'); return node; };
const query = async (value: string) => act(async () => {
  const input = searchInput(); const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
});
const key = (key: string, ctrlKey = false) => act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })));

test('mobile starts at original root navigation, consumes inner Back and delegates root close', async () => {
  await render(); expect(host.textContent).toContain('Settings'); expect(host.textContent).not.toContain('appearance content');
  expect(back?.()).toBe(false); expect(button('Appearance')?.getAttribute('aria-current')).toBeNull();
  await click('Appearance'); expect(host.textContent).toContain('appearance content');
  await act(async () => { expect(back?.()).toBe(true); }); expect(host.textContent).not.toContain('appearance content');
  expect(back?.()).toBe(false); await click('Close settings'); expect(closeCalls).toBe(1); expect(page).toBe('appearance');
});

test('split pages preserve mobile sidebar, focused detail, native Back and history ladder', async () => {
  await render(); await click('Agents'); expect(host.textContent).toContain('Select existing item'); expect(host.textContent).not.toContain('agents content');
  await click('Select existing item'); await pause(); expect(host.textContent).toContain('agents content');
  expect(document.activeElement?.getAttribute('data-settings-page-heading')).not.toBeNull();
  expect(window.history.state?.__openchamberSettingsDetail).toEqual({ page: 'agents', stage: 'page-content' });
  await act(async () => { expect(back?.()).toBe(true); }); expect(historyBackCalls).toBe(1);
  // Happy DOM does not traverse session history. Deliver the browser's prior
  // entry event to verify the original popstate branch separately.
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
  expect(host.textContent).toContain('Select existing item'); expect(host.textContent).not.toContain('agents content');
  await act(async () => { expect(back?.()).toBe(true); }); expect(host.textContent).not.toContain('Select existing item'); expect(back?.()).toBe(false);
});

test('desktop uses the original persistent navigation and 280px split sidebar', async () => {
  mobile = false; page = 'agents'; await render();
  expect(button('Appearance')).not.toBe(undefined); expect(host.textContent).toContain('Select existing item'); expect(host.textContent).toContain('agents content');
  expect(host.querySelector<HTMLElement>('[style*="280px"]')?.style.width).toBe('280px'); expect(back?.()).toBe(false);
});

test('search preserves item order, arrow and Ctrl navigation, owner preparation and exact highlight', async () => {
  await render(); await query('fixture');
  const light = button('Light theme'); const dark = button('Dark theme'); expect(light).not.toBe(undefined); expect(dark).not.toBe(undefined);
  expect(light?.className).toContain('bg-interactive-selection');
  await key('n', true); expect(dark?.className).toContain('bg-interactive-selection');
  await key('p', true); expect(light?.className).toContain('bg-interactive-selection');
  await key('ArrowDown'); await key('Enter'); await pause();
  expect(prepared).toEqual(['appearance.dark-theme']); expect(host.querySelector('[data-settings-item="appearance.dark-theme"]')?.getAttribute('data-settings-search-highlight')).toBe('true');
  expect(document.activeElement).toBe(host.querySelector('[data-settings-item="appearance.dark-theme"]'));
  expect(host.textContent).toContain('appearance content');
});

test('search clear and Escape restore the original grouped navigation without changing page', async () => {
  await render(); await query('unavailable fixture'); expect(host.textContent).toContain('No matching settings');
  await key('Escape'); expect(searchInput().value).toBe(''); expect(button('Appearance')).not.toBe(undefined); expect(page).toBe('appearance');
  await query('fixture'); await click('Clear settings search'); expect(searchInput().value).toBe(''); expect(prepared).toEqual([]);
});

test('search into a split page prepares its domain target and opens content directly', async () => {
  await render(); await query('new fixture'); await key('Enter'); await pause();
  expect(page).toBe('agents'); expect(prepared).toEqual(['agents.create']); expect(host.textContent).toContain('agents content');
  expect(host.querySelector('[data-settings-item="agents.name"]')?.getAttribute('data-settings-search-highlight')).toBe('true');
});

test('an owner-provided Settings jump is consumed once and uses the same page/highlight path', async () => {
  jump = { page: 'chat', itemId: 'appearance.light-theme' }; await render(); await pause();
  expect(jumpConsumed).toBe(1); expect(page).toBe('chat'); expect(host.textContent).toContain('chat content');
  expect(host.querySelector('[data-settings-item="appearance.light-theme"]')?.getAttribute('data-settings-search-highlight')).toBe('true');
});


test('composing Escape and Enter leave search intact, while consumed Escape cannot close its outer surface', async () => {
  let outerEscapes = 0;
  const closeSurface = (event: KeyboardEvent) => { if (event.key === 'Escape') outerEscapes++; };
  document.addEventListener('keydown', closeSurface);
  try {
    nestedSurface = true; await render(); await pause(350); await query('fixture');
    await act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    expect(prepared).toEqual([]); expect(searchInput().value).toBe('fixture');
    await act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })));
    expect(searchInput().value).toBe('fixture'); expect(outerEscapes).toBe(0); expect(closeCalls).toBe(0);
    outerEscapes = 0;
    await key('Escape'); expect(searchInput().value).toBe(''); expect(outerEscapes).toBe(0); expect(closeCalls).toBe(0);
    await key('Escape'); expect(closeCalls).toBe(1);
  } finally { document.removeEventListener('keydown', closeSurface); }
});
