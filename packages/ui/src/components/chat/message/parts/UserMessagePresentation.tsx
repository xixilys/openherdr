import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export type UserMessageBubbleProps = {
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    peek?: boolean;
};

export function UserMessageBubble({ children, footer, className, peek = false }: UserMessageBubbleProps) {
    return <div className={cn('relative flex flex-col items-end', className)}>
        <div className={cn('max-w-[85%]', peek && 'pb-3')}>
            <div
                style={{ backgroundColor: 'var(--chat-user-message-bg)', borderRadius: 'var(--radius-xl)', borderBottomRightRadius: 'var(--radius-sm)' }}
                className="px-5 py-3 shadow-none border border-primary/5"
                data-user-message-bubble=""
            >{children}</div>
        </div>
        {footer}
    </div>;
}

export type UserTextViewProps = {
    text: string;
    expanded: boolean;
    onToggle: () => void;
    collapsible?: boolean;
    showToggle?: boolean;
    renderingMode?: 'plain' | 'markdown';
    children?: React.ReactNode;
    onTruncationChange?: (truncated: boolean) => void;
    onTextClick?: React.MouseEventHandler<HTMLDivElement>;
};

/** The source owner supplies prepared inline content and owns expansion state. */
export function UserTextView({ text, expanded, onToggle, collapsible = true, showToggle = true, renderingMode = 'plain', children, onTruncationChange, onTextClick }: UserTextViewProps) {
    const { t } = useI18n();
    const [truncated, setTruncated] = React.useState(false);
    const textRef = React.useRef<HTMLDivElement>(null);
    const collapsed = collapsible && !expanded;

    React.useLayoutEffect(() => {
        const element = textRef.current;
        if (!element || !collapsible || expanded) return;
        const checkTruncation = () => setTruncated(element.scrollHeight > element.clientHeight);
        checkTruncation();
        const initialFrame = window.requestAnimationFrame(checkTruncation);
        const resizeObserver = new ResizeObserver(checkTruncation);
        resizeObserver.observe(element);
        const observeChildren = () => { for (const child of Array.from(element.children)) resizeObserver.observe(child); };
        observeChildren();
        const mutationObserver = new MutationObserver(() => { observeChildren(); checkTruncation(); });
        mutationObserver.observe(element, { childList: true, subtree: true });
        return () => { window.cancelAnimationFrame(initialFrame); mutationObserver.disconnect(); resizeObserver.disconnect(); };
    }, [collapsible, expanded, text]);
    React.useEffect(() => { if (!collapsible) setTruncated(false); }, [collapsible]);
    React.useLayoutEffect(() => { onTruncationChange?.(truncated); }, [onTruncationChange, truncated]);
    React.useEffect(() => () => onTruncationChange?.(false), [onTruncationChange]);

    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        onTextClick?.(event);
        if (event.defaultPrevented) return;
        const element = textRef.current;
        if (!element) return;
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (element.contains(range.startContainer) || element.contains(range.endContainer)) return;
        }
        if (collapsed && element.scrollHeight > element.clientHeight) { setTruncated(true); onToggle(); }
    };

    return <>
        <div ref={textRef} onClick={handleClick} className={cn(
            'break-words font-sans typography-markdown-body',
            renderingMode === 'plain' && 'whitespace-pre-wrap [unicode-bidi:plaintext] text-start',
            collapsed && 'line-clamp-2',
            collapsed && truncated && 'cursor-pointer',
        )}>{children ?? text}</div>
        {showToggle && collapsible && (expanded || truncated) ? <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggle(); }}
            className="ms-auto mt-1 block py-0.5 text-end text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none focus-visible:text-foreground"
            style={{ minHeight: 0, minWidth: 0 }}
            aria-expanded={expanded}
        >{t(expanded ? 'chat.message.userText.showLess' : 'chat.message.userText.showFullMessage')}</button> : null}
    </>;
}
