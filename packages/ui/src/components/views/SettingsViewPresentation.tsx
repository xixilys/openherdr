import React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { SettingsScrollbarTopClearanceContext } from '@/components/sections/shared/settingsScrollbarClearance';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { McpIcon } from '@/components/icons/McpIcon';
import { getDropdownNavigationKey } from '@/components/ui/dropdown-navigation';
import { isIMECompositionEvent } from '@/lib/ime';
import { SETTINGS_PAGE_METADATA, getSettingsNavIcon, getSettingsPageMeta, resolveSettingsSlug, type SettingsPageSlug, type SettingsRuntimeContext } from '@/lib/settings/metadata';
import type { SettingsSearchResult } from '@/lib/settings/search-index';

const SETTINGS_SPLIT_SIDEBAR_WIDTH = 280;
const SETTINGS_CLOSE_BUTTON_CLEARANCE = 32;
const SETTINGS_DETAIL_HISTORY_KEY = '__openchamberSettingsDetail';
const PENDING_ITEM_MAX_FRAMES = 30;
export type SettingsMobileStage = 'nav' | 'page-sidebar' | 'page-content';

export interface SettingsViewPresentationProps {
  page: SettingsPageSlug;
  onPageChange: (page: SettingsPageSlug) => void;
  runtimeCtx: SettingsRuntimeContext;
  isWindowed?: boolean;
  visiblePageSlugs?: SettingsPageSlug[];
  buildSearchResults: (query: string, getPageTitle: (page: SettingsPageSlug) => string) => SettingsSearchResult[];
  prepareSearchTarget?: (result: SettingsSearchResult) => string;
  renderPageContent: (page: SettingsPageSlug) => React.ReactNode;
  renderPageSidebar?: (page: SettingsPageSlug, options: { onItemSelect?: () => void }) => React.ReactNode;
  onClose?: () => void;
  closeSettingsTitle?: string;
  registerBackHandler?: (handler: (() => boolean) | null) => void;
  initialMobileStage?: SettingsMobileStage;
  jumpRequest?: { page: SettingsPageSlug; itemId: string | null } | null;
  onJumpRequestConsumed?: () => void;
}

type SettingsDetailHistoryEntry = {
  page: SettingsPageSlug;
  stage: 'page-content';
};

interface SettingsDetailHistoryCandidate {
  page?: string | null;
  stage?: 'page-content' | null;
}

interface SettingsHistoryState {
  [SETTINGS_DETAIL_HISTORY_KEY]?: SettingsDetailHistoryCandidate | null;
}

const pageOrder: SettingsPageSlug[] = [
  // 'general' group — OpenChamber
  'general',
  'appearance',
  'chat',
  'notifications',
  'sessions',
  'routing',
  'shortcuts',
  'voice',
  'integrations',
  'extensions',
  'usage',
  'about',
  // 'projects' group — Workspace
  'projects',
  'remote-instances',
  'tunnel',
  'git',
  'isolated-spaces',
  // 'opencode' group — OpenCode
  'providers',
  'web-search',
  'agents',
  'behavior',
  'commands',
  'mcp',
  'plugins',
  // 'content' group — Library
  'magic-prompts',
  'snippets',
  'skills.installed',
  'skills.catalog',
];

const NAV_GROUP_ORDER = ['general', 'projects', 'opencode', 'content'] as const;

function getSettingsDetailHistoryEntry(state: SettingsHistoryState | null): SettingsDetailHistoryEntry | null {
  const detail = state?.[SETTINGS_DETAIL_HISTORY_KEY];
  if (detail?.page == null || detail.stage !== 'page-content') {
    return null;
  }

  return { page: resolveSettingsSlug(detail.page), stage: detail.stage };
}

function getCurrentHistoryState(): SettingsHistoryState {
  const state: SettingsHistoryState | null = window.history.state;
  return state ?? {};
}


