import { useCallback, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import type { Theme } from '@/types/theme';
import { LiveTerminal, type LiveTerminalStatus } from './LiveTerminal';
import { readSchema, TransportError, type snapshotSchema, type HerdrTransport } from './transport';
import { useHerdrText } from './herdr.i18n';
import { usePolling } from './usePolling';

type Pane = z.infer<typeof snapshotSchema>['snapshot']['panes'][number];
type PaneMonitorProps = { transport: HerdrTransport; machine: string; pane: Pane; theme: Theme; active: boolean; snapshotStale: boolean };

/** A terminal occupant owns its output independently of matching pane IDs on other machines. */
export function PaneMonitor(props: PaneMonitorProps) {
  return <PaneMonitorOwner key={JSON.stringify([props.transport.connection.server, props.machine, props.pane.pane_id, props.pane.terminal_id])} {...props} />;
}

function PaneMonitorOwner({ transport, machine, pane, theme, active, snapshotStale }: PaneMonitorProps) {
  const { t, locale } = useI18n();
  const h = useHerdrText();
  const [screen, setScreen] = useState(true);
  const [observation, setObservation] = useState<LiveTerminalStatus>({ kind: 'connecting', lastReadAt: null });
  const { pane_id: paneId, terminal_id: terminalId, workspace_id: workspaceId, tab_id: tabId } = pane;
  const owner = JSON.stringify([transport.connection.server, machine, paneId, terminalId]);
  const read = useCallback(async (signal: AbortSignal) => {
    const result = await transport.rpc(machine, 'pane.read', { pane_id: paneId, source: 'visible', format: 'text', strip_ansi: true, lines: 500 }, readSchema, signal);
    if (result.read.pane_id !== paneId || result.read.workspace_id !== workspaceId || result.read.tab_id !== tabId || result.read.source !== 'visible') throw new TransportError('INVALID_RESPONSE', t('common.unavailable'));
    return { ...result.read, readAt: Date.now() };
  }, [machine, paneId, tabId, transport, workspaceId, t]);
  const output = usePolling(read, active && (!screen || observation.kind !== 'live'), 900, owner);
  const lastReadAt = output.data?.readAt ?? null;
  const formattedTime = lastReadAt ? new Date(lastReadAt).toLocaleString(locale) : null;
  const showingText = !screen || observation.kind !== 'live' || !active;
  const textError = showingText ? output.error : null;
  const stale = !active || !!textError || (screen && observation.kind !== 'live' && (lastReadAt ?? 0) < (observation.lastReadAt ?? 0));
  const text = <pre className="herdr-output" dir="ltr" tabIndex={0} aria-label={t('herdr.monitor.visibleText')}><code>{output.data ? output.data.text : output.loading ? t('common.loading') : t('herdr.monitor.waiting')}</code></pre>;
  return <section className="herdr-panel-body" data-pane-monitor={owner}>
    <div className="herdr-pane-toolbar flex-wrap">
      <span className="typography-meta text-muted-foreground">{t('herdr.monitor.readOnly')}</span>
      <div className="herdr-row">
        <Button size="sm" variant="ghost" aria-pressed={screen} onClick={() => setScreen(true)}>{t('herdr.monitor.screen')}</Button>
        <Button size="sm" variant="ghost" aria-pressed={!screen} onClick={() => setScreen(false)}>{t('herdr.monitor.visibleText')}</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 typography-meta text-muted-foreground">
      <i className={`herdr-status ${snapshotStale ? 'unknown' : pane.agent_status}`} />
      <span dir="auto">{pane.display_agent ?? pane.agent ?? pane.agent_status}</span>
      <span dir="auto" className="min-w-0 truncate">{pane.foreground_cwd ?? pane.cwd ?? ''}</span>
    </div>
    {textError ? <p className="herdr-banner herdr-error" role="alert">{textError.message}</p> : null}
    {stale ? <p className="herdr-banner herdr-warning" role="status">{!active ? t('herdr.monitor.paused') : null}{!active ? ' ' : null}{formattedTime ? t('herdr.monitor.stale', { time: formattedTime }) : t('herdr.monitor.waiting')}</p> : null}
    {screen && active && observation.kind === 'unavailable' ? <p className="herdr-banner typography-meta text-muted-foreground">{t('herdr.monitor.screenFallback')}</p> : null}
    <div className="herdr-terminal-body">
      {screen && active ? <LiveTerminal connection={transport.connection} machine={machine} paneId={paneId} theme={theme} onStatus={setObservation} fallback={text} /> : text}
    </div>
    {output.data?.truncated ? <p className="herdr-truncated">{h('truncated')}</p> : null}
    {showingText && formattedTime ? <p className="herdr-terminal-status"><span>{t('herdr.monitor.lastRead', { time: formattedTime })}</span></p> : null}
  </section>;
}
