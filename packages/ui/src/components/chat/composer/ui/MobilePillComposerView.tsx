import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { StopIcon } from '@/components/icons/StopIcon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type MobilePillComposerInput = {
    value: string;
    placeholder: string;
    onExpand: () => void;
};

type MobilePillComposerChoice = {
    label: string;
    onChoose: () => void;
    disabled?: boolean;
};

type MobileComposerChoices = {
    model?: MobilePillComposerChoice & { icon?: React.ReactNode };
    agent?: MobilePillComposerChoice & { color?: React.CSSProperties['color'] };
};

const keepKeyboard = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch') event.preventDefault();
};

/** Model and agent labels come from the controller's actual selection. */
export function MobileComposerChoicesView({ model, agent }: MobileComposerChoices) {
    if (!model && !agent) return null;
    return <div className="flex items-center justify-between gap-x-2 px-3.5 pb-2 pt-0.5">
        {model ? <button
            type="button"
            onClick={model.onChoose}
            disabled={model.disabled}
            onMouseDown={event => event.preventDefault()}
            onPointerDownCapture={keepKeyboard}
            className="inline-flex h-[26px] min-h-0 min-w-0 items-stretch rounded-lg typography-micro font-medium text-foreground/80 focus:outline-none hover:bg-[var(--interactive-hover)] px-0 disabled:cursor-not-allowed disabled:opacity-50"
            title={model.label}
        ><span className="flex h-full w-full min-w-0 items-center gap-1">{model.icon}<span className="truncate">{model.label}</span></span></button> : null}
        {agent ? <button
            type="button"
            onClick={agent.onChoose}
            disabled={agent.disabled}
            onMouseDown={event => event.preventDefault()}
            onPointerDownCapture={keepKeyboard}
            className="inline-flex h-[26px] min-h-0 min-w-0 flex-shrink-0 items-stretch select-none rounded-lg typography-micro font-medium focus:outline-none hover:bg-[var(--interactive-hover)] touch-none px-0 disabled:cursor-not-allowed disabled:opacity-50"
            style={agent.color ? { color: agent.color } : undefined}
            title={agent.label}
        ><span className="flex h-full w-full min-w-0 items-center"><span className="truncate">{agent.label}</span></span></button> : null}
    </div>;
}

export const MOBILE_PILL_ICON_BUTTON_CLASS = 'flex cursor-pointer items-center justify-center text-foreground transition-none outline-none focus:outline-none flex-shrink-0 disabled:cursor-not-allowed h-8 w-8';

export type MobilePillComposerViewProps = MobileComposerChoices & {
    input: MobilePillComposerInput;
    attachmentControl?: React.ReactNode;
    /** Genuine queue, goal or hint rows, inside the pill above the prompt. */
    topRow?: React.ReactNode;
    attachments?: React.ReactNode;
    /** Genuine activity supplied by the controller, above the pill. */
    statusRow?: React.ReactNode;
    /** Retains the original app's state-owning model and agent controls. */
    bottomRow?: React.ReactNode;
    /** Authoritative turn state, independent of the runtime's stop capability. */
    isRunning: boolean;
    /** Enables sending while idle. */
    canSend: boolean;
    /** Enables queueing during a running turn when onQueue is supplied. */
    canQueue: boolean;
    canAbort: boolean;
    onSend: () => void;
    onAbort: () => void;
    onQueue?: () => void;
    /** Omit when the runtime has no usable voice capability. */
    onStartDictation?: () => void;
    footerIconButtonClass?: string;
    iconSizeClass?: string;
    sendIconSizeClass?: string;
    stopIconSizeClass?: string;
};

