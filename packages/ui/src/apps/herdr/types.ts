import type React from 'react';
import type { MobileAppActions } from '../mobileAppContext';
import type { MobileWorkspacePanel } from '../MobileWorkspaceDrawerView';

export type HerdrMobileTarget = {
  machine: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
  available: boolean;
};

export type HerdrWorkspaceRow = { id: string; label: string; active: boolean };
export type HerdrSessionRow = { id: string; title: string; subtitle?: string; active: boolean; status?: string };

export type HerdrMobileFullscreen = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  content: React.ReactNode;
  /** Settings owns its header and inner navigation. */
  headerless?: boolean;
  ariaLabel?: string;
};
export type HerdrMobileOverlay = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: React.ReactNode;
  footer?: React.ReactNode;
};

export type HerdrMobileShellProps = {
  target: HerdrMobileTarget;
  workspaces: readonly HerdrWorkspaceRow[];
  sessions: readonly HerdrSessionRow[];
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onOpenWorkspace: () => void;
  onOpenSessions: () => void;
  header: {
    title: React.ReactNode;
    metadata?: React.ReactNode;
    actions?: React.ReactNode;
    onTitleClick?: () => void;
    titleButtonRef?: React.Ref<HTMLButtonElement>;
    titleExpanded?: boolean;
  };
  /** Optional title popup, rendered in the header's chat-column containing block. */
  headerPopover?: React.ReactNode;
  sessionsOpen: boolean;
  onSessionsOpenChange: (open: boolean) => void;
  workspaceOpen: boolean;
  onWorkspaceOpenChange: (open: boolean) => void;
  workspaceTab: string;
  onWorkspaceTabChange: (tab: string) => void;
  workspacePanels: readonly MobileWorkspacePanel[];
  /** Optional complete sessions body, in the original sessions drawer. */
  sidebar?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  children: React.ReactNode;
  actions: MobileAppActions;
  fullscreen: HerdrMobileFullscreen | null;
  overlay: HerdrMobileOverlay | null;
};
