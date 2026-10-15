import React from 'react';
import {
  formatShortcutForDisplay,
  getEffectiveShortcutCombo,
} from '@/lib/shortcuts';
import { useUIStore } from '@/stores/useUIStore';
import { useEnterpriseMode, useJevBlockedByEnterprise } from '@/stores/useEnterprisePolicyStore';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useAgentsStore } from '@/stores/useAgentsStore';
import { useCommandsStore } from '@/stores/useCommandsStore';
import { useMcpConfigStore } from '@/stores/useMcpConfigStore';
import { useSnippetsStore } from '@/stores/useSnippetsStore';
import { projectSettingsTabForSearchTarget, useProjectSettingsTabStore } from '@/components/sections/projects/projectSettingsTabs';
import { useSkillsStore } from '@/stores/useSkillsStore';
import { useSkillsCatalogStore } from '@/stores/useSkillsCatalogStore';
import { AgentsSidebar } from '@/components/sections/agents/AgentsSidebar';
import { AgentsPage } from '@/components/sections/agents/AgentsPage';
import { BehaviorPage } from '@/components/sections/behavior/BehaviorPage';
import { WebSearchPage } from '@/components/sections/websearch/WebSearchPage';
import { CommandsSidebar } from '@/components/sections/commands/CommandsSidebar';
import { CommandsPage } from '@/components/sections/commands/CommandsPage';
import { McpPage } from '@/components/sections/mcp/McpPage';
import { PluginsPage } from '@/components/sections/plugins';
import { usePluginsStore } from '@/stores/usePluginsStore';
import { SkillsSidebar } from '@/components/sections/skills/SkillsSidebar';
import { SkillsPage } from '@/components/sections/skills/SkillsPage';
import { ProjectsSidebar } from '@/components/sections/projects/ProjectsSidebar';
import { ProjectsPage } from '@/components/sections/projects/ProjectsPage';
import { RemoteInstancesPage } from '@/components/sections/remote-instances/RemoteInstancesPage';
import { ProvidersPage } from '@/components/sections/providers/ProvidersPage';
import { UsageSidebar } from '@/components/sections/usage/UsageSidebar';
import { UsagePage } from '@/components/sections/usage/UsagePage';
import { MagicPromptsSidebar } from '@/components/sections/magic-prompts/MagicPromptsSidebar';
import { MagicPromptsPage } from '@/components/sections/magic-prompts/MagicPromptsPage';
import { SnippetsSidebar } from '@/components/sections/snippets/SnippetsSidebar';
import { SnippetsPage } from '@/components/sections/snippets/SnippetsPage';
import { GitPage } from '@/components/sections/git-identities/GitPage';
import { IntegrationsPage } from '@/components/sections/integrations/IntegrationsPage';
import { RoutingPage } from '@/components/sections/routing/RoutingPage';
import { ExtensionsPage } from '@/components/sections/extensions/ExtensionsPage';
import type { OpenChamberSection } from '@/components/sections/openchamber/types';
import { OpenChamberPage } from '@/components/sections/openchamber/OpenChamberPage';
import { AboutSettings } from '@/components/sections/openchamber/AboutSettings';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SETTINGS_SECTION_TITLE_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { useDeviceInfo } from '@/lib/device';
import { isDesktopLocalOriginActive, isDesktopShell, isVSCodeRuntime, isWebRuntime } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';
import {
  getSettingsPageMeta,
  resolveSettingsSlug,
  type SettingsPageSlug,
  type SettingsRuntimeContext,
  type SettingsPageMeta,
} from '@/lib/settings/metadata';
import { buildSettingsSearchResults, type SettingsSearchResult } from '@/lib/settings/search';

import { SettingsViewPresentation, type SettingsMobileStage } from './SettingsViewPresentation';

interface SettingsViewProps {
  onClose?: () => void;
  /** Force mobile layout regardless of device detection */
  forceMobile?: boolean;
  /** Rendered inside a window/dialog (skip traffic light padding) */
  isWindowed?: boolean;
  /** Restrict top-level settings navigation to a specific product surface. */
  visiblePageSlugs?: SettingsPageSlug[];
  /** Lets a native shell hand its hardware back button to the mobile stages:
      the handler steps one level up and reports whether it consumed the press. */
  registerBackHandler?: (handler: (() => boolean) | null) => void;
  initialMobileStage?: SettingsMobileStage;
}

