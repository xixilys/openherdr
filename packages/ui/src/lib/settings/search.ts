import { useUIStore } from '@/stores/useUIStore';
import { buildSettingsSearchResults as buildSearchIndexResults, type BuildSettingsSearchResultsOptions } from './search-index';
export type { SettingsSearchResult } from './search-index';

/** Original Settings supplies availability owned by the original UI store. */
export function buildSettingsSearchResults(options: BuildSettingsSearchResultsOptions) {
  const availability = useUIStore.getState();
  return buildSearchIndexResults({
    ...options,
    runtimeCtx: {
      ...options.runtimeCtx,
      agentControlToolEnabled: availability.agentControlToolEnabled,
      isolatedSpacesEnabled: availability.isolatedSpacesEnabled,
      agentMemoryFeatureAvailable: availability.agentMemoryFeatureAvailable,
    },
  });
}
