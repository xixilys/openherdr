import React from 'react';
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
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

test('comments keep their session binding and default to enabled', () => {
  assert.throws(() => renderToString(
    <I18nProvider><PierreDiffViewer {...diff} /></I18nProvider>,
  ), /useSyncRuntime must be used within <SyncProvider>/);

  let requests = 0;
  const sdk = OpenCode.make({
    baseUrl: 'https://diff.test',
    fetch: async () => {
      requests++;
      throw new Error('Server rendering must not make an OpenCode request');
    },
  });
  assert.doesNotThrow(() => renderToString(
    <I18nProvider><SyncProvider sdk={sdk} directory=""><PierreDiffViewer {...diff} /></SyncProvider></I18nProvider>,
  ));
  expect(requests).toBe(0);
});
