import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { reportSettingsSaveState } from '@/lib/persistence';
import { HerdrPreferencesClient, HerdrPreferencesController, type PreferenceSurface } from './preferences-client';
import type { HerdrTransport } from './transport';

export function useHerdrPreferences(transport: HerdrTransport, surface: PreferenceSurface, enabled = true) {
  const controller = useMemo(() => new HerdrPreferencesController(new HerdrPreferencesClient(transport, surface)), [transport, surface]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    void controller.refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void controller.refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      // An accepted save completes against this controller's captured server.
      controller.cancelRefresh();
    };
  }, [controller, enabled]);
  useEffect(() => {
    reportSettingsSaveState(state.saving ? 'saving' : state.failure === 'save' || state.failure === 'conflict' ? 'error' : 'saved');
  }, [state.saving, state.failure]);
  return { state, controller, surface };
}
export type HerdrPreferencesModel = ReturnType<typeof useHerdrPreferences>;
