import React from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import { useDurationTickerNow } from '@/hooks/useDurationTicker';
import { MinDurationShineText } from './MinDurationShineText';
import { BlockLine } from './BlockLine';

import { TOOL_ROW_TITLE_CLASS, TOOL_ROW_DESCRIPTION_CLASS, TOOL_ERROR_ICON_STYLE, TOOL_NORMAL_ICON_STYLE, TOOL_ERROR_TITLE_STYLE, TOOL_NORMAL_TITLE_STYLE } from './toolSummaryStyles';

type ToolSummaryStatus = 'pending' | 'running' | 'completed' | 'error';
type ActivateEvent = React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>;
export type ToolSummaryViewProps = {
    title: string;
    icon: React.ReactNode;
    summary?: string;
    status: ToolSummaryStatus;
    active?: boolean;
    startedAt?: number;
    endedAt?: number;
    expanded: boolean;
    onToggle: () => void;
    children?: React.ReactNode;
    titleActions?: React.ReactNode;
    summaryContent?: React.ReactNode;
    summaryActions?: React.ReactNode;
    statusLabel?: React.ReactNode;
    onActivate?: (event: ActivateEvent) => void;
    expandedContentRef?: React.Ref<HTMLDivElement>;
    renderExpandedContent?: boolean;
};

const ToolDuration = ({ start, end, active }: { start: number; end?: number; active: boolean }) => {
    const now = useDurationTickerNow(active, 250);
    const seconds = Math.max(0, (end ?? now) - start) / 1000;
    const displaySeconds = seconds < 0.05 && end !== undefined ? 0.1 : seconds;
    return <>{displaySeconds.toFixed(1)}s</>;
};

export function ToolSummaryDetails({ expanded, onToggle, contentRef, renderContent = expanded, children }: {
    expanded: boolean;
    onToggle: () => void;
    contentRef?: React.Ref<HTMLDivElement>;
    renderContent?: boolean;
    children?: React.ReactNode;
}) {
    return <div ref={contentRef} aria-hidden={!expanded} style={{ height: expanded ? 'auto' : '0px', overflow: expanded ? 'visible' : 'hidden', overflowAnchor: 'none' }}>
        {renderContent ? <div className="relative ms-2 ps-3"><BlockLine onToggle={onToggle} topOffset={1} />{children}</div> : null}
    </div>;
}

/** Source owners supply the tool title, actions and genuine expanded details. */
export function ToolSummaryView({ title, icon, summary, status, active: suppliedActive, startedAt, endedAt, expanded, onToggle, children, titleActions, summaryContent, summaryActions, statusLabel, onActivate, expandedContentRef, renderExpandedContent = expanded }: ToolSummaryViewProps) {
    const active = suppliedActive ?? (status === 'pending' || status === 'running');
    const iconStyle = status === 'error' ? TOOL_ERROR_ICON_STYLE : TOOL_NORMAL_ICON_STYLE;
    const titleStyle = status === 'error' ? TOOL_ERROR_TITLE_STYLE : TOOL_NORMAL_TITLE_STYLE;
    const activate = (event: ActivateEvent) => { if (onActivate) onActivate(event); else onToggle(); };
    return <div>
        <div className="group/tool flex gap-1.5 pe-2 ps-px py-1.5 rounded-xl items-center cursor-pointer" role="button" tabIndex={0} aria-expanded={expanded} onClick={activate} onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault(); activate(event);
        }}>
            <div className="flex gap-1.5 items-center flex-shrink-0">
                <div className="relative h-5 w-3.5 flex-shrink-0 cursor-pointer" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
                    <div className={cn('absolute inset-0 flex items-center justify-center transition-opacity', expanded && 'opacity-0', !expanded && 'group-hover/tool:opacity-0')} style={iconStyle}>{icon}</div>
                    <div className={cn('absolute inset-0 transition-opacity flex items-center justify-center', expanded && 'opacity-100', !expanded && 'opacity-0 group-hover/tool:opacity-100')}>
                        <Icon name={expanded ? 'arrow-down-s' : 'arrow-right-s'} className="h-3.5 w-3.5" />
                    </div>
                </div>
                <div className={cn('flex items-center min-w-0 flex-1', titleActions ? 'gap-1' : 'gap-2')}>
                    <MinDurationShineText active={active} minDurationMs={300} className={cn(TOOL_ROW_TITLE_CLASS, 'flex-shrink-0')} style={titleStyle} title={title}>{title}</MinDurationShineText>
                    {titleActions}
                </div>
                {startedAt !== undefined ? <span className={cn('flex-shrink-0 tabular-nums text-muted-foreground/80', TOOL_ROW_DESCRIPTION_CLASS)}><ToolDuration start={startedAt} end={endedAt} active={active && endedAt === undefined} /></span> : null}
                {statusLabel ? <span className={cn('flex-shrink-0 text-muted-foreground/80', TOOL_ROW_DESCRIPTION_CLASS)}>{statusLabel}</span> : null}
            </div>
            <div className={cn('flex items-center gap-1 flex-1 min-w-0', TOOL_ROW_DESCRIPTION_CLASS)} style={{ color: 'var(--tools-description)' }}>
                <div className="flex items-center gap-1 flex-1 min-w-0">{summaryContent ?? (summary ? <span className={cn('min-w-0 truncate', TOOL_ROW_DESCRIPTION_CLASS)} style={{ color: 'var(--tools-description)' }} title={summary}>{summary}</span> : null)}</div>
                {summaryActions}
            </div>
        </div>
        <ToolSummaryDetails expanded={expanded} onToggle={onToggle} contentRef={expandedContentRef} renderContent={renderExpandedContent}>{children}</ToolSummaryDetails>
    </div>;
}
