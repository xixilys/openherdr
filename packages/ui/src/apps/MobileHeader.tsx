import React from 'react';

import { useI18n } from '@/lib/i18n';
import { useMultiRunTitle } from '@/lib/multirun/useMultiRuns';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { useGitStore, useIsGitRepo } from '@/stores/useGitStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSession } from '@/sync/sync-context';

import { SpaceAccessButton } from '@/components/session/spaces/SpaceAccessButton';

import { MobileSessionMetadataButton } from './MobileSessionMetadata';
import { MobileSessionSwitcher } from './MobileSessionSwitcher';
import { MobileHeaderView } from './MobileHeaderView';

export const MobileHeader: React.FC<{
  onOpenSessions: () => void;
  /** Opens the right workspace drawer (Changes / Files / Terminal / Notes / MCP). */
  onOpenWorkspace: () => void;
  /** Tablet: size the title trigger to its text instead of the free width, so
      a wide header doesn't turn the switcher into a full-width tap target. */
  compactTitle?: boolean;
}> = ({ onOpenSessions, onOpenWorkspace, compactTitle = false }) => {
  const { t } = useI18n();
  const [metadataOpen, setMetadataOpen] = React.useState(false);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const titleRef = React.useRef<HTMLButtonElement>(null);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const currentSessionDirectory = useSessionUIStore(
    React.useCallback((state) => (currentSessionId ? state.getDirectoryForSession(currentSessionId) : null), [currentSessionId]),
  );
  const effectiveDirectory = currentSessionDirectory || currentDirectory;
  const currentSession = useSession(currentSessionId, effectiveDirectory || undefined);
  const isNewSessionDraftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  // Uncommitted changes in the active project or worktree: the workspace
  // button gets a dot instead of a changed-files bar above the composer.
  const isGitRepo = useIsGitRepo(effectiveDirectory || null);
  const hasUncommittedChanges = useGitStore((state) => {
    if (!effectiveDirectory || isGitRepo !== true) return false;
    const status = state.directories.get(effectiveDirectory)?.status;
    return Boolean(status && !status.isClean);
  });

  // An open run overview covers the chat, so the header names the run and
  // drops the session-only metadata button rather than describe a session
  // that is not on screen.
  const runOverviewKey = useUIStore((state) => state.runOverviewKey);
  const runTitle = useMultiRunTitle(runOverviewKey);
  const sessionTitle = currentSession?.title?.trim();
  // Single-line title, desktop-style: session title, or the "New session"
  // placeholder on the draft screen. No project/branch metadata line.
  const primaryLabel = (runOverviewKey ? runTitle : null)
    || sessionTitle
    || (currentSessionId ? t('mobile.sessions.untitled') : t('sessions.switcher.draftTitle'));

  React.useEffect(() => {
    setMetadataOpen(false);
    setSwitcherOpen(false);
  }, [currentSessionId, effectiveDirectory]);

  const handleOpenSessions = React.useCallback(() => {
    setMetadataOpen(false);
    setSwitcherOpen(false);
    onOpenSessions();
  }, [onOpenSessions]);

  // The two header popovers are mutually exclusive.
  const handleMetadataOpenChange = React.useCallback((value: boolean | ((open: boolean) => boolean)) => {
    setMetadataOpen((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      if (next) setSwitcherOpen(false);
      return next;
    });
  }, []);

  const toggleSwitcher = React.useCallback(() => {
    setSwitcherOpen((current) => {
      const next = !current;
      if (next) setMetadataOpen(false);
      return next;
    });
  }, []);

  return (
    <>
      <MobileHeaderView
        title={primaryLabel}
        titleExpanded={switcherOpen}
        titleButtonRef={titleRef}
        onTitleClick={toggleSwitcher}
        compactTitle={compactTitle}
        hasUncommittedChanges={hasUncommittedChanges}
        onOpenSessions={handleOpenSessions}
        onOpenWorkspace={() => {
          setMetadataOpen(false);
          setSwitcherOpen(false);
          onOpenWorkspace();
        }}
        metadata={runOverviewKey ? null : (
          <MobileSessionMetadataButton
            open={metadataOpen}
            onOpenChange={handleMetadataOpenChange}
            currentSessionId={currentSessionId}
            effectiveDirectory={effectiveDirectory}
            isNewSessionDraftOpen={isNewSessionDraftOpen}
          />
        )}
        actions={(
          <SpaceAccessButton
            directory={effectiveDirectory}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            iconClassName="size-5"
          />
        )}
      />
      <MobileSessionSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        anchorRef={titleRef}
      />
    </>
  );
};
