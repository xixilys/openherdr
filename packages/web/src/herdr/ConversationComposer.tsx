import React from 'react';
import { flushSync } from 'react-dom';
import { ComposerEditor, type ComposerEditorHandle } from '@openchamber/ui/components/chat/composer/editor/ComposerEditor';
import { composerAutoCorrect } from '@openchamber/ui/components/chat/composer/editor/autocorrect';
import { createComposerEditorViewStore } from '@openchamber/ui/components/chat/composer/editor/viewStore';
import { useMobileComposerShell } from '@openchamber/ui/components/chat/composer/state/useMobileComposerShell';
import { useMobileViewportPin } from '@openchamber/ui/components/chat/composer/state/useMobileViewportPin';
import { ComposerAttachmentControls } from '@openchamber/ui/components/chat/composer/ui/ComposerAttachmentControls';
import { MobileExpandedComposerView } from '@openchamber/ui/components/chat/composer/ui/MobileExpandedComposerView';
import { MobilePillComposerView, MOBILE_PILL_ICON_BUTTON_CLASS, type MobilePillComposerViewProps } from '@openchamber/ui/components/chat/composer/ui/MobilePillComposerView';
import { shouldSubmitEnter } from '@openchamber/ui/components/chat/composer/keyboardPolicy';
import { useHardwareKeyboard } from '@openchamber/ui/lib/hardwareKeyboard';
import { useTabletLayout } from '@openchamber/ui/lib/device';
import { isIMECompositionEvent } from '@openchamber/ui/lib/ime';
import { isInsideOpenPopup, registerBackLayer } from '@openchamber/ui/lib/mobileBackLayers';
import { useI18n } from '@openchamber/ui/lib/i18n';
import { ATTACHMENT_ACCEPT } from '@openchamber/ui/sync/attachment-files';

type ConversationComposerProps = Omit<MobilePillComposerViewProps, 'input' | 'attachmentControl'> & {
  text: string;
  onTextChange: (text: string) => void;
  attachmentFiles: readonly { name: string }[];
  onAttach: (files: File[]) => void;
  onEditorFocus: () => void;
  onEditorBlur: () => void;
  writable: boolean;
  hidden: boolean;
  isMobile: boolean;
  pickerOpen: boolean;
  ariaLabel: string;
  children?: React.ReactNode;
  preferences?: { enterToSend: boolean; enterToSendConfigured: boolean };
};
const noRepositoryPicker = () => {};

