import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { MobileSessionSwitcherViewProps } from './MobileSessionSwitcherView';
import type { Session } from '@/lib/opencode/model';

const dom = new Window({ url: 'https://mobile-switcher.test' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Text: dom.Text,
  Event: dom.Event, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent, DOMRect: dom.DOMRect,
  MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
dom.innerWidth = 390;
dom.innerHeight = 844;
const savedFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
  calls.push(input instanceof Request ? input.url : String(input));
  return Response.json({ error: 'Unexpected network request' }, { status: 503 });
}, savedFetch);
const { MobileSessionSwitcherView } = await import('./MobileSessionSwitcherView');
const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
const { closeTopmostBackLayer, registerBackLayer } = await import('@/lib/mobileBackLayers');
const { createRoot } = await import('react-dom/client');

afterAll(async () => {
  globalThis.fetch = savedFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function mount(extra: Partial<MobileSessionSwitcherViewProps> = {}) {
  const host = document.createElement('div');
  const anchor = document.createElement('button');
  document.body.append(anchor, host);
  const root = createRoot(host);
  const closed: boolean[] = [];
  const selected: string[] = [];
  const props: MobileSessionSwitcherViewProps = {
    open: true, onClose: () => closed.push(true), anchorRef: { current: anchor },
    rows: [{ id: 'one', title: 'First conversation', subtitle: 'Project · branch', activity: 'idle' }, { id: 'two', title: 'Other conversation', activity: 'unknown' }],
    selectedId: 'one', onSelect: (id) => selected.push(id), ...extra,
  };
  const render = () => act(async () => root.render(<I18nProvider><MobileSessionSwitcherView {...props} /></I18nProvider>));
  await render();
  return { host, anchor, root, props, closed, selected, render, async dispose() { await act(async () => root.unmount()); host.remove(); anchor.remove(); } };
}

test('pure import and phone rendering start no legacy I/O and keep original row geometry', async () => {
  expect(calls).toEqual([]);
  const fixture = await mount();
  try {
    expect(calls).toEqual([]);
    const panel = fixture.host.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel?.classList.contains('rounded-[20px]')).toBe(true);
    expect(panel?.classList.contains('mx-3')).toBe(true);
    expect(panel?.classList.contains('mt-2')).toBe(true);
    expect(panel?.style.animation).toContain('session-switcher-in');
    expect(panel?.style.maxHeight).toContain('72dvh');
    const rows = fixture.host.querySelectorAll('button');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    expect(rows[0].classList.contains('px-2.5')).toBe(true);
    expect(rows[0].textContent).toContain('Project · branch');
    expect(rows[0].querySelector('[data-session-activity-indicator]')).toBeNull();
    expect(rows[1].querySelector('[data-session-activity-indicator="unknown"]')?.textContent).toBe('Unknown');
    await act(async () => rows[1].click());
    expect(fixture.selected).toEqual(['two']);
    expect(fixture.closed.length).toBe(1);
  } finally { await fixture.dispose(); }
});

test('outside, Escape and Android Back close the popup while the title anchor and newer layers remain independent', async () => {
  const fixture = await mount();
  try {
    fixture.anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.host.querySelector('[role="dialog"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(fixture.closed.length).toBe(0);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(fixture.closed.length).toBe(1);
    const other: string[] = [];
    const unregister = registerBackLayer(() => other.push('nested'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.closed.length).toBe(1);
    expect(closeTopmostBackLayer()).toBe(true);
    expect(other).toEqual(['nested']);
    unregister();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.closed.length).toBe(2);
    expect(closeTopmostBackLayer()).toBe(true);
    expect(fixture.closed.length).toBe(3);
  } finally { await fixture.dispose(); }
  expect(closeTopmostBackLayer()).toBe(false);
});

test('creation respects ownership disablement, footer actions are outside rows and the exit retains content for 140 ms', async () => {
  let creates = 0;
  let more = 0;
  const fixture = await mount({ rows: [], onCreate: () => { creates++; }, createDisabled: true, footer: <button type="button" onClick={() => { more++; }}>More history</button> });
  try {
    expect(fixture.host.textContent).toContain('No recent sessions');
    const create = Array.from(fixture.host.querySelectorAll('button')).find((button) => button.textContent?.includes('New session'));
    if (!create) throw new Error('Create button missing');
    await act(async () => create.click());
    expect(creates).toBe(0);
    fixture.props.createDisabled = false;
    await fixture.render();
    await act(async () => create.click());
    expect(creates).toBe(1);
    expect(fixture.closed.length).toBe(1);
    const footer = Array.from(fixture.host.querySelectorAll('button')).find((button) => button.textContent === 'More history');
    if (!footer) throw new Error('History footer missing');
    await act(async () => footer.click());
    expect(more).toBe(1);
    expect(footer.parentElement?.getAttribute('role')).toBe('dialog');
    fixture.props.open = false;
    await fixture.render();
    expect(fixture.host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.host.querySelector<HTMLElement>('[role="dialog"]')?.style.animation).toContain('140ms');
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 170)); });
    expect(fixture.host.querySelector('[role="dialog"]')).toBeNull();
  } finally { await fixture.dispose(); }
});