function buildRuntimeContext(isDesktop: boolean, isMobile: boolean, routingAvailable: boolean, enterpriseMode: boolean, jevBlockedByEnterprise: boolean): SettingsRuntimeContext {
  const isVSCode = isVSCodeRuntime();
  const isWeb = !isDesktop && isWebRuntime();
  return { isVSCode, isWeb, isDesktop, isMobile, routingAvailable, enterpriseMode, jevBlockedByEnterprise };
}

function isPageAvailable(page: SettingsPageMeta, ctx: SettingsRuntimeContext): boolean {
  if (!page.isAvailable) {
    return true;
  }
  return page.isAvailable(ctx);
}

function nextUniqueName(baseName: string, existingNames: Iterable<string>): string {
  const existing = new Set(existingNames);
  let name = baseName;
  let counter = 1;
  while (existing.has(name)) {
    name = `${baseName}-${counter}`;
    counter += 1;
  }
  return name;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onClose, forceMobile, isWindowed, visiblePageSlugs, initialMobileStage = 'nav', registerBackHandler }) => {
  const { t } = useI18n();
  const deviceInfo = useDeviceInfo();
  const isMobile = forceMobile ?? deviceInfo.isMobile;

  const settingsPageRaw = useUIStore((state) => state.settingsPage);
  const isSettingsDialogOpen = useUIStore((state) => state.isSettingsDialogOpen);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const openSettingsShortcutOverride = useUIStore((state) => state.shortcutOverrides.open_settings);
  const settingsSlug = resolveSettingsSlug(settingsPageRaw);

  // No starter page on desktop: 'home' (fresh state) resolves to General.
  // settingsPage persists in the UI store, so subsequent opens restore the
  // last visited page. Mobile keeps 'home' — its entry stage is the nav list.
  React.useEffect(() => {
    if (!isMobile && settingsSlug === 'home') {
      setSettingsPage('general');
    }
  }, [isMobile, setSettingsPage, settingsSlug]);

  const isDesktopApp = React.useMemo(() => {
    return isDesktopShell();
  }, []);
  const isDesktopLocalOrigin = React.useMemo(() => {
    return isDesktopShell() && isDesktopLocalOriginActive();
  }, []);
  const isMac = React.useMemo(() => {
    return isDesktopShell() && window.__OPENCHAMBER_PLATFORM__ === 'darwin';
  }, []);
  const isWindows = React.useMemo(() => {
    return isDesktopShell() && window.__OPENCHAMBER_PLATFORM__ === 'win32';
  }, []);
  const isLinux = React.useMemo(() => {
    return isDesktopShell() && window.__OPENCHAMBER_PLATFORM__ === 'linux';
  }, []);

  // keep platform check available for future window chrome tweaks

  const routingAvailable = useUIStore((state) => state.routingFeatureAvailable);
  const enterpriseMode = useEnterpriseMode();
  const jevBlockedByEnterprise = useJevBlockedByEnterprise();
  const runtimeCtx = React.useMemo(
    () => buildRuntimeContext(isDesktopApp, isMobile, routingAvailable, enterpriseMode, jevBlockedByEnterprise),
    [isDesktopApp, isMobile, routingAvailable, enterpriseMode, jevBlockedByEnterprise],
  );

  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const settingsDirectory = useSettingsDirectory();

  // Load stores when the settings project changes or a page becomes active.
  React.useEffect(() => {
    if (!isSettingsDialogOpen && !runtimeCtx.isVSCode && !isWindowed) {
      return;
    }

    if (settingsSlug === 'agents') {
      void useAgentsStore.getState().loadAgents(settingsDirectory);
      return;
    }
    if (settingsSlug === 'commands') {
      void useCommandsStore.getState().loadCommands(settingsDirectory);
      return;
    }
    if (settingsSlug === 'mcp') {
      void useMcpConfigStore.getState().loadMcpConfigs({ directory: settingsDirectory });
      return;
    }
    if (settingsSlug === 'plugins') {
      void usePluginsStore.getState().loadPlugins();
      return;
    }
    if (settingsSlug === 'skills.installed' || settingsSlug === 'skills.catalog') {
      void useSkillsStore.getState().loadSkills(settingsDirectory);
      void useSkillsCatalogStore.getState().loadCatalog();
    }
    if (settingsSlug === 'snippets') {
      void useSnippetsStore.getState().loadSnippets();
    }
    // `activeProjectId` still matters: the settings directory follows the active
    // project until the user picks another one in the Settings selector.
  }, [activeProjectId, isSettingsDialogOpen, isWindowed, runtimeCtx.isVSCode, settingsDirectory, settingsSlug]);

  const openChamberSectionBySlug: Partial<Record<SettingsPageSlug, OpenChamberSection>> = React.useMemo(() => ({
    general: 'general',
    appearance: 'visual',
    chat: 'chat',
    shortcuts: 'shortcuts',
    sessions: 'sessions',
    notifications: 'notifications',
    voice: 'voice',
    tunnel: 'tunnel',
    'isolated-spaces': 'spaces',
  }), []);

  const buildSearchResults = React.useCallback((query: string, getPageTitle: (page: SettingsPageSlug) => string) => buildSettingsSearchResults({
    query,
    runtimeCtx: { ...runtimeCtx, isDesktopLocalOrigin, isMac, isWindows, isLinux },
    visiblePageSlugs,
    t,
    getPageTitle,
  }), [isDesktopLocalOrigin, isMac, isWindows, isLinux, runtimeCtx, t, visiblePageSlugs]);

  const prepareSettingsSearchTarget = React.useCallback((result: SettingsSearchResult): string => {
    if (result.id.startsWith('agents.')) {
      const store = useAgentsStore.getState();
      const name = nextUniqueName('new-agent', store.agents.map((agent) => agent.name));
      store.setAgentDraft({ name, scope: 'user' });
      store.setSelectedAgent(name);
      return result.id === 'agents.create' ? 'agents.name' : result.id;
    }

    if (result.id.startsWith('commands.')) {
      const store = useCommandsStore.getState();
      const name = nextUniqueName('new-command', store.commands.map((command) => command.name));
      store.setCommandDraft({ name, scope: 'user' });
      store.setSelectedCommand(name);
      return result.id === 'commands.create' ? 'commands.name' : result.id;
    }

    if (result.id.startsWith('mcp.')) {
      const store = useMcpConfigStore.getState();
      const name = nextUniqueName('new-mcp-server', store.mcpServers.map((server) => server.name));
      store.setMcpDraft({
        name,
        scope: 'user',
        type: 'local',
        command: [],
        url: '',
        environment: [],
        headers: [],
        oauthEnabled: true,
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScope: '',
        oauthRedirectUri: '',
        oauthCallbackPort: '',
        oauthAuthServerMetadataUrl: '',
        protocol: 'legacy',
        timeoutStartup: '',
        timeoutCatalog: '',
        timeoutExecution: '',
        codemode: 'default',
        disabled: false,
      });
      store.setSelectedMcp(name);
      return result.id === 'mcp.create' ? 'mcp.server' : result.id;
    }

    if (result.id.startsWith('snippets.')) {
      const store = useSnippetsStore.getState();
      const name = nextUniqueName('new-snippet', store.snippets.map((snippet) => snippet.name));
      store.setSnippetDraft({ name, scope: 'global' });
      store.setSelectedSnippet(name);
      return result.id === 'snippets.create' ? 'snippets.content' : result.id;
    }

    if (result.id.startsWith('skills.')) {
      const store = useSkillsStore.getState();
      const name = nextUniqueName('new-skill', store.skills.map((skill) => skill.name));
      store.setSkillDraft({ name, scope: 'user', source: 'opencode', description: '', instructions: '' });
      store.setSelectedSkill(name);
      return result.id === 'skills.create' ? 'skills.basic-information' : result.id;
    }

    if (result.id === 'providers.connect') {
      useUIStore.getState().setSettingsProvidersConnectRequested(true);
    }

    if (result.id === 'providers.classification') {
      useUIStore.getState().setSettingsProvidersClassificationRequested(true);
    }

    if (result.id === 'plugins.create') {
      window.setTimeout(() => { window.dispatchEvent(new CustomEvent('openchamber:settings-open-plugin-add')); }, 50);
      return 'plugins.spec';
    }

    const projectTab = projectSettingsTabForSearchTarget(result.id);
    if (projectTab) {
      useProjectSettingsTabStore.getState().setTab(projectTab);
    }

    return result.id;
  }, []);

  const settingsJumpRequest = useUIStore((state) => state.settingsJumpRequest);
  const jumpRequest = React.useMemo(() => settingsJumpRequest ? { ...settingsJumpRequest, page: resolveSettingsSlug(settingsJumpRequest.page) } : null, [settingsJumpRequest]);
  const consumeJumpRequest = React.useCallback(() => useUIStore.getState().clearSettingsJumpRequest(), []);

  const renderUnavailable = React.useCallback(() => {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className={SETTINGS_SECTION_TITLE_CLASS}>{t('settings.view.unavailable.title')}</div>
          <p className="typography-ui text-muted-foreground mt-1">{t('settings.view.unavailable.description')}</p>
        </div>
      </div>
    );
  }, [t]);

  const renderPageSidebar = React.useCallback((slug: SettingsPageSlug, opts: { onItemSelect?: () => void }) => {
    switch (slug) {
      case 'projects':
        return <ProjectsSidebar onItemSelect={opts.onItemSelect} />;
      case 'agents':
        return <AgentsSidebar onItemSelect={opts.onItemSelect} />;
      case 'commands':
        return <CommandsSidebar onItemSelect={opts.onItemSelect} />;
      case 'skills.installed':
        return <SkillsSidebar onItemSelect={opts.onItemSelect} />;
      case 'usage':
        return <UsageSidebar onItemSelect={opts.onItemSelect} />;
      case 'magic-prompts':
        return <MagicPromptsSidebar onItemSelect={opts.onItemSelect} />;
      case 'snippets':
        return <SnippetsSidebar onItemSelect={opts.onItemSelect} />;
      default:
        return null;
    }
  }, []);

  const renderPageContent = React.useCallback((slug: SettingsPageSlug) => {
    const meta = getSettingsPageMeta(slug);
    if (meta && !isPageAvailable(meta, runtimeCtx)) {
      return renderUnavailable();
    }

    switch (slug) {
      case 'projects':
        return <ProjectsPage />;
      case 'remote-instances':
        return <RemoteInstancesPage />;
      case 'agents':
        return <AgentsPage />;
      case 'behavior':
        return <BehaviorPage />;
      case 'commands':
        return <CommandsPage />;
      case 'mcp':
        return <McpPage />;
      case 'plugins':
        return <PluginsPage />;
      case 'skills.installed':
        return <SkillsPage view="installed" />;
      case 'skills.catalog':
        return <SkillsPage view="catalog" />;
      case 'providers':
        return <ProvidersPage />;
      case 'web-search':
        return <WebSearchPage />;
      case 'usage':
        return <UsagePage />;
      case 'about':
        return (
          <SettingsPageLayout title={t('settings.page.about.title')} showSaveStatus={false}>
            <AboutSettings />
          </SettingsPageLayout>
        );
      case 'magic-prompts':
        return <MagicPromptsPage />;
      case 'snippets':
        return <SnippetsPage />;
      case 'git':
        return <GitPage />;
      case 'integrations':
        return <IntegrationsPage />;
      case 'routing':
        return <RoutingPage />;
      case 'extensions':
        return <ExtensionsPage />;
      case 'general':
      case 'appearance':
      case 'chat':
      case 'shortcuts':
      case 'sessions':
      case 'notifications':
      case 'voice':
      case 'tunnel':
      case 'isolated-spaces': {
        const section = openChamberSectionBySlug[slug] ?? 'visual';
        return <OpenChamberPage section={section} />;
      }
      case 'home':
      default:
        return null;
    }
  }, [openChamberSectionBySlug, renderUnavailable, runtimeCtx, t]);

  const openSettingsCombo = getEffectiveShortcutCombo(
    'open_settings',
    openSettingsShortcutOverride === undefined ? undefined : { open_settings: openSettingsShortcutOverride },
  );
  const closeSettingsTitle = openSettingsCombo
    ? t('settings.view.actions.closeSettingsWithShortcut', {
        shortcut: formatShortcutForDisplay(openSettingsCombo),
      })
    : t('settings.view.actions.closeSettings');

  return <SettingsViewPresentation page={settingsSlug} onPageChange={setSettingsPage} runtimeCtx={runtimeCtx}
    isWindowed={isWindowed} visiblePageSlugs={visiblePageSlugs} buildSearchResults={buildSearchResults}
    prepareSearchTarget={prepareSettingsSearchTarget} renderPageContent={renderPageContent} renderPageSidebar={renderPageSidebar}
    onClose={onClose} closeSettingsTitle={closeSettingsTitle} registerBackHandler={registerBackHandler}
    initialMobileStage={initialMobileStage} jumpRequest={jumpRequest} onJumpRequestConsumed={consumeJumpRequest} />;
};
