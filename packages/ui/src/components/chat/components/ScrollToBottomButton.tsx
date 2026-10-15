import React from 'react';

import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useAssistantStatus } from '@/hooks/useAssistantStatus';
import { useBackgroundSessionWork } from '@/hooks/useBackgroundSessionWork';
import { useConfigStore } from '@/stores/useConfigStore';
import { getProviderModelDisplayName } from '@/lib/modelDisplay';
import { BackgroundWorkButton } from './BackgroundWorkButton';
import { ScrollAction, ScrollToBottomView } from './ScrollToBottomView';

/**
 * Compact one-line mirror of the status row for the pill: same label and
 * background action, none of the status row's animation machinery (which does
 * not survive being squeezed into a 28px chip). The action is a sibling of the
 * scroll button, never inside it.
 */
const WorkingPillBody: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    const { t } = useI18n();
    const { activeModel, working } = useAssistantStatus();
    const providers = useConfigStore((state) => state.providers);
    const backgroundWork = useBackgroundSessionWork();

    const modelName = React.useMemo(() => {
        if (!activeModel) return null;
        const provider = providers.find((candidate) => candidate.id === activeModel.providerId);
        return getProviderModelDisplayName(provider, activeModel.modelId) || null;
    }, [activeModel, providers]);

    if (!working.isWorking || !working.statusText) return <ScrollAction onClick={onClick} />;
    const status = working.statusText;
    const label = modelName && modelName.trim().length > 0
        ? t('chat.statusRow.modelStatus', { model: modelName.trim(), status })
        : status.charAt(0).toUpperCase() + status.slice(1);

    return (
        <>
            <ScrollAction onClick={onClick}>
                <span className={cn('-ms-px min-w-0 truncate text-[13px] leading-4 text-muted-foreground', working.canBackground ? 'pe-1' : 'pe-2')}>
                    {label}
                </span>
            </ScrollAction>
            {working.canBackground ? <BackgroundWorkButton onClick={backgroundWork} className="me-0.5 h-6 w-6" /> : null}
        </>
    );
};

interface ScrollToBottomButtonProps {
    visible: boolean;
    /** The session is still streaming: the pill carries the status label
        while the floating status row is hidden away from the live edge. */
    working?: boolean;
    onClick: () => void;
}

const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({ visible, working = false, onClick }) => <ScrollToBottomView visible={visible} onClick={onClick}>{working && visible ? <WorkingPillBody onClick={onClick} /> : undefined}</ScrollToBottomView>;

export default React.memo(ScrollToBottomButton);
