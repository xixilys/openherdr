import React from 'react';
import type { FormRequest } from '@/lib/opencode/model';
import { ComposerFloatingPanel } from './composer/ui/ComposerFloatingPanel';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { isIMECompositionEvent } from '@/lib/ime';
import { useI18n } from '@/lib/i18n';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { FormFieldControl } from './FormFieldControl';
import { FormMarkdown } from './FormMarkdown';
import {
    type FormValues,
    buildFormAnswer,
    fieldAnswer,
    isAnswerableField,
    missingRequiredKeys,
    valueOf,
    visibleFields,
} from './formCardState';

import { createSteppedFormState, steppedFormFieldsSignature, type SteppedFormState } from './steppedFormState';

type FormField = FormRequest['fields'][number];

interface SteppedFormViewProps {
    fields: readonly FormField[];
    title?: string;
    state: SteppedFormState;
    onStateChange: React.Dispatch<React.SetStateAction<SteppedFormState>>;
    isMobile: boolean;
    isResponding: boolean;
    disabled?: boolean;
    waiting: number;
    isFromSubagent: boolean;
    hidden?: boolean;
    onSubmit: (answer: ReturnType<typeof buildFormAnswer>) => void | Promise<void>;
    onDismiss: () => void | Promise<void>;
    onCopy: (format: 'markdown' | 'json') => void | Promise<void>;
}

const isStepAnswered = (field: FormField, values: FormValues): boolean => {
    if (!isAnswerableField(field)) return valueOf(values, field.key).acknowledged;
    const answer = fieldAnswer(field, values);
    if (answer === undefined) return false;
    return !(Array.isArray(answer) && answer.length === 0);
};

