import React from 'react';
import { useI18n } from '@openchamber/ui/lib/i18n';
import { copyTextToClipboard } from '@openchamber/ui/lib/clipboard';
import type { ConversationForm as DriverForm } from '@openchamber/ui/lib/opencode/herdr-driver';
import { SteppedFormView } from '@openchamber/ui/components/chat/SteppedFormView';
import {
  createSteppedFormState, steppedFormFieldsSignature, type SteppedFormState,
} from '@openchamber/ui/components/chat/steppedFormState';
import { serializeFormAsJson, serializeFormAsMarkdown } from '@openchamber/ui/components/chat/formSerializers';
import type { HerdrJsonValue } from './transport';

interface ConversationFormProps {
  form: DriverForm;
  owner: string;
  hidden: boolean;
  waiting: number;
  isMobile: boolean;
  disabled: boolean;
  onReply: (answer: HerdrJsonValue) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  onNotice: (message: string) => void;
}

type FormDraft = { fieldsSignature: string; state: SteppedFormState; generation: symbol };
// Page-lifetime drafts mirror FormDock's 50-entry limit. The caller's owner
// includes server, machine, pane identity, session and directory. Confirmation
// removes only the captured draft; unmounts and failed replies retain it.
const drafts = new Map<string, FormDraft>();
const MAX_FORM_DRAFTS = 50;
const saveDraft = (key: string, draft: FormDraft) => {
  drafts.delete(key);
  drafts.set(key, draft);
  if (drafts.size > MAX_FORM_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
};

export function ConversationForm(props: ConversationFormProps) {
  const identity = JSON.stringify([props.owner, props.form.sessionID, props.form.id]);
  const fieldsSignature = steppedFormFieldsSignature(props.form.fields);
  return <ConversationFormOwner key={JSON.stringify([identity, fieldsSignature])} {...props} identity={identity} fieldsSignature={fieldsSignature} />;
}

function ConversationFormOwner({ form, identity, fieldsSignature, disabled, hidden, waiting, isMobile, onReply, onCancel, onNotice }: ConversationFormProps & { identity: string; fieldsSignature: string }) {
  const { t } = useI18n();
  const [draft] = React.useState<FormDraft>(() => {
    const restored = drafts.get(identity);
    return {
      fieldsSignature,
      state: restored?.fieldsSignature === fieldsSignature ? restored.state : createSteppedFormState(form.fields),
      // A remounted editor owns its restored draft. A reply from an earlier
      // mount must not clear answers edited after returning to this form.
      generation: Symbol(),
    };
  });
  const [state, setState] = React.useState(draft.state);
  const [responding, setResponding] = React.useState(false);
  const [settled, setSettled] = React.useState(false);
  const inFlight = React.useRef(false);
  const completed = React.useRef(false);

  React.useEffect(() => {
    if (completed.current) return;
    saveDraft(identity, { ...draft, state });
  }, [draft, identity, state]);

  const respond = async (action: () => Promise<boolean>, failure: string) => {
    if (disabled || hidden || inFlight.current || completed.current) return;
    inFlight.current = true;
    setResponding(true);
    try {
      if (await action()) {
        completed.current = true;
        if (drafts.get(identity)?.generation === draft.generation) drafts.delete(identity);
        setSettled(true);
      }
    } catch {
      onNotice(failure);
    } finally {
      inFlight.current = false;
      setResponding(false);
    }
  };
  const copy = async (format: 'markdown' | 'json') => {
    try {
      const result = await copyTextToClipboard(format === 'markdown' ? serializeFormAsMarkdown(form) : serializeFormAsJson(form));
      onNotice(t(result.ok ? format === 'markdown' ? 'chat.questionCard.copiedMarkdown' : 'chat.questionCard.copiedJson' : 'chat.questionCard.copyFailed'));
    } catch { onNotice(t('chat.questionCard.copyFailed')); }
  };

  if (settled) return null;
  return <SteppedFormView fields={form.fields} title={form.title} state={state} onStateChange={setState}
    isMobile={isMobile} isResponding={responding} disabled={disabled} waiting={waiting} isFromSubagent={false} hidden={hidden}
    onSubmit={(answer) => respond(() => onReply(answer), t('chat.formCard.submitFailed'))}
    onDismiss={() => respond(onCancel, t('chat.formCard.cancelFailed'))} onCopy={copy} />;
}
