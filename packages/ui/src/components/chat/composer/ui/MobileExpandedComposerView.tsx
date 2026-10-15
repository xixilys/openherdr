import React from 'react';
import { ComposerBoxView } from './ComposerBoxView';
import { MobileComposerActionsView, MobileComposerChoicesView, type MobilePillComposerViewProps } from './MobilePillComposerView';

type MobileExpandedComposerViewProps = Omit<MobilePillComposerViewProps, 'input'> & { editor: React.ReactNode };

/** Original floating editor layout with source-owned content and actions. */
export function MobileExpandedComposerView({
    editor, statusRow, topRow, attachments, attachmentControl, bottomRow, model, agent, ...actions
}: MobileExpandedComposerViewProps) {
    return <div className="flex flex-col">
        {statusRow}
        <ComposerBoxView radius="1.5rem" boxProps={{ 'data-composer-box': 'true' }}>
            <div data-mobile-composer-expanded="true" className="relative flex flex-col">
                <div className="overflow-hidden">
                    {topRow}
                    {attachments}
                    <div className="relative overflow-hidden" data-composer-morph-prompt="true">{editor}</div>
                </div>
                <div className="bg-transparent flex-shrink-0 px-1.5 py-1.5 flex items-center gap-x-1.5" data-chat-input-footer="true">
                    <div className="flex w-full items-center justify-between gap-x-1.5">
                        <div className="composer-mobile-actions flex items-center gap-x-2 ps-1">{attachmentControl}</div>
                        <div className="flex items-center min-w-0 gap-x-1 justify-end"><div className="flex items-center gap-x-1 flex-shrink-0"><MobileComposerActionsView {...actions} /></div></div>
                    </div>
                </div>
            </div>
            {bottomRow ?? <MobileComposerChoicesView model={model} agent={agent} />}
        </ComposerBoxView>
    </div>;
}
