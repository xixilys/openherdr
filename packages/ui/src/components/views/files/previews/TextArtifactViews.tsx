import React from 'react';
import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { JsonTreeView } from '@/components/ui/JsonTreeView';
import { useI18n } from '@/lib/i18n';

export function MarkdownFilePreview({ content, scrollerRef, onMouseDown, fontStyle, commentMenu, search, fullscreen = false }: {
  content: string;
  scrollerRef: React.Ref<HTMLDivElement>;
  onMouseDown: React.MouseEventHandler<HTMLDivElement>;
  fontStyle?: React.CSSProperties;
  commentMenu?: React.ReactNode;
  search?: React.ReactNode;
  fullscreen?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="relative h-full min-h-0">
      <div className={`oc-file-preview h-full overflow-auto ${fullscreen ? 'p-4' : 'p-3'} outline-none`}
        tabIndex={-1} onMouseDown={onMouseDown} ref={scrollerRef}>
        {commentMenu}
        {content.length > 500 * 1024 && (
          <div className="mb-3 rounded-md border border-status-warning/20 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
            {t('filesView.warning.largeFilePreviewLimited', { sizeKb: Math.round(content.length / 1024) })}
          </div>
        )}
        <ErrorBoundary fallback={
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
            <div className="mb-1 font-medium text-destructive">{t('filesView.error.previewUnavailable')}</div>
            <div className="text-sm text-muted-foreground">{t('filesView.error.switchToEditMode')}</div>
          </div>
        }>
          <div style={fontStyle}>
            <SimpleMarkdownRenderer content={content} className="typography-markdown-body" stripFrontmatter enableFileReferences={false} allowRawHtml />
          </div>
        </ErrorBoundary>
      </div>
      {search}
    </div>
  );
}

export function JsonFilePreview({ path, content }: { path: string; content: string }) {
  const { t } = useI18n();
  return (
    <ErrorBoundary fallback={
      <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
        <div className="mb-1 font-medium text-destructive">{t('filesView.error.jsonViewerUnavailable')}</div>
        <div className="text-sm text-muted-foreground">{t('filesView.error.switchToTextMode')}</div>
      </div>
    }>
      <div className="h-full overflow-auto">
        <JsonTreeView jsonString={content} format={path.toLowerCase().endsWith('.jsonc') ? 'jsonc' : 'json'} maxHeight="100%" initiallyExpandedDepth={2} />
      </div>
    </ErrorBoundary>
  );
}

export function MermaidFilePreview({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <ErrorBoundary fallback={
        <div className="m-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
          <div className="mb-1 font-medium text-destructive">{t('filesView.error.previewUnavailable')}</div>
          <div className="text-sm text-muted-foreground">{t('filesView.error.switchToEditMode')}</div>
        </div>
      }>
        <SimpleMarkdownRenderer content={`\`\`\`mermaid\n${content}\n\`\`\``} className="markdown-mermaid-fullscreen h-full" enableFileReferences={false} allowMermaidWheelEvents />
      </ErrorBoundary>
    </div>
  );
}
