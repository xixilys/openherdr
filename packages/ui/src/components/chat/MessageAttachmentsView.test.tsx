import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import assert from 'node:assert/strict';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { MessageAttachmentItem } from './MessageAttachmentsView';

const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
const installDom = () => {
  const win = new Window({ url: 'http://localhost' });
  const previous = GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const values = { window: win, document: win.document, navigator: win.navigator, Node: win.Node, Element: win.Element,
    HTMLElement: win.HTMLElement, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), IS_REACT_ACT_ENVIRONMENT: true };
  for (const name of GLOBALS) Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  return { container, restore: () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    void win.happyDOM.close();
  } };
};

const bootstrap = installDom();
const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { useI18nStore } = await import('@/lib/i18n/store');
const requested: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
  requested.push(String(input));
  throw new Error('Unexpected network request');
}, originalFetch);
const { MessageAttachmentsView } = await import('./MessageAttachmentsView');
const { ImagePreviewView } = await import('./ImagePreviewView');
const { registerBackLayer, closeTopmostBackLayer } = await import('@/lib/mobileBackLayers');
globalThis.fetch = originalFetch;
bootstrap.restore();

const items: MessageAttachmentItem[] = [
  { id: 'text', name: 'notes.txt', mime: 'text/plain', size: 2048, kind: 'file', compactOpenable: true },
  { id: 'pdf', name: 'manual.pdf', mime: 'application/pdf', kind: 'file' },
  { id: 'issue', name: 'Issue 9', kind: 'issue', icon: 'github' },
  { id: 'diagram', name: 'drawing.drawio', kind: 'diagram' },
  { id: 'one', name: 'one.png', kind: 'image', previewUrl: 'blob:owned-one' },
  { id: 'two', name: 'two.png', kind: 'image', previewUrl: 'blob:owned-two' },
];

