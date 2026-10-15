/**
 * The collapsed mobile composer.
 *
 * With the keyboard down the composer is a pill: attachments, a one-line
 * preview of the draft, and a mic. Tapping anywhere in it expands the real
 * composer and raises the keyboard in the same gesture — which is why the
 * expand handler must run synchronously from the tap rather than from an
 * effect.
 *
 * With content, the inner end slot sends while the session is idle. While it
 * is running, abort keeps that slot and a queue action appears just before it,
 * inside the pill.
 */

import React, { useState } from 'react';
import type { SourceControlProvider } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useConfigStore } from '@/stores/useConfigStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { isDictationCaptureSupported } from '@/lib/dictation/use-dictation-audio-source';
import { ComposerAttachmentControls } from './ComposerAttachmentControls';
import { MobilePillComposerView } from './MobilePillComposerView';

export interface MobilePillComposerProps {
    message: string;
    sessionId: string | null;
    newSessionDraftOpen: boolean;
    hasContent: boolean;
    isVSCode: boolean;
    canAbort: boolean;
    footerIconButtonClass: string;
    iconSizeClass: string;
    sendIconSizeClass: string;
    stopIconSizeClass: string;
    /** The composer's top rows (goal, queue, hints, suggested follow-up), inside the pill. */
    topRow?: React.ReactNode;
    /** Attached files, shown inside the pill above the draft line. */
    attachments?: React.ReactNode;
    /** Rendered as the pill's own last row (mobile model/agent controls). */
    bottomRow?: React.ReactNode;
    onExpand: () => void;
    onPrimaryAction: () => void;
    /** While a turn runs, the trailing action queues, as the expanded composer does. */
    onQueueMessage: () => void;
    onPickLocalFiles: () => void;
    onOpenGitHubPicker: () => void;
    /** The host the project's issues and change requests come from. */
    repositoryProvider?: SourceControlProvider;
    showLinearPicker?: boolean;
    onOpenLinearPicker?: () => void;
    onOpenAttachSheet: () => void;
    onStartDictation: () => void;
    onAbort: () => void;
}

export function MobilePillComposer(props: MobilePillComposerProps) {
    const { t } = useI18n();
    const {
        message,
        sessionId: currentSessionId,
        newSessionDraftOpen,
        hasContent,
        isVSCode,
        canAbort,
        footerIconButtonClass,
        iconSizeClass,
        sendIconSizeClass,
        stopIconSizeClass,
        topRow,
        attachments,
        bottomRow,
        onExpand,
        onPrimaryAction,
        onQueueMessage,
        onPickLocalFiles,
        onOpenGitHubPicker,
        repositoryProvider,
        showLinearPicker,
        onOpenLinearPicker,
        onOpenAttachSheet,
        onStartDictation,
        onAbort,
    } = props;
    const canPrimaryAction = hasContent && Boolean(currentSessionId || newSessionDraftOpen);
    const dictationEnabled = useConfigStore((state) => state.dictationEnabled);
    const [dictationSupported] = useState(() => !isVSCodeRuntime() && isDictationCaptureSupported());
    const showDictation = dictationEnabled && dictationSupported;

    return <MobilePillComposerView
        input={{
            value: message,
            placeholder: currentSessionId || newSessionDraftOpen
                ? t('chat.chatInput.placeholder.chatCompact')
                : t('chat.chatInput.placeholder.selectSession'),
            onExpand,
        }}
        attachmentControl={<ComposerAttachmentControls
            isVSCode={isVSCode}
            footerIconButtonClass={footerIconButtonClass}
            iconSizeClass={iconSizeClass}
            handlePickLocalFiles={onPickLocalFiles}
            openGitHubPicker={onOpenGitHubPicker}
            repositoryProvider={repositoryProvider}
            showLinearPicker={showLinearPicker}
            openLinearPicker={onOpenLinearPicker}
            onOpenMobileSheet={onOpenAttachSheet}
        />}
        topRow={topRow}
        attachments={attachments}
        bottomRow={bottomRow}
        isRunning={canAbort}
        canSend={canPrimaryAction}
        canQueue={canPrimaryAction}
        canAbort={canAbort}
        onSend={onPrimaryAction}
        onAbort={onAbort}
        onQueue={onQueueMessage}
        onStartDictation={showDictation ? onStartDictation : undefined}
        footerIconButtonClass={footerIconButtonClass}
        iconSizeClass={iconSizeClass}
        sendIconSizeClass={sendIconSizeClass}
        stopIconSizeClass={stopIconSizeClass}
    />;
}
