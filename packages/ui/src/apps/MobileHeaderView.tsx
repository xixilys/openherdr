import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type MobileHeaderViewProps = {
  title: React.ReactNode;
  titleExpanded: boolean;
  onTitleClick: () => void;
  titleButtonRef?: React.Ref<HTMLButtonElement>;
  onOpenSessions: () => void;
  onOpenWorkspace: () => void;
  compactTitle?: boolean;
  hasUncommittedChanges?: boolean;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
};

/** Shared mobile header presentation. Its owner supplies live selection and actions. */
export function MobileHeaderView({ title, titleExpanded, onTitleClick, titleButtonRef, onOpenSessions, onOpenWorkspace, compactTitle = false, hasUncommittedChanges = false, metadata, actions }: MobileHeaderViewProps) {
  const { t } = useI18n();
  return (
      <header
        className="oc-mobile-header relative z-30 flex shrink-0 items-center gap-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        style={{ paddingTop: 'var(--oc-safe-area-top, 0px)' }}
      >
        <div className="flex h-[var(--oc-header-height,56px)] w-full items-center gap-1 px-2">
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('mobile.sessions.openSheetAria')}
            onClick={onOpenSessions}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="list-unordered" className="size-5" />
          </button>

          {/* Session title doubles as the recent-sessions switcher trigger. */}
          <button
            ref={titleButtonRef}
            type="button"
            className={cn(
              'flex min-w-0 items-center rounded-lg px-2 py-1.5 text-start transition-colors active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              compactTitle ? 'shrink' : 'flex-1',
            )}
            aria-label={t('sessions.switcher.openAria')}
            aria-haspopup="dialog"
            aria-expanded={titleExpanded}
            onClick={onTitleClick}
            style={{ touchAction: 'manipulation' }}
          >
            <span className="flex min-w-0 items-center gap-1">
              <span dir="auto" className="block min-w-0 truncate oc-ui-start-align typography-ui-label text-foreground">{title}</span>
              {/* Discoverability: the chevron marks the title as a disclosure
                  trigger and flips while the switcher is open. */}
              <Icon
                name="arrow-down-s"
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
                  titleExpanded && 'rotate-180',
                )}
              />
            </span>
          </button>

          {/* Compact title: this takes the leftover width so the trailing
              controls stay pinned to the right edge. */}
          {compactTitle ? <div className="min-w-0 flex-1" /> : null}

          {metadata}
          {actions}

          <button
            type="button"
            className="relative flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={hasUncommittedChanges
              ? t('mobile.header.openWorkspaceWithChangesAria')
              : t('mobile.header.openWorkspaceAria')}
            onClick={onOpenWorkspace}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="pencil-ruler-2" className="size-5" />
            {hasUncommittedChanges ? (
              <span
                className="absolute inset-e-1.5 top-1.5 size-2.5 rounded-full border-2 border-[var(--background)] bg-[var(--status-warning)]"
                aria-hidden
              />
            ) : null}
          </button>
        </div>
      </header>
  );
}
