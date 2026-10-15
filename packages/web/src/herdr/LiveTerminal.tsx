import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import type { Theme } from '@/types/theme';
import { convertThemeToXterm, toGhosttyTheme } from '@/lib/terminalTheme';
import type { GhosttyTerminalSurface } from '@/lib/ghostty/surface';
import { isHerdrForeground } from '@openchamber/ui/lib/herdr-native';
import { useHerdrText } from './herdr.i18n';
import type { Connection } from './transport';

const terminalFrame = z.object({ type: z.literal('terminal.frame'), bytes: z.string().max(2 * 1024 * 1024), full: z.boolean(), width: z.number().int().min(1).max(1000), height: z.number().int().min(1).max(500), seq: z.number().int().nonnegative() });

export function LiveTerminal({ connection, machine, paneId, theme, fallback }: { connection: Connection; machine: string; paneId: string; theme: Theme; fallback: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null);
  const surface = useRef<GhosttyTerminalSurface | null>(null);
  const latestTheme = useRef(theme);
  latestTheme.current = theme;
  const [unavailable, setUnavailable] = useState(false);
  const h = useHerdrText();
  const labels = useRef({ input: h('snapshot'), scrollbar: h('follow') });

  useEffect(() => { surface.current?.setTheme(toGhosttyTheme(convertThemeToXterm(theme))); }, [theme]);
  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    let live = true;
    let observer: ResizeObserver | undefined;
    let stream: AbortController | undefined;
    let terminal: GhosttyTerminalSurface | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setUnavailable(false);
    const read = async () => {
      clearTimeout(retryTimer);
      stream?.abort();
      if (!live || !isHerdrForeground() || navigator.onLine === false || !terminal) return;
      const own = ++generation;
      const controller = new AbortController(); stream = controller;
      const width = Math.max(20, Math.min(300, Math.floor(container.clientWidth / 8)));
      const height = Math.max(5, Math.min(150, Math.floor(container.clientHeight / 18)));
      let permanentFailure = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetch(new URL('/api/herdr/terminal', connection.server), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ machine, pane_id: paneId, cols: width, rows: height }), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        permanentFailure = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
        if (!response.ok || !response.body) throw new Error('Observation unavailable');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; let lastSeq = -1;
        while (live && generation === own) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 3 * 1024 * 1024) throw new Error('Invalid terminal frame');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line) continue;
            const frame = terminalFrame.safeParse(JSON.parse(line));
            if (!frame.success) continue;
            if (!live || controller.signal.aborted || generation !== own || frame.data.seq <= lastSeq) continue;
            lastSeq = frame.data.seq;
            const bytes = Uint8Array.from(atob(frame.data.bytes), (character) => character.charCodeAt(0));
            const text = new TextDecoder().decode(bytes);
            if (frame.data.full) terminal.resetAndWrite(text, { cols: frame.data.width, rows: frame.data.height });
            else terminal.write(text);
            failures = 0; terminal.setVisible(true); setUnavailable(false);
          }
        }
        if (live && generation === own && !controller.signal.aborted) setUnavailable(true);
      } catch {
        if (live && generation === own && !controller.signal.aborted) setUnavailable(true);
      } finally {
        const retry = live && generation === own && !controller.signal.aborted;
        controller.abort();
        void reader?.cancel().catch(() => undefined);
        if (retry) {
          terminal?.setVisible(false);
          failures += 1;
          if (isHerdrForeground() && navigator.onLine) retryTimer = setTimeout(() => void read(), permanentFailure ? 30000 : Math.min(15000, 1000 * 2 ** Math.min(failures - 1, 4)));
        }
      }
    };
    const visibility = () => {
      generation += 1; clearTimeout(retryTimer);
      stream?.abort();
      terminal?.setVisible(isHerdrForeground());
      if (isHerdrForeground() && navigator.onLine !== false) void read();
    };
    void import('@/lib/ghostty/surface').then(async ({ GhosttyTerminalSurface: Surface }) => {
      terminal = await Surface.create(container, {
        theme: toGhosttyTheme(convertThemeToXterm(latestTheme.current)),
        font: { size: 12 }, labels: labels.current,
        // Observation never acquires Herdr's exclusive terminal controller.
        // Text and keys are sent deliberately through the composer below it.
        onData: () => {}, beforeKey: () => false,
        onResize: () => {},
        onLinkActivate: () => {},
      });
      if (!live) { terminal.dispose(); return; }
      surface.current = terminal;
      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { terminal?.fit(); void read(); }, 200);
      });
      observer.observe(container);
      document.addEventListener('visibilitychange', visibility);
      for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.addEventListener(event, visibility);
      void read();
    }).catch(() => { if (live) setUnavailable(true); });
    return () => {
      live = false; generation += 1;
      clearTimeout(resizeTimer); clearTimeout(retryTimer); observer?.disconnect(); stream?.abort();
      document.removeEventListener('visibilitychange', visibility);
      for (const event of ['online', 'offline', 'openherdr:resume', 'openherdr:pause']) window.removeEventListener(event, visibility);
      terminal?.dispose(); surface.current = null;
    };
    // Theme changes update the existing emulator above without restarting its stream.
  }, [connection.server, connection.token, machine, paneId]);

  return <div className="herdr-live-terminal"><div ref={mount} className="herdr-frame-canvas" dir="ltr" style={{ visibility: unavailable ? 'hidden' : undefined }} />{unavailable && <div className="herdr-terminal-fallback">{fallback}</div>}</div>;
}