/** Original Settings navigation, search and responsive page presentation. */
export const SettingsViewPresentation: React.FC<SettingsViewPresentationProps> = ({
  page: settingsSlug, onPageChange: setSettingsPage, runtimeCtx, isWindowed,
  visiblePageSlugs, buildSearchResults, prepareSearchTarget, renderPageContent,
  renderPageSidebar = () => null, onClose, closeSettingsTitle: suppliedCloseTitle,
  registerBackHandler, initialMobileStage = 'nav', jumpRequest, onJumpRequestConsumed,
}) => {
  const { t } = useI18n();
  const isMobile = runtimeCtx.isMobile;
  const isDesktopApp = runtimeCtx.isDesktop;
  const [mobileStage, setMobileStage] = React.useState<SettingsMobileStage>(initialMobileStage);
  // Seed with the mount-time slug when opening at the nav stage: the slug
  // persists across opens, and the deep-link auto-jump below must react only
  // to slug CHANGES after mount — not re-enter the previously visited page
  // every time settings reopen.
  const autoNavSlugRef = React.useRef<string | null>(initialMobileStage === 'nav' ? settingsSlug : null);

  const [settingsSearchQuery, setSettingsSearchQuery] = React.useState('');
  const [pendingSearchItemId, setPendingSearchItemId] = React.useState<string | null>(null);
  const [activeSearchResultIndex, setActiveSearchResultIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const shouldFocusMobilePageContentRef = React.useRef(false);
  const searchResultRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const activeSearchResultIndexRef = React.useRef(0);
  const keyboardSearchNavigationRef = React.useRef(false);

  const visiblePages = React.useMemo(() => {
    const allowedPages = visiblePageSlugs ? new Set<SettingsPageSlug>(visiblePageSlugs) : null;
    return SETTINGS_PAGE_METADATA
      .filter((page) => page.slug !== 'home')
      .filter((page) => !allowedPages || allowedPages.has(page.slug))
      .filter((page) => !page.isAvailable || page.isAvailable(runtimeCtx))
      .filter((page) => !(runtimeCtx.isVSCode && page.slug === 'projects'))
      .filter((page) => !(isMobile && page.slug === 'shortcuts'));
  }, [runtimeCtx, isMobile, visiblePageSlugs]);

  const sortedFilteredPages = React.useMemo(() => {
    const rank = new Map<SettingsPageSlug, number>(pageOrder.map((s, i) => [s, i]));
    return visiblePages
      .slice()
      .sort((a, b) => (rank.get(a.slug) ?? 999) - (rank.get(b.slug) ?? 999));
  }, [visiblePages]);

  const openPage = React.useCallback((slug: SettingsPageSlug) => {
    setSettingsPage(slug);
    autoNavSlugRef.current = slug;
    if (!isMobile) {
      return;
    }
    const def = getSettingsPageMeta(slug);
    if (!def || def.slug === 'home') {
      setMobileStage('nav');
      return;
    }
    setMobileStage(def.kind === 'split' ? 'page-sidebar' : 'page-content');
  }, [isMobile, setSettingsPage]);

  const activePageMeta = React.useMemo(() => {
    return getSettingsPageMeta(settingsSlug);
  }, [settingsSlug]);

  const getPageTitle = React.useCallback((slug: SettingsPageSlug): string => {
    switch (slug) {
      case 'general':
        return t('settings.page.general.title');
      case 'projects':
        return t('settings.page.projects.title');
      case 'remote-instances':
        return t('settings.page.remoteInstances.title');
      case 'providers':
        return t('settings.page.providers.title');
      case 'web-search':
        return t('settings.page.webSearch.title');
      case 'usage':
        return t('settings.page.usage.title');
      case 'agents':
        return t('settings.page.agents.title');
      case 'behavior':
        return t('settings.page.behavior.title');
      case 'commands':
        return t('settings.page.commands.title');
      case 'mcp':
        return t('settings.page.mcp.title');
      case 'plugins':
        return t('settings.page.plugins.title');
      case 'skills.installed':
        return t('settings.page.skills.title');
      case 'skills.catalog':
        return t('settings.page.skillsCatalog.title');
      case 'git':
        return t('settings.page.git.title');
      case 'integrations':
        return t('settings.page.integrations.title');
      case 'extensions':
        return t('settings.page.extensions.title');
      case 'appearance':
        return t('settings.page.appearance.title');
      case 'chat':
        return t('settings.page.chat.title');
      case 'shortcuts':
        return t('settings.page.shortcuts.title');
      case 'sessions':
        return t('settings.page.sessions.title');
      case 'routing':
        return t('settings.page.routing.title');
      case 'magic-prompts':
        return t('settings.page.magicPrompts.title');
      case 'snippets':
        return t('settings.page.snippets.title');
      case 'notifications':
        return t('settings.page.notifications.title');
      case 'voice':
        return t('settings.page.voice.title');
      case 'tunnel':
        return t('settings.page.tunnel.title');
      case 'isolated-spaces':
        return t('settings.openchamber.spaces.title');
      case 'about':
        return t('settings.page.about.title');
      case 'home':
      default:
        return t('settings.view.home.title');
    }
  }, [t]);

  const settingsSearchResults = React.useMemo(() => buildSearchResults(settingsSearchQuery, getPageTitle), [buildSearchResults, getPageTitle, settingsSearchQuery]);

  const groupedSettingsSearchResults = React.useMemo(() => {
    const groups: Array<{ page: SettingsPageSlug; pageTitle: string; results: SettingsSearchResult[] }> = [];
    const groupByPage = new Map<SettingsPageSlug, { page: SettingsPageSlug; pageTitle: string; results: SettingsSearchResult[] }>();
    for (const result of settingsSearchResults) {
      let group = groupByPage.get(result.page);
      if (!group) {
        group = { page: result.page, pageTitle: result.pageTitle, results: [] };
        groupByPage.set(result.page, group);
        groups.push(group);
      }
      group.results.push(result);
    }
    return groups;
  }, [settingsSearchResults]);

  React.useEffect(() => {
    setActiveSearchResultIndex(0);
    activeSearchResultIndexRef.current = 0;
    keyboardSearchNavigationRef.current = false;
  }, [settingsSearchQuery]);

  React.useEffect(() => {
    activeSearchResultIndexRef.current = activeSearchResultIndex;
  }, [activeSearchResultIndex]);

  React.useEffect(() => {
    searchResultRefs.current[activeSearchResultIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeSearchResultIndex]);

  React.useEffect(() => {
    if (activeSearchResultIndex >= settingsSearchResults.length) {
      setActiveSearchResultIndex(Math.max(0, settingsSearchResults.length - 1));
    }
    searchResultRefs.current.length = settingsSearchResults.length;
  }, [activeSearchResultIndex, settingsSearchResults.length]);

  const openSearchResult = React.useCallback((result: SettingsSearchResult) => {
    const targetId = prepareSearchTarget ? prepareSearchTarget(result) : result.id;
    setPendingSearchItemId(targetId);
    openPage(result.page);
    if (isMobile) {
      setMobileStage('page-content');
    }
  }, [isMobile, openPage, prepareSearchTarget]);

  const handleSettingsSearchKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!settingsSearchQuery.trim()) {
      return;
    }

    const mappedNavigationKey = getDropdownNavigationKey(event);
    if (!mappedNavigationKey && isIMECompositionEvent(event)) {
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setSettingsSearchQuery('');
      return;
    }

    if (settingsSearchResults.length === 0) {
      return;
    }

    const navigationKey = mappedNavigationKey ?? event.key;
    if (navigationKey === 'ArrowDown') {
      event.preventDefault();
      keyboardSearchNavigationRef.current = true;
      setActiveSearchResultIndex((current) => (current + 1) % settingsSearchResults.length);
      return;
    }

    if (navigationKey === 'ArrowUp') {
      event.preventDefault();
      keyboardSearchNavigationRef.current = true;
      setActiveSearchResultIndex((current) => (current - 1 + settingsSearchResults.length) % settingsSearchResults.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const safeIndex = ((activeSearchResultIndexRef.current % settingsSearchResults.length) + settingsSearchResults.length) % settingsSearchResults.length;
      const result = settingsSearchResults[safeIndex] ?? settingsSearchResults[0];
      if (result) {
        openSearchResult(result);
      }
    }
  }, [openSearchResult, settingsSearchQuery, settingsSearchResults]);

  React.useEffect(() => {
    if (!jumpRequest) return;
    onJumpRequestConsumed?.();
    setPendingSearchItemId(jumpRequest.itemId);
    openPage(jumpRequest.page);
    if (isMobile) setMobileStage('page-content');
  }, [isMobile, jumpRequest, onJumpRequestConsumed, openPage]);

  React.useEffect(() => {
    const targetId = pendingSearchItemId;
    if (!targetId) {
      return;
    }

    // A page that loads its content (an agent's details, a provider's page)
    // renders the item a few frames late, so look for it for a short while.
    let cancelled = false;
    let attempts = 0;
    let frame = 0;
    const reveal = () => {
      if (cancelled) {
        return;
      }
      const escapedId = globalThis.CSS?.escape
        ? globalThis.CSS.escape(targetId)
        : targetId.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const target = containerRef.current?.querySelector<HTMLElement>(`[data-settings-item="${escapedId}"]`);
      if (!target) {
        attempts += 1;
        if (attempts < PENDING_ITEM_MAX_FRAMES) frame = window.requestAnimationFrame(reveal);
        return;
      }
      setPendingSearchItemId(null);
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.setAttribute('data-settings-search-highlight', 'true');
      const focusTarget = isMobile && target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
        ? target.parentElement : target;
      const previousTabIndex = focusTarget?.getAttribute('tabindex');
      if (previousTabIndex === null) focusTarget?.setAttribute('tabindex', '-1');
      focusTarget?.focus({ preventScroll: true });
      window.setTimeout(() => {
        target.removeAttribute('data-settings-search-highlight');
        if (previousTabIndex === null && focusTarget?.getAttribute('tabindex') === '-1') focusTarget.removeAttribute('tabindex');
      }, 1600);
    };
    frame = window.requestAnimationFrame(reveal);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [isMobile, pendingSearchItemId, settingsSlug]);

  // Mobile: if opened via deep-link / palette to a non-home page, jump into it once.
  React.useEffect(() => {
    if (!isMobile) {
      return;
    }
    if (mobileStage !== 'nav') {
      return;
    }
    if (settingsSlug === 'home') {
      return;
    }
    if (autoNavSlugRef.current === settingsSlug) {
      return;
    }
    const def = getSettingsPageMeta(settingsSlug);
    if (!def || def.slug === 'home') {
      return;
    }
    autoNavSlugRef.current = settingsSlug;
    setMobileStage(def.kind === 'split' ? 'page-sidebar' : 'page-content');
  }, [isMobile, mobileStage, settingsSlug]);

  const showBackButton = isMobile && mobileStage !== 'nav';
  // Split pages drill down on mobile: nav → the page's own list → the item.
  // Back walks that path in reverse, so it takes one tap to reach the next
  // item instead of a round trip through the settings root.
  const backButtonTargetsPageSidebar = isMobile
    && mobileStage === 'page-content'
    && activePageMeta?.kind === 'split';
  const mobileBackButtonLabel = backButtonTargetsPageSidebar
    ? t('settings.view.actions.back')
    : showBackButton
      ? t('settings.view.actions.backToSettings')
      : t('settings.view.actions.closeSettings');
  const closeSettingsTitle = suppliedCloseTitle ?? t('settings.view.actions.closeSettings');

  const pushMobileSplitDetailHistory = React.useCallback((slug: SettingsPageSlug) => {
    if (runtimeCtx.isVSCode) {
      return;
    }

    const currentDetail = getSettingsDetailHistoryEntry(window.history.state);
    if (currentDetail?.page === slug && currentDetail.stage === 'page-content') {
      return;
    }

    window.history.pushState(
      {
        ...getCurrentHistoryState(),
        [SETTINGS_DETAIL_HISTORY_KEY]: { page: slug, stage: 'page-content' },
      },
      '',
      window.location.href,
    );
  }, [runtimeCtx.isVSCode]);

  const handleMobilePageSidebarItemSelect = React.useCallback(() => {
    shouldFocusMobilePageContentRef.current = true;
    setMobileStage('page-content');
    pushMobileSplitDetailHistory(settingsSlug);
  }, [pushMobileSplitDetailHistory, settingsSlug]);

  React.useEffect(() => {
    if (!isMobile || mobileStage !== 'page-content' || !shouldFocusMobilePageContentRef.current) {
      return;
    }

    shouldFocusMobilePageContentRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>('[data-settings-page-heading]')
        ?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isMobile, mobileStage, settingsSlug]);

  const handleBack = React.useCallback(() => {
    if (backButtonTargetsPageSidebar) {
      const currentDetail = getSettingsDetailHistoryEntry(window.history.state);
      if (currentDetail?.page === settingsSlug && !runtimeCtx.isVSCode) {
        window.history.back();
        return;
      }
      setMobileStage('page-sidebar');
      return;
    }

    setMobileStage('nav');
  }, [backButtonTargetsPageSidebar, runtimeCtx.isVSCode, settingsSlug]);

  // The Android hardware back button belongs to the same ladder as the header's
  // back arrow: one level up per press, and only the press at the root falls
  // through to the shell, which closes Settings.
  React.useEffect(() => {
    if (!registerBackHandler) {
      return;
    }
    registerBackHandler(() => {
      if (!isMobile || mobileStage === 'nav') {
        return false;
      }
      handleBack();
      return true;
    });
    return () => registerBackHandler(null);
  }, [handleBack, isMobile, mobileStage, registerBackHandler]);

  React.useEffect(() => {
    if (!isMobile || runtimeCtx.isVSCode) {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      if (getSettingsPageMeta(settingsSlug)?.kind !== 'split') {
        return;
      }

      const detail = getSettingsDetailHistoryEntry(event.state);
      if (detail?.page === settingsSlug) {
        setMobileStage('page-content');
        return;
      }

      setMobileStage((stage) => stage === 'page-content' ? 'page-sidebar' : stage);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isMobile, runtimeCtx.isVSCode, settingsSlug]);

  const renderSettingsNav = () => {
    const hasSearchQuery = settingsSearchQuery.trim().length > 0;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="px-4 pt-3">
          <div className="oc-surface-elevated flex h-10 items-center gap-1.5 rounded-md border border-border bg-surface-elevated/70 px-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:h-8">
            <Icon name="search" className="h-4 w-4 shrink-0" />
            <input
              value={settingsSearchQuery}
              onChange={(event) => setSettingsSearchQuery(event.target.value)}
              onKeyDown={handleSettingsSearchKeyDown}
              placeholder={t('settings.view.search.placeholder')}
              aria-label={t('settings.view.search.aria')}
              className="typography-ui min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {hasSearchQuery && (
              <button
                type="button"
                onClick={() => setSettingsSearchQuery('')}
                aria-label={t('settings.view.search.clear')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-interactive-hover hover:text-foreground sm:h-5 sm:w-5"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable nav items */}
        <ScrollableOverlay outerClassName="flex-1 min-h-0" disableHorizontal>
          <div className="flex flex-col gap-0.5 px-4 pt-4 pb-2">
            {hasSearchQuery ? (
              settingsSearchResults.length > 0 ? (() => {
                let resultIndex = 0;
                return groupedSettingsSearchResults.map((group) => (
                  <div key={group.page} className="space-y-0.5">
                    <div className="px-2 pb-0.5 pt-2 typography-micro font-medium text-muted-foreground/70">
                      {group.pageTitle}
                    </div>
                    {group.results.map((result) => {
                      const currentIndex = resultIndex;
                      resultIndex += 1;
                      const active = currentIndex === activeSearchResultIndex;
                      const hasDescription = Boolean(result.description);
                      return (
                        <button
                          key={result.id}
                          type="button"
                          ref={(element) => {
                            searchResultRefs.current[currentIndex] = element;
                          }}
                          onMouseMove={() => {
                            keyboardSearchNavigationRef.current = false;
                            setActiveSearchResultIndex(currentIndex);
                          }}
                          onClick={() => openSearchResult(result)}
                          className={cn(
                            'flex w-full flex-col rounded-md px-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            hasDescription ? 'min-h-11 py-1.5' : 'py-2',
                            active ? 'bg-interactive-selection' : 'hover:bg-interactive-hover'
                          )}
                        >
                          <span className="typography-ui-label text-foreground truncate">{result.title}</span>
                          {hasDescription && (
                            <span className="typography-micro text-muted-foreground/70 line-clamp-2">{result.description}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ));
              })() : (
                <div className="px-2 py-6 text-center typography-ui text-muted-foreground">
                  {t('settings.view.search.noResults')}
                </div>
              )
            ) : (() => {
              const pagesByGroup = new Map<string, typeof sortedFilteredPages>();
              for (const page of sortedFilteredPages) {
                const group = page.group;
                const existing = pagesByGroup.get(group);
                if (existing) {
                  existing.push(page);
                } else {
                  pagesByGroup.set(group, [page]);
                }
              }

              const visibleGroups = NAV_GROUP_ORDER
                .map((group) => ({ group, pages: pagesByGroup.get(group) ?? [] }))
                .filter((entry) => entry.pages.length > 0);

              return visibleGroups.map(({ group, pages }, groupIndex) => (
                <div key={group} className="space-y-0.5">
                  <div
                    className={cn(
                      'px-3 pb-1 typography-micro font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:pb-0.5',
                      groupIndex === 0 ? 'pt-1' : 'pt-4 sm:pt-3',
                    )}
                  >
                    {t(`settings.view.nav.group.${group}`)}
                  </div>
                  {pages.map((page) => {
                    // On the mobile nav STAGE nothing is "current" — the user is
                    // choosing, and settingsSlug only remembers the last visited
                    // page. Keeping it highlighted read as a stuck selection.
                    const selected = settingsSlug === page.slug && !(isMobile && mobileStage === 'nav');
                    const iconName = getSettingsNavIcon(page.slug);
                    if (!iconName && page.slug !== 'mcp') return null;

                    return (
                      <Tooltip key={page.slug}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => openPage(page.slug)}
                            aria-current={selected ? 'page' : undefined}
                            className={cn(
                              'flex h-11 w-full items-center gap-2.5 rounded-md px-3 overflow-hidden sm:h-8 sm:gap-2 sm:px-2',
                              selected
                                ? 'bg-interactive-selection text-foreground'
                                : 'text-foreground hover:bg-interactive-hover'
                            )}
                          >
                            {page.slug === 'mcp'
                              ? <McpIcon className="h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4" />
                              : <Icon name={iconName!} className="h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4" />}
                            <span className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden transition-opacity duration-150 opacity-100">
                              <span className="typography-ui-label font-normal truncate">{getPageTitle(page.slug)}</span>
                              {page.slug === 'tunnel' && (
                                <span className="shrink-0 typography-micro px-1 rounded leading-none pb-px text-[var(--status-warning)] bg-[var(--status-warning)]/10">
                                  {t('settings.view.badge.beta')}
                                </span>
                              )}
                            </span>
                          </button>
                        </TooltipTrigger>
                      </Tooltip>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </ScrollableOverlay>
      </div>
    );
  };

  const renderMobileStage = () => {
    if (mobileStage === 'nav') {
      return (
        <div className="flex-1 min-h-0 overflow-hidden bg-background">
          <div className="flex h-full min-h-0 flex-col">
            <ErrorBoundary>{renderSettingsNav()}</ErrorBoundary>
          </div>
        </div>
      );
    }

    if (!activePageMeta) {
      return <div className="flex-1 bg-background" />;
    }

    if (mobileStage === 'page-sidebar') {
      if (activePageMeta.kind !== 'split') {
        // No sidebar available; fall back to direct content.
        const fallback = renderPageContent(settingsSlug);
        return (
          <ScrollableOverlay outerClassName="flex-1 min-h-0" className="bg-background" disableHorizontal>
            <ErrorBoundary>{fallback}</ErrorBoundary>
          </ScrollableOverlay>
        );
      }
      return (
        <ScrollableOverlay outerClassName="flex-1 min-h-0" className="bg-background" disableHorizontal>
          <ErrorBoundary>
            {renderPageSidebar(settingsSlug, { onItemSelect: handleMobilePageSidebarItemSelect })}
          </ErrorBoundary>
        </ScrollableOverlay>
      );
    }

    // page-content
    const content = renderPageContent(settingsSlug);

    return (
      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="bg-background" disableHorizontal>
        <ErrorBoundary>{content}</ErrorBoundary>
      </ScrollableOverlay>
    );
  };

  const renderDesktopContent = () => {
    if (!activePageMeta || settingsSlug === 'home') {
      return null;
    }

    // The floating close button sits over the content's top-right corner, so
    // the content scrollbar starts below it.
    const scrollbarTopClearance = onClose ? SETTINGS_CLOSE_BUTTON_CLEARANCE : 0;
    const content = (
      <SettingsScrollbarTopClearanceContext.Provider value={scrollbarTopClearance}>
        <ErrorBoundary>{renderPageContent(settingsSlug)}</ErrorBoundary>
      </SettingsScrollbarTopClearanceContext.Provider>
    );

    if (activePageMeta.kind === 'split') {
      return (
        <div className="flex h-full min-h-0 overflow-hidden">
          <div className={cn('border-e', runtimeCtx.isVSCode ? 'bg-background' : 'bg-sidebar')} style={{ width: SETTINGS_SPLIT_SIDEBAR_WIDTH, minWidth: SETTINGS_SPLIT_SIDEBAR_WIDTH, borderColor: 'var(--interactive-border)' }}>
            <ErrorBoundary>{renderPageSidebar(settingsSlug, {})}</ErrorBoundary>
          </div>
          <ScrollableOverlay outerClassName="flex-1 min-h-0" className="bg-background" disableHorizontal verticalTrackStart={scrollbarTopClearance}>
            {content}
          </ScrollableOverlay>
        </div>
      );
    }

    return (
      <ScrollableOverlay outerClassName="h-full min-h-0" className="bg-background" disableHorizontal verticalTrackStart={scrollbarTopClearance}>
        {content}
      </ScrollableOverlay>
    );
  };

  return (
    <div ref={containerRef} data-settings-view="true" className={cn('relative flex h-full min-h-0 flex-col overflow-hidden bg-background')}>
      {isMobile ? (
        <div
          className={cn(
            'flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3',
            // The root nav list reads as a single quiet page — no divider and
            // no back arrow (the X on the right is the only way out); subpages
            // keep both.
            mobileStage !== 'nav' && 'border-b',
            'bg-background'
          )}
          style={mobileStage !== 'nav' ? { borderColor: 'var(--interactive-border)' } : undefined}
        >
          {showBackButton ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label={mobileBackButtonLabel}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="arrow-left-s" className="h-5 w-5" />
            </button>
          ) : null}

          <div className="min-w-0 flex-1 px-2 typography-ui-label font-medium text-foreground truncate">
            {mobileStage === 'nav'
              ? t('settings.view.home.title')
              : (activePageMeta ? getPageTitle(activePageMeta.slug) : t('settings.view.home.title'))}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('settings.view.actions.closeSettings')}
              title={closeSettingsTitle}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          )}
        </div>
      ) : (
        <>
          {showBackButton && (
            <div className={cn('absolute inset-s-3 z-50', isWindowed ? 'top-2' : 'top-3')}>
              <button
                type="button"
                onClick={handleBack}
                aria-label={t('settings.view.actions.back')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="arrow-left-s" className="h-5 w-5" />
              </button>
            </div>
          )}

      {onClose && (
        <div className={cn('absolute inset-e-0.5 z-50', isWindowed ? 'top-0.5' : 'top-1')}>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('settings.view.actions.closeSettings')}
            title={closeSettingsTitle}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
      )}
        </>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {isMobile ? (
          renderMobileStage()
        ) : (
          <>
            <div
              className={cn(
                'relative flex h-full min-h-0 w-36 min-w-36 flex-col overflow-hidden border-e sm:w-64 sm:min-w-64',
                isDesktopApp
                  ? 'bg-sidebar'
                  : runtimeCtx.isVSCode
                    ? 'bg-background'
                    : 'bg-sidebar',
              )}
              style={{
                borderColor: 'var(--interactive-border)',
              }}
            >
              <ErrorBoundary>
                {renderSettingsNav()}
              </ErrorBoundary>
            </div>

            <div className="flex-1 overflow-hidden bg-background">
              {renderDesktopContent()}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
