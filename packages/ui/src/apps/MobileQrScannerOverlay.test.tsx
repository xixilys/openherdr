import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';

const dom = new Window({ url: 'https://scanner.test' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement,
  Event: dom.Event, KeyboardEvent: dom.KeyboardEvent, MutationObserver: dom.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const { MobileQrScannerOverlay } = await import('./MobileQrScannerOverlay');
const { I18nProvider } = await import('@/lib/i18n');
const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
const { createRoot } = await import('react-dom/client');

afterAll(async () => {
  await dom.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function mount(hint?: string) {
  const host = document.createElement('div');
  host.style.opacity = '0.7';
  host.style.pointerEvents = 'auto';
  document.body.append(host);
  const root = createRoot(host);
  let cancellations = 0;
  function Fixture() {
    const [open, setOpen] = React.useState(true);
    return <I18nProvider>{open && <MobileQrScannerOverlay hint={hint} onCancel={() => {
      cancellations += 1;
      setOpen(false);
    }} />}</I18nProvider>;
  }
  await act(async () => root.render(<Fixture />));
  return {
    host, cancelled: () => cancellations,
    async dispose() { await act(async () => root.unmount()); host.remove(); },
  };
}

test('Back cancels the scanner and restores backgrounds and portal siblings', async () => {
  document.documentElement.style.setProperty('background-color', 'rgb(1, 2, 3)', 'important');
  document.body.style.setProperty('background-color', 'rgb(4, 5, 6)');
  const fixture = await mount('Custom translated hint');
  const latePortal = document.createElement('div');
  latePortal.style.opacity = '0.4';
  try {
    expect(document.body.textContent).toContain('Custom translated hint');
    expect(fixture.host.style.opacity).toBe('0');
    document.body.append(latePortal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(latePortal.style.opacity).toBe('0');
    await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
    expect(fixture.cancelled()).toBe(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(closeTopmostBackLayer()).toBe(false);
    expect(fixture.host.style.opacity).toBe('0.7');
    expect(fixture.host.style.pointerEvents).toBe('auto');
    expect(latePortal.style.opacity).toBe('0.4');
    expect(document.documentElement.style.getPropertyValue('background-color')).toBe('rgb(1, 2, 3)');
    expect(document.documentElement.style.getPropertyPriority('background-color')).toBe('important');
    expect(document.body.style.getPropertyValue('background-color')).toBe('rgb(4, 5, 6)');
  } finally {
    latePortal.remove();
    await fixture.dispose();
    document.documentElement.style.removeProperty('background-color');
    document.body.style.removeProperty('background-color');
  }
});

test('backgrounding cancels once and removes visibility and Back listeners', async () => {
  const fixture = await mount();
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    expect(document.body.textContent).toContain('On your computer, open «Add a device» to show a QR code, then scan it here.');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fixture.cancelled()).toBe(1);
    expect(fixture.host.style.opacity).toBe('0.7');
    expect(document.body.style.getPropertyValue('background-color')).toBe('');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fixture.cancelled()).toBe(1);
    expect(closeTopmostBackLayer()).toBe(false);
  } finally {
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
    else Reflect.deleteProperty(document, 'visibilityState');
    await fixture.dispose();
  }
});

test('unmount restores the document and unregisters the Back layer', async () => {
  const fixture = await mount();
  await fixture.dispose();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.documentElement.style.getPropertyValue('background-color')).toBe('');
  expect(document.body.style.getPropertyValue('background-color')).toBe('');
  expect(closeTopmostBackLayer()).toBe(false);
});
