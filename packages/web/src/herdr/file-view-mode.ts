import { initialFileTextMode } from '@/components/views/fileEditorContent';
import { isDelimitedTableFile, isDrawioFile, isExcalidrawFile, isMermaidFile, isSvgFile } from '@/lib/toolHelpers';

export type FileViewMode = 'edit' | 'view';
export type TextFilePreviewKind = 'code' | 'markdown' | 'json' | 'svg' | 'mermaid' | 'table' | 'source';

export function textFilePreviewKind(path: string): TextFilePreviewKind {
  if (isDrawioFile(path) || isExcalidrawFile(path) || /\.(html|htm)$/i.test(path)) return 'source';
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  if (/\.(json|jsonc|json5|geojson)$/i.test(path)) return 'json';
  if (isSvgFile(path)) return 'svg';
  if (isMermaidFile(path)) return 'mermaid';
  if (isDelimitedTableFile(path)) return 'table';
  return 'code';
}

/** Specialized artifacts use FilesView's shipped preview default. */
export function initialFileViewMode(path: string, content: string): FileViewMode {
  const kind = textFilePreviewKind(path);
  if (kind === 'source') return 'edit';
  return kind === 'code' ? initialFileTextMode(content) : 'view';
}
