import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { registerFloatingPanelClearanceReader } from '@/components/chat/composer/state/composerInsetReaders';

/** The scroll action: the arrow, plus the status label while the session works. */
export const ScrollAction: React.FC<{ onClick: () => void; children?: React.ReactNode }> = ({ onClick, children }) => {
    const { t } = useI18n();
    return (
        // Sits inside the pill's hairline border, so the pill as a whole is
        // 28px like the status row it takes over from.
        <button
            type="button"
            onClick={onClick}
            aria-label={t('chat.scrollToBottom.aria')}
            className="inline-flex h-[calc(1.75rem-2px)] min-w-0 max-w-full flex-1 items-center rounded-full [corner-shape:round] text-start"
        >
            {/* flex-1 so the icon stays centred when the mobile
                touch-target floor widens the bare button past 28px;
                with the status label present it collapses back to
                its 28px basis. */}
            <span className="flex h-full w-7 flex-1 shrink-0 basis-7 items-center justify-center text-muted-foreground">
                <Icon name="arrow-down" className="h-4 w-4" />
            </span>
            {children}
        </button>
    );
};

export const ScrollToBottomView: React.FC<{ visible: boolean; onClick: () => void; children?: React.ReactNode }> = ({ visible, onClick, children }) => {
    return (
        <div
            ref={registerFloatingPanelClearanceReader}
            className={cn(
                'pointer-events-none absolute bottom-full inset-x-0 mb-2 transition-opacity duration-100',
                visible ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transform: 'translateY(calc(-1 * var(--chat-floating-panel-clearance, 0px)))' }}
        >
            {/* The same column that centres the composer, so the pill's left
                edge lines up exactly with the input frame. */}
            <div className="chat-input-column">
                {/* The soft shadow lives on this wrapper, apart from the
                    pill itself. */}
                <div className="inline-flex max-w-full rounded-full shadow-[0_2px_6px_-2px_rgb(0_0_0_/_0.10)] dark:shadow-[0_2px_6px_-2px_rgb(0_0_0_/_0.35)]">
                <div
                    className={cn(
                        // Opaque surface with a hairline border, much lighter
                        // than the oc-glass-floating shadow stack.
                        // min-h, not h: the mobile touch-target floor grows
                        // the buttons inside to 36px, and the pill with them.
                        'oc-surface-floating inline-flex min-h-7 max-w-full items-center rounded-full [corner-shape:round]',
                        'border border-black/[0.06] dark:border-white/[0.08]',
                        visible ? 'pointer-events-auto' : 'pointer-events-none',
                    )}
                >
                    {children ?? <ScrollAction onClick={onClick} />}
                </div>
                </div>
            </div>
        </div>
    );
};
