import { useCallback, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { HerdrTransport } from './transport';
import { usePolling } from './usePolling';
import { useHerdrText } from './herdr.i18n';

const filesSchema = z.object({ root: z.string(), path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(['directory', 'link', 'file']) })), truncated: z.boolean() });
const fileSchema = z.object({ root: z.string(), path: z.string(), content: z.string().max(262144), bytes: z.number().nonnegative() });
const statusSchema = z.object({ root: z.string(), branch: z.string(), status: z.string().max(2097152) });
const diffSchema = z.object({ root: z.string(), mode: z.enum(['diff', 'staged']), diff: z.string().max(2097152) });

type FilesTarget = { mode: 'list' | 'read'; path: string };
export function FilesPanel({ transport, machine, paneId }: { transport: HerdrTransport; machine: string; paneId: string }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const [target, setTarget] = useState<FilesTarget>({ mode: 'list', path: '' });
  const [refresh, setRefresh] = useState(0);
  const read = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const options = { method: 'POST', body: JSON.stringify({ machine, pane_id: paneId, ...target }), signal };
    if (target.mode === 'list') return { mode: 'list' as const, ...await transport.request('/api/herdr/files', filesSchema, options) };
    return { mode: 'read' as const, ...await transport.request('/api/herdr/files', fileSchema, options) };
  }, [transport, machine, paneId, target, refresh]);
  const result = usePolling(read, !!paneId, 15000, `${machine}:${paneId}:${target.mode}:${target.path}`);
  const back = () => setTarget({ mode: 'list', path: target.path.split('/').slice(0, -1).join('/') });
  return <section className="herdr-content"><div className="herdr-content-toolbar"><Button variant="ghost" size="sm" disabled={!target.path} onClick={back}><Icon name="arrow-go-back" className="size-4" />{t('mobile.files.parentDirectory')}</Button><span className="herdr-file-path" dir="ltr">/{target.path}</span><Button variant="ghost" size="icon" aria-label={t('gitView.history.refresh')} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" /></Button></div>{result.error && <p className="herdr-banner herdr-error" role="alert">{result.error.message}</p>}{result.loading && <p className="herdr-detail">{t('common.loading')}</p>}{!paneId && <p className="herdr-detail">{h('noPane')}</p>}{result.data?.mode === 'list' && <div className="herdr-file-list">{result.data.entries.length === 0 && <p>{h('empty')}</p>}{result.data.entries.map(item => <Button key={item.name} variant="ghost" className="herdr-file-row" onClick={() => setTarget({ mode: item.type === 'directory' ? 'list' : 'read', path: target.path ? `${target.path}/${item.name}` : item.name })}><Icon name={item.type === 'directory' ? 'folder' : 'file-text'} className="size-4" /><span dir="auto">{item.name}</span>{item.type === 'link' && <span>↗</span>}</Button>)}{result.data.truncated && <p className="herdr-muted">{h('truncated')}</p>}</div>}{result.data?.mode === 'read' && <pre className="herdr-file-content" dir="ltr"><code>{result.data.content}</code></pre>}<footer className="herdr-content-root" dir="ltr">{result.data?.root}</footer></section>;
}

export function ChangesPanel({ transport, machine, paneId }: { transport: HerdrTransport; machine: string; paneId: string }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const [mode, setMode] = useState<'status' | 'diff' | 'staged'>('status');
  const [refresh, setRefresh] = useState(0);
  const read = useCallback(async (signal: AbortSignal) => {
    void refresh;
    const options = { method: 'POST', body: JSON.stringify({ machine, pane_id: paneId, mode }), signal };
    if (mode === 'status') return { mode: 'status' as const, ...await transport.request('/api/herdr/git', statusSchema, options) };
    return transport.request('/api/herdr/git', diffSchema, options);
  }, [transport, machine, paneId, mode, refresh]);
  const result = usePolling(read, !!paneId, 15000, `${machine}:${paneId}:${mode}`);
  const text = result.data && ('status' in result.data ? result.data.status : result.data.diff);
  return <section className="herdr-content"><div className="herdr-content-toolbar"><Button variant="chip" size="sm" aria-pressed={mode === 'status'} onClick={() => setMode('status')}>{t('gitView.pr.checks.statusLabel')}</Button><Button variant="chip" size="sm" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>{t('walkthrough.scope.working')}</Button><Button variant="chip" size="sm" aria-pressed={mode === 'staged'} onClick={() => setMode('staged')}>{t('walkthrough.scope.staged')}</Button><span className="herdr-spacer" /><Button variant="ghost" size="icon" aria-label={t('gitView.history.refresh')} onClick={() => setRefresh(value => value + 1)}><Icon name="refresh" className="size-4" /></Button></div>{result.error && <p className="herdr-banner herdr-error" role="alert">{result.error.message}</p>}{result.loading && <p className="herdr-detail">{t('common.loading')}</p>}{!paneId && <p className="herdr-detail">{h('noPane')}</p>}{result.data && <><p className="herdr-content-root" dir="ltr">{result.data.root}{'branch' in result.data && ` · ${result.data.branch}`}</p><pre className="herdr-file-content" dir="ltr"><code>{text || h('empty')}</code></pre></>}</section>;
}
