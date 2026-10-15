import React from 'react';
import { AnimatePresence } from 'motion/react';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { FormRequest } from '@/lib/opencode/model';
import { readWebSearchConsent } from '@/lib/opencode/websearch';
import { useUIStore } from '@/stores/useUIStore';
import { useScopedBlockingForms, useSessions } from '@/sync/sync-context';
import { useRequestReveal } from '@/sync/request-reveal';
import { useChatSessionSelection } from './chatColumnSession';
import * as sessionActions from '@/sync/session-actions';
import { WebSearchConsentDock } from './WebSearchConsent';
import { serializeFormAsJson, serializeFormAsMarkdown } from './formSerializers';
import type { FormValues } from './formCardState';
import { SteppedFormView } from './SteppedFormView';
import { createSteppedFormState, steppedFormFieldsSignature, type SteppedFormState } from './steppedFormState';

/**
 * The agent's question, docked above the composer.
 *
 * A v2 form is one request with several typed fields, and the reply is one
 * answer for all of them. Showing every field at once made a tall card, so
 * the dock walks the fields one at a time — the same shape OpenCode's own
 * clients use — with a segment per step, Back / Next, and Submit in place
 * of Next on the last one. Fields gated by a `when` clause join or leave the
 * steps as their controlling answer changes, so the count is honest at every
 * moment. An `external` field is an information step: a link to open,
 * nothing to type; opening the step acknowledges it, which the reply must
 * carry as `true` for the server to accept it. Enter in a text box moves to the next step (Submit on
 * the last); Cmd/Ctrl+Enter submits from anywhere in the dock.
 *
 * Mounted once per composer, inside the shared floating frame, so it shares
 * the frame's clearance and hides behind BTW like the queue does. The BTW
 * sheet keeps the inline `FormCard` for its child session's forms.
 */

interface FormDockProps {
    sessionId: string | null;
    directory?: string;
    hidden: boolean;
}

const FormDockView: React.FC<FormDockProps> = ({ sessionId, directory, hidden }) => {
    const forms = useScopedBlockingForms(sessionId, directory);
    // The session's own forms come first; a location-scoped form (an MCP
    // elicitation, owned by no session) follows and shows in every session
    // of the directory that raised it.
    const form = forms[0];
    const webSearchConsent = form ? readWebSearchConsent(form) : null;
    // Keyed on the form id so a different request starts from a clean slate
    // (and the panels cross-fade instead of swapping content in place).
    return (
        <AnimatePresence>
            {hidden || !form ? null : webSearchConsent
                ? <WebSearchConsentDock key={form.id} form={form} consent={webSearchConsent} />
                : <FormDockPanel key={form.id} form={form} forms={forms} />}
        </AnimatePresence>
    );
};

type FormDraft = { fieldsSignature: string; values: FormValues; step: number };

// Answers in progress outlive the panel: switching sessions unmounts it, and
// coming back must find the form where it was left. Kept in memory only and
// dropped once the form is answered or dismissed.
const formDrafts = new Map<string, FormDraft>();
const MAX_FORM_DRAFTS = 50;

const saveFormDraft = (formId: string, draft: FormDraft) => {
    formDrafts.delete(formId);
    formDrafts.set(formId, draft);
    if (formDrafts.size > MAX_FORM_DRAFTS) {
        const oldest = formDrafts.keys().next().value;
        if (oldest !== undefined) formDrafts.delete(oldest);
    }
};

const FormDockPanel: React.FC<{ form: FormRequest; forms: FormRequest[] }> = ({ form, forms }) => {
    const { t } = useI18n();
    const isMobile = useUIStore((state) => state.isMobile);
    // The sessions of the chat this dock belongs to, which may be a chat of
    // another project pinned in the side panel.
    const sessions = useSessions(useChatSessionSelection().directory ?? undefined);

    const fields = form.fields;
    // A rebuilt pending list hands over a new object with the same content;
    // only fields that actually changed start the answers over.
    const fieldsSignature = steppedFormFieldsSignature(fields);
    const [restored] = React.useState(() => {
        const draft = formDrafts.get(form.id);
        return draft?.fieldsSignature === fieldsSignature ? draft : null;
    });
    const [state, setState] = React.useState<SteppedFormState>(() => {
        const initial = createSteppedFormState(fields);
        return restored ? { ...initial, values: restored.values, step: restored.step } : initial;
    });
    const { values, step } = state;
    const [isResponding, setIsResponding] = React.useState(false);
    const waiting = forms.length - 1;
    // "Open session" on a question's toast expands the dock, including for a
    // question queued behind the one shown.
    const formIds = React.useMemo(() => forms.map((item) => item.id), [forms]);
    useRequestReveal(formIds, React.useCallback(() => setState((previous) => ({ ...previous, collapsed: false })), []));

    React.useEffect(() => {
        if (state.fieldsSignature !== fieldsSignature) return;
        saveFormDraft(form.id, { fieldsSignature, values, step });
    }, [fieldsSignature, form.id, state.fieldsSignature, step, values]);

    const isFromSubagent = React.useMemo(() => {
        const source = sessions.find((session) => session.id === form.sessionID);
        return Boolean(source?.parentID);
    }, [form.sessionID, sessions]);

    const handleSubmit = React.useCallback(async (answer: Parameters<typeof sessionActions.replyToForm>[2]) => {
        setIsResponding(true);
        try {
            await sessionActions.replyToForm(form.sessionID, form.id, answer);
            formDrafts.delete(form.id);
        } catch {
            toast.error(t('chat.formCard.submitFailed'), { description: t('chat.formCard.tryAgain') });
        } finally {
            setIsResponding(false);
        }
    }, [form.id, form.sessionID, t]);

    const handleDismiss = React.useCallback(async () => {
        setIsResponding(true);
        try {
            await sessionActions.cancelForm(form.sessionID, form.id);
            formDrafts.delete(form.id);
        } catch {
            toast.error(t('chat.formCard.cancelFailed'), { description: t('chat.formCard.tryAgain') });
        } finally {
            setIsResponding(false);
        }
    }, [form.id, form.sessionID, t]);

    const handleCopy = React.useCallback(async (format: 'markdown' | 'json') => {
        const text = format === 'markdown' ? serializeFormAsMarkdown(form) : serializeFormAsJson(form);
        const result = await copyTextToClipboard(text);
        if (result.ok) {
            toast.success(t(format === 'markdown' ? 'chat.questionCard.copiedMarkdown' : 'chat.questionCard.copiedJson'));
            return;
        }
        toast.error(t('chat.questionCard.copyFailed'));
    }, [form, t]);

    return <SteppedFormView
        fields={fields}
        title={form.title}
        state={state}
        onStateChange={setState}
        isMobile={isMobile}
        isResponding={isResponding}
        waiting={waiting}
        isFromSubagent={isFromSubagent}
        onSubmit={handleSubmit}
        onDismiss={handleDismiss}
        onCopy={handleCopy}
    />;
};

/** Memoized: the composer re-renders on every keystroke, and nothing here depends on the draft text. */
export const FormDock = React.memo(FormDockView);
