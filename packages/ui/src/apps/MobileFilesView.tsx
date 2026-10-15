import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type MobileFilesRoute =
  | { type: 'browser'; directory: string }
  | { type: 'file'; path: string; returnDirectory: string };
type MobileFilesEntry = { name: string; path: string; isDirectory: boolean; size?: number; disabled?: boolean; actions?: React.ReactNode };
type MobileFilesSearchResult = { path: string };
type MobileFilesViewProps = {
  root: string;
  route: MobileFilesRoute;
  entries: MobileFilesEntry[];
  isLoadingDirectory: boolean;
  directoryError?: string | null;
  query: string;
  searchResults: MobileFilesSearchResult[];
  isSearching: boolean;
  onQueryChange: (query: string) => void;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onClose?: () => void;
  canUpload?: boolean;
  isUploading?: boolean;
  onUpload?: () => void;
  browserActions?: React.ReactNode;
  fileActions?: React.ReactNode;
  children?: React.ReactNode;
};

const getNameFromPath = (path: string): string => {
  if (!path || path === '/') return path || '/';
  return path.split('/').filter(Boolean).at(-1) ?? path;
};

const getParentDirectory = (path: string): string | null => {
  if (!path || path === '/') return null;
  const index = path.lastIndexOf('/');
  if (index <= 0) return path.startsWith('/') ? '/' : null;
  return path.slice(0, index);
};

const getRelativePath = (path: string, root: string): string => {
  if (!root || path === root) return getNameFromPath(path);
  const prefix = root === '/' ? '/' : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
};

const formatFileSize = (size?: number): string => {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return '';
};

/** The original phone file browser and file header; callers own I/O and editor state. */
export const MobileFilesView: React.FC<MobileFilesViewProps> = ({
  root, route, entries, isLoadingDirectory, directoryError, query, searchResults, isSearching,
  onQueryChange, onOpenDirectory: openDirectory, onOpenFile: openFile, onBack, onRefresh,
  onClose, canUpload, isUploading, onUpload, browserActions, fileActions, children,
}) => {
  const { t } = useI18n();
  if (!root) return <MobileFilesState loading={isLoadingDirectory} message={directoryError ?? (isLoadingDirectory ? t('common.loading') : t('mobile.files.empty.noDirectory'))} />;
  if (route.type === 'file') {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 border-b border-border/70 px-3 text-foreground">
          <Button variant="ghost" size="icon"
            type="button"
            className="-ms-1 flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('header.actions.backAria')}
            onClick={onBack}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="arrow-left" className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate typography-ui-header text-foreground">{getNameFromPath(route.path)}</h2>
          </div>
          {fileActions}
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
  const directoryLabel = route.directory === root ? t('mobile.files.rootDirectory') : getNameFromPath(route.directory);
  const visibleSearchResults = query.trim() ? searchResults : [];

  // Cap parent navigation at the project root: only allow stepping up while
  // the parent stays inside (or equal to) the root.
  const rawParent = getParentDirectory(route.directory);
  const parentWithinRoot =
    route.directory !== root && rawParent !== null && (rawParent === root || rawParent.startsWith(root === '/' ? '/' : `${root}/`));
  const canGoBack = parentWithinRoot && !query.trim();
  const parentDirectory = parentWithinRoot ? rawParent : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3 text-foreground">
        {onClose ? (
          <Button variant="ghost" size="icon"
            type="button"
            className="-ms-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('mobile.surface.closeAria')}
            onClick={onClose}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="close" className="size-5" />
          </Button>
        ) : null}
        {canGoBack && parentDirectory ? (
          <Button variant="ghost" size="icon"
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('mobile.files.backToParentAria', { name: getNameFromPath(parentDirectory) })}
            onClick={() => openDirectory(parentDirectory)}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="arrow-left" className="size-5" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1 px-1">
          <h2 className="truncate typography-ui-label text-foreground">{directoryLabel}</h2>
        </div>
        <Button variant="ghost" size="icon"
          type="button"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('mobile.files.refreshAria')}
          onClick={onRefresh}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="refresh" className={cn('size-5', isLoadingDirectory && 'animate-spin')} />
        </Button>
        {canUpload ? (
          <Button variant="ghost" size="icon"
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label={t('sidebarFilesTree.actions.uploadFilesTitle')}
            onClick={onUpload}
            disabled={isUploading}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name={isUploading ? 'loader-4' : 'upload-2'} className={cn('size-5', isUploading && 'animate-spin')} />
          </Button>
        ) : null}
      </header>
      <div className="shrink-0 px-4 pb-2 pt-1">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('mobile.files.search.placeholder')}
            className="h-11 ps-9"
          />
        </div>
      </div>

      {browserActions}
      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {directoryError ? (
          <MobileFilesState message={directoryError} />
        ) : query.trim() ? (
          <MobileSearchResults results={visibleSearchResults} isSearching={isSearching} root={root} onOpenFile={openFile} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--surface-elevated)]">
            {entries.length === 0 && !isLoadingDirectory ? (
              <div className="px-4 py-8 text-center typography-body text-muted-foreground">{t('mobile.files.empty.directory')}</div>
            ) : null}
            {entries.map((entry) => (
              <MobileFileRow
                key={entry.path}
                name={entry.name}
                path={entry.path}
                directory={entry.isDirectory}
                meta={entry.isDirectory ? undefined : formatFileSize(entry.size)}
                disabled={entry.disabled}
                actions={entry.actions}
                onClick={() => entry.isDirectory ? openDirectory(entry.path) : openFile(entry.path)}
              />
            ))}
          </div>
        )}
      </ScrollShadow>
    </div>
  );
};