describe('source-neutral attachment presentation', () => {
  let dom: ReturnType<typeof installDom>;
  let root: Root;
  beforeEach(() => { dom = installDom(); root = createRoot(dom.container); useI18nStore.getState().setLocale('en'); });
  afterEach(async () => { await act(async () => root.unmount()); useI18nStore.getState().setLocale('en'); dom.restore(); });
  const render = async (content: React.ReactNode) => act(async () => root.render(<I18nProvider>{content}</I18nProvider>));

  test('importing the views makes no source initialization requests', () => {
    expect(requested).toEqual([]);
  });

  test('compact chips and image strip preserve action identities and inert files', async () => {
    const opened: string[] = [];
    await render(<MessageAttachmentsView items={items} compact className="mb-2" onOpen={(item) => opened.push(item.id)} />);
    expect(dom.container.firstElementChild?.className).toContain('mb-2');
    expect(dom.container.querySelectorAll('img')).toHaveLength(2);
    const buttons = [...dom.container.querySelectorAll('button')];
    expect(buttons).toHaveLength(4);
    await act(async () => { for (const button of buttons) button.click(); });
    expect(opened).toEqual(['text', 'issue', 'one', 'two']);
    expect(dom.container.textContent).toContain('manual.pdf');
    expect(dom.container.querySelector('[dir="auto"]')).not.toBeNull();
  });

  test('full cards preserve file, issue and diagram actions with static images', async () => {
    const opened: string[] = [];
    await render(<MessageAttachmentsView items={items} onOpen={(item) => opened.push(item.id)} />);
    expect(dom.container.querySelectorAll('img')).toHaveLength(2);
    expect(dom.container.querySelectorAll('button')).toHaveLength(4);
    expect(dom.container.textContent).toContain('2.0 KB');
    await act(async () => { for (const button of dom.container.querySelectorAll('button')) button.click(); });
    expect(opened).toEqual(['text', 'pdf', 'issue', 'diagram']);
    await render(<MessageAttachmentsView items={[]} onOpen={() => {}} />);
    expect(dom.container.children).toHaveLength(0);
  });

  test('gallery selects the requested image, wraps with keyboard and closes', async () => {
    const changes: boolean[] = [];
    await render(<ImagePreviewView open images={[{ url: 'blob:one', filename: 'one' }, { url: 'blob:two', filename: 'two' }]}
      initialIndex={1} title="Gallery" isMobile onOpenChange={(open) => changes.push(open)} />);
    const image = () => document.body.querySelector('img')?.getAttribute('src');
    expect(image()).toBe('blob:two');
    expect(document.body.querySelector('[aria-label="Previous image"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })); });
    expect(image()).toBe('blob:one');
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })); });
    expect(image()).toBe('blob:two');
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(changes).toEqual([false]);
  });

  test('image dimensions follow the loaded URL and unmount removes keyboard handling', async () => {
    const changes: boolean[] = [];
    await render(<ImagePreviewView open images={[{ url: 'blob:wide' }, { url: 'blob:tall' }]}
      title="Gallery" isMobile={false} onOpenChange={(open) => changes.push(open)} />);
    const image = document.body.querySelector('img');
    expect(Boolean(image)).toBe(true);
    if (!image) throw new Error('Missing preview image');
    Object.defineProperties(image, { naturalWidth: { value: 800, configurable: true }, naturalHeight: { value: 400, configurable: true } });
    await act(async () => { image.dispatchEvent(new window.Event('load')); });
    assert(Math.abs(Number.parseFloat(image.style.width) / Number.parseFloat(image.style.height) - 2) < 0.005);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    expect(image.getAttribute('src')).toBe('blob:tall');
    Object.defineProperties(image, { naturalWidth: { value: 400, configurable: true }, naturalHeight: { value: 800, configurable: true } });
    await act(async () => { image.dispatchEvent(new window.Event('load')); });
    assert(Math.abs(Number.parseFloat(image.style.width) / Number.parseFloat(image.style.height) - 0.5) < 0.005);
    await render(null);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(changes).toEqual([]);
  });

  test('equivalent gallery renders retain the selected URL until the requested target changes', async () => {
    const show = async (images: { url: string; filename: string }[], initialIndex = 0) => render(<ImagePreviewView open images={images} initialIndex={initialIndex} title="Gallery" isMobile onOpenChange={() => {}} />);
    await show([{ url: 'blob:one', filename: 'one' }, { url: 'blob:two', filename: 'two' }]);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:two');
    await show([{ url: 'blob:one', filename: 'one refreshed' }, { url: 'blob:two', filename: 'two refreshed' }]);
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:two');
    await show([{ url: 'blob:two', filename: 'two' }, { url: 'blob:one', filename: 'one' }], 1);
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:two');
    await show([{ url: 'blob:two', filename: 'two' }, { url: 'blob:one', filename: 'one' }], 0);
    await show([{ url: 'blob:one', filename: 'one' }, { url: 'blob:two', filename: 'two' }], 0);
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:one');
  });

  test('consecutive gallery keys retain each navigation step in one React batch', async () => {
    await render(<ImagePreviewView open images={[{ url: 'blob:one' }, { url: 'blob:two' }, { url: 'blob:three' }]} title="Gallery" isMobile onOpenChange={() => {}} />);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:three');
  });

  test('Back closes the image layer with the latest callback without reordering it', async () => {
    const calls: string[] = [];
    const releaseLower = registerBackLayer(() => calls.push('lower'));
    let releaseUpper = () => {};
    try {
      const show = (open: boolean, name: string) => render(<ImagePreviewView open={open} images={[{ url: 'blob:one' }]} title="Gallery" isMobile onOpenChange={() => calls.push(name)} />);
      await show(true, 'old');
      releaseUpper = registerBackLayer(() => calls.push('upper'));
      await show(true, 'latest');
      await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
      expect(calls).toEqual(['upper']);
      releaseUpper();
      await act(async () => { expect(closeTopmostBackLayer()).toBe(true); });
      expect(calls).toEqual(['upper', 'latest']);
      await show(false, 'closed');
      expect(closeTopmostBackLayer()).toBe(true);
      expect(calls).toEqual(['upper', 'latest', 'lower']);
      releaseLower();
      expect(closeTopmostBackLayer()).toBe(false);
      await show(true, 'unmounted');
      await render(null);
      expect(closeTopmostBackLayer()).toBe(false);
    } finally { releaseUpper(); releaseLower(); }
  });

  test('translated diagram and preview labels react to locale, with RTL gallery keys', async () => {
    await act(async () => {
      useI18nStore.getState().setLocale('ar');
      if (useI18nStore.getState().loadingLocale) await new Promise<void>((resolve) => {
        const unsubscribe = useI18nStore.subscribe((state) => { if (!state.loadingLocale) { unsubscribe(); resolve(); } });
      });
    });
    await render(<><MessageAttachmentsView items={[items[3]]} onOpen={() => {}} />
      <ImagePreviewView open images={[{ url: 'blob:one', filename: 'one' }, { url: 'blob:two', filename: 'two' }]}
        title="Gallery" isMobile onOpenChange={() => {}} /></>);
    expect(document.documentElement.dir).toBe('rtl');
    expect(dom.container.textContent).toContain('فتح في عرض المخطط');
    expect(Boolean(document.body.querySelector('[aria-label="الصورة التالية"]'))).toBe(true);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })); });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe('blob:two');
  });
});
