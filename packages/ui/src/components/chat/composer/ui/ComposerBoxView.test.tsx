import React, { act } from 'react';
import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { ComposerBoxView } from './ComposerBoxView';

test('the original frame keeps its ref, radius, expansion, dictation marker and drag handlers', async () => {
  const dom = new Window();
  const globals = { window: dom, document: dom.document, navigator: dom.navigator, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); const box = React.createRef<HTMLDivElement>();
  const events: string[] = [];
  try {
    await act(async () => root.render(<ComposerBoxView radius="var(--radius-xl)" expanded boxRef={box} boxProps={{
      className: 'ring-2 ring-primary ring-offset-2', 'data-composer-box': 'true', 'data-dictating': 'true',
      onDropCapture: () => events.push('capture'), onDrop: () => events.push('drop'),
      onDragEnter: () => events.push('enter'), onDragOver: () => events.push('over'),
      onDragLeave: () => events.push('leave'), onDragEnd: () => events.push('end'),
    }}><div data-original-editor /><div data-original-footer /></ComposerBoxView>));
    const node = box.current;
    expect(node).toBe(container.querySelector('[data-composer-box]'));
    expect(node?.style.borderRadius).toBe('var(--radius-xl)');
    expect(node?.parentElement?.style.borderRadius).toBe('var(--radius-xl)');
    expect(node?.classList.contains('oc-surface-floating')).toBe(true);
    expect(node?.classList.contains('ring-2')).toBe(true);
    expect(node?.classList.contains('flex-1')).toBe(true);
    expect(node?.parentElement?.classList.contains('flex-1')).toBe(true);
    expect(node?.getAttribute('data-dictating')).toBe('true');
    expect(node?.querySelector('[data-original-footer]')).not.toBeNull();
    await act(async () => {
      for (const name of ['dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) node?.dispatchEvent(new Event(name, { bubbles: true }));
    });
    expect(events).toEqual(['enter', 'over', 'leave', 'capture', 'drop', 'end']);
  } finally {
    await act(async () => root.unmount()); dom.happyDOM.cancelAsync();
    for (const name of Object.keys(globals)) { const old = previous[name]; if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); }
  }
});
