import React from 'react';

import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { isFilePathWithinDirectory, toAbsoluteFilePath } from '@/lib/path-utils';
import { useMarkdownAssetBindings, type MarkdownAssetSource } from './useMarkdownAssetBindings';

const MAX_LOCAL_IMAGE_BYTES = 25 * 1024 * 1024;

/** Original runtime adapter, including the file viewer's outside-workspace reads. */
export const useMarkdownLocalAssets = ({ container, filePath, workspaceRoot, onOpenFile, enabled, colorScheme }: {
  container: HTMLElement | null;
  filePath: string | null;
  workspaceRoot: string | null;
  onOpenFile: (absolutePath: string) => void;
  enabled: boolean;
  colorScheme: 'light' | 'dark';
}) => {
  const runtimeKey = getRuntimeKey();
  const source = React.useMemo<MarkdownAssetSource | null>(() => {
    if (!filePath) return null;
    const baseDirectory = filePath.slice(0, filePath.lastIndexOf('/') + 1) || '/';
    return {
      key: JSON.stringify([runtimeKey, filePath, workspaceRoot]),
      resolve(reference) {
        const path = reference.split(/[?#]/, 1)[0] ?? '';
        let decoded = path;
        try { decoded = decodeURIComponent(path); } catch { /* Preserve the original file viewer's literal-path fallback. */ }
        return toAbsoluteFilePath(baseDirectory, decoded);
      },
      async readImage(path, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) controller.abort();
        const deadline = setTimeout(abort, 30_000);
        try {
          const response = await runtimeFetch('/api/fs/raw', {
            query: {
              path,
              allowOutsideWorkspace: workspaceRoot && isFilePathWithinDirectory(path, workspaceRoot) ? undefined : 'true',
              directory: workspaceRoot || undefined,
            },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Image read failed (${response.status})`);
          const blob = await response.blob();
          if (blob.size > MAX_LOCAL_IMAGE_BYTES) throw new Error('Image too large for preview');
          if (controller.signal.aborted || getRuntimeKey() !== runtimeKey) throw new Error('Preview closed');
          return blob;
        } finally {
          clearTimeout(deadline);
          signal.removeEventListener('abort', abort);
        }
      },
    };
  }, [filePath, workspaceRoot, runtimeKey]);
  useMarkdownAssetBindings({ container, source, onOpenFile, enabled, colorScheme });
};
