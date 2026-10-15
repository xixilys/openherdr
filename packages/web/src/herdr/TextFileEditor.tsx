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
import { MarkdownFilePreview, JsonFilePreview, MermaidFilePreview } from '@/components/views/files/previews/TextArtifactViews';
import { ImageArtifact } from '@/components/views/files/previews/ImageArtifact';
import { TableArtifact } from '@/components/views/files/previews/TableArtifact';
import { useMarkdownAssetBindings, type MarkdownAssetSource } from '@/components/views/files/previews/useMarkdownAssetBindings';
import { MarkdownPreviewSearch } from '@/components/views/MarkdownPreviewSearch';
import { useFilePreviewScrollPosition } from '@/components/views/useFilePreviewScrollPosition';
import { MarkdownPresentationContext, type MarkdownPresentationSource } from '@/components/chat/MarkdownPresentationContext';
import { createFileEditorExtensions } from '@/lib/codemirror/fileEditorExtensions';
import { languageByExtension, loadLanguageByExtension } from '@/lib/codemirror/languageByExtension';
import { revealEditorSelectionAboveKeyboard } from '@/lib/codemirror/keyboardOcclusion';
import { useI18n } from '@/lib/i18n';
import { registerBackLayer } from '@/lib/mobileBackLayers';
import { openExternalUrl } from '@/lib/url';
import type { Theme } from '@/types/theme';
import { FilePreviewSourceError } from './file-preview-source';
import { textFilePreviewKind, type FileViewMode } from './file-view-mode';

const selectionMatches = highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 });

