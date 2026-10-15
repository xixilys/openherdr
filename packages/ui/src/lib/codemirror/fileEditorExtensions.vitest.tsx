import { expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { createFileEditorExtensions } from './fileEditorExtensions';
import { languageByExtension } from './languageByExtension';
import { getDefaultTheme } from '@/lib/theme/themes';

test('the shared builder preserves the supplied grammar and caller extensions', () => {
  const state = EditorState.create({ doc: 'const value: number = 1;', extensions: createFileEditorExtensions({
    theme: getDefaultTheme(false), path: 'source.ts', language: languageByExtension('source.ts'),
    fontSize: 15, wrapLines: true, isMobile: true, beforeEditingAids: [EditorState.tabSize.of(7)],
  }) });
  expect(state.facet(EditorState.tabSize)).toBe(7);
  expect(state.facet(EditorState.allowMultipleSelections)).toBe(false);
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.toString()).toContain('TypeAnnotation');
  expect(state.doc.toString()).toBe('const value: number = 1;');
});

test('desktop local editing aids retain multiple selection while mobile keeps native touch selection', () => {
  for (const isMobile of [true, false]) {
    const state = EditorState.create({ extensions: createFileEditorExtensions({ theme: getDefaultTheme(true), path: 'plain.txt', wrapLines: false, isMobile, vimMode: true }) });
    expect(state.facet(EditorState.allowMultipleSelections)).toBe(!isMobile);
  }
});

test('a missing selected path keeps the original theme-only configuration', () => {
  const state = EditorState.create({ extensions: createFileEditorExtensions({ theme: getDefaultTheme(false), path: null, wrapLines: true, isMobile: false, beforeEditingAids: [EditorState.tabSize.of(7)] }) });
  expect(state.facet(EditorState.tabSize)).toBe(4);
  expect(state.facet(EditorState.allowMultipleSelections)).toBe(false);
});
