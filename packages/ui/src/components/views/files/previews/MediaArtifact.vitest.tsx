import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { MediaArtifact } from './MediaArtifact';
import { I18nProvider } from '@/lib/i18n';

let dom: Window;
let host: HTMLDivElement;
let tree: Root;
let restore: () => void;
beforeEach(async () => {
  dom = new Window({ url: 'https://media-fixture.test' });
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLVideoElement: dom.HTMLVideoElement,
    Event: dom.Event, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  restore = () => { for (const name of Object.keys(globals)) { const descriptor = descriptors[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); tree = createRoot(host);
});
afterEach(async () => { await act(async () => tree.unmount()); await dom.happyDOM.close(); restore(); });
const render = ({ kind = 'audio', src = 'https://media-fixture.test/first', show = true, other = false }: { kind?: 'audio' | 'video'; src?: string; show?: boolean; other?: boolean } = {}) => act(async () => tree.render(<I18nProvider>
  <section data-player="selected">{show && <MediaArtifact kind={kind} src={src} name="Selected media" sizeBytes={100} download={<button>Download selected</button>} />}</section>
  {other && <section data-player="other"><MediaArtifact kind="audio" src="https://media-fixture.test/other" name="Other media" sizeBytes={50} /></section>}
</I18nProvider>));
const player = (owner = 'selected') => {
  const node = host.querySelector<HTMLMediaElement>(`[data-player="${owner}"] audio, [data-player="${owner}"] video`);
  if (!node) throw new Error('Missing actual media element');
  return node;
};
const recordCleanup = (node: HTMLMediaElement) => {
  const calls: string[] = [];
  node.pause = () => { calls.push('pause'); };
  node.load = () => { expect(node.hasAttribute('src')).toBe(false); calls.push('load'); };
  return calls;
};

for (const kind of ['audio', 'video'] as const) {
  test(`${kind} detach pauses its retained old node, clears its resource and loads once`, async () => {
    await render({ kind });
    const old = player(); const calls = recordCleanup(old);
    await render({ kind, show: false });
    expect(old.isConnected).toBe(false); expect(old.getAttribute('src')).toBeNull(); expect(calls).toEqual(['pause', 'load']);
    await render({ kind, show: false }); expect(calls).toEqual(['pause', 'load']);
  });
}

test('a keyed source replacement cleans the previous node while an unrelated player remains untouched', async () => {
  await render({ other: true });
  const old = player(); const other = player('other'); const calls = recordCleanup(old); const otherCalls = recordCleanup(other);
  await render({ src: 'https://media-fixture.test/replacement', other: true });
  expect(player()).not.toBe(old); expect(player().getAttribute('src')).toBe('https://media-fixture.test/replacement');
  expect(old.getAttribute('src')).toBeNull(); expect(calls).toEqual(['pause', 'load']);
  expect(player('other')).toBe(other); expect(other.getAttribute('src')).toBe('https://media-fixture.test/other'); expect(otherCalls).toEqual([]);
});

test('decode failure detaches and releases the failed video while retaining the original download fallback', async () => {
  await render({ kind: 'video', other: true });
  const failed = player(); const other = player('other'); const calls = recordCleanup(failed); const otherCalls = recordCleanup(other);
  await act(async () => failed.dispatchEvent(new Event('error')));
  expect(host.querySelector('[data-player="selected"] video')).toBeNull(); expect(failed.isConnected).toBe(false);
  expect(failed.getAttribute('src')).toBeNull(); expect(calls).toEqual(['pause', 'load']);
  expect(host.textContent).toContain('Download selected'); expect(player('other')).toBe(other); expect(otherCalls).toEqual([]);
});

test('metadata and unchanged renders keep the attached player; changing media kind cleans it', async () => {
  await render(); const audio = player(); const calls = recordCleanup(audio);
  Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
  await act(async () => audio.dispatchEvent(new Event('loadedmetadata')));
  await render(); expect(player()).toBe(audio); expect(calls).toEqual([]); expect(host.textContent).toContain('2:05');
  await render({ kind: 'video' }); expect(player().tagName).toBe('VIDEO'); expect(player()).not.toBe(audio);
  expect(audio.getAttribute('src')).toBeNull(); expect(calls).toEqual(['pause', 'load']);
});


test('StrictMode ref replay restores the same released player source without resetting ordinary renders', async () => {
  const src = 'https://media-fixture.test/strict';
  const strict = () => act(async () => tree.render(<React.StrictMode><I18nProvider><MediaArtifact kind="audio" src={src} name="Strict media" sizeBytes={100} /></I18nProvider></React.StrictMode>));
  await strict();
  const audio = host.querySelector<HTMLAudioElement>('audio');
  if (!audio) throw new Error('Missing StrictMode media element');
  expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBe(src); expect(audio.src).toBe(src);
  const calls = recordCleanup(audio);
  await strict(); expect(host.querySelector('audio')).toBe(audio); expect(audio.getAttribute('src')).toBe(src); expect(calls).toEqual([]);
  await act(async () => tree.render(<React.StrictMode><I18nProvider children={null} /></React.StrictMode>));
  expect(audio.getAttribute('src')).toBeNull(); expect(calls).toEqual(['pause', 'load']);
});
