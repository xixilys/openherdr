import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { highlightSelectionMatches } from '@codemirror/search';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';
import { GoToLineDialog } from '@/components/views/GoToLineDialog';
import { PreviewToggleButton } from '@/components/views/PreviewToggleButton';
import { CodeFilePreview } from '@/components/views/files/CodeFilePreview';
import { initialFileTextMode } from '@/components/views/fileEditorContent';
import { createFileEditorExtensions } from '@/lib/codemirror/fileEditorExtensions';
import { languageByExtension, loadLanguageByExtension } from '@/lib/codemirror/languageByExtension';
import { revealEditorSelectionAboveKeyboard } from '@/lib/codemirror/keyboardOcclusion';
import { useI18n } from '@/lib/i18n';
import { registerBackLayer } from '@/lib/mobileBackLayers';
import { isDelimitedTableFile, isDrawioFile, isExcalidrawFile, isMermaidFile, isSvgFile } from '@/lib/toolHelpers';
import type { Theme } from '@/types/theme';

const selectionMatches = highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 });

// These formats have separate rendered-artifact flows in the original viewer.
const hasCodePreview = (path: string) => !/\.(md|markdown|json|jsonc|json5|geojson|html|htm)$/i.test(path)
  && !isDrawioFile(path) && !isExcalidrawFile(path) && !isMermaidFile(path) && !isDelimitedTableFile(path) && !isSvgFile(path);

export function TextFileEditor({ id, path, content, theme, enabled, readOnly, isMobile, onChange, onViewReady, onViewDestroy, onSave, canSave }: {
  id: string;
  path: string;
  content: string;
  theme: Theme;
  enabled: boolean;
  readOnly: boolean;
  isMobile: boolean;
  onChange: (content: string) => void;
  onViewReady: (view: EditorView) => void;
  onViewDestroy: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const { t } = useI18n();
  const previewAvailable = hasCodePreview(path);
  const [mode, setMode] = useState(() => previewAvailable ? initialFileTextMode(content) : 'edit');
  const [wrapLines, setWrapLines] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const staticLanguage = useMemo(() => languageByExtension(path), [path]);
  const [loadedLanguage, setLoadedLanguage] = useState<{ path: string; language: Extension | null } | null>(null);
  const preview = previewAvailable && mode === 'view';
  const editing = enabled && !preview;
  useEffect(() => {
    if (!editing || staticLanguage) return;
    let cancelled = false;
    void loadLanguageByExtension(path).then(language => { if (!cancelled) setLoadedLanguage({ path, language }); });
    return () => { cancelled = true; };
  }, [path, staticLanguage, editing]);
  useEffect(() => {
    if (!editing) { setSearchOpen(false); setGoToLineOpen(false); }
  }, [editing]);
  const keyboardExtension = useMemo(() => EditorView.updateListener.of(update => {
    if (!editing || !isMobile || !update.view.hasFocus || !(update.selectionSet || update.focusChanged || update.viewportChanged || update.geometryChanged)) return;
    requestAnimationFrame(() => { if (viewRef.current === update.view) revealEditorSelectionAboveKeyboard(update.view); });
  }), [editing, isMobile]);
  const extensions = useMemo(() => editing ? createFileEditorExtensions({
    theme, path, language: staticLanguage ?? (loadedLanguage?.path === path ? loadedLanguage.language : null),
    wrapLines, isMobile, beforeEditingAids: [selectionMatches, keyboardExtension],
  }) : [], [editing, theme, path, staticLanguage, loadedLanguage, wrapLines, isMobile, keyboardExtension]);
  useEffect(() => {
    if (!editing || !isMobile) return;
    let frame: number | null = null;
    const nudge = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; revealEditorSelectionAboveKeyboard(viewRef.current); });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', nudge);
    viewport?.addEventListener('scroll', nudge, { passive: true });
    document.addEventListener('selectionchange', nudge);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', nudge);
      viewport?.removeEventListener('scroll', nudge);
      document.removeEventListener('selectionchange', nudge);
    };
  }, [editing, isMobile]);
  useEffect(() => {
    if (!editing || !isMobile || (!searchOpen && !goToLineOpen)) return;
    return registerBackLayer(() => { if (goToLineOpen) setGoToLineOpen(false); else setSearchOpen(false); });
  }, [editing, isMobile, searchOpen, goToLineOpen]);
  const ready = useCallback((view: EditorView) => { viewRef.current = view; onViewReady(view); }, [onViewReady]);
  const destroyed = useCallback(() => { viewRef.current = null; onViewDestroy(); }, [onViewDestroy]);
  const controlSize = isMobile ? 'icon' : 'sm';
  return <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={event => {
    if (enabled && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSave) onSave();
    }
  }}>
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1">
      <Button variant="ghost" size={controlSize} disabled={!editing} aria-label={t('filesView.editor.findInFile')} title={t('filesView.editor.findInFile')} aria-pressed={editing && searchOpen} onClick={() => { setGoToLineOpen(false); setSearchOpen(value => !value); }}><Icon name="search" className="size-4" /></Button>
      <Button variant="ghost" size={controlSize} disabled={!enabled} aria-label={t(wrapLines ? 'filesView.editor.disableLineWrap' : 'filesView.editor.enableLineWrap')} title={t(wrapLines ? 'filesView.editor.disableLineWrap' : 'filesView.editor.enableLineWrap')} aria-pressed={wrapLines} onClick={() => setWrapLines(value => !value)}><Icon name="text-wrap" className="size-4" /></Button>
      <Button variant="ghost" size={controlSize} data-go-to-line-toggle disabled={!editing} aria-label={t('filesView.editor.goToLine')} title={t('filesView.editor.goToLine')} aria-pressed={editing && goToLineOpen} onClick={() => { setSearchOpen(false); setGoToLineOpen(value => !value); }}><Icon name="menu-fold-2" className="size-4" /></Button>
      {previewAvailable && <div className="ms-auto"><PreviewToggleButton currentMode={preview ? 'preview' : 'edit'} size={isMobile ? 'icon' : 'sm'} disabled={!enabled} onToggle={() => setMode(preview ? 'edit' : 'view')} /></div>}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col" dir="ltr">
      <CodeMirrorEditor value={content} onChange={onChange} extensions={extensions} readOnly={readOnly || !editing} detached={!editing} onViewReady={ready} onViewDestroy={destroyed} searchOpen={editing && searchOpen} onSearchOpenChange={setSearchOpen} enableSearch className={editing ? 'min-h-0 flex-1 overflow-auto oc-surface-code' : 'hidden'} />
      <div hidden={!editing || !goToLineOpen}><GoToLineDialog open={editing && goToLineOpen} onOpenChange={setGoToLineOpen} viewRef={viewRef} /></div>
      {enabled && preview && <div ref={setScroller} className="min-h-0 flex-1 overflow-auto oc-surface-code" data-code-preview><CodeFilePreview path={path} content={content} theme={theme} wrapLines={wrapLines} scroller={scroller} positionKey={JSON.stringify(['herdr-code-preview', id])} /></div>}
    </div>
  </div>;
}