test('tablet anchoring uses the original 380 px physical bounds in both language directions', async () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalLocale = useI18nStore.getState().locale;
  dom.innerWidth = 1200;
  dom.innerHeight = 800;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'BUTTON' && !this.parentElement?.closest('[role="dialog"]')) return new DOMRect(650, 0, 80, 40);
    if (this.classList.contains('fixed')) return new DOMRect(100, 0, 700, 800);
    return originalRect.call(this);
  };
  try {
    for (const locale of ['en', 'ar'] as const) {
      await act(async () => useI18nStore.getState().setLocale(locale));
      const fixture = await mount({ rows: [{ id: 'one', title: 'عنوان محادثة', activity: 'running' }] });
      try {
        const panel = fixture.host.querySelector<HTMLElement>('[role="dialog"]');
        expect(panel?.style.left).toBe('312px');
        expect(panel?.classList.contains('absolute')).toBe(true);
        expect(fixture.host.querySelector('[data-session-activity-indicator="running"]')).not.toBeNull();
        expect(fixture.host.querySelector('span[dir="auto"]')).not.toBeNull();
        expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      } finally { await fixture.dispose(); }
    }
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    dom.innerWidth = 390;
    dom.innerHeight = 844;
    await act(async () => useI18nStore.getState().setLocale(originalLocale));
  }
});

test('the original OpenCode wrapper keeps recent limits, project selection and closing rows', async () => {
  const { MobileSessionSwitcher } = await import('./MobileSessionSwitcher');
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  const { useProjectsStore } = await import('@/stores/useProjectsStore');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useSessionOrderingStore } = await import('@/sync/session-ordering');
  const globalState = useGlobalSessionsStore.getState();
  const projectState = useProjectsStore.getState();
  const sessionState = useSessionUIStore.getState();
  const orderingState = useSessionOrderingStore.getState();
  const sessions: Session[] = Array.from({ length: 12 }, (_, index) => ({
    id: `fixture-session-${index}`, projectID: 'fixture-project', directory: '/fixture/project', title: `Fixture ${index}`,
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: index + 1, updated: index + 1 },
  }));
  let refreshes = 0;
  useSessionOrderingStore.setState({ rankById: new Map() });
  useGlobalSessionsStore.getState().applySnapshot(sessions, []);
  useGlobalSessionsStore.setState({ loadSessions: async () => { refreshes++; return { activeSessions: sessions, archivedSessions: [] }; } });
  useProjectsStore.setState({ projects: [{ id: 'fixture-project', path: '/fixture/project', label: 'Fixture project' }], activeProjectId: null });
  useSessionUIStore.setState({ currentSessionId: null, currentSessionDirectory: null });
  const host = document.createElement('div');
  const anchor = document.createElement('button');
  document.body.append(anchor, host);
  const root = createRoot(host);
  let open = true;
  let closes = 0;
  const render = () => act(async () => root.render(<I18nProvider><MobileSessionSwitcher open={open} onClose={() => { closes++; }} anchorRef={{ current: anchor }} /></I18nProvider>));
  try {
    await render();
    expect(refreshes).toBeGreaterThan(0);
    const rows = host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    expect(rows.length).toBe(10);
    expect(rows[0].textContent).toContain('Fixture 11');
    expect(rows[0].textContent).toContain('Fixture project');
    await act(async () => rows[0].click());
    expect(useProjectsStore.getState().activeProjectId).toBe('fixture-project');
    expect(useSessionUIStore.getState().currentSessionId).toBe('fixture-session-11');
    expect(closes).toBe(1);
    open = false;
    await render();
    expect(host.querySelectorAll('[role="dialog"] button').length).toBe(10);
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 170)); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    useSessionUIStore.getState().setCurrentSession(null);
    useGlobalSessionsStore.setState(globalState, true);
    useProjectsStore.setState(projectState, true);
    useSessionUIStore.setState(sessionState, true);
    useSessionOrderingStore.setState(orderingState, true);
    host.remove(); anchor.remove();
  }
});
