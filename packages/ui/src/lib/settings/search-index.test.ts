import { afterEach, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import { useUIStore } from '@/stores/useUIStore';
import { ISOLATED_SPACES_RELEASED } from '@/lib/spaces/release';
import { buildSettingsSearchResults, type SettingsSearchItem } from './search-index';
import { buildSettingsSearchResults as buildOriginalSearchResults } from './search';

const runtimeCtx = { isVSCode: false, isWeb: true, isDesktop: false, isMobile: false, isDesktopLocalOrigin: false, isMac: false, isWindows: false, isLinux: false, routingAvailable: false, enterpriseMode: false, jevBlockedByEnterprise: false };
const t = (key: I18nKey) => key;
const getPageTitle = (page: string) => page;
const owner = useUIStore.getState();
const originalFlags = { agentControlToolEnabled: owner.agentControlToolEnabled, isolatedSpacesEnabled: owner.isolatedSpacesEnabled, agentMemoryFeatureAvailable: owner.agentMemoryFeatureAvailable };
afterEach(() => { useUIStore.setState(originalFlags); });

test('a surface supplies exact real search items without inheriting another surface mobile font guard', () => {
  const items: readonly SettingsSearchItem[] = [
    { id: 'appearance.interface-font-size', page: 'appearance', titleKey: 'settings.openchamber.visual.field.interfaceFontSize', keywords: ['fixture font'] },
    { id: 'chat.enter-to-send', page: 'chat', titleKey: 'settings.openchamber.visual.field.enterToSend', keywords: ['fixture enter'], isAvailable: ctx => !ctx.isMobile },
  ];
  const mobile = { ...runtimeCtx, isMobile: true };
  expect(buildSettingsSearchResults({ query: 'fixture', runtimeCtx: mobile, items, t, getPageTitle }).map(result => result.id)).toEqual(['appearance.interface-font-size']);
  expect(buildSettingsSearchResults({ query: 'fixture', runtimeCtx, items, t, getPageTitle }).map(result => result.id)).toEqual(['appearance.interface-font-size', 'chat.enter-to-send']);
  expect(buildSettingsSearchResults({ query: 'font size', runtimeCtx: mobile, t, getPageTitle }).some(result => result.id === 'appearance.interface-font-size')).toBe(false);
});

test('explicit items retain registry order, all-term matching and exact page restriction', () => {
  const items: readonly SettingsSearchItem[] = [
    { id: 'chat.first', page: 'chat', titleKey: 'settings.page.chat.title', keywords: ['visible fixture'] },
    { id: 'appearance.second', page: 'appearance', titleKey: 'settings.page.appearance.title', keywords: ['visible fixture'] },
  ];
  expect(buildSettingsSearchResults({ query: '  VISIBLE fixture ', runtimeCtx, items, t, getPageTitle }).map(result => result.id)).toEqual(['chat.first', 'appearance.second']);
  expect(buildSettingsSearchResults({ query: 'fixture', runtimeCtx, items, visiblePageSlugs: ['appearance'], t, getPageTitle }).map(result => result.id)).toEqual(['appearance.second']);
  expect(buildSettingsSearchResults({ query: 'fixture absent', runtimeCtx, items, t, getPageTitle })).toEqual([]);
  expect(buildSettingsSearchResults({ query: ' ', runtimeCtx, items, t, getPageTitle })).toEqual([]);
});

test('the original wrapper supplies the current control and memory owners over caller hints', () => {
  for (const enabled of [false, true]) {
    useUIStore.setState({ agentControlToolEnabled: enabled, agentMemoryFeatureAvailable: enabled });
    const context = { ...runtimeCtx, agentControlToolEnabled: !enabled, agentMemoryFeatureAvailable: !enabled };
    expect(buildOriginalSearchResults({ query: 'worktree move', runtimeCtx: context, t, getPageTitle }).some(result => result.id === 'sessions.agent-worktree-move')).toBe(enabled);
    expect(buildOriginalSearchResults({ query: 'memory', runtimeCtx: context, t, getPageTitle }).some(result => result.id === 'sessions.agent-memory-tool')).toBe(enabled);
    expect(buildOriginalSearchResults({ query: 'memory', runtimeCtx: { ...context, isVSCode: true }, t, getPageTitle }).some(result => result.id === 'sessions.agent-memory-tool')).toBe(false);
  }
});

test('the isolated spaces owner and unreleased/runtime guards remain required', () => {
  for (const enabled of [false, true]) {
    useUIStore.setState({ isolatedSpacesEnabled: enabled });
    const results = buildOriginalSearchResults({ query: 'idle stop', runtimeCtx: { ...runtimeCtx, isolatedSpacesEnabled: !enabled }, t, getPageTitle });
    expect(results.some(result => result.id === 'general.isolated-spaces-idle-stop')).toBe(ISOLATED_SPACES_RELEASED && enabled);
    expect(buildOriginalSearchResults({ query: 'space', runtimeCtx: { ...runtimeCtx, isVSCode: true }, t, getPageTitle }).some(result => result.page === 'isolated-spaces')).toBe(false);
  }
});
