import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type MobileConnectionWelcomeViewProps = {
  logo: React.ReactNode;
  title: React.ReactNode;
  notice?: React.ReactNode;
  replacementForm?: React.ReactNode;
  scan: { supported: boolean; scanning: boolean; busy: boolean; hint: React.ReactNode; onScan: () => void };
  error?: React.ReactNode;
  saved: readonly { id: string; label: string; detail: string; connecting: boolean; disabled?: boolean }[];
  onSaved: (id: string) => void;
  disabled: boolean;
  manualOpen: boolean;
  onToggleManual: () => void;
  manualForm: React.ReactNode;
  toolbar?: React.ReactNode;
};

/** The original connection welcome layout with caller-owned connection actions. */
export const MobileConnectionWelcomeView: React.FC<MobileConnectionWelcomeViewProps> = ({
  logo, title, notice, replacementForm, scan, error, saved, onSaved, disabled,
  manualOpen, onToggleManual, manualForm, toolbar,
}) => {
  const { t } = useI18n();
  return (
    <main className="oc-keyboard-fill-screen flex min-h-dvh flex-col overflow-y-auto bg-background px-6 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))+28px)] pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+28px)] text-foreground">
      <div className="m-auto flex w-full max-w-[360px] shrink-0 flex-col items-center gap-9 py-8">
        <div className="flex flex-col items-center gap-5 text-center">
          {logo}
          <h1 className="typography-h2 text-foreground">{title}</h1>
        </div>

        {notice}

        {replacementForm != null ? (
          replacementForm
        ) : (
          <div className="flex w-full flex-col gap-6">
            {scan.supported ? (
              <div className="flex w-full flex-col gap-2">
                <Button
                  type="button"
                  size="lg"
                  className="h-12 w-full"
                  onClick={scan.onScan}
                  disabled={disabled || scan.scanning || scan.busy}
                >
                  <Icon name="scan-2" className={cn('size-[18px]', scan.scanning && 'animate-pulse')} />
                  {scan.busy ? t('mobile.connect.connecting') : t('mobile.connect.scanQr')}
                </Button>
                <p className="px-2 text-center typography-small text-muted-foreground">
                  {scan.hint}
                </p>
              </div>
            ) : null}

            {error && !manualOpen ? <p className="px-1 text-center typography-small text-[var(--status-error)]">{error}</p> : null}

            {saved.length > 0 ? (
              <section className="flex w-full flex-col gap-2.5">
                <h2 className="text-center typography-micro uppercase tracking-[0.14em] text-muted-foreground">
                  {t('mobile.connect.saved.title')}
                </h2>
                <div className="overflow-hidden rounded-[18px] border border-border/70 bg-surface-elevated">
                  {saved.map((connection) => (
                    <button
                      key={connection.id}
                      type="button"
                      disabled={disabled || connection.disabled}
                      className="flex min-h-14 w-full items-center gap-3 border-b border-border/70 px-3.5 py-2.5 text-start last:border-b-0 hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-70"
                      onClick={() => onSaved(connection.id)}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-interactive-hover text-foreground">
                        <Icon name="server" className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate typography-ui-label text-foreground">{connection.label}</span>
                        <span className={cn('block truncate typography-small', connection.connecting ? 'text-foreground' : 'text-muted-foreground')}>
                          {connection.connecting ? t('mobile.connect.connecting') : connection.detail}
                        </span>
                      </span>
                      {connection.connecting
                        ? <Icon name="loader-4" className="size-5 animate-spin text-muted-foreground" />
                        : <Icon name="arrow-right-s" className="size-5 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="flex w-full flex-col">
              {scan.supported ? (
                <button
                  type="button"
                  onClick={onToggleManual}
                  aria-expanded={manualOpen}
                  className="mx-auto flex items-center gap-1 rounded-full px-2 py-1 typography-small text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{t('mobile.connect.manual.toggle')}</span>
                  <Icon name="arrow-down-s" className={cn('size-4 transition-transform duration-200', manualOpen && 'rotate-180')} />
                </button>
              ) : null}
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-out"
                style={{ gridTemplateRows: manualOpen ? '1fr' : '0fr' }}
              >
                <div className="min-h-0 overflow-hidden">
                  {manualForm}
                </div>
              </div>
            </div>
            {toolbar}
          </div>
        )}
      </div>
    </main>
  );
};
