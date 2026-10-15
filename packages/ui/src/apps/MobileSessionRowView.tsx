import React from 'react';
import { cn } from '@/lib/utils';

export interface MobileSessionRowViewProps {
  title: string;
  active: boolean;
  indent: number;
  contextLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  replacement?: React.ReactNode;
  /** The caller supplies the swipe row's opaque frame. */
  embedded?: boolean;
}

export const MobileSessionRowView: React.FC<MobileSessionRowViewProps> = ({
  title, active, indent, contextLabel, onSelect, disabled, leading, trailing, replacement, embedded = false,
}) => {
  const content = (
    <>
      {leading}
      {replacement ?? (
        <button
          type="button"
          // Match the rename form's 36 px height; context rows remain flexible.
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 pe-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            contextLabel ? 'min-h-10 py-1' : 'h-9',
          )}
          style={{ paddingInlineStart: indent, touchAction: 'manipulation' }}
          onClick={onSelect}
          disabled={disabled}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2.5">
              <span
                dir="auto"
                className={cn(
                  'block min-w-0 flex-1 truncate oc-ui-start-align typography-ui-label',
                  active ? 'text-primary' : 'text-foreground',
                )}
              >
                {title}
              </span>
              {trailing}
            </span>
            {contextLabel ? (
              <span dir="auto" className="block truncate oc-ui-start-align typography-micro text-muted-foreground">{contextLabel}</span>
            ) : null}
          </span>
        </button>
      )}
    </>
  );

  if (embedded) return content;

  return (
    <div data-active-session={active || undefined} className="relative overflow-hidden">
      <div
        className={cn(
          'relative flex items-center gap-1 transition-colors',
          active && 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]',
        )}
      >
        {content}
      </div>
    </div>
  );
};
