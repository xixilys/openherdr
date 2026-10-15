import React, { act } from 'react';
import { afterAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Worker as NodeWorker } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse } from '@pierre/diffs/worker';

const NativeEventTarget = globalThis.EventTarget;
const NativeMessageEvent = globalThis.MessageEvent;
const workerEntry = import.meta.resolve('@pierre/diffs/worker/worker.js');
const workers = new Set<NodeWorker>();
const failures: Error[] = [];
class PierreWorker extends NativeEventTarget {
  private worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(`
    import { parentPort, workerData } from 'node:worker_threads';
    globalThis.postMessage = data => parentPort.postMessage(data);
    globalThis.self = { addEventListener(type, listener) {
      if (type === 'message') parentPort.on('message', data => listener({ data }));
    } };
    await import(workerData);
  `)}`), { workerData: workerEntry });
  constructor() {
    super(); workers.add(this.worker);
    this.worker.on('message', (data: WorkerResponse) => this.dispatchEvent(new NativeMessageEvent('message', { data })));
    this.worker.on('error', error => failures.push(error));
  }
  postMessage(request: WorkerRequest) { this.worker.postMessage(request); }
  terminate() { workers.delete(this.worker); return this.worker.terminate(); }
}
const dom = new Window({ url: 'https://code-preview.test' });
dom.happyDOM.setWindowSize({ width: 412, height: 915 });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, Window: dom.Window, document: dom.document, navigator: dom.navigator, location: dom.location,
  localStorage: dom.localStorage, Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
  Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot,
  Text: dom.Text, Range: dom.Range, SVGElement: dom.SVGElement, Event: dom.Event,
  customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
  MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, IntersectionObserver: dom.IntersectionObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), Worker: PierreWorker, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const savedFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
  requests.push(input instanceof Request ? input.url : String(input));
  throw new Error('A code preview must not initialize another runtime');
}, savedFetch);
const { createRoot } = await import('react-dom/client');
const { VirtualizedFile, Virtualizer } = await import('@pierre/diffs');
const { CodeFilePreview } = await import('./CodeFilePreview');
const { getDefaultTheme } = await import('@/lib/theme/themes');
const { ensurePierreThemeRegistered } = await import('@/lib/shiki/appThemeRegistry');
const theme = getDefaultTheme(false);
ensurePierreThemeRegistered(theme);
const content = Array.from({ length: 6000 }, (_, index) => `row-${String(index + 1).padStart(4, '0')} full current draft text keeps every byte\n`).join('') + 'FINAL-TAIL\n';

// happy-dom has no layout. Keep Pierre's real viewport reconciliation while
// supplying measurable rows in the same 412x661 scroller as the browser case.
const measure = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  const root = this.getRootNode();
  const owner = root instanceof ShadowRoot ? root.host : this;
  const scroller = owner.closest<HTMLElement>('[data-preview-scroller]');
  if (scroller) {
    if (this.matches('diffs-container')) return new dom.DOMRect(0, 220 - scroller.scrollTop, 412, 6002 * 20);
    if (this.matches('[data-line]')) {
      const index = Number(this.getAttribute('data-line-index') ?? '0');
      return new dom.DOMRect(0, 220 + index * 20 - scroller.scrollTop, 412, 20);
    }
  }
  return measure.call(this);
};
const makeScroller = () => {
  const scroller = document.createElement('div');
  scroller.dataset.previewScroller = 'true';
  Object.defineProperties(scroller, { clientHeight: { value: 661 }, clientWidth: { value: 412 }, scrollHeight: { value: 6002 * 20 } });
  scroller.getBoundingClientRect = () => new dom.DOMRect(0, 220, 412, 661);
  document.body.append(scroller);
  return scroller;
};
const waitFor = async (condition: () => boolean, describe?: () => string) => {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) {
    if (failures.length) throw failures[0];
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  if (!condition()) throw new Error(describe?.() ?? 'The real code preview did not render');
};
const text = (host: HTMLElement) => host.querySelector('diffs-container')?.shadowRoot?.textContent ?? '';
afterAll(async () => {
  await Promise.all([...workers].map(worker => worker.terminate()));
  globalThis.fetch = savedFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('a forced render in the installed virtualized renderer requires the prepared file object even when cache keys match', async () => {
  const scroller = makeScroller();
  const host = document.createElement('div'); scroller.append(host);
  const virtualizer = new Virtualizer();
  virtualizer.setup(scroller, host);
  const instance = new VirtualizedFile({ disableFileHeader: true, disableErrorHandling: true, theme: theme.metadata.id, themeType: 'light' }, virtualizer);
  const file = { name: 'large.txt', contents: content, cacheKey: 'prepared-file-identity' };
  try {
    instance.render({ file, containerWrapper: host });
    await waitFor(() => text(host).includes('row-0001'));
    instance.render({ file });
    instance.render({ file });
    expect(() => instance.render({ file: { ...file }, forceRender: true })).toThrow('rendered a different file than its prepared layout');
  } finally { instance.cleanUp(); virtualizer.cleanUp(); scroller.remove(); }
});

test('large shared preview survives identical and option rerenders, then shows a same-length middle edit', async () => {
  const scroller = makeScroller();
  const root = createRoot(scroller);
  const errors: string[] = [];
  const savedError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); savedError(...args); };
  const render = async (draft: string, attached = true, wrapLines = true) => act(async () => root.render(<CodeFilePreview path="large.txt" content={draft} theme={theme} wrapLines={wrapLines} scroller={attached ? scroller : null} positionKey="large-preview-lifecycle" />));
  try {
    await render(content);
    await waitFor(() => text(scroller).includes('row-0001') || errors.length > 0);
    for (let count = 0; count < 3; count++) await render(content);
    await render(content, true, false);
    await render(content);
    expect(errors).toEqual([]);
    expect(text(scroller)).not.toContain('rendered a different file');
    scroller.scrollTop = 2999 * 20;
    await act(async () => scroller.dispatchEvent(new Event('scroll')));
    await waitFor(() => text(scroller).includes('row-3000'));
    const updated = content.replace('row-3000', 'EDIT3000');
    expect(updated.length).toBe(content.length);
    await render(updated);
    await waitFor(() => text(scroller).includes('EDIT3000') || errors.length > 0, () => JSON.stringify({ top: scroller.scrollTop, text: text(scroller).slice(-1000), html: scroller.innerHTML.slice(0, 500), errors }));
    expect(text(scroller)).toContain('EDIT3000');
    expect(text(scroller)).not.toContain('row-3000');
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    console.error = savedError;
    scroller.remove();
  }
});

test('the queued large file remains connected when its actual scroller arrives after the first render', async () => {
  const scroller = makeScroller();
  const root = createRoot(scroller);
  const render = async (attached: boolean) => act(async () => root.render(<CodeFilePreview path="attach.txt" content={content} theme={theme} wrapLines scroller={attached ? scroller : null} positionKey="large-preview-attachment" />));
  try {
    await render(false);
    await render(true);
    await waitFor(() => text(scroller).includes('row-0001'), () => JSON.stringify({ top: scroller.scrollTop, text: text(scroller).slice(-1000), html: scroller.innerHTML.slice(0, 500) }));
    expect(text(scroller)).not.toContain('rendered a different file');
    expect(requests).toEqual([]);
  } finally { await act(async () => root.unmount()); scroller.remove(); }
});