/** Original pill presentation, without OpenCode state, config or transport. */
export function MobilePillComposerView({
    input, attachmentControl, topRow, attachments, statusRow, bottomRow, model, agent,
    isRunning, canSend, canQueue, canAbort, onSend, onAbort, onQueue, onStartDictation,
    footerIconButtonClass = MOBILE_PILL_ICON_BUTTON_CLASS,
    iconSizeClass = 'h-[18px] w-[18px]', sendIconSizeClass = 'h-4 w-4', stopIconSizeClass = 'h-6 w-6',
}: MobilePillComposerViewProps) {
    const footer = bottomRow ?? (model || agent ? <MobileComposerChoicesView model={model} agent={agent} /> : null);
    const rounded = topRow || footer ? 'rounded-[1.5rem]' : 'rounded-full';
    return <div className="flex flex-col">
        {statusRow}
        <div className={cn('flex min-w-0 flex-col shadow-[0_4px_16px_-4px_rgb(0_0_0_/_0.12)]', rounded)}>
            <div data-mobile-composer-pill="true" data-composer-box="true" className={cn('oc-surface-floating flex min-w-0 flex-col border border-border/80', rounded)}>
                {topRow}
                {attachments}
                <div className="flex min-w-0 gap-x-0.5 ps-1 pe-1 h-12 items-center">
                    {attachmentControl}
                    <button
                        type="button"
                        data-composer-morph-prompt="true"
                        className="flex h-full min-w-0 flex-1 cursor-text items-center px-1.5 text-start"
                        onClick={input.onExpand}
                    ><span className={cn('truncate typography-ui-label', input.value.trim() ? 'text-foreground' : 'text-muted-foreground/40')}>{input.value.trim() ? input.value : input.placeholder}</span></button>
                    <MobileComposerActionsView {...{ isRunning, canSend, canQueue, canAbort, onSend, onAbort, onQueue, onStartDictation, footerIconButtonClass, iconSizeClass, sendIconSizeClass, stopIconSizeClass }} />
                </div>
                {footer}
            </div>
        </div>
    </div>;
}

type MobileComposerActionsProps = Pick<MobilePillComposerViewProps,
    'isRunning' | 'canSend' | 'canQueue' | 'canAbort' | 'onSend' | 'onAbort' | 'onQueue' | 'onStartDictation' |
    'footerIconButtonClass' | 'iconSizeClass' | 'sendIconSizeClass' | 'stopIconSizeClass'>;

/** Both mobile frames keep the same source-owned action eligibility. */
export function MobileComposerActionsView({
    isRunning, canSend, canQueue, canAbort, onSend, onAbort, onQueue, onStartDictation,
    footerIconButtonClass = MOBILE_PILL_ICON_BUTTON_CLASS,
    iconSizeClass = 'h-[18px] w-[18px]', sendIconSizeClass = 'h-4 w-4', stopIconSizeClass = 'h-6 w-6',
}: MobileComposerActionsProps) {
    const { t } = useI18n();
    return <>
        {onStartDictation ? <button type="button" className={footerIconButtonClass} onClick={onStartDictation} title={t('chat.dictation.start')} aria-label={t('chat.dictation.start')}><Icon name="mic" className={cn(iconSizeClass, 'text-current')} /></button> : null}
        {isRunning && canQueue && onQueue ? <button type="button" className={cn(footerIconButtonClass, 'text-primary hover:text-primary')} onClick={onQueue} title={t('chat.chatInput.actions.queueMessageAria')} aria-label={t('chat.chatInput.actions.queueMessageAria')}><Icon name="send-plane-2" className={cn(sendIconSizeClass, '-rotate-90 rtl:rotate-90')} /></button> : null}
        {canAbort ? <button
            type="button"
            className={cn(footerIconButtonClass, 'text-[var(--status-error)] hover:text-[var(--status-error)]')}
            onMouseDown={event => event.preventDefault()}
            onPointerDownCapture={keepKeyboard}
            onClick={event => { event.stopPropagation(); onAbort(); }}
            title={t('chat.chatInput.actions.stopGeneratingAria')}
            aria-label={t('chat.chatInput.actions.stopGeneratingAria')}
        ><StopIcon className={stopIconSizeClass} /></button> : !isRunning && canSend ? <Button type="button" variant="ghost" size="icon" className="text-primary hover:text-primary" onClick={onSend} title={t('chat.chatInput.actions.sendMessageAria')} aria-label={t('chat.chatInput.actions.sendMessageAria')}><Icon name="send-plane-2" className={sendIconSizeClass} /></Button> : null}
    </>;
}
