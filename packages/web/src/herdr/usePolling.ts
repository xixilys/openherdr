import { useEffect, useState } from 'react';
import { isHerdrForeground } from '@openchamber/ui/lib/herdr-native';

export function usePolling<T>(read: (signal: AbortSignal) => Promise<T>, enabled: boolean, interval: number, scope?: string) {
  const owner = scope ?? read;
  const [state, setState] = useState<{ owner: string | typeof read; data: T | null; error: Error | null; loading: boolean }>({ owner, data: null, error: null, loading: true });
  useEffect(() => {
    setState(previous => previous.owner === owner ? previous : { owner, data: null, error: null, loading: enabled });
    if (!enabled) return;
    let live = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const tick = async () => {
      if (!live || !isHerdrForeground() || navigator.onLine === false) return;
      const controller = new AbortController();
      request = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
      try {
        const data = await read(controller.signal);
        if (live && request === controller && !controller.signal.aborted) { setState({ owner, data, error: null, loading: false }); failures = 0; }
      } catch (error) {
        if (live && request === controller && (!controller.signal.aborted || timedOut)) {
          failures += 1;
          setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error : new Error('DISCONNECTED') }));
        }
      } finally {
        clearTimeout(timeout);
        if (live && request === controller && isHerdrForeground() && navigator.onLine) timer = setTimeout(tick, Math.min(15000, interval * 2 ** failures));
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      const previous = request; request = undefined;
      previous?.abort();
      if (isHerdrForeground() && navigator.onLine !== false) void tick();
    };
    document.addEventListener('visibilitychange', visibility);
    for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.addEventListener(event, visibility);
    void tick();
    return () => { live = false; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.removeEventListener(event, visibility); };
  }, [read, enabled, interval, owner]);
  return state.owner === owner ? state : { data: null, error: null, loading: enabled };
}