export function TextFileEditor({ id, server, root, path, content, baseContent, sizeBytes, mode, onModeChange, assetSource, onOpenFile, theme, enabled, readOnly, isMobile, onChange, onViewReady, onViewDestroy, onSave, canSave }: {
  id: string;
  server: string;
  root: string;
  path: string;
  content: string;
  baseContent: string;
  sizeBytes: number;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  assetSource: MarkdownAssetSource | null;
  onOpenFile: (path: string) => void;
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
  const kind = textFilePreviewKind(path);
  const previewAvailable = kind !== 'source';
  const [wrapLines, setWrapLines] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [markdownNode, setMarkdownNode] = useState<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const [markdownSearchOpen, setMarkdownSearchOpen] = useState(false);
  const [markdownFocusNonce, setMarkdownFocusNonce] = useState(0);
  const [assetFailure, setAssetFailure] = useState<{ source: MarkdownAssetSource; reference: string; error: Error } | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const staticLanguage = useMemo(() => languageByExtension(path), [path]);
  const [loadedLanguage, setLoadedLanguage] = useState<{ path: string; language: Extension | null } | null>(null);
  const preview = previewAvailable && mode === 'view';
  const markdownPreview = enabled && preview && kind === 'markdown';
  const editing = enabled && !preview;
  const { setScroller: connectMarkdownScroll } = useFilePreviewScrollPosition(markdownPreview ? JSON.stringify(['herdr-markdown-preview', id]) : null);
  const connectMarkdown = useCallback((node: HTMLDivElement | null) => {
    markdownRef.current = node;
    setMarkdownNode(node);
    connectMarkdownScroll(node);
  }, [connectMarkdownScroll]);
  useMarkdownAssetBindings({
    container: markdownNode, source: assetSource, enabled: markdownPreview,
    colorScheme: theme.metadata.variant, onOpenFile,
    onError: (reference, error) => { if (assetSource) setAssetFailure({ source: assetSource, reference, error }); },
    onImageBound: reference => setAssetFailure(previous => previous?.source === assetSource && previous.reference === reference ? null : previous),
  });
  const markdownSource = useMemo<MarkdownPresentationSource>(() => ({
    directory: root, runtimeKey: server, themeMode: theme.metadata.variant, theme,
    isVSCode: false, fileReferences: false, inlineImages: false, ownOrigins: [server],
    openExternalLink: url => { void openExternalUrl(url); },
  }), [root, server, theme]);
  const focusMarkdown = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable) return;
    markdownRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (!markdownPreview) setMarkdownSearchOpen(false); }, [markdownPreview]);
  const visibleAssetFailure = markdownPreview && assetFailure?.source === assetSource ? assetFailure : null;
  const assetFailureText = visibleAssetFailure?.error instanceof FilePreviewSourceError
    ? t(visibleAssetFailure.error.code === 'outside_root' ? 'filesView.artifact.localAsset.outsideProject'
      : visibleAssetFailure.error.code === 'not_image' ? 'filesView.artifact.localAsset.notImage' : 'filesView.artifact.localAsset.invalidReference')
    : t('filesView.error.readFileFailed');
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
    if (!enabled || !isMobile || (!searchOpen && !goToLineOpen && !markdownSearchOpen)) return;
    return registerBackLayer(() => { if (markdownSearchOpen) setMarkdownSearchOpen(false); else if (goToLineOpen) setGoToLineOpen(false); else setSearchOpen(false); });
  }, [enabled, isMobile, searchOpen, goToLineOpen, markdownSearchOpen]);
  const ready = useCallback((view: EditorView) => { viewRef.current = view; onViewReady(view); }, [onViewReady]);
  const destroyed = useCallback(() => { viewRef.current = null; onViewDestroy(); }, [onViewDestroy]);
  const controlSize = isMobile ? 'icon' : 'sm';
  const find = () => {
    setGoToLineOpen(false);
    if (markdownPreview) { setMarkdownSearchOpen(value => !value); setMarkdownFocusNonce(value => value + 1); }
    else setSearchOpen(value => !value);
  };
  return <MarkdownPresentationContext.Provider value={markdownSource}><div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={event => {
    if (enabled && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSave) onSave();
    }
    if (markdownPreview && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && !event.nativeEvent.isComposing) {
      event.preventDefault(); setMarkdownSearchOpen(true); setMarkdownFocusNonce(value => value + 1);
    }
  }}>
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1">
      <Button variant="ghost" size={controlSize} disabled={!editing && !markdownPreview} aria-label={t('filesView.editor.findInFile')} title={t('filesView.editor.findInFile')} aria-pressed={markdownPreview ? markdownSearchOpen : editing && searchOpen} onClick={find}><Icon name="search" className="size-4" /></Button>
      <Button variant="ghost" size={controlSize} disabled={!enabled || preview && kind !== 'code'} aria-label={t(wrapLines ? 'filesView.editor.disableLineWrap' : 'filesView.editor.enableLineWrap')} title={t(wrapLines ? 'filesView.editor.disableLineWrap' : 'filesView.editor.enableLineWrap')} aria-pressed={wrapLines} onClick={() => setWrapLines(value => !value)}><Icon name="text-wrap" className="size-4" /></Button>
      <Button variant="ghost" size={controlSize} data-go-to-line-toggle disabled={!editing} aria-label={t('filesView.editor.goToLine')} title={t('filesView.editor.goToLine')} aria-pressed={editing && goToLineOpen} onClick={() => { setSearchOpen(false); setGoToLineOpen(value => !value); }}><Icon name="menu-fold-2" className="size-4" /></Button>
      {previewAvailable && <div className="ms-auto">{kind === 'table'
        ? <Button variant="ghost" size={controlSize} disabled={!enabled} aria-label={t(preview ? 'filesView.artifact.table.showSource' : 'filesView.artifact.table.showTable')} title={t(preview ? 'filesView.artifact.table.showSource' : 'filesView.artifact.table.showTable')} aria-pressed={preview} onClick={() => onModeChange(preview ? 'edit' : 'view')}><Icon name={preview ? 'code-sslash' : 'table-2'} className="size-4" /></Button>
        : kind === 'json'
          ? <Button variant="ghost" size={controlSize} disabled={!enabled} aria-label={t(preview ? 'filesView.editor.switchToTextView' : 'filesView.editor.switchToTreeView')} title={t(preview ? 'filesView.editor.switchToTextView' : 'filesView.editor.switchToTreeView')} aria-pressed={preview} onClick={() => onModeChange(preview ? 'edit' : 'view')}><Icon name={preview ? 'code-sslash' : 'node-tree'} className="size-4" /></Button>
          : <PreviewToggleButton currentMode={preview ? 'preview' : 'edit'} size={isMobile ? 'icon' : 'sm'} disabled={!enabled} onToggle={() => onModeChange(preview ? 'edit' : 'view')} />}</div>}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div dir="ltr" className={editing ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <CodeMirrorEditor value={content} onChange={onChange} extensions={extensions} readOnly={readOnly || !editing} detached={!editing} onViewReady={ready} onViewDestroy={destroyed} searchOpen={editing && searchOpen} onSearchOpenChange={setSearchOpen} enableSearch className="min-h-0 flex-1 overflow-auto oc-surface-code" />
        <div hidden={!editing || !goToLineOpen}><GoToLineDialog open={editing && goToLineOpen} onOpenChange={setGoToLineOpen} viewRef={viewRef} /></div>
      </div>
      {visibleAssetFailure && <div role="alert" className="shrink-0 px-3 py-2 typography-meta text-[var(--status-error-text)]">{assetFailureText}<span className="ms-1 break-all" dir="ltr">{visibleAssetFailure.reference}</span></div>}
      {enabled && preview && (kind === 'code'
        ? <div dir="ltr" ref={setScroller} className="min-h-0 flex-1 overflow-auto oc-surface-code" data-code-preview><CodeFilePreview path={path} content={content} theme={theme} wrapLines={wrapLines} scroller={scroller} positionKey={JSON.stringify(['herdr-code-preview', id])} /></div>
        : <div className="min-h-0 flex-1" data-text-artifact={kind}>
          {kind === 'markdown' && <MarkdownFilePreview content={baseContent} scrollerRef={connectMarkdown} onMouseDown={focusMarkdown}
            search={<MarkdownPreviewSearch containerRef={markdownRef} open={markdownSearchOpen} onOpenChange={setMarkdownSearchOpen} focusNonce={markdownFocusNonce} />} />}
          {kind === 'json' && <JsonFilePreview path={path} content={baseContent} />}
          {kind === 'svg' && <ImageArtifact src={`data:image/svg+xml;utf8,${encodeURIComponent(baseContent)}`} name={path.split('/').at(-1) ?? path} sizeBytes={sizeBytes} />}
          {kind === 'mermaid' && <MermaidFilePreview content={baseContent} />}
          {kind === 'table' && <TableArtifact path={path} content={baseContent} sizeBytes={sizeBytes} />}
        </div>)}
    </div>
  </div></MarkdownPresentationContext.Provider>;
}