const MobileFileRow: React.FC<{
  name: string;
  path: string;
  directory: boolean;
  meta?: string;
  onClick: () => void;
  disabled?: boolean;
  actions?: React.ReactNode;
}> = ({ name, path, directory, meta, onClick, disabled, actions }) => (
  <div className="flex items-center border-b border-border/70 last:border-b-0">
  <Button variant="ghost"
    type="button"
    className="flex min-h-14 rounded-none min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    onClick={onClick}
    disabled={disabled}
    style={{ touchAction: 'manipulation' }}
  >
    {directory ? (
      <Icon name="folder-3-fill" className="size-5 shrink-0 text-primary/80" />
    ) : (
      <FileTypeIcon filePath={path} className="size-5 shrink-0" />
    )}
    <span dir="auto" className="block min-w-0 flex-1 truncate typography-ui-label text-foreground">{name}</span>
    {meta ? <span className="shrink-0 typography-micro text-muted-foreground">{meta}</span> : null}
    {directory ? <Icon name="arrow-right-s" className="size-4 shrink-0 text-muted-foreground/60" /> : null}
  </Button>
  {actions}
  </div>
);

const MobileSearchResults: React.FC<{
  results: MobileFilesSearchResult[];
  root: string;
  isSearching: boolean;
  onOpenFile: (path: string) => void;
}> = ({ results, isSearching, root, onOpenFile }) => {
  const { t } = useI18n();
  if (isSearching) return <MobileFilesState loading message={t('common.loading')} />;
  if (results.length === 0) return <MobileFilesState message={t('mobile.files.search.empty')} />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--surface-elevated)]">
      {results.map((result) => (
        <MobileFileRow
          key={result.path}
          name={getNameFromPath(result.path)}
          path={result.path}
          directory={false}
          meta={getRelativePath(result.path, root)}
          onClick={() => onOpenFile(result.path)}
        />
      ))}
    </div>
  );
};


export const MobileFilesState: React.FC<{ message: string; loading?: boolean }> = ({ message, loading = false }) => (
  <div className="flex h-full items-center justify-center px-6 text-center">
    <div className="flex max-w-sm flex-col items-center gap-2">
      {loading ? <Icon name="loader-4" className="size-5 animate-spin text-muted-foreground" /> : <Icon name="folder-open-fill" className="size-6 text-muted-foreground" />}
      <p className="typography-ui-label font-semibold text-foreground">{message}</p>
    </div>
  </div>
);
