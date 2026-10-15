import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { MobileInstancesListViewProps } from './MobileInstancesListView';

const dom = new Window({ url: 'https://instances-view.test' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Text: dom.Text,
  Event: dom.Event, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent,
  HTMLInputElement: dom.HTMLInputElement, MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
  requests.push(input instanceof Request ? input.url : String(input));
  return Response.json({}, { status: 503 });
}, originalFetch);
const { MobileInstancesListView } = await import('./MobileInstancesListView');
const { I18nProvider } = await import('@/lib/i18n');
const { createRoot } = await import('react-dom/client');

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const findButton = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  if (!found) throw new Error(`Missing original instance action ${label}`);
  return found;
};
const tap = async (host: HTMLElement, label: string) => { await act(async () => findButton(host, label).click()); };
const selectButton = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.querySelector('[dir="auto"]')?.textContent === label);
  if (!found) throw new Error(`Missing original instance row ${label}`);
  return found;
};
const mount = async (overrides: Partial<MobileInstancesListViewProps> = {}) => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const calls: string[] = [];
  const props: MobileInstancesListViewProps = {
    rows: [{ id: 'active', label: 'Active host', status: 'Connected directly', active: true, connecting: false }, { id: 'remote', label: 'خادم بعيد', status: 'https://remote.test', active: false, connecting: false, canEdit: true }],
    busy: false, confirmingDeleteId: null,
    onSelect: id => calls.push(`select:${id}`), onEdit: id => calls.push(`edit:${id}`),
    onToggleDelete: id => { calls.push(`toggle:${id}`); props.confirmingDeleteId = props.confirmingDeleteId === id ? null : id; },
    onConfirmDelete: id => calls.push(`delete:${id}`), ...overrides,
  };
  const render = async () => { await act(async () => root.render(<I18nProvider><MobileInstancesListView {...props} /></I18nProvider>)); };
  await render();
  return { host, props, calls, render, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
};

