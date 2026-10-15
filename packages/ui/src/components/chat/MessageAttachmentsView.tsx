import React, { memo } from 'react';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { formatFileSize } from '@/lib/fileSize';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** URLs and actions are resolved by the source adapter before rendering. */
export interface MessageAttachmentItem {
  id: string;
  name: string;
  mime?: string;
  size?: number;
  previewUrl?: string;
  kind: 'image' | 'file' | 'issue' | 'diagram';
  icon?: IconName;
  compactOpenable?: boolean;
}

interface MessageAttachmentsViewProps {
  items: readonly MessageAttachmentItem[];
  compact?: boolean;
  className?: string;
  onOpen: (item: MessageAttachmentItem) => void;
}

export const MessageAttachmentsView = memo(({ items, compact = false, className, onOpen }: MessageAttachmentsViewProps) => {
  const { t } = useI18n();
  const images = items.filter((file) => file.kind === 'image' && file.previewUrl);
  const others = items.filter((file) => file.kind !== 'image');
  if (items.length === 0) return null;

  if (compact) {
    return (
      <div className={cn('space-y-1.5', className ?? 'mt-1.5')}>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {others.map((file) => {
              const fileName = file.name;
              const ext = fileName.split('.').pop() || '';
              const sizeText = formatFileSize(file.size);
              const issueLinkKind = file.kind === 'issue';
              return (
                <Tooltip key={file.id}>
                  <TooltipTrigger asChild>
                    {issueLinkKind ? (
                      <button
                        type="button"
                        onClick={() => {
                          onOpen(file);
                        }}
                        className="inline-flex items-center bg-muted/30 border border-border/30 typography-meta gap-1 px-2 py-0.5 rounded-lg text-foreground hover:text-primary transition-colors"
                      >
                        <Icon name={file.icon ?? 'attachment-2'} className="text-muted-foreground h-3.5 w-3.5" />
                        <div className="overflow-hidden max-w-[220px]">
                          <span dir="auto" className="truncate block oc-ui-start-align" title={fileName}>{fileName}</span>
                        </div>
                      </button>
                    ) : file.compactOpenable ? (
                      <button
                        type="button"
                        onClick={() => onOpen(file)}
                        className="inline-flex items-center bg-muted/30 border border-border/30 typography-meta gap-1 px-2 py-0.5 rounded-lg text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring"
                      >
                        <FileTypeIcon filePath={fileName} extension={ext} className="text-muted-foreground h-3.5 w-3.5" />
                        <div className="overflow-hidden max-w-[140px]">
                          <span dir="auto" className="truncate block oc-ui-start-align" title={fileName}>{fileName}</span>
                        </div>
                      </button>
                    ) : (
                      <div className="inline-flex items-center bg-muted/30 border border-border/30 typography-meta gap-1 px-2 py-0.5 rounded-lg">
                        {file.mime?.includes('pdf') ? (
                          <Icon name="file-pdf" className="text-muted-foreground h-3.5 w-3.5" />
                        ) : (
                          <FileTypeIcon filePath={fileName} extension={ext} className="text-muted-foreground h-3.5 w-3.5" />
                        )}
                        <div className="overflow-hidden max-w-[140px]">
                          <span dir="auto" className="truncate block oc-ui-start-align" title={fileName}>{fileName}</span>
                        </div>
                      </div>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{fileName}{sizeText ? ` (${sizeText})` : ''}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}

        {images.length > 0 && (
          <div className="overflow-x-auto -mx-1 px-1 py-0.5 scrollbar-thin">
            <div className="flex snap-x snap-mandatory gap-2">
              {images.map((file) => {
                const filename = file.name;

                return (
                  <Tooltip key={file.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onOpen(file)}
                        className="relative flex-none border border-border/40 bg-muted/10 overflow-hidden snap-start h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring"
                        aria-label={filename}
                      >
                        <img
                          src={file.previewUrl}
                          alt={filename}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                        />
                        <span className="sr-only">{filename}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6} className="typography-meta px-2 py-1">
                      {filename}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
      {items.map((file) => {
        const fileName = file.name;
        const isImage = file.kind === 'image';
        const sizeText = formatFileSize(file.size);
        const issueLinkKind = file.kind === 'issue';

        if (isImage && file.previewUrl) {
          return (
            <div
              key={file.id}
              className="relative aspect-video rounded-lg border border-border/40 bg-muted/10 overflow-hidden group"
            >
              <img
                src={file.previewUrl}
                alt={fileName}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-0 inset-s-0 inset-e-0 p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs font-medium truncate">{fileName}</p>
                {sizeText && <p className="text-xs opacity-80">{sizeText}</p>}
              </div>
            </div>
          );
        }

        if (issueLinkKind) {
          return (
            <Tooltip key={file.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(file);
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors text-start text-sm"
                >
                  <div className="flex-shrink-0">
                    <Icon name={file.icon ?? 'attachment-2'} className="text-muted-foreground h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p dir="auto" className="font-medium truncate oc-ui-start-align">{fileName}</p>
                    {sizeText && <p className="text-xs text-muted-foreground">{sizeText}</p>}
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{fileName}{sizeText ? ` (${sizeText})` : ''}</p>
              </TooltipContent>
            </Tooltip>
          );
        }

        if (file.kind === 'diagram') {
          return (
            <Tooltip key={file.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(file);
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors text-start cursor-pointer text-sm"
                >
                  <Icon name="file" className="text-muted-foreground shrink-0 h-4 w-4" />
                  <div className="flex-1 min-w-0">
                    <p dir="auto" className="font-medium truncate oc-ui-start-align">{fileName}</p>
                    <p className="text-xs text-status-info">{t('chat.fileAttachment.openInDiagram')}</p>
                  </div>
                  <Icon name="external-link" className="text-muted-foreground shrink-0 h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('chat.fileAttachment.openInDiagram')}</p>
              </TooltipContent>
            </Tooltip>
          );
        }

        return (
          <Tooltip key={file.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  onOpen(file);
                }}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors text-start text-sm"
              >
                <div className="flex-shrink-0">
                  {file.mime?.startsWith('image/') ? (
                    <Icon name="file-image" className="text-muted-foreground h-4 w-4" />
                  ) : file.mime?.includes('pdf') ? (
                    <Icon name="file-pdf" className="text-muted-foreground h-4 w-4" />
                  ) : (
                    <Icon name="file" className="text-muted-foreground h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p dir="auto" className="font-medium truncate oc-ui-start-align">{fileName}</p>
                  {sizeText && <p className="text-xs text-muted-foreground">{sizeText}</p>}
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{fileName}{sizeText ? ` (${sizeText})` : ''}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
});

MessageAttachmentsView.displayName = 'MessageAttachmentsView';
