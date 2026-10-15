import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { connectionDisplayUrl, useMobileConnection } from './mobileConnections';
import { useDebugPanelLongPress } from './mobileConnectionDebug';
import { MobileConnectionDebugPanel } from './MobileConnectionDebugPanel';
import { isQrScanSupported, parseConnectionPayload, scanConnectionQr } from './mobileQrScan';
import { mobileConnectionInputClass, mobileInputKeyboardProps } from './mobileConnectionUi';
import { MobileConnectionWelcomeView } from './MobileConnectionWelcomeView';
import { MobileQrConnectionLoading, MobileQrScannerOverlay } from './MobileQrScannerOverlay';

export type MobileConnectionNotice = {
  kind: 'unreachable' | 'auth-expired';
  label: string;
};

export const MobileConnectionWelcome: React.FC<{
  onConnected: () => void;
  /** Why the user landed here (failed cold-launch auto-connect) — shown as a banner. */
  notice?: MobileConnectionNotice | null;
}> = ({ onConnected, notice = null }) => {
  const { t } = useI18n();
  const conn = useMobileConnection(onConnected);
  const { connections, isBusy, isPasswordBusy, error, pendingConnection } = conn;
  const [serverUrl, setServerUrl] = React.useState('');
  const [connectionName, setConnectionName] = React.useState('');
  const [clientToken, setClientToken] = React.useState('');
  const [isScanning, setIsScanning] = React.useState(false);
  const [isCompletingScan, setIsCompletingScan] = React.useState(false);
  const scanAbortRef = React.useRef<AbortController | null>(null);
  const qrScanSupported = React.useMemo(() => isQrScanSupported(), []);
  // QR pairing is the primary flow; the manual URL form stays collapsed unless
  // scanning is unavailable (web build) or the user asks for it.
  const [manualOpen, setManualOpen] = React.useState(() => !isQrScanSupported());
  // Which saved connection is being connected to, for the per-row spinner.
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  // Hidden diagnostics: long-press the logo to open the connection event log —
  // reachable even when a user has been bounced back to this screen.
  const [debugOpen, setDebugOpen] = React.useState(false);
  const debugLongPress = useDebugPanelLongPress(React.useCallback(() => setDebugOpen(true), []));

  const handleSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    void conn.connect({ url: serverUrl, clientToken, label: connectionName });
  }, [clientToken, conn, connectionName, serverUrl]);

  // Accept a pasted pairing link (openchamber://connect?...) in the URL field and
  // split it back into the server URL + token.
  const handleUrlChange = React.useCallback((value: string) => {
    if (/^openchamber:\/\//i.test(value.trim())) {
      const payload = parseConnectionPayload(value);
      if (payload) {
        if ('pairing' in payload) {
          void conn.redeemPairingConnection(payload.pairing);
          return;
        }
        setServerUrl(payload.url);
        if (payload.label) setConnectionName(payload.label);
        if (payload.clientToken) setClientToken(payload.clientToken);
        return;
      }
    }
    setServerUrl(value);
  }, [conn]);

  const handleScanQr = React.useCallback(async () => {
    if (scanAbortRef.current || isBusy) return;
    conn.setError(null);
    setIsScanning(true);
    const controller = new AbortController();
    scanAbortRef.current = controller;
    try {
      const result = await scanConnectionQr({ signal: controller.signal });
      if (scanAbortRef.current === controller) {
        scanAbortRef.current = null;
        setIsScanning(false);
      }
      switch (result.status) {
        case 'ok':
          setIsCompletingScan(true);
          setServerUrl(result.url);
          if (result.label) setConnectionName(result.label);
          if (result.clientToken) setClientToken(result.clientToken);
          await conn.connect({ url: result.url, clientToken: result.clientToken, label: result.label });
          break;
        case 'pairing':
          setIsCompletingScan(true);
          await conn.redeemPairingConnection(result.pairing);
          break;
        case 'permission-denied':
          conn.setError(t('mobile.connect.scan.permissionDenied'));
          break;
        case 'invalid':
          conn.setError(t('mobile.connect.scan.invalid'));
          break;
        case 'unsupported':
          conn.setError(t('mobile.connect.scan.unsupported'));
          break;
        case 'failed':
          conn.setError(t('mobile.connect.scan.failed'));
          break;
        case 'cancelled':
        default:
          break;
      }
    } finally {
      setIsCompletingScan(false);
      if (scanAbortRef.current === controller) {
        scanAbortRef.current = null;
        setIsScanning(false);
      }
    }
  }, [conn, isBusy, t]);

  React.useEffect(() => () => scanAbortRef.current?.abort(), []);

  const handlePasswordSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    void conn.submitPassword(password);
  }, [conn, password]);

  const cancelPassword = React.useCallback(() => {
    setPassword('');
    conn.cancelPassword();
  }, [conn]);

  return (
    <>
    {isScanning ? <MobileQrScannerOverlay onCancel={() => scanAbortRef.current?.abort()} /> : null}
    {isCompletingScan ? <MobileQrConnectionLoading /> : null}
    {debugOpen ? <MobileConnectionDebugPanel onClose={() => setDebugOpen(false)} /> : null}
    <MobileConnectionWelcomeView
      logo={<span {...debugLongPress} className="select-none" style={{ touchAction: 'manipulation' }}><OpenChamberLogo width={72} height={72} className="size-[72px]" /></span>}
      title={t('mobile.connect.welcome.title')}
      notice={notice ? (<div
            role="status"
            className="flex w-full items-center gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_10%,transparent)] px-3.5 py-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--status-warning)_16%,transparent)] text-[var(--status-warning)]">
              <Icon name={notice.kind === 'auth-expired' ? 'lock' : 'cloud-off'} className="size-[18px]" />
            </span>
            <p className="min-w-0 flex-1 typography-small text-foreground">
              {notice.kind === 'auth-expired'
                ? t('mobile.connect.notice.authExpired', { label: notice.label })
                : t('mobile.connect.notice.unreachable', { label: notice.label })}
            </p>
          </div>) : null}
      replacementForm={pendingConnection ? (<form className="flex w-full flex-col gap-3" onSubmit={handlePasswordSubmit}>
            <div className="flex items-center gap-3 rounded-[18px] border border-border/70 bg-surface-elevated px-3.5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-interactive-hover text-foreground">
                <Icon name="lock" className="size-[18px]" />
              </span>
              <div className="min-w-0 text-start">
                <p className="truncate typography-ui-label text-foreground">{pendingConnection.label}</p>
                <p className="truncate typography-small text-muted-foreground">
                  {pendingConnection.candidates.some((c) => c.kind === 'direct') ? connectionDisplayUrl(pendingConnection) : t('mobile.connect.relay.badge')}
                </p>
              </div>
            </div>
            <input
              {...mobileInputKeyboardProps}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('mobile.connect.password.placeholder')}
              aria-label={t('mobile.connect.password.label')}
              type="password"
              autoFocus
              className={mobileConnectionInputClass}
            />
            {error ? <p className="px-1 text-center typography-small text-[var(--status-error)]">{error}</p> : null}
            <Button type="submit" size="lg" className="mt-1 h-12 w-full" disabled={isPasswordBusy || !password.trim()}>
              {isPasswordBusy ? t('mobile.connect.connecting') : t('mobile.connect.unlockButton')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={cancelPassword}
            >
              {t('mobile.connect.cancelPassword')}
            </Button>
          </form>) : null}
      scan={{ supported: qrScanSupported, scanning: isScanning, busy: isBusy, hint: t('mobile.connect.welcome.scanHint'), onScan: () => void handleScanQr() }}
      error={error}
      saved={connections.map(connection => ({ id: connection.id, label: connection.label, detail: connection.candidates.some(candidate => candidate.kind === 'direct') ? connectionDisplayUrl(connection) : t('mobile.connect.relay.badge'), connecting: connectingId === connection.id }))}
      onSaved={id => {
        const connection = connections.find(value => value.id === id);
        if (!connection) return;
        setConnectingId(connection.id);
        void conn.connect({ id: connection.id, candidates: connection.candidates, clientToken: connection.clientToken, label: connection.label }).finally(() => setConnectingId(null));
      }}
      disabled={isBusy}
      manualOpen={manualOpen}
      onToggleManual={() => setManualOpen(value => !value)}
      manualForm={<form className="flex w-full flex-col gap-3 pt-3" onSubmit={handleSubmit}>
                    <input
                      {...mobileInputKeyboardProps}
                      value={serverUrl}
                      onChange={(event) => handleUrlChange(event.target.value)}
                      placeholder={t('mobile.connect.url.placeholder')}
                      aria-label={t('mobile.connect.url.label')}
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      tabIndex={manualOpen ? undefined : -1}
                      className={cn(mobileConnectionInputClass, 'text-center')}
                    />
                    <input
                      value={connectionName}
                      onChange={(event) => setConnectionName(event.target.value)}
                      placeholder={t('mobile.instances.label.placeholder')}
                      aria-label={t('mobile.instances.label.label')}
                      autoComplete="off"
                      autoCapitalize="words"
                      autoCorrect="off"
                      spellCheck={false}
                      tabIndex={manualOpen ? undefined : -1}
                      className={cn(mobileConnectionInputClass, 'text-center')}
                    />
                    <input
                      {...mobileInputKeyboardProps}
                      value={clientToken}
                      onChange={(event) => setClientToken(event.target.value)}
                      placeholder={t('mobile.connect.token.placeholder')}
                      aria-label={t('mobile.connect.token.label')}
                      tabIndex={manualOpen ? undefined : -1}
                      autoCapitalize="none"
                      className={cn(mobileConnectionInputClass, 'text-center')}
                    />
                    <p className="px-1 text-center typography-micro text-muted-foreground">{t('mobile.connect.token.hint')}</p>
                    {error ? <p className="px-1 text-center typography-small text-[var(--status-error)]">{error}</p> : null}
                    <Button type="submit" variant={qrScanSupported ? 'outline' : 'default'} size="lg" className="h-12 w-full" disabled={isBusy || isScanning || !serverUrl.trim()}>
                      {isBusy ? t('mobile.connect.connecting') : t('mobile.connect.connectButton')}
                    </Button>
                  </form>}
    />
    </>
  );
};