test('the source-free instance list keeps original geometry, factual status and active-row behavior without runtime bootstrap', async () => {
  expect(requests).toEqual([]);
  const fixture = await mount();
  try {
    const card = fixture.host.firstElementChild;
    expect(card?.className).toBe('overflow-hidden rounded-[18px] border border-border/70 bg-surface-elevated');
    expect(card?.children).toHaveLength(2);
    const active = selectButton(fixture.host, 'Active host');
    const remote = selectButton(fixture.host, 'خادم بعيد');
    expect(active.classList.contains('px-3.5')).toBe(true); expect(active.classList.contains('py-3')).toBe(true);
    expect(active.classList.contains('text-start')).toBe(true);
    expect(active.querySelector('.rounded-full[aria-hidden]')).not.toBeNull();
    expect(active.textContent).toContain('Connected directly');
    expect(remote.querySelector('[dir="auto"]')?.textContent).toBe('خادم بعيد');
    expect(remote.textContent).toContain('https://remote.test');
    expect(fixture.host.querySelectorAll('input,form')).toHaveLength(0);
    expect(fixture.host.querySelectorAll('button[aria-label="Edit"]')).toHaveLength(1);
    await act(async () => active.click()); await act(async () => remote.click()); await tap(fixture.host, 'Edit');
    expect(fixture.calls).toEqual(['select:remote', 'edit:remote']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('delete remains a caller-controlled two-step row confirmation with an explicit keep action', async () => {
  const fixture = await mount();
  try {
    await tap(fixture.host, 'Delete خادم بعيد'); await fixture.render();
    expect(fixture.calls).toEqual(['toggle:remote']);
    expect(selectButton(fixture.host, 'خادم بعيد').disabled).toBe(true);
    expect(fixture.host.querySelector('button[aria-label="Edit"]')).toBeNull();
    expect(findButton(fixture.host, 'Confirm deleting خادم بعيد').classList.contains('bg-destructive')).toBe(true);
    await tap(fixture.host, 'Keep خادم بعيد'); await fixture.render();
    expect(selectButton(fixture.host, 'خادم بعيد').disabled).toBe(false);
    expect(fixture.host.querySelector('button[aria-label="Confirm deleting خادم بعيد"]')).toBeNull();
    await tap(fixture.host, 'Delete خادم بعيد'); await fixture.render();
    await tap(fixture.host, 'Confirm deleting خادم بعيد');
    expect(fixture.calls).toEqual(['toggle:remote', 'toggle:remote', 'toggle:remote', 'delete:remote']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('busy preserves the original connecting-row exception and disabled selection still permits removal', async () => {
  const fixture = await mount({ busy: true, rows: [
    { id: 'connecting', label: 'Connecting host', status: 'Connecting…', active: false, connecting: true },
    { id: 'waiting', label: 'Other host', status: 'https://other.test', active: false, connecting: false, canEdit: true },
    { id: 'rejected', label: 'Revoked host', status: 'Expired', active: false, connecting: true, disabled: true },
  ] });
  try {
    const connecting = selectButton(fixture.host, 'Connecting host');
    expect(connecting.disabled).toBe(false); expect(connecting.querySelector('.animate-spin')).not.toBeNull();
    expect(selectButton(fixture.host, 'Other host').disabled).toBe(true);
    expect(selectButton(fixture.host, 'Revoked host').disabled).toBe(true);
    await act(async () => selectButton(fixture.host, 'Other host').click());
    await act(async () => selectButton(fixture.host, 'Revoked host').click());
    expect(fixture.calls).toEqual([]);
    expect(findButton(fixture.host, 'Edit').disabled).toBe(false);
    await tap(fixture.host, 'Edit'); await tap(fixture.host, 'Delete Revoked host'); await fixture.render();
    await tap(fixture.host, 'Confirm deleting Revoked host');
    expect(fixture.calls).toEqual(['edit:waiting', 'toggle:rejected', 'delete:rejected']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('the unchanged card and empty roots forward pointer diagnostics and click capture without extra containers', async () => {
  const events: string[] = [];
  const fixture = await mount({
    onPointerDown: () => events.push('down'), onPointerMove: () => events.push('move'),
    onPointerUp: () => events.push('up'), onPointerCancel: () => events.push('cancel'),
    onClickCapture: event => { events.push('capture'); event.preventDefault(); event.stopPropagation(); },
  });
  try {
    const card = fixture.host.firstElementChild;
    if (!card) throw new Error('Missing original card root');
    await act(async () => {
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) card.dispatchEvent(new PointerEvent(type, { bubbles: true }));
      selectButton(fixture.host, 'خادم بعيد').click();
    });
    expect(events).toEqual(['down', 'move', 'up', 'cancel', 'capture']); expect(fixture.calls).toEqual([]);
    fixture.props.rows = []; await fixture.render();
    const empty = fixture.host.firstElementChild;
    expect(empty?.tagName).toBe('P'); expect(empty?.classList.contains('border-dashed')).toBe(true);
    expect(empty?.textContent).toBe('No saved connections yet.');
    await act(async () => empty?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(events).toEqual(['down', 'move', 'up', 'cancel', 'capture', 'down']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('the original wrapper retains direct metadata, edit population, deletion ownership and long-press click suppression', async () => {
  localStorage.setItem('openchamber.mobile.connections.v1', JSON.stringify([{ id: 'original', label: 'Original saved host', candidates: [{ kind: 'direct', url: 'https://original-instances.test' }], lastUsedAt: 1 }]));
  const { MobileInstancesSurface } = await import('./MobileInstancesSurface');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let deletedActive = 0; let connected = 0;
  try {
    await act(async () => root.render(<I18nProvider><MobileInstancesSurface onConnect={() => { connected += 1; }} onActiveConnectionDeleted={() => { deletedActive += 1; }} /></I18nProvider>));
    const row = selectButton(host, 'Original saved host');
    expect(row.textContent).toContain('original-instances.test');
    await act(async () => { row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 })); await new Promise(resolve => setTimeout(resolve, 720)); });
    expect(host.textContent).toContain('Connection log');
    await act(async () => { row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); row.click(); });
    expect(connected).toBe(0); expect(requests).toEqual([]);
    await tap(host, 'Close'); await tap(host, 'Edit');
    expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toContain('original-instances.test');
    expect([...host.querySelectorAll<HTMLInputElement>('input')].some(input => input.value === 'Original saved host')).toBe(true);
    expect(host.querySelectorAll('input')).toHaveLength(3);
    await tap(host, 'Cancel');
    await tap(host, 'Delete Original saved host');
    expect(deletedActive).toBe(0);
    await tap(host, 'Confirm deleting Original saved host');
    expect(deletedActive).toBe(1); expect(connected).toBe(0);
    expect(host.textContent).toContain('No saved connections yet.');
    expect(host.textContent).not.toContain('Original saved host');
    expect(requests).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});