/** Controlled form dock. The caller owns draft identity, lifetime and response actions. */
export function SteppedFormView({
    fields, title: suppliedTitle, state: suppliedState, onStateChange, isMobile, isResponding, disabled = false,
    waiting, isFromSubagent, hidden = false, onSubmit, onDismiss, onCopy,
}: SteppedFormViewProps) {
    const { t } = useI18n();
    const fieldsSignature = steppedFormFieldsSignature(fields);
    // A definition update must never render or submit the previous answers,
    // even before the owner has committed the new state.
    const state = suppliedState.fieldsSignature === fieldsSignature
        ? suppliedState
        : { ...createSteppedFormState(fields), collapsed: suppliedState.collapsed };
    const updateState = React.useCallback<React.Dispatch<React.SetStateAction<SteppedFormState>>>((next) => {
        onStateChange((previous) => {
            const current = previous.fieldsSignature === fieldsSignature
                ? previous
                : { ...createSteppedFormState(fields), collapsed: previous.collapsed };
            return typeof next === 'function' ? next(current) : next;
        });
    }, [fields, fieldsSignature, onStateChange]);
    const { values, step, collapsed, showErrors } = state;
    const title = suppliedTitle?.trim() || t('chat.formCard.inputNeeded');
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const setStep = React.useCallback((next: number) => updateState((previous) => ({ ...previous, step: next })), [updateState]);
    const shown = React.useMemo(() => visibleFields(fields, values), [fields, values]);
    const missing = React.useMemo(() => missingRequiredKeys(fields, values), [fields, values]);
    const canSubmit = missing.length === 0;
    const lastStep = Math.max(0, shown.length - 1);
    const currentStep = Math.min(step, lastStep);
    const currentField = shown[currentStep];
    const answered = React.useMemo(() => shown.map((field) => isStepAnswered(field, values)), [shown, values]);
    // Submit stays off while any question is still open, optional or not:
    // the agent asked, so every question gets an answer or the form is
    // dismissed.
    const allAnswered = answered.every(Boolean);
    const responseBlocked = disabled || isResponding;
    const submitEnabled = !responseBlocked && allAnswered;

    const availableMaxHeight = useMobileAutocompleteMaxHeight(bodyRef, !collapsed && !hidden, 320);

    const updateValue = React.useCallback((key: string, patch: Partial<FormValues[string]>) => {
        updateState((previous) => ({ ...previous, values: { ...previous.values, [key]: { ...valueOf(previous.values, key), ...patch } } }));
    }, [updateState]);

    // Opening an external step is the acknowledgement OpenCode requires for
    // it (`true` in the reply); Submit stays off until every link step has
    // been opened, and a keyboard submit jumps to the first one that has not.
    const currentFieldKey = currentField?.key;
    const currentFieldIsExternal = currentField?.type === 'external';
    React.useEffect(() => {
        updateState((previous) => {
            if (hidden || previous.collapsed || !currentFieldKey || !currentFieldIsExternal) return previous;
            const value = valueOf(previous.values, currentFieldKey);
            if (value.acknowledged) return previous;
            return { ...previous, values: { ...previous.values, [currentFieldKey]: { ...value, acknowledged: true } } };
        });
    }, [collapsed, currentFieldIsExternal, currentFieldKey, fieldsSignature, hidden, updateState]);

    const handleSubmit = React.useCallback(() => {
        if (hidden || responseBlocked) return;
        if (!canSubmit) {
            const firstMissing = shown.findIndex((field) => missing.includes(field.key));
            updateState((previous) => ({ ...previous, showErrors: true, step: firstMissing >= 0 ? firstMissing : previous.step }));
            return;
        }
        void onSubmit(buildFormAnswer(fields, values));
    }, [canSubmit, fields, hidden, responseBlocked, missing, onSubmit, shown, updateState, values]);

    const goNext = React.useCallback(() => {
        setStep(Math.min(currentStep + 1, lastStep));
    }, [currentStep, lastStep, setStep]);

    const handleTextKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (isIMECompositionEvent(event)) return;
            if (event.key !== 'Enter' || event.shiftKey) return;
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                void handleSubmit();
                return;
            }
            if (isMobile) return;
            event.preventDefault();
            if (currentStep >= lastStep) void handleSubmit();
            else goNext();
        },
        [currentStep, goNext, handleSubmit, isMobile, lastStep],
    );

    const handlePanelKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!event.defaultPrevented && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isIMECompositionEvent(event)) {
            event.preventDefault();
            void handleSubmit();
        }
    }, [handleSubmit]);

    const stepLabel = (field: FormField, index: number) => field.title?.trim() || t('chat.questionCard.questionFallback', { index: String(index + 1) });
    const iconButtonClass = 'rounded p-1 text-muted-foreground/70 transition-colors hover:bg-interactive-hover/30 hover:text-foreground';

    return (
        <ComposerFloatingPanel
            role="dialog"
            ariaLabel={title}
            compact={collapsed}
            hidden={hidden}
            header={<>
                <button
                    type="button"
                    onClick={() => updateState((previous) => ({ ...previous, collapsed: !previous.collapsed }))}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? t('chat.formDock.expandAria') : t('chat.formDock.collapseAria')}
                    className="flex min-w-0 flex-1 items-center gap-2 text-start text-muted-foreground transition-colors hover:text-foreground"
                >
                    <Icon name="question" className="size-3.5 shrink-0 text-primary" />
                    <Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" />
                    <span className="typography-ui-label min-w-0 truncate text-foreground">{title}</span>
                    {isFromSubagent ? (
                        <span className="typography-micro shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-muted-foreground">
                            {t('chat.formCard.fromSubagent')}
                        </span>
                    ) : null}
                    <span className="typography-micro shrink-0 tabular-nums text-muted-foreground">
                        {t('chat.formDock.progress', { current: String(currentStep + 1), total: String(shown.length) })}
                    </span>
                </button>
                {/* One dot per question: filled when answered, the current one solid. */}
                {!collapsed ? (
                    <div className="flex shrink-0 items-center gap-1" role="tablist">
                        {shown.map((field, index) => (
                            <button
                                key={field.key}
                                type="button"
                                role="tab"
                                aria-selected={index === currentStep}
                                aria-label={t('chat.formDock.stepAria', { index: String(index + 1), title: stepLabel(field, index) })}
                                title={stepLabel(field, index)}
                                onClick={() => setStep(index)}
                                className="flex size-4 items-center justify-center"
                            >
                                <span
                                    className={cn(
                                        'block size-1.5 rounded-full transition-colors',
                                        index === currentStep
                                            ? 'bg-primary'
                                            : answered[index]
                                                ? 'bg-primary/40'
                                                : 'bg-foreground/15',
                                    )}
                                />
                            </button>
                        ))}
                    </div>
                ) : null}
                {waiting > 0 ? (
                    <span className="typography-micro shrink-0 text-muted-foreground">
                        {t('chat.formDock.waiting', { count: String(waiting) })}
                    </span>
                ) : null}
                <button type="button" onClick={() => void onCopy('markdown')} title={t('chat.questionCard.copyMarkdown')} aria-label={t('chat.questionCard.copyMarkdown')} className={iconButtonClass}>
                    <Icon name="file-text" className="size-3" />
                </button>
                <button type="button" onClick={() => void onCopy('json')} title={t('chat.questionCard.copyJson')} aria-label={t('chat.questionCard.copyJson')} className={iconButtonClass}>
                    <Icon name="code" className="size-3" />
                </button>
            </>}
        >
            {!collapsed ? (
                <div onKeyDown={handlePanelKeyDown}>
                    <div
                        ref={bodyRef}
                        className="max-h-[50vh] overflow-y-auto overscroll-contain px-1.5"
                        style={availableMaxHeight === undefined ? undefined : { maxHeight: Math.max(120, availableMaxHeight - 96) }}
                    >
                        {currentField ? (
                            currentField.type === 'external' ? (
                                <div className="px-1.5 py-1">
                                    <div className="typography-meta font-medium text-foreground">{stepLabel(currentField, currentStep)}</div>
                                    {currentField.description ? (
                                        <FormMarkdown content={currentField.description} size="micro" className="mb-1 text-muted-foreground" />
                                    ) : null}
                                    <a
                                        href={currentField.url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="typography-meta inline-flex items-center gap-1 text-primary hover:underline"
                                    >
                                        <Icon name="external-link" className="size-3" />
                                        {t('chat.formCard.openLink')}
                                    </a>
                                    <div className="typography-micro mt-1 text-muted-foreground">{t('chat.formDock.linkInfo')}</div>
                                </div>
                            ) : (
                                <FormFieldControl
                                    key={currentField.key}
                                    field={currentField}
                                    values={values}
                                    missing={missing}
                                    showErrors={showErrors}
                                    isResponding={responseBlocked}
                                    updateValue={updateValue}
                                    onTextKeyDown={handleTextKeyDown}
                                />
                            )
                        ) : null}
                    </div>

                    <div className="flex items-center gap-1.5 px-3 pb-2 pt-1">
                        <Button variant="ghost" size="xs" disabled={responseBlocked} onClick={() => void onDismiss()}>
                            {t('chat.questionCard.dismiss')}
                        </Button>
                        {showErrors && !canSubmit ? (
                            <span className="typography-micro min-w-0 truncate text-[var(--status-error)]">{t('chat.formCard.missingRequired')}</span>
                        ) : null}
                        <div className="min-w-0 flex-1" />
                        {currentStep > 0 ? (
                            <Button variant="outline" size="xs" disabled={responseBlocked} onClick={() => setStep(currentStep - 1)}>
                                {t('chat.formDock.back')}
                            </Button>
                        ) : null}
                        {currentStep < lastStep ? (
                            <Button variant="outline" size="xs" disabled={responseBlocked} onClick={goNext}>
                                {t('chat.questionCard.next')}
                            </Button>
                        ) : (
                            <Button size="xs" disabled={!submitEnabled} onClick={() => void handleSubmit()}>
                                {isResponding ? <Icon name="loader-4" className="size-3.5 animate-spin" /> : <Icon name="check" className="size-3.5" />}
                                {t('chat.formCard.submit')}
                            </Button>
                        )}
                    </div>
                </div>
            ) : null}
        </ComposerFloatingPanel>
    );
}
