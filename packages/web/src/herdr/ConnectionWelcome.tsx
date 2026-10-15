import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { MobileConnectionWelcomeView } from '@/apps/MobileConnectionWelcomeView';
import { MobileQrScannerOverlay } from '@/apps/MobileQrScannerOverlay';
import { isQrScanSupported, scanQrText } from '@/apps/mobileQrScan';
import { mobileConnectionInputClass, mobileInputKeyboardProps } from '@/apps/mobileConnectionUi';
import { useI18n } from '@/lib/i18n';
import { credentialStorageKind } from './transport';
import { HerdrConnectionController } from './connection-controller';
import { useHerdrText } from './herdr.i18n';

export function ConnectionWelcome({ controller, toolbar, onClose }: { controller: HerdrConnectionController; toolbar: ReactNode; onClose: (() => void) | null }) {
  const { t } = useI18n();
  const h = useHerdrText();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const scanSupported = isQrScanSupported();
  const [manualOpen, setManualOpen] = useState(() => !scanSupported || !!state.pairing || !!state.error);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const busy = !['editing', 'save-failed'].includes(state.phase);
  const locked = state.phase !== 'editing';
  const cancelScan = useCallback(() => { scanAbort.current?.abort(); }, []);
  useEffect(() => {
    if (state.pairing || state.error) setManualOpen(true);
    cancelScan();
  }, [state.intakeRevision, state.pairing, state.error, cancelScan]);
  useEffect(() => () => scanAbort.current?.abort(), []);
  const scan = async () => {
    if (scanAbort.current || locked) return;
    const abort = new AbortController();
    const intakeRevision = controller.getSnapshot().intakeRevision;
    scanAbort.current = abort;
    setScanError(null); setScanning(true);
    try {
      const result = await scanQrText({ signal: abort.signal });
      if (abort.signal.aborted || controller.getSnapshot().intakeRevision !== intakeRevision) return;
      switch (result.status) {
        case 'ok': controller.acceptLink(result.rawValue); setManualOpen(true); break;
        case 'permission-denied': setScanError(t('mobile.connect.scan.permissionDenied')); break;
        case 'unsupported': setScanError(t('mobile.connect.scan.unsupported')); break;
        case 'failed': setScanError(t('mobile.connect.scan.failed')); break;
        case 'cancelled': break;
      }
    } finally {
      if (scanAbort.current === abort) { scanAbort.current = null; setScanning(false); }
    }
  };
  const errorCode = state.error;
  const error = scanError ?? (errorCode === 'invalidPairing' || errorCode === 'invalidServer' || errorCode === 'credentialStorage' || errorCode === 'credentialSave' ? h(errorCode) : errorCode);
  const manualForm = <form className="flex w-full flex-col gap-3 pt-3" onSubmit={event => { event.preventDefault(); setScanError(null); void controller.connect(); }}>
    <label className="flex flex-col gap-1 typography-small text-muted-foreground">{h('server')}
      <input {...mobileInputKeyboardProps} className={mobileConnectionInputClass} type="url" dir="ltr" inputMode="url" autoCapitalize="none" required disabled={locked} tabIndex={manualOpen ? undefined : -1} value={state.server} onChange={event => controller.setServer(event.target.value)} />
    </label>
    {!state.pairing && <label className="flex flex-col gap-1 typography-small text-muted-foreground">{h('pairing')}
      <input {...mobileInputKeyboardProps} className={mobileConnectionInputClass} type="password" dir="ltr" autoCapitalize="none" required disabled={locked} tabIndex={manualOpen ? undefined : -1} value={state.pairingText} onChange={event => { setScanError(null); controller.setPairingText(event.target.value); }} />
    </label>}
    <p className="px-1 text-center typography-small text-muted-foreground">{h('pairingHint')}</p>
    {error && <p className="px-1 text-center typography-small text-[var(--status-error)]" role="alert">{error}</p>}
    <Button type="submit" size="lg" className="h-12 w-full" tabIndex={manualOpen ? undefined : -1} disabled={busy || scanning || !state.server.trim()}>{busy ? t('mobile.connect.connecting') : t('mobile.connect.connectButton')}</Button>
    <p className="px-1 text-center typography-micro text-muted-foreground">{h(credentialStorageKind() === 'native' ? 'nativeCredential' : 'localCredential')}</p>
  </form>;
  return <>
    {scanning && <MobileQrScannerOverlay onCancel={cancelScan} hint={h('pairingHint')} />}
    <MobileConnectionWelcomeView logo={<span className="flex size-[72px] items-center justify-center"><img src="/openherdr.svg" width={72} height={72} alt="OpenHerdr" /></span>} title={h('connectTitle')} scan={{ supported: scanSupported, scanning, busy, hint: h('pairingHint'), onScan: () => void scan() }} error={error} saved={state.saved.map(item => ({ id: item.server, label: item.server, detail: '', connecting: state.savingSaved === item.server }))} onSaved={server => { setScanError(null); void controller.selectSaved(server); }} disabled={locked || scanning} manualOpen={manualOpen} onToggleManual={() => { if (!locked) setManualOpen(current => !current); }} manualForm={manualForm} toolbar={<><div className="flex items-center justify-center gap-2">{toolbar}</div>{onClose && <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t('mobile.instances.cancelEdit')}</Button>}</>} />
  </>;
}
