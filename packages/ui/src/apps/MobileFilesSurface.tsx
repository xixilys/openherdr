import React from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { MobileFilesView, MobileFilesState, type MobileFilesRoute } from './MobileFilesView';
import { useFileTreeUpload } from '@/components/views/files/useFileTreeUpload';
import { AUTO_RELIST_MAX_ENTRIES, useFileTreeChanges, type FileTreeChangeBatch } from '@/components/views/files/useFileTreeChanges';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { useFilesViewShowGitignored } from '@/lib/filesViewShowGitignored';
import type { FileListEntry, FileSearchResult } from '@/lib/api/types';
import { useFilesViewTabsStore } from '@/stores/useFilesViewTabsStore';
import { useUIStore } from '@/stores/useUIStore';
import { normalizePath as normalizePathImpl } from '@/lib/pathNormalization';

// The full desktop file editor, loaded on demand — it's a heavy chunk and only
// needed once a file is actually opened.
const LazyFilesEditor = React.lazy(() =>
  import('@/components/views/FilesView').then((module) => ({ default: module.FilesView })),
);

const normalizePath = (value: string | null | undefined): string => normalizePathImpl(value) ?? '';

type MobileFilesSurfaceProps = {
  /** When provided, the header gets a close X that calls this. */
  onClose?: () => void;
  /** The surface is on screen; file changes wait for it. */
  visible?: boolean;
};

export const MobileFilesSurface: React.FC<MobileFilesSurfaceProps> = ({ onClose, visible = true }) => {
  const root = normalizePath(useEffectiveDirectory() ?? null);
  return <MobileFilesSurfaceForRoot key={root} root={root} onClose={onClose} visible={visible} />;
};

const MobileFilesSurfaceForRoot: React.FC<MobileFilesSurfaceProps & { root: string; visible: boolean }> = ({ root, onClose, visible }) => {
  const { t } = useI18n();
  const { files } = useRuntimeAPIs();
  const showGitignored = useFilesViewShowGitignored();
  const setSelectedPath = useFilesViewTabsStore((state) => state.setSelectedPath);
  const [route, setRoute] = React.useState<MobileFilesRoute>(() => ({ type: 'browser', directory: root }));
  const [entries, setEntries] = React.useState<FileListEntry[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = React.useState(false);
  const [directoryError, setDirectoryError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const directoryLoadRequestIdRef = React.useRef(0);

  const currentDirectory = route.type === 'browser' ? route.directory : route.returnDirectory;
  const currentDirectoryRef = React.useRef(currentDirectory);
  currentDirectoryRef.current = currentDirectory;

  // A background reload (a file change, not a navigation) keeps the listing
  // on screen when it fails.
  const loadDirectory = React.useCallback(async (directory: string, options?: { background?: boolean }) => {
    if (!directory) return;
    const respectGitignore = !showGitignored;
    const requestId = directoryLoadRequestIdRef.current + 1;
    directoryLoadRequestIdRef.current = requestId;
    setIsLoadingDirectory(true);
    if (!options?.background) setDirectoryError(null);
    try {
      const result = await files.listDirectory(directory, { respectGitignore });
      if (directoryLoadRequestIdRef.current !== requestId) return;
      setDirectoryError(null);
      setEntries(result.entries.slice().sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
    } catch (error) {
      if (directoryLoadRequestIdRef.current !== requestId) return;
      if (options?.background) {
        console.error('Failed to reload mobile directory:', error);
        return;
      }
      setEntries([]);
      setDirectoryError(error instanceof Error ? error.message : t('mobile.files.error.listFailed'));
    } finally {
      if (directoryLoadRequestIdRef.current === requestId) {
        setIsLoadingDirectory(false);
      }
    }
  }, [files, showGitignored, t]);

  React.useEffect(() => {
    if (route.type !== 'browser') return;
    void loadDirectory(route.directory);
  }, [loadDirectory, route]);

  // The folder on screen reloads when the agent changed it, also after the
  // drawer was closed meanwhile; a file being viewed reloads its folder on return.
  const routeRef = React.useRef(route);
  routeRef.current = route;
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;
  const reloadChangedDirectory = React.useCallback(({ directories }: FileTreeChangeBatch) => {
    const current = routeRef.current;
    if (current.type !== 'browser') return;
    if (directories && !directories.some((directory) => normalizePath(directory) === normalizePath(current.directory))) return;
    if (entriesRef.current.length > AUTO_RELIST_MAX_ENTRIES) return;
    void loadDirectory(current.directory, { background: true });
  }, [loadDirectory]);
  useFileTreeChanges({ root, active: visible, whileInactive: 'hold', onChanges: reloadChangedDirectory });

  // Reload the listing only when the upload landed in the folder still on screen.
  const refreshUploadedDirectory = React.useCallback(async (directory: string) => {
    if (normalizePath(directory) !== normalizePath(currentDirectoryRef.current)) return;
    await loadDirectory(currentDirectoryRef.current);
  }, [loadDirectory]);

  const { canUpload, uploadingDirectory, pickFiles, uploadElements } = useFileTreeUpload({
    root,
    refreshDirectory: refreshUploadedDirectory,
  });
  const isUploading = uploadingDirectory !== null;

  React.useEffect(() => {
    if (route.type !== 'browser') return;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      void files.search({ directory: route.directory, query: normalizedQuery, maxResults: 40 })
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [files, query, route]);

  const openDirectory = (directory: string) => {
    setQuery('');
    setRoute({ type: 'browser', directory });
  };

  const openFile = (path: string) => {
    // FilesView (editor-only) reads its target from the files-view tabs store.
    setSelectedPath(root, path);
    setRoute({ type: 'file', path, returnDirectory: currentDirectory || root });
  };

  // Chat tool rows (read/skill/edit) stage a pending file focus/navigation in
  // the UI store — the same channel desktop's context panel consumes. Route
  // straight to the editor for any requested target, inside or outside this
  // workspace: a skill or an agent output under /tmp is a real file the user
  // asked to read, and the editor reads it through allowOutsideWorkspace. The
  // browser tree itself stays rooted at `root`.
  const pendingFileFocusPath = useUIStore((state) => state.pendingFileFocusPath);
  const pendingFileNavigation = useUIStore((state) => state.pendingFileNavigation);
  React.useEffect(() => {
    const target = normalizePath(pendingFileNavigation?.path ?? pendingFileFocusPath ?? '');
    if (!target || !root) return;
    setSelectedPath(root, target, { allowOutsideRoot: true });
    setRoute({ type: 'file', path: target, returnDirectory: root });
    if (pendingFileFocusPath) useUIStore.getState().setPendingFileFocusPath(null);
  }, [pendingFileFocusPath, pendingFileNavigation, root, setSelectedPath]);

  return <MobileFilesView
    root={root} route={route} entries={entries} isLoadingDirectory={isLoadingDirectory}
    directoryError={directoryError} query={query} searchResults={searchResults} isSearching={isSearching}
    onQueryChange={setQuery} onOpenDirectory={openDirectory} onOpenFile={openFile}
    onBack={() => route.type === 'file' && setRoute({ type: 'browser', directory: route.returnDirectory })}
    onRefresh={() => void loadDirectory(currentDirectory)} onClose={onClose}
    canUpload={canUpload} isUploading={isUploading} onUpload={() => pickFiles(currentDirectory)}
    browserActions={uploadElements}
  >
    <ErrorBoundary>
      <React.Suspense fallback={<MobileFilesState loading message={t('filesView.state.loading')} />}>
        <LazyFilesEditor mode="editor-only" />
      </React.Suspense>
    </ErrorBoundary>
  </MobileFilesView>;
};
