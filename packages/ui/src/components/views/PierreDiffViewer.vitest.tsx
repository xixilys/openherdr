import React from 'react';
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { renderToPipeableStream, renderToString } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { Window } from 'happy-dom';
import { OpenCode } from '@opencode/client';
import { I18nProvider } from '@/lib/i18n';
import { SyncProvider } from '@/sync/sync-context';
import { PierreDiffViewer } from './PierreDiffViewer';

const diff = {
  original: 'const value = 1;\n',
  modified: 'const value = 2;\n',
  language: 'typescript',
  fileName: 'example.ts',
  renderSideBySide: false,
};

test('read-only diffs render without an OpenCode sync or theme provider', () => {
  for (const themeMode of ['light', 'dark'] as const) {
    assert.doesNotThrow(() => renderToString(
      <I18nProvider><PierreDiffViewer {...diff} enableComments={false} themeMode={themeMode} /></I18nProvider>,
    ));
  }
});

const renderResolved = async (content: React.ReactNode) => {
  const errors: unknown[] = [];
  let html = '';
  await new Promise<void>((resolve, reject) => {
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => { html += chunk.toString(); });
    output.on('end', resolve);
    output.on('error', reject);
    const stream = renderToPipeableStream(content, {
      onAllReady: () => stream.pipe(output),
      onError: error => { errors.push(error); },
    });
  });
  return { html, errors };
};

test('comments resolve their real default session binding and require SyncProvider', async () => {
  // Wait for the lazy binding. A synchronous SSR render would only inspect
  // Suspense's initial fallback and never exercise the comment controller.
  const missing = await renderResolved(
    <I18nProvider><PierreDiffViewer {...diff} /></I18nProvider>,
  );
  expect(missing.errors).toHaveLength(1);
  expect(missing.errors[0]).toBeInstanceOf(Error);
  expect(String(missing.errors[0])).toContain('useSyncRuntime must be used within <SyncProvider>');

  let requests = 0;
  const sdk = OpenCode.make({
    baseUrl: 'https://diff.test',
    fetch: async () => {
      requests++;
      throw new Error('Server rendering must not make an OpenCode request');
    },
  });
  const dom = new Window({ url: 'https://diff.test' });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: dom, configurable: true, writable: true });
  try {
    const bound = await renderResolved(
      <I18nProvider><SyncProvider sdk={sdk} directory=""><PierreDiffViewer {...diff} /></SyncProvider></I18nProvider>,
    );
    expect(bound.errors).toEqual([]);
    expect(bound.html).toContain('pierre-diff-wrapper');
    expect(bound.html).not.toContain('<template');
    expect(requests).toBe(0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    await dom.happyDOM.close();
  }
});
