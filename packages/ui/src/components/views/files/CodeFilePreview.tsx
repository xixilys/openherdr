import React from 'react';
import { File as PierreFile, VirtualizerContext, WorkerPoolContext } from '@pierre/diffs/react';
import type { Theme } from '@/types/theme';
import { useWorkerPool } from '@/contexts/DiffWorkerProvider';
import { ensurePierreThemeRegistered } from '@/lib/shiki/appThemeRegistry';
import { getDefaultTheme } from '@/lib/theme/themes';
import { getLanguageFromExtension } from '@/lib/toolHelpers';
import { LARGE_FILE_CHAR_THRESHOLD, makeFileContentCacheKey } from '../fileEditorContent';
import { useFileViewVirtualizer } from '../useFileViewVirtualizer';
import { useFilePreviewScrollPosition } from '../useFilePreviewScrollPosition';

type CodeFilePreviewProps = {
  path: string;
  name?: string;
  content: string;
  theme: Theme;
  lightTheme?: Theme;
  darkTheme?: Theme;
  wrapLines: boolean;
  /** The caller owns the actual scrolling element around the preview. */
  scroller: HTMLElement | null;
  /** Includes runtime, directory, file and preview surface identity. */
  positionKey: string | null;
};

/** The original full-text Pierre preview, independent of FilesView's controller. */
export function CodeFilePreview({ path, name, content, theme, lightTheme, darkTheme, wrapLines, scroller, positionKey }: CodeFilePreviewProps) {
  const light = lightTheme ?? (theme.metadata.variant === 'light' ? theme : getDefaultTheme(false));
  const dark = darkTheme ?? (theme.metadata.variant === 'dark' ? theme : getDefaultTheme(true));
  ensurePierreThemeRegistered(light);
  ensurePierreThemeRegistered(dark);
  const pierreTheme = React.useMemo(() => ({ light: light.metadata.id, dark: dark.metadata.id }), [light.metadata.id, dark.metadata.id]);
  const virtualizer = useFileViewVirtualizer();
  const { setScroller: connectVirtualizer } = virtualizer;
  const { setScroller: connectScrollPosition, restore } = useFilePreviewScrollPosition(positionKey);
  React.useLayoutEffect(() => {
    if (!scroller) return;
    connectVirtualizer(scroller);
    connectScrollPosition(scroller);
    return () => {
      connectVirtualizer(null);
      connectScrollPosition(null);
    };
  }, [connectScrollPosition, connectVirtualizer, scroller]);

  const workerPool = useWorkerPool('unified');
  const isLarge = content.length > LARGE_FILE_CHAR_THRESHOLD;
  const cacheKey = React.useMemo(() => isLarge ? `${path}:${makeFileContentCacheKey(content)}` : undefined, [content, isLarge, path]);
  // Pierre prepares and finalizes virtual layouts against the same FileContents
  // object, even when its cache key identifies equivalent incoming contents.
  const file = React.useMemo(() => ({
    name: name ?? path.split('/').at(-1) ?? path,
    contents: content,
    lang: getLanguageFromExtension(path) || undefined,
    cacheKey,
  }), [cacheKey, content, name, path]);
  const preview = <PierreFile
    key={isLarge ? `${path}:${workerPool ? 'pool' : 'pending'}` : path}
    file={file}
    options={{
      disableFileHeader: true,
      overflow: wrapLines ? 'wrap' : 'scroll',
      theme: pierreTheme,
      themeType: theme.metadata.variant === 'dark' ? 'dark' : 'light',
      onPostRender: restore,
    }}
    className={isLarge ? 'block w-full' : 'block h-full w-full'}
    style={isLarge ? undefined : { height: '100%' }}
  />;
  return <div className="h-full">{isLarge ? (
    <VirtualizerContext.Provider value={virtualizer.virtualizer}>
      <WorkerPoolContext.Provider value={workerPool}>{preview}</WorkerPoolContext.Provider>
    </VirtualizerContext.Provider>
  ) : preview}</div>;
}
