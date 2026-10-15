import React, { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Root } from 'react-dom/client';
import { HerdrConnectionController } from '../../../../web/src/herdr/connection-controller';
import type { Connection } from '../../../../web/src/herdr/transport';

let dom: Window;
let root: Root;
let host: HTMLElement;
let restore: () => void;
let controller: HerdrConnectionController;
let redemptions: string[];
let activations: Connection[];
let finishBarcode: (raw: string) => void;
const payload = { pairingId: 'fixture-once', secret: 'fixture-private-once', server: 'https://fixture-remote.test' };
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const link = `https://fixture-remote.test/#pairing=${encoded}`;
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };

beforeEach(async () => {
  dom = new Window({ url: 'https://connection.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent,
    MutationObserver: dom.MutationObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  restore = () => { for (const name of Object.keys(globals)) { const saved = previous[name]; if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  redemptions = []; activations = []; finishBarcode = () => undefined;
  controller = new HerdrConnectionController({ async initialize() {}, list() { return []; },
    async redeem(server) { redemptions.push(server); return { server, token: 'fixture-device' }; }, async save() {},
    async probe() { return 'ready'; }, async rename() {}, async forget() {},
  }, connection => activations.push(connection), { server: '', pairing: null, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); await dom.happyDOM.close(); restore(); });

async function render() {
  const { I18nProvider } = await import('@/lib/i18n');
  const { ConnectionWelcome } = await import('../../../../web/src/herdr/ConnectionWelcome');
  await act(async () => root.render(<I18nProvider><ConnectionWelcome controller={controller} toolbar={null} onClose={null} /></I18nProvider>));
}
function installScanner() {
  let receiveBarcode: (info: { barcodes: { rawValue: string }[] }) => void = () => undefined;
  Object.defineProperty(dom, 'Capacitor', { value: { getPlatform: () => 'android', Plugins: { BarcodeScanner: {
    async requestPermissions() { return { camera: 'granted' }; }, async startScan() {}, async stopScan() {},
    async addListener(event: string, callback: typeof receiveBarcode) {
      if (event === 'barcodesScanned') receiveBarcode = callback;
      return { async remove() { if (event === 'barcodesScanned') receiveBarcode = () => undefined; } };
    },
  } } }, configurable: true });
  finishBarcode = rawValue => receiveBarcode({ barcodes: [{ rawValue }] });
}
async function scan() {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Scan QR code'));
  if (!button) throw new Error('Expected the original scan action');
  await act(async () => button.click()); await settle();
}
test('pasting a CLI link waits for explicit confirmation and hides its secret', async () => {
  await render();
  await act(async () => controller.setPairingText(link));
  const server = host.querySelector<HTMLInputElement>('input[type="url"]');
  expect(server?.value).toBe(payload.server);
  expect(host.querySelector('input[type="password"]')).not.toBeNull();
  expect(host.textContent).not.toContain(payload.secret); expect(redemptions).toEqual([]);
  const form = host.querySelector('form'); if (!form) throw new Error('Expected pairing form');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(redemptions).toEqual([payload.server]); expect(activations).toHaveLength(1);
});
test('a scanned native link previews the server and never automatically redeems', async () => {
  installScanner(); await render(); await scan();
  await act(async () => finishBarcode(`openherdr://connect#pairing=${encoded}`)); await settle();
  expect(controller.getSnapshot().pairing).toEqual(payload);
  expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(payload.server);
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(redemptions).toEqual([]); expect(document.querySelector('[aria-modal="true"]')).toBeNull();
});
test('a new OS intent cancels the camera and ignores an older scan result', async () => {
  installScanner(); await render(); await scan();
  const newer = { ...payload, pairingId: 'newer', server: 'https://newer.test' };
  const newerLink = `openherdr://connect#pairing=${Buffer.from(JSON.stringify(newer)).toString('base64url')}`;
  await act(async () => controller.acceptLink(newerLink));
  await settle(); await act(async () => finishBarcode(link)); await settle();
  expect(controller.getSnapshot().pairing).toEqual(newer);
  expect(redemptions).toEqual([]); expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  expect(document.body.style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});
test('system Back cancels scanning through the existing layer', async () => {
  installScanner(); await render(); await scan();
  const { closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
  await act(async () => { expect(closeTopmostBackLayer()).toBe(true); }); await settle();
  expect(document.querySelector('[aria-modal="true"]')).toBeNull(); expect(closeTopmostBackLayer()).toBe(false);
  expect(redemptions).toEqual([]);
});
