import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Theme } from '@/types/theme';
import { getLanguageFromExtension } from '@/lib/toolHelpers';
import { getResolvedShikiTheme } from '@/lib/shiki/appThemeRegistry';
import { createFlexokiCodeMirrorTheme } from './flexokiTheme';
import { shikiHighlightExtension } from './shikiHighlight';
import { bracketAids, multipleCursors } from './editingAids';
import { codeFolding } from './codeFolding';

type FileEditorExtensionsOptions = {
  theme: Theme;
  path: string | null;
  language?: Extension | null;
  fontSize?: number;
  wrapLines: boolean;
  isMobile: boolean;
  vimMode?: boolean;
  /** Caller-owned change markers and edit listeners retain their original order. */
  beforeEditingAids?: readonly Extension[];
};

/** Shared source-editor appearance and local editing aids, without runtime state. */
export function createFileEditorExtensions({
  theme, path, language, fontSize, wrapLines, isMobile, vimMode = false, beforeEditingAids = [],
}: FileEditorExtensionsOptions): Extension[] {
  if (!path) return [createFlexokiCodeMirrorTheme(theme, { fontSize })];

  const shikiLanguage = getLanguageFromExtension(path);
  const extensions: Extension[] = [createFlexokiCodeMirrorTheme(theme, { syntaxColors: !shikiLanguage, fontSize })];
  if (language) extensions.push(language);
  if (shikiLanguage) {
    extensions.push(shikiHighlightExtension({
      language: shikiLanguage,
      themeName: theme.metadata.id,
      theme: getResolvedShikiTheme(theme),
    }));
  }
  if (wrapLines) extensions.push(EditorView.lineWrapping);
  extensions.push(...beforeEditingAids, bracketAids());
  if (!isMobile) extensions.push(codeFolding(), multipleCursors({ vimMode }));
  return extensions;
}
