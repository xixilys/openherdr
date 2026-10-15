import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { MobileSessionRowViewProps } from './MobileSessionRowView';

const dom = new Window({ url: 'https://session-row-view.test' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, Text: dom.Text,
  Event: dom.Event, MouseEvent: dom.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const savedFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
  requests.push(input instanceof Request ? input.url : String(input));
  return Response.json({ error: 'Unexpected row view request' }, { status: 503 });
}, savedFetch);
const { MobileSessionRowView } = await import('./MobileSessionRowView');
const { createRoot } = await import('react-dom/client');
afterAll(async () => {
  globalThis.fetch = savedFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
async function mount(overrides: Partial<MobileSessionRowViewProps> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); let selections = 0;
  const props: MobileSessionRowViewProps = { title: 'Worker monitor', active: false, indent: 12, onSelect: () => { selections++; }, ...overrides };
  const render = () => act(async () => root.render(<MobileSessionRowView {...props} />));
  await render();
  return { host, props, render, selections: () => selections, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('source-neutral row keeps original single/context geometry, active colors and supplied status order', async () => {
  expect(requests).toEqual([]);
  const row = await mount({ trailing: <><span>Running</span><span>15s</span></> });
  try {
    const button = row.host.querySelector('button');
    expect(button?.classList.contains('h-9')).toBe(true);
    expect(button?.style.paddingInlineStart).toBe('12px');
    expect(button?.classList.contains('text-start')).toBe(true);
    expect(row.host.querySelector('[data-active-session]')).toBeNull();
    const title = row.host.querySelector('span[dir="auto"]');
    expect(title?.classList.contains('truncate')).toBe(true);
    expect(title?.classList.contains('oc-ui-start-align')).toBe(true);
    expect(title?.classList.contains('text-foreground')).toBe(true);
    expect([...title?.parentElement?.children ?? []].map(node => node.textContent)).toEqual(['Worker monitor', 'Running', '15s']);
    row.props.active = true; row.props.contextLabel = 'WSL · Research · dashboard'; await row.render();
    expect(button?.classList.contains('h-9')).toBe(false);
    expect(button?.classList.contains('min-h-10')).toBe(true);
    expect(button?.classList.contains('py-1')).toBe(true);
    expect(row.host.querySelector('[data-active-session="true"]')?.firstElementChild?.className).toContain('var(--primary)_10%,transparent');
    expect(title?.classList.contains('text-primary')).toBe(true);
    expect(row.host.textContent).toContain('WSL · Research · dashboard');
    expect(row.host.querySelectorAll('[dir="auto"]').length).toBe(2);
    expect(row.host.querySelector('[dir="auto"].typography-micro')?.classList.contains('oc-ui-start-align')).toBe(true);
    await act(async () => button?.click()); expect(row.selections()).toBe(1);
    row.props.disabled = true; await row.render();
    expect(button?.disabled).toBe(true);
    await act(async () => button?.click()); expect(row.selections()).toBe(1);
    expect(requests).toEqual([]);
  } finally { await row.dispose(); }
});

test('caller disclosure remains a separate hit target and logical padding works under RTL', async () => {
  let toggles = 0;
  const row = await mount({ title: 'مراقبة العامل', contextLabel: 'مشروع · /home/worker', indent: 44, leading: <button aria-label="Expand children" onClick={() => { toggles++; }}>Expand</button> });
  try {
    row.host.dir = 'rtl';
    const buttons = row.host.querySelectorAll('button');
    await act(async () => buttons[0].click()); expect(toggles).toBe(1); expect(row.selections()).toBe(0);
    expect(buttons[1].style.paddingInlineStart).toBe('44px');
    expect(buttons[1].style.paddingLeft).toBe('');
    expect(row.host.querySelector('[dir="auto"]')?.textContent).toBe('مراقبة العامل');
    expect(row.host.querySelector('[dir="auto"].typography-micro')?.textContent).toBe('مشروع · /home/worker');
    await act(async () => buttons[1].click()); expect(row.selections()).toBe(1);
  } finally { await row.dispose(); }
});

test('embedded swipe content and rename replacement add no row frame or selection button', async () => {
  const row = await mount({ active: true, embedded: true, leading: <span data-gutter>Gutter</span>, replacement: <form><input defaultValue="Rename draft" /><button type="submit">Save name</button></form> });
  try {
    expect(row.host.querySelector('[data-active-session]')).toBeNull();
    expect(row.host.firstElementChild?.hasAttribute('data-gutter')).toBe(true);
    expect(row.host.querySelectorAll('div').length).toBe(0);
    expect(row.host.querySelectorAll('button').length).toBe(1);
    expect(row.host.querySelector('input')?.value).toBe('Rename draft');
    row.props.replacement = undefined; await row.render();
    expect(row.host.querySelector('form')).toBeNull();
    await act(async () => row.host.querySelector('button')?.click()); expect(row.selections()).toBe(1);
    expect(requests).toEqual([]);
  } finally { await row.dispose(); }
});
