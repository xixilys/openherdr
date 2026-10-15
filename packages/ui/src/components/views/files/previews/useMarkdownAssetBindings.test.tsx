import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useMarkdownAssetBindings, type MarkdownAssetSource } from './useMarkdownAssetBindings';

const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const deferredBlob = () => {
  let resolve: (blob: Blob) => void = () => { throw new Error('Deferred image was not initialized'); };
  const promise = new Promise<Blob>(done => { resolve = done; });
  return { promise, resolve };
};
function Preview(props: Parameters<typeof useMarkdownAssetBindings>[0]) { useMarkdownAssetBindings(props); return null; }

describe('injected Markdown resource bindings', () => {
  let root: Root;
  let container: HTMLDivElement;
  let created: string[];
  let revoked: string[];
  let reads: Array<{ path: string; signal: AbortSignal }>;
  let source: MarkdownAssetSource;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    const windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance, document: windowInstance.document,
      Element: windowInstance.Element, HTMLElement: windowInstance.HTMLElement,
      HTMLAnchorElement: windowInstance.HTMLAnchorElement, MouseEvent: windowInstance.MouseEvent,
      MutationObserver: windowInstance.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    });
    created = []; revoked = []; reads = [];
    URL.createObjectURL = () => { const url = `blob:test-${created.length + 1}`; created.push(url); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); };
    const host = document.createElement('div');
    container = document.createElement('div');
    document.body.append(host, container);
    root = createRoot(host);
    source = {
      key: 'owner-a',
      resolve: reference => `/a/${reference}`,
      readImage: async (path, signal) => { reads.push({ path, signal }); return new Blob(['a']); },
    };
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
  const render = async (props: Partial<Parameters<typeof useMarkdownAssetBindings>[0]> = {}) => {
    await act(async () => { root.render(<Preview container={container} source={source} onOpenFile={() => {}} enabled colorScheme="light" {...props} />); });
  };

  test('deduplicates actual DOM images and srcset candidates while preserving raw references for the resolver', async () => {
    container.innerHTML = '<picture><source srcset="./a.png?v=1#x 1x, https://cdn.test/a.png 2x"><img src="./a.png?v=1#x" srcset="./b.png 2x"></picture>';
    await render(); await flush(); await flush();
    expect(reads.map(read => read.path)).toEqual(['/a/./a.png?v=1#x', '/a/./b.png']);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-1');
    expect(container.querySelector('source')?.getAttribute('srcset')).toBe('blob:test-1 1x, https://cdn.test/a.png 2x');
    expect(container.querySelector('img')?.getAttribute('srcset')).toBe('blob:test-2 2x');
    await render({ onOpenFile: () => {}, onError: () => {} }); await flush();
    expect(reads).toHaveLength(2);
    expect(revoked).toEqual([]);
  });

  test('restores owned src and srcset on hide, then reads unchanged HTML again on show', async () => {
    container.innerHTML = '<source srcset="a.png 1x, b.png 2x"><img src="a.png">';
    await render(); await flush();
    await render({ enabled: false }); await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('a.png');
    expect(container.querySelector('source')?.getAttribute('srcset')).toBe('a.png 1x, b.png 2x');
    expect(revoked).toEqual(created);
    expect(reads.every(read => read.signal.aborted)).toBe(true);
    await render(); await flush();
    expect(reads).toHaveLength(4);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-3');
  });

  test('treats a new transport object with the same key as a new source', async () => {
    container.innerHTML = '<img src="a.png">';
    await render(); await flush();
    const replacement: MarkdownAssetSource = {
      key: source.key,
      resolve: reference => `/b/${reference}`,
      readImage: async (path, signal) => { reads.push({ path, signal }); return new Blob(['b']); },
    };
    await render({ source: replacement }); await flush();
    expect(reads.map(read => read.path)).toEqual(['/a/a.png', '/b/a.png']);
    expect(reads[0]?.signal.aborted).toBe(true);
    expect(revoked).toEqual(['blob:test-1']);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-2');
  });

  test('aborts pending reads and creates no URL for a late result after source removal', async () => {
    const pending = deferredBlob();
    const oldSource: MarkdownAssetSource = { ...source, readImage: (path, signal) => { reads.push({ path, signal }); return pending.promise; } };
    container.innerHTML = '<img src="a.png">';
    await render({ source: oldSource });
    await render({ source: null });
    expect(reads[0]?.signal.aborted).toBe(true);
    pending.resolve(new Blob(['late'])); await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('a.png');
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
    await render(); await flush();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-1');
  });

  test('a late image result cannot overwrite a newer renderer attribute, and cleanup preserves the newer value', async () => {
    const pending = deferredBlob();
    source = { ...source, readImage: (path, signal) => { reads.push({ path, signal }); return pending.promise; } };
    container.innerHTML = '<img src="a.png">';
    await render();
    const image = container.querySelector('img');
    image?.setAttribute('src', 'https://cdn.test/new.png');
    pending.resolve(new Blob(['old'])); await flush();
    expect(image?.getAttribute('src')).toBe('https://cdn.test/new.png');
    await render({ enabled: false });
    expect(image?.getAttribute('src')).toBe('https://cdn.test/new.png');
    expect(revoked).toEqual(created);
  });

  test('keeps independent src and srcset generations when the renderer changes both while reads are pending', async () => {
    const old = deferredBlob();
    source = { ...source, readImage: (path, signal) => {
      reads.push({ path, signal });
      return path.includes('old') ? old.promise : Promise.resolve(new Blob(['new']));
    } };
    container.innerHTML = '<img src="old.png" srcset="old.png 1x">';
    await render();
    const image = container.querySelector('img');
    image?.setAttribute('src', 'new.png');
    image?.setAttribute('srcset', 'new.png 2x');
    await flush();
    old.resolve(new Blob(['old'])); await flush();
    expect(reads.map(read => read.path)).toEqual(['/a/old.png', '/a/new.png']);
    expect(image?.getAttribute('src')).toBe('blob:test-1');
    expect(image?.getAttribute('srcset')).toBe('blob:test-1 2x');
    await render({ enabled: false });
    expect(image?.getAttribute('src')).toBe('new.png');
    expect(image?.getAttribute('srcset')).toBe('new.png 2x');
  });

  test('follows app theme without rereading images and restores original media on disable', async () => {
    container.innerHTML = '<picture><source media="(prefers-color-scheme: dark)" srcset="a.png 1x"><img></picture>';
    await render(); await flush();
    const element = container.querySelector('source');
    expect(element?.getAttribute('media')).toBe('(max-width: -1px)');
    await render({ colorScheme: 'dark' }); await flush();
    expect(element?.getAttribute('media')).toBe('(min-width: 0px)');
    expect(reads).toHaveLength(1);
    await render({ enabled: false });
    expect(element?.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
    expect(element?.hasAttribute('data-oc-media')).toBe(false);
  });

  test('routes local links and fragments, reports resolver/read failures and leaves external/modified clicks alone', async () => {
    const opened: string[] = []; const failures: string[] = []; const headings: string[] = [];
    source = { ...source, resolve(reference) { if (reference.startsWith('../')) throw new Error('Outside root'); return `/a/${reference}`; }, readImage: async () => { throw new Error('Unavailable'); } };
    container.innerHTML = '<a href="note.md?q=x#h">local</a><a href="#next-step">heading</a><a href="../secret">escape</a><a href="https://cdn.test">external</a><h2>Next step!</h2><img src="fail.png"><img src="../image.png">';
    const heading = container.querySelector('h2');
    if (heading) heading.scrollIntoView = () => { headings.push('next'); };
    await render({ onOpenFile: path => opened.push(path), onError: reference => failures.push(reference) }); await flush();
    const click = (index: number, ctrlKey = false) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey });
      container.querySelectorAll('a')[index]?.dispatchEvent(event); return event.defaultPrevented;
    };
    expect(click(0)).toBe(true); expect(click(1)).toBe(true); expect(click(2)).toBe(true);
    expect(click(3)).toBe(false); expect(click(0, true)).toBe(false);
    expect(opened).toEqual(['/a/note.md?q=x#h']); expect(headings).toEqual(['next']);
    expect(failures).toContain('fail.png'); expect(failures).toContain('../image.png'); expect(failures).toContain('../secret');
  });

  test('can retry a failed image after a later renderer update without changing the source', async () => {
    let attempts = 0;
    source = { ...source, readImage: async (path, signal) => {
      reads.push({ path, signal }); attempts += 1;
      if (attempts === 1) throw new Error('Unavailable');
      return new Blob(['recovered']);
    } };
    container.innerHTML = '<img src="a.png">';
    await render(); await flush();
    expect(reads).toHaveLength(1);
    container.append(document.createElement('p'));
    await flush(); await flush();
    expect(reads).toHaveLength(2);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-1');
  });

  test('uses the latest navigation/error callbacks without resetting a loaded image', async () => {
    container.innerHTML = '<img src="a.png"><a href="note.md">link</a>';
    const opened: string[] = [];
    await render(); await flush();
    await render({ onOpenFile: path => opened.push(path) });
    container.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual(['/a/note.md']); expect(reads).toHaveLength(1); expect(revoked).toEqual([]);
  });
});
