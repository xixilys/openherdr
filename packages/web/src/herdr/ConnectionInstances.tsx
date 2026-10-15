import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { MobileInstancesListView } from '@/apps/MobileInstancesListView';
import { mobileConnectionInputClass, mobileInputKeyboardProps } from '@/apps/mobileConnectionUi';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { closeTopmostBackLayer, registerBackLayer } from '@/lib/mobileBackLayers';
import { useHerdrText } from './herdr.i18n';
import { HerdrConnectionController } from './connection-controller';
import type { Connection } from './transport';

/** Original instance rows with Herdr's exact-origin credential owner. */
export function ConnectionInstances({ controller, activeConnection, onAdd, onRemoved }: {
  controller: HerdrConnectionController;
  activeConnection: Connection | null;
  onAdd: (server?: string) => void;
  onRemoved: (connection: Connection) => void;
}) {
  const { t } = useI18n();
  const h = useHerdrText();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = state.phase !== 'editing';
  const editingConnection = state.saved.find(item => item.server === editing);
  const isActive = (connection: Connection) => activeConnection?.server === connection.server && activeConnection.token === connection.token && !controller.isRejected(connection);
  const error = state.error === 'connectionUnavailable' ? t('mobile.connect.error.unreachable') : state.error === 'invalidPairing' || state.error === 'invalidServer' || state.error === 'credentialStorage' || state.error === 'credentialSave' ? h(state.error) : state.error;
  const dismissLocal = () => { setConfirming(null); setEditing(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!editing && !confirming) return;
    return registerBackLayer(() => { if (controller.getSnapshot().phase === 'editing') dismissLocal(); });
  }, [controller, editing, confirming]);
  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingConnection) return;
    if (await controller.renameSaved(editingConnection.server, label) && mounted.current) setEditing(null);
  };
  const remove = async (server: string) => {
    const removed = await controller.removeSaved(server);
    if (!removed) return;
    if (mounted.current) { setConfirming(null); if (editing === server) setEditing(null); }
    onRemoved(removed);
  };
  return <div className="flex h-full flex-col overflow-hidden" onKeyDownCapture={event => {
    if (event.key === 'Escape' && (editing || confirming)) { event.preventDefault(); event.stopPropagation(); closeTopmostBackLayer(); }
  }}>
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <fieldset disabled={busy} className="min-w-0 space-y-6 border-0 p-0">
        <MobileInstancesListView rows={state.saved.map(connection => ({
          id: connection.server,
          label: connection.label || connection.server,
          status: isActive(connection) ? `${t('desktopHostSwitcher.header.current')} · ${connection.server}` : connection.server,
          active: isActive(connection),
          connecting: state.savingSaved === connection.server,
          disabled: controller.isRejected(connection),
          canEdit: true,
        }))} busy={busy} confirmingDeleteId={confirming} onSelect={server => { void controller.selectSaved(server); }} onEdit={server => {
          const connection = state.saved.find(item => item.server === server);
          if (!connection) return;
          setEditing(server); setLabel(connection.label ?? ''); setConfirming(null);
        }} onToggleDelete={server => setConfirming(value => value === server ? null : server)} onConfirmDelete={server => { void remove(server); }} />
        {state.authRequiredServer && <div className="space-y-3">
          <p role="status" className="typography-small text-muted-foreground">{t('mobile.connect.notice.authExpired', { label: state.authRequiredServer })}</p>
          <Button type="button" variant="outline" onClick={() => onAdd(state.authRequiredServer ?? undefined)}>{t('mobile.connect.connectButton')}</Button>
        </div>}
        {error && <p role="alert" className="px-1 typography-small text-[var(--status-error)]">{error}</p>}
        {editingConnection ? <form className="space-y-3" onSubmit={event => { void rename(event); }}>
          <div className="flex h-8 items-center justify-between gap-3 px-1">
            <h3 className="typography-ui-label text-foreground">{t('mobile.instances.editTitle')}</h3>
            <Button type="button" variant="ghost" size="xs" onClick={dismissLocal}>{t('mobile.instances.cancelEdit')}</Button>
          </div>
          <label className="block space-y-1.5">
            <span className="block px-1 typography-ui-label text-foreground">{t('mobile.connect.url.label')}</span>
            <input {...mobileInputKeyboardProps} type="url" dir="ltr" className={mobileConnectionInputClass} readOnly value={editingConnection.server} />
          </label>
          <label className="block space-y-1.5">
            <span className="block px-1 typography-ui-label text-foreground">{t('mobile.instances.label.label')}</span>
            <input className={mobileConnectionInputClass} value={label} onChange={event => setLabel(event.target.value)} placeholder={t('mobile.instances.label.placeholder')} autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false} maxLength={128} dir="auto" />
          </label>
          <Button type="submit" size="lg" className="mt-1 h-12 w-full">{busy ? t('common.loading') : t('mobile.instances.saveEdit')}</Button>
        </form> : <Button type="button" variant="outline" size="lg" className="h-12 w-full" onClick={() => onAdd()}><Icon name="add" className="size-[18px]" />{t('mobile.instances.addTitle')}</Button>}
      </fieldset>
    </div>
  </div>;
}