/** Draft and delivery authority stay in ConversationPanel; this owns the original input shell. */
export function ConversationComposer({ text, onTextChange, attachmentFiles, onAttach, onEditorFocus, onEditorBlur,
  writable, hidden, isMobile, pickerOpen, ariaLabel, preferences, model, agent, children, ...view }: ConversationComposerProps) {
  const { t } = useI18n();
  const form = React.useRef<HTMLFormElement>(null);
  const editor = React.useRef<ComposerEditorHandle>(null);
  const files = React.useRef<HTMLInputElement>(null);
  const access = React.useRef({ writable, hidden });
  access.current = { writable, hidden };
  const [viewStore] = React.useState(createComposerEditorViewStore);
  const [filePickerOpen, setFilePickerOpen] = React.useState(false);
  React.useEffect(() => {
    const input = files.current;
    const cancel = () => setFilePickerOpen(false);
    // React delegates cancel for dialogs, while file inputs emit a native cancel.
    input?.addEventListener('cancel', cancel);
    return () => input?.removeEventListener('cancel', cancel);
  }, []);
  const hardwareKeyboard = useHardwareKeyboard();
  const tablet = useTabletLayout();
  const shell = useMobileComposerShell({ isMobile, editorRef: editor, formRef: form, setExpandedInput: noRepositoryPicker, alwaysExpanded: hardwareKeyboard || tablet.enabled,
    holders: { controlsPanelOpen: pickerOpen, attachMenuOpen: filePickerOpen, draftPickerOpen: false, referencePickerOpen: false, isDragging: false } });
  const { cancelOverlayCloseRestore, onEditorBlur: blurShellEditor } = shell;
  // Attachment controls retain their callback through pill renders. Read the
  // current owner's access when the gesture arrives, including after hiding.
  const pickLocalFiles = React.useCallback(() => {
    if (!files.current || !access.current.writable || access.current.hidden) return;
    flushSync(() => setFilePickerOpen(true));
    cancelOverlayCloseRestore();
    editor.current?.blur();
    files.current?.click();
  }, [cancelOverlayCloseRestore]);
  React.useEffect(() => {
    if (filePickerOpen) shell.cancelOverlayCloseRestore();
  }, [filePickerOpen, shell]);
  useMobileViewportPin({ isMobile: isMobile && !hidden, isFullscreen: false, isDraftScreen: false, isFocused: shell.focused,
    editorRef: editor, formRef: form });
  React.useEffect(() => () => { viewStore.view?.destroy(); viewStore.view = null; }, [viewStore]);
  React.useEffect(() => {
    if (!hidden) return;
    cancelOverlayCloseRestore();
    editor.current?.blur();
    blurShellEditor();
    setFilePickerOpen(false);
  }, [hidden, cancelOverlayCloseRestore, blurShellEditor]);
  const blur = React.useCallback(() => { editor.current?.blur(); }, []);
  // Android can hide its IME while the contenteditable retains focus. Release
  // that focus before the original shell handles its keyboard-hide intent.
  React.useLayoutEffect(() => {
    if (!isMobile || hidden) return;
    const hideKeyboard = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.open === false && !pickerOpen && !filePickerOpen) blur();
    };
    window.addEventListener('oc:keyboard-intent', hideKeyboard);
    return () => window.removeEventListener('oc:keyboard-intent', hideKeyboard);
  }, [blur, filePickerOpen, hidden, isMobile, pickerOpen]);
  React.useEffect(() => {
    if (!isMobile || hidden || !shell.expanded || hardwareKeyboard || tablet.enabled || filePickerOpen || pickerOpen) return;
    return registerBackLayer(blur);
  }, [blur, filePickerOpen, hardwareKeyboard, hidden, isMobile, pickerOpen, shell.expanded, tablet.enabled]);
  const languageContext = React.useMemo(() => ({ inputMode: 'normal' as const, knownAgentNames: new Set<string>(), confirmedMentions: new Set<string>(),
    knownSlashNames: new Set<string>(), knownSnippetTriggers: new Set<string>(), attachmentFilenames: attachmentFiles.map((file) => file.name) }), [attachmentFiles]);
  const choose = (callback: () => void) => () => {
    // Publish the holder before blur, matching ChatInput's mobile picker handoff.
    flushSync(callback);
    editor.current?.blur();
  };
  const submit = () => {
    if (hidden || !writable) return;
    if (view.isRunning) {
      if (view.canQueue) view.onQueue?.();
      return;
    }
    if (view.canSend) view.onSend();
  };
  const controls = {
    ...view,
    model: model ? { ...model, onChoose: choose(model.onChoose) } : undefined,
    agent: agent ? { ...agent, onChoose: choose(agent.onChoose) } : undefined,
    attachmentControl: <div aria-disabled={!writable} className={!writable ? 'pointer-events-none opacity-50' : undefined}>
      <ComposerAttachmentControls isVSCode={false} footerIconButtonClass={MOBILE_PILL_ICON_BUTTON_CLASS} iconSizeClass="h-[18px] w-[18px]" filesOnly
        handlePickLocalFiles={pickLocalFiles} openGitHubPicker={noRepositoryPicker} />
    </div>,
  };
  return <form ref={form} className={isMobile ? 'relative w-full pb-4 bottom-safe-area oc-mobile-composer' : 'relative w-full pb-4'}
    onSubmit={(event) => { event.preventDefault(); submit(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || isIMECompositionEvent(event) || isInsideOpenPopup(event.target) || !isMobile) return;
      event.preventDefault(); event.stopPropagation(); blur();
    }}>
    {isMobile && (hidden || !shell.expanded) ? <MobilePillComposerView {...controls} input={{ value: text,
      placeholder: t('chat.chatInput.placeholder.chatCompact'), onExpand: shell.expand }} /> : <MobileExpandedComposerView {...controls}
      editor={<div data-herdr-composer="true"><ComposerEditor ref={editor} viewStore={viewStore} value={text} languageContext={languageContext}
        aria-label={ariaLabel} placeholder={t('chat.chatInput.placeholder.chatCompact')} editable={writable && !hidden}
        onChange={(change) => { if (!change.fromValueProp) onTextChange(change.value); }}
        onFocus={() => { shell.onEditorFocus(); onEditorFocus(); }}
        onBlur={() => { shell.onEditorBlur(); onEditorBlur(); }}
        onPaste={(event) => { const incoming = [...(event.clipboardData?.files ?? [])]; if (incoming.length && writable) { event.preventDefault(); onAttach(incoming); } }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isIMECompositionEvent(event) || !shouldSubmitEnter({ isMobile, isDesktopExpanded: false,
            enterToSend: preferences?.enterToSend ?? true, enterToSendConfigured: preferences?.enterToSendConfigured ?? false,
            shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })) return false;
          event.preventDefault(); submit(); return true;
        }}
        autoCorrect={composerAutoCorrect({ isMobile })} autoCapitalize={isMobile ? 'sentences' : 'none'}
        preserveDeferredEnterShift={!preferences?.enterToSendConfigured || !isMobile} spellCheck={isMobile}
        maxLines={isMobile ? 16 : 8} boundSelector={isMobile ? '[data-composer-bound]' : undefined} boundGapPx={4}
        className="min-h-[52px] px-3 relative z-10 pt-4 pb-2.5 typography-markdown md:typography-ui-label" />
      </div>} />}
    {children}
    <input ref={files} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden"
      onChange={(event) => { const incoming = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; setFilePickerOpen(false); if (incoming.length && writable) onAttach(incoming); }} />
  </form>;
}
