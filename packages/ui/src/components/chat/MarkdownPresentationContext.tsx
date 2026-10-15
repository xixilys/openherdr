import React from 'react';
import type { EditorAPI } from '@/lib/api/types';
import type { SessionLinkTarget } from '@/lib/sessionLinks';
import type { Theme } from '@/types/theme';

/** Explicit host capabilities for Markdown outside the OpenCode application. */
export type MarkdownPresentationSource = {
  directory: string;
  runtimeKey: string;
  themeMode?: 'light' | 'dark';
  theme?: Theme;
  isVSCode: boolean;
  editor?: EditorAPI;
  fileReferences: boolean;
  inlineImages: boolean;
  ownOrigins: readonly string[];
  openExternalLink: (url: string) => void;
  openSessionLink?: (target: SessionLinkTarget) => void;
  previewLoopback?: (url: string) => void;
};

export const MarkdownPresentationContext = React.createContext<MarkdownPresentationSource | null>(null);
