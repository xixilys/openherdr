import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';
import type { SkillInfo, SkillAutocompleteHandle } from './SkillAutocompleteView';

let dom: Window;
let root: Root;
let host: HTMLDivElement;
let restore: () => void;
let render: () => Promise<void>;
let rows: SkillInfo[];
let query: string;
let mobile: boolean;
let status: React.ReactNode;
let selected: string[];
let closed: number;
let requests: string[];
const handle = React.createRef<SkillAutocompleteHandle>();
const candidates = () => [...host.querySelectorAll<HTMLElement>('[data-skill-autocomplete] .cursor-pointer')];

beforeEach(async () => {
  dom = new Window({ url: 'https://skill-view.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Event: dom.Event, MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  requests = []; const savedFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => { requests.push(String(input)); throw new Error('A skill view cannot load a runtime'); }, savedFetch);
  restore = () => { globalThis.fetch = savedFetch; for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { SkillAutocompleteView } = await import('./SkillAutocompleteView');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  rows = []; query = ''; mobile = true; status = undefined; selected = []; closed = 0;
  render = () => act(async () => root.render(<I18nProvider><SkillAutocompleteView ref={handle} skills={rows} searchQuery={query} isMobile={mobile}
    status={status} onSkillSelect={name => { selected.push(name); }} onClose={() => { closed++; }} /></I18nProvider>));
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); try { expect(requests).toEqual([]); } finally { restore(); } });

test('the standalone native view preserves original rows and hides unavailable badges', async () => {
  rows = [{ id: 'native-z', name: 'zeta' }, { id: 'native-a', name: 'alpha', description: 'Actual description' }];
  await render();
  expect(candidates().map(row => row.textContent)).toEqual(['alpha', 'zeta']);
  expect(candidates()[0]?.classList.contains('py-1.5')).toBe(true);
  expect(candidates()[0]?.classList.contains('items-center')).toBe(true);
  expect(host.querySelector('[data-skill-autocomplete]')?.classList.contains('inset-s-0')).toBe(true);
  expect(host.querySelector('[data-skill-autocomplete]')?.classList.contains('max-h-60')).toBe(true);
  expect(host.textContent).not.toContain('navigate');
});

test('actual project/user/source badges retain original ranking and desktop hints', async () => {
  mobile = false;
  rows = [{ name: 'alpha', scope: 'user', source: 'opencode' }, { name: 'zeta', scope: 'project', source: 'agents' }];
  await render();
  expect(candidates().map(row => row.textContent)).toEqual(['zetaprojectagents', 'alphauseropencode']);
  expect(candidates()[0]?.classList.contains('items-start')).toBe(true);
  expect(host.textContent).toContain('↑↓ navigate • Enter select • Esc close');
  query = 'alpha'; await render();
  expect(candidates().map(row => row.textContent)).toEqual(['alphauseropencode']);
});

test('selection wraps, filtering resets it and Escape/outside clicks close', async () => {
  rows = [{ name: 'alpha' }, { name: 'zeta' }]; await render();
  await act(async () => handle.current?.handleKeyDown('ArrowUp'));
  await act(async () => handle.current?.handleKeyDown('Enter'));
  expect(selected).toEqual(['zeta']);
  query = 'al'; await render();
  await act(async () => handle.current?.handleKeyDown('Tab'));
  expect(selected).toEqual(['zeta', 'alpha']);
  await act(async () => handle.current?.handleKeyDown('Escape'));
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(closed).toBe(2);
});

test('touch taps select once and preserve the focused editor; scrolling does not select', async () => {
  rows = [{ name: 'audit' }]; await render();
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  const row = candidates()[0]; if (!row) throw new Error('Missing skill candidate');
  const pointer = (type: string, y: number) => row.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: 10, clientY: y, bubbles: true, cancelable: true }));
  await act(async () => { pointer('pointerdown', 10); pointer('pointerup', 10); row.click(); });
  expect(selected).toEqual(['audit']); expect(document.activeElement).toBe(input);
  await act(async () => { pointer('pointerdown', 10); pointer('pointermove', 35); pointer('pointerup', 35); });
  expect(selected).toEqual(['audit']);
});

test('loading/errors remain distinct from a successful empty registry', async () => {
  expect(host.textContent).toContain('No skills found');
  status = <p role="status">Actual loading</p>; await render();
  expect(host.textContent).not.toContain('No skills found'); expect(host.querySelector('[role="status"]')?.textContent).toBe('Actual loading');
  status = <p role="alert">Native registry failed</p>; await render();
  expect(host.textContent).not.toContain('No skills found'); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Native registry failed');
  status = undefined; await render(); expect(host.textContent).toContain('No skills found');
});
