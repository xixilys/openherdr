import React from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { GitSubmoduleState } from '@/lib/api/types';
import type { Theme } from '@/types/theme';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { WhitespaceToggleIcon } from '@/components/views/WhitespaceToggleIcon';
import { PierreDiffViewer, type ContextExpansionRequest } from '@/components/views/PierreDiffViewer';
import { SubmoduleDiffSummary } from '@/components/views/SubmoduleDiffSummary';
import { getLanguageFromExtension, isImageFile } from '@/lib/toolHelpers';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface MobileDiffData {
  original: string;
  modified: string;
  isBinary?: boolean;
  fileDiff?: FileDiffMetadata;
  submodule?: GitSubmoduleState | null;
}

/** The file list scrolls independently of the original pinned commit footer. */
export const MobileWorkingChangesView: React.FC<{ children: React.ReactNode; commitFooter: React.ReactNode }> = ({ children, commitFooter }) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-hidden px-4 pt-4">{children}</div>
    <div className="shrink-0 border-t border-border/70 px-4 pb-4 pt-3">{commitFooter}</div>
  </div>
);

export const MobileChangesState: React.FC<{
  message: string;
  description?: string;
  loading?: boolean;
  icon?: boolean;
}> = ({ message, description, loading = false, icon = false }) => (
  <div className="flex h-full items-center justify-center px-6 text-center">
    <div className="flex max-w-sm flex-col items-center gap-2">
      {loading ? <Icon name="loader-4" className="size-5 animate-spin text-muted-foreground" /> : null}
      {icon ? <Icon name="git-branch" className="size-6 text-muted-foreground" /> : null}
      <p className="typography-ui-label font-semibold text-foreground">{message}</p>
      {description ? <p className="typography-meta text-muted-foreground">{description}</p> : null}
    </div>
  </div>
);

export interface MobileDiffDetailProps {
  path: string;
  subtitle?: string;
  diff: MobileDiffData | null;
  staged?: boolean;
  fileExists: boolean;
  unavailableReason?: 'nested_repository' | 'untracked_directory' | null;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onExpandContextRequest?: (request: ContextExpansionRequest) => void;
  pendingContextExpansion?: ContextExpansionRequest | null;
  contextLoading?: boolean;
  hideWhitespace: boolean;
  onHideWhitespaceChange: (value: boolean) => void;
  theme?: Theme;
  themeMode?: 'light' | 'dark';
  enableComments?: boolean;
}

export const MobileDiffDetail: React.FC<MobileDiffDetailProps> = ({ path, subtitle, diff, staged = false, fileExists, unavailableReason = null, error, onBack, onRetry, onExpandContextRequest, pendingContextExpansion, contextLoading, hideWhitespace, onHideWhitespaceChange, theme, themeMode, enableComments }) => {
  const { t } = useI18n();
  const language = React.useMemo(() => getLanguageFromExtension(path) || 'text', [path]);
  const whitespaceState = hideWhitespace ? t('diffView.whitespace.hidden') : t('diffView.whitespace.shown');

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-3 border-b border-border/70 px-3 text-foreground">
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('header.actions.backAria')}
          onClick={onBack}
        >
          <Icon name="arrow-left" className="size-5" />
        </button>
        <div className="min-w-0 flex-1 px-2">
          <h2 className="truncate typography-ui-header text-foreground">{path}</h2>
          {subtitle && <p className="truncate typography-meta text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          type="button"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            hideWhitespace ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-label={t('diffView.actions.hideWhitespace')}
          aria-pressed={hideWhitespace}
          title={whitespaceState}
          onClick={() => onHideWhitespaceChange(!hideWhitespace)}
        >
          <WhitespaceToggleIcon hidden={hideWhitespace} className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!fileExists ? (
          <MobileChangesState icon message={t('mobile.changes.diffDetail.missingTitle')} description={t('mobile.changes.diffDetail.missingDescription')} />
        ) : unavailableReason === 'nested_repository' ? (
          <MobileChangesState icon message={t('diffView.unavailable.nestedRepositoryTitle')} description={t('diffView.unavailable.nestedRepositoryDescription')} />
        ) : unavailableReason === 'untracked_directory' ? (
          <MobileChangesState icon message={t('diffView.unavailable.untrackedDirectoryTitle')} description={t('diffView.unavailable.untrackedDirectoryDescription')} />
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <p className="typography-ui-label font-semibold text-foreground">{t('mobile.changes.diffDetail.loadFailed')}</p>
              <p className="typography-meta text-muted-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('diffView.actions.retry')}</Button>
            </div>
          </div>
        ) : !diff ? (
          <MobileChangesState loading message={t('diffView.state.loadingDiff')} />
        ) : diff.submodule ? (
          <div className="p-3"><SubmoduleDiffSummary state={diff.submodule} staged={staged} /></div>
        ) : diff.isBinary ? (
          <MobileChangesState icon message={t('diffView.binary.unavailable')} />
        ) : isImageFile(path) && !diff.fileDiff ? (
          <MobileChangesState icon message={t('mobile.changes.diffDetail.imageUnavailable')} />
        ) : (
          <ScrollShadow
            className="h-full overflow-y-auto overflow-x-hidden p-3"
            data-diff-virtual-root
            data-diff-virtual-content
          >
            <PierreDiffViewer
              original={diff.original}
              modified={diff.modified}
              fileDiff={diff.fileDiff}
              language={language}
              fileName={path}
              renderSideBySide={false}
              wrapLines={true}
              hideWhitespace={hideWhitespace}
              layout="inline"
              theme={theme}
              themeMode={themeMode}
              enableComments={enableComments}
              onExpandContextRequest={onExpandContextRequest}
              pendingContextExpansion={pendingContextExpansion}
              contextLoading={contextLoading}
            />
          </ScrollShadow>
        )}
      </div>
    </div>
  );
};

