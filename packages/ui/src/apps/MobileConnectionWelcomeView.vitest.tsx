import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { MobileConnectionWelcomeViewProps } from './MobileConnectionWelcomeView';

const dom = new Window({ url: 'https://welcome.test' });
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
const { MobileConnectionWelcomeView } = await import('./MobileConnectionWelcomeView');
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

const mount = async (overrides: Partial<MobileConnectionWelcomeViewProps> = {}) => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const calls: string[] = [];
  const props: MobileConnectionWelcomeViewProps = {
    logo: <span data-logo>Logo</span>, title: 'OpenHerdr',
    scan: { supported: true, scanning: false, busy: false, hint: 'Supplied scan hint', onScan: () => calls.push('scan') },
    saved: [{ id: 'one', label: 'Saved host', detail: 'https://saved.test', connecting: false }],
    onSaved: id => calls.push(id), disabled: false, manualOpen: false,
    onToggleManual: () => { props.manualOpen = !props.manualOpen; calls.push('manual'); },
    manualForm: <form aria-label="Pair device"><input aria-label="Pairing code" /><button>Confirm supplied server</button></form>,
    toolbar: <button onClick={() => calls.push('toolbar')}>Supplied toolbar</button>, ...overrides,
  };
  const render = async () => act(async () => root.render(<I18nProvider><MobileConnectionWelcomeView {...props} /></I18nProvider>));
  await render();
  return { host, root, props, calls, render, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
};
const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll('button')].find(element => element.textContent?.includes(label));
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
};

test('pure welcome keeps original geometry and supplied Herdr form without source I/O', async () => {
  expect(requests).toEqual([]);
  const fixture = await mount({ notice: <p role="status">Confirm the displayed server</p> });
  try {
    const main = fixture.host.querySelector('main');
    expect(main?.classList.contains('oc-keyboard-fill-screen')).toBe(true);
    expect(main?.classList.contains('px-6')).toBe(true);
    expect(main?.className).toContain('--safe-area-inset-bottom');
    expect(main?.firstElementChild?.classList.contains('max-w-[360px]')).toBe(true);
    expect(main?.firstElementChild?.classList.contains('gap-9')).toBe(true);
    expect(fixture.host.querySelector('h1')?.textContent).toBe('OpenHerdr');
    expect(fixture.host.querySelector('[role="status"]')?.textContent).toContain('displayed server');
    expect(button(fixture.host, 'Saved host').classList.contains('min-h-14')).toBe(true);
    expect(button(fixture.host, 'Saved host').classList.contains('text-start')).toBe(true);
    expect(fixture.host.querySelector('form')?.getAttribute('aria-label')).toBe('Pair device');
    expect(fixture.host.querySelector('.grid')?.getAttribute('style')).toContain('0fr');
    await act(async () => button(fixture.host, 'Saved host').click());
    await act(async () => button(fixture.host, 'Scan QR code').click());
    await act(async () => button(fixture.host, 'Connect by address').click());
    await fixture.render();
    expect(fixture.host.querySelector('.grid')?.getAttribute('style')).toContain('1fr');
    expect(button(fixture.host, 'Connect by address').getAttribute('aria-expanded')).toBe('true');
    await act(async () => button(fixture.host, 'Supplied toolbar').click());
    expect(fixture.calls).toEqual(['one', 'scan', 'manual', 'toolbar']);
    expect(requests).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('busy saved rows and scanner reject activation while preserving the connecting row', async () => {
  const fixture = await mount({ disabled: true, scan: { supported: true, scanning: false, busy: true, hint: '', onScan: () => { throw new Error('Busy scan activated'); } }, saved: [{ id: 'one', label: 'Saved host', detail: 'https://saved.test', connecting: true }] });
  try {
    const row = button(fixture.host, 'Saved host');
    expect(row.disabled).toBe(true); expect(row.textContent).toContain('Connecting');
    expect(row.querySelector('.animate-spin')).not.toBeNull();
    const scan = [...fixture.host.querySelectorAll('button')].find(element => element.classList.contains('h-12'));
    expect(scan?.disabled).toBe(true);
    await act(async () => row.click()); expect(fixture.calls).toEqual([]);
  } finally { await fixture.dispose(); }
});

test('replacement form takes the original password branch and manual error ownership remains explicit', async () => {
  const fixture = await mount({ error: 'Scan failed', replacementForm: <form><input type="password" aria-label="Password" /><button>Unlock supplied server</button></form> });
  try {
    expect(fixture.host.querySelector('input[type="password"]')).not.toBeNull();
    expect(fixture.host.textContent).not.toContain('Saved host');
    expect(fixture.host.textContent).not.toContain('Scan QR code');
    fixture.props.replacementForm = null; await fixture.render();
    expect(fixture.host.textContent).toContain('Scan failed');
    fixture.props.manualOpen = true; await fixture.render();
    expect(fixture.host.textContent).not.toContain('Scan failed');
    fixture.props.scan.supported = false; await fixture.render();
    expect(fixture.host.textContent).not.toContain('Connect by address');
    expect(fixture.host.querySelector('.grid')?.getAttribute('style')).toContain('1fr');
  } finally { await fixture.dispose(); }
});

test('original wrapper keeps saved metadata, manual inputs, notice and logo long-press diagnostics', async () => {
  localStorage.setItem('openchamber.mobile.connections.v1', JSON.stringify([{ id: 'original', label: 'Original saved host', candidates: [{ kind: 'direct', url: 'https://original.test' }], lastUsedAt: 1 }]));
  const { MobileConnectionWelcome } = await import('./MobileConnectionWelcome');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<I18nProvider><MobileConnectionWelcome onConnected={() => { throw new Error('Unexpected connection'); }} notice={{ kind: 'auth-expired', label: 'Original saved host' }} /></I18nProvider>));
    expect(host.querySelector('h1')?.textContent).toBe('Connect to OpenChamber');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('expired or was revoked');
    expect(button(host, 'Original saved host').textContent).toContain('original.test');
    expect(host.querySelectorAll('input')).toHaveLength(3);
    const url = host.querySelector('input[type="url"]');
    expect(url?.getAttribute('aria-label')).toBe('Server URL');
    expect(url?.getAttribute('autocapitalize')).toBe('none');
    expect(button(host, 'Connect').disabled).toBe(true);
    const logo = host.querySelector('main h1')?.previousElementSibling;
    if (!logo) throw new Error('Missing original long-press logo');
    await act(async () => { logo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 })); await new Promise(resolve => setTimeout(resolve, 720)); });
    expect(host.textContent).toContain('Connection log');
    expect(requests).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});
