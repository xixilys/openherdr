import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type MobileInstanceDisplayRow = {
  id: string;
  label: string;
  status: string;
  active: boolean;
  connecting: boolean;
  /** Disables selection only; a rejected connection can still be removed. */
  disabled?: boolean;
  canEdit?: boolean;
};

export type MobileInstancesListViewProps = Pick<React.HTMLAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture'
> & {
  rows: readonly MobileInstanceDisplayRow[];
  busy: boolean;
  confirmingDeleteId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
};

/** Original instance-list presentation with caller-owned status and actions. */
export function MobileInstancesListView({ rows, busy, confirmingDeleteId, onSelect, onEdit, onToggleDelete, onConfirmDelete, ...interactionHandlers }: MobileInstancesListViewProps) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <p {...interactionHandlers} className="rounded-[18px] border border-dashed border-border/70 px-4 py-6 text-center typography-small text-muted-foreground">{t('mobile.connect.saved.empty')}</p>;
  }
  return <div {...interactionHandlers} className="overflow-hidden rounded-[18px] border border-border/70 bg-surface-elevated">
    {rows.map(row => {
      const confirming = confirmingDeleteId === row.id;
      return <div key={row.id} className={cn(
        'flex items-center border-b border-border/70 transition-colors last:border-b-0',
        confirming && 'bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)]',
      )}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-start transition-colors active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
          onClick={() => { if (!row.active) onSelect(row.id); }}
          disabled={row.disabled || (busy && !row.connecting) || confirming}
        >
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-interactive-hover text-foreground">
            <Icon name="server" className="size-[18px]" />
            {row.active ? <span className="absolute -inset-e-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--surface-elevated)] bg-[var(--status-success)]" aria-hidden /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate typography-ui-label text-foreground">{row.label}</span>
            <span dir="auto" className={cn(
              'block truncate typography-small',
              row.active && !row.connecting ? 'text-[var(--status-success)]' : 'text-muted-foreground',
            )}>{row.status}</span>
          </span>
          {row.connecting ? <Icon name="loader-4" className="size-5 shrink-0 animate-spin text-muted-foreground" /> : null}
        </button>
        <div className="flex items-center gap-0.5 pe-2">
          {confirming ? <button
            type="button"
            aria-label={t('mobile.instances.confirmDeleteAria', { label: row.label })}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-destructive px-3 text-destructive-foreground transition-opacity active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            onClick={() => onConfirmDelete(row.id)}
            style={{ touchAction: 'manipulation' }}
          >
            <Icon name="delete-bin" className="size-[18px]" />
            <span className="typography-ui-label">{t('mobile.instances.delete')}</span>
          </button> : row.canEdit ? <button
            type="button"
            aria-label={t('mobile.instances.edit')}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onEdit(row.id)}
            style={{ touchAction: 'manipulation' }}
          ><Icon name="edit" className="size-[18px]" /></button> : null}
          <button
            type="button"
            aria-label={confirming
              ? t('mobile.instances.cancelDeleteAria', { label: row.label })
              : t('mobile.instances.deleteAria', { label: row.label })}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onToggleDelete(row.id)}
            style={{ touchAction: 'manipulation' }}
          ><Icon name={confirming ? 'close' : 'delete-bin'} className="size-[18px]" /></button>
        </div>
      </div>;
    })}
  </div>;
}
