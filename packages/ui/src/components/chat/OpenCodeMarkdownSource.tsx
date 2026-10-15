import React from 'react';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useUIStore } from '@/stores/useUIStore';
import { isDesktopShell, isVSCodeRuntime } from '@/lib/desktop';
import { getRuntimeApiBaseUrl, getRuntimeKey } from '@/lib/runtime-switch';
import { openSessionLink } from '@/lib/router/openSessionFromRoute';
import type { SessionLinkTarget } from '@/lib/sessionLinks';
import { useOpenChatLink } from './useOpenChatLink';
import type { MarkdownPresentationSource } from './MarkdownPresentationContext';

const resolveOwnOrigins = (): string[] => {
  if (!globalThis.window) return [];
  const origins = [window.location.origin];
  try {
    const apiOrigin = new URL(getRuntimeApiBaseUrl() || window.location.href, window.location.href).origin;
    if (!origins.includes(apiOrigin)) origins.push(apiOrigin);
  } catch {
    // An unparseable runtime address adds nothing.
  }
  return origins;
};

/** OpenCode session capabilities are loaded only by its own Markdown container. */
export default function OpenCodeMarkdownSource({ children }: { children: (source: MarkdownPresentationSource) => React.ReactNode }) {
  const { editor, runtime } = useRuntimeAPIs();
  const directory = useEffectiveDirectory() ?? '';
  const openContextPreview = useUIStore((state) => state.openContextPreview);
  const openLinksInBrowserPanel = useUIStore((state) => state.openLinksInBrowserPanel) && isDesktopShell();
  const openExternalLink = useOpenChatLink(directory);
  const previewLoopback = React.useCallback((url: string) => { if (directory) openContextPreview(directory, url); }, [directory, openContextPreview]);
  const runtimeKey = getRuntimeKey();
  const source = React.useMemo<MarkdownPresentationSource>(() => ({
    directory, runtimeKey, editor, isVSCode: runtime.isVSCode,
    fileReferences: true, inlineImages: true, ownOrigins: resolveOwnOrigins(), openExternalLink,
    openSessionLink: !isVSCodeRuntime() ? (target: SessionLinkTarget) => { void openSessionLink(target.sessionId, target.messageId); } : undefined,
    previewLoopback: directory && !openLinksInBrowserPanel ? previewLoopback : undefined,
  }), [directory, editor, openExternalLink, openLinksInBrowserPanel, previewLoopback, runtime.isVSCode, runtimeKey]);
  return children(source);
}
