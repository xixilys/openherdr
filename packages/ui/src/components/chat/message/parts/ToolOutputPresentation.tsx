import React from 'react';
import { cn } from '@/lib/utils';
import { toolDisplayStyles } from '@/lib/typography';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Icon } from '@/components/icon/Icon';
import { WorkerHighlightedCode } from '@/components/code/WorkerHighlightedCode';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import type { Theme } from '@/types/theme';
import type { DiffViewMode } from '../DiffViewToggle';
import type { DiffPatchEntry } from './toolDiffUtils';
import { PlainDiffFallback } from './PlainDiffFallback';
import { isToolDiffPreviewOversized } from './toolDiffPreview';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { getStreamingOutputAppend } from './toolOutput';

const TOOL_COLLAPSED_CUSTOM_STYLE: React.CSSProperties = {
    ...toolDisplayStyles.getCollapsedStyles(),
    padding: 0,
    overflow: 'visible',
};
const CODE_TAG_STYLE = { background: 'transparent', backgroundColor: 'transparent' };

interface ToolScrollableSectionProps {
    children: React.ReactNode;
    maxHeightClass?: string;
    className?: string;
    outerClassName?: string;
    disableHorizontal?: boolean;
    followKey?: string;
}

export const ToolScrollableSection: React.FC<ToolScrollableSectionProps> = ({
    children,
    maxHeightClass = 'max-h-[60vh]',
    className,
    outerClassName,
    disableHorizontal = false,
    followKey,
}) => {
    const scrollRef = React.useRef<HTMLElement>(null);
    const isFollowingRef = React.useRef(true);
    const lastScrollTopRef = React.useRef(0);

    React.useLayoutEffect(() => {
        const element = scrollRef.current;
        if (followKey === undefined) {
            isFollowingRef.current = true;
            return;
        }
        if (!element || !isFollowingRef.current) {
            return;
        }
        element.scrollTop = element.scrollHeight;
        // Read back the clamped position before the queued scroll event fires.
        lastScrollTopRef.current = element.scrollTop;
    }, [followKey]);

    return (
        <div className={cn('w-full min-w-0 flex-none overflow-hidden', outerClassName)}>
            <ScrollShadow
                ref={scrollRef}
                // Tool output boxes are short (often 240px), so the 48px default
                // fade would hide a couple of lines at each edge.
                size={24}
                data-scrollable="true"
                onWheelCapture={(event) => {
                    if (followKey !== undefined && event.deltaY < 0) {
                        isFollowingRef.current = false;
                    }
                }}
                onScroll={(event) => {
                    if (followKey === undefined) {
                        return;
                    }
                    const element = event.currentTarget;
                    const distanceToEnd = element.scrollHeight - element.scrollTop - element.clientHeight;
                    // Output can grow between an automatic scroll and its event.
                    // A larger bottom gap alone does not mean the reader moved up.
                    if (distanceToEnd <= 2) {
                        isFollowingRef.current = true;
                    } else if (element.scrollTop < lastScrollTopRef.current - 1) {
                        isFollowingRef.current = false;
                    }
                    lastScrollTopRef.current = element.scrollTop;
                }}
                className={cn(
                    'tool-output-surface p-2 rounded-xl w-full min-w-0',
                    maxHeightClass,
                    disableHorizontal ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto',
                    className,
                )}
            >
                <div className="w-full min-w-0">
                    {children}
                </div>
            </ScrollShadow>
        </div>
    );
};

const StreamingPlainTextOutput: React.FC<{ output: string }> = ({ output }) => {
    const preRef = React.useRef<HTMLPreElement>(null);
    const previousOutputRef = React.useRef('');

    React.useLayoutEffect(() => {
        const element = preRef.current;
        if (!element) {
            return;
        }

        const firstChild = element.firstChild;
        const textNode = firstChild instanceof globalThis.Text
            ? firstChild
            : document.createTextNode('');
        if (textNode !== firstChild) {
            element.replaceChildren(textNode);
        }

        const append = getStreamingOutputAppend(previousOutputRef.current, output);
        if (append === undefined) {
            textNode.data = output;
        } else if (append.length > 0) {
            textNode.appendData(append);
        }
        previousOutputRef.current = output;
    }, [output]);

    return (
        <pre
            ref={preRef}
            className="m-0 whitespace-pre-wrap break-words"
            style={{
                ...TOOL_COLLAPSED_CUSTOM_STYLE,
                lineHeight: 'round(var(--code-block-line-height), 1px)',
                overflowWrap: 'break-word',
            }}
        />
    );
};

/** Copies a tool's whole output as plain text; shown on JSON and shell output. */
export const CopyToolOutputButton: React.FC<{ output: string }> = ({ output }) => {
    const { t } = useI18n();
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        setCopied(false);
    }, [output]);

    const handleCopy = React.useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const result = await copyTextToClipboard(output);
        if (!result.ok) {
            toast.error(t('chat.toolPart.copyOutputFailed'));
            return;
        }
        setCopied(true);
        if (typeof window !== 'undefined') {
            window.setTimeout(() => setCopied(false), 1200);
        }
    }, [output, t]);

    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md bg-[var(--surface-elevated)]/80 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
            onPointerDown={(event) => event.stopPropagation()}
            aria-label={copied ? t('chat.toolPart.copiedOutput') : t('chat.toolPart.copyOutput')}
            title={copied ? t('chat.toolPart.copiedOutput') : t('chat.toolPart.copyOutput')}
        >
            <Icon name={copied ? 'check' : 'file-copy'} className="h-3.5 w-3.5" />
        </Button>
    );
};

/** Receives the owner's formatted, bounded snapshot. Live output avoids worker highlighting. */
export const ToolShellOutput: React.FC<{ output: string; isStreaming?: boolean; theme?: Theme }> = ({ output, isStreaming = false, theme }) => {
    if (isStreaming) {
        return <div dir="ltr" className="typography-code text-muted-foreground/90"><StreamingPlainTextOutput output={output} /></div>;
    }
    return (
        <div dir="ltr" className="relative typography-code text-muted-foreground/90">
            <div className="absolute inset-e-1 top-1 z-10"><CopyToolOutputButton output={output} /></div>
            <div className="pe-8">
                <WorkerHighlightedCode language="bash" code={output} theme={theme} style={TOOL_COLLAPSED_CUSTOM_STYLE} codeStyle={CODE_TAG_STYLE} wrap />
            </div>
        </div>
    );
};

export const ToolShellInput: React.FC<{ input: string }> = ({ input }) => (
    <pre dir="ltr" className="tool-input-text whitespace-pre-wrap break-words typography-code text-muted-foreground/90 m-0 p-0">{input}</pre>
);

const LazyToolPartDiffPreview = lazyWithChunkRecovery(() => import('./ToolPartDiffPreview'));

export const ToolDiffPreview: React.FC<{ diff: string; diffViewMode: DiffViewMode; theme?: Theme }> = ({ diff, diffViewMode, theme }) => {
    if (isToolDiffPreviewOversized(diff)) return <PlainDiffFallback diff={diff} />;
    return (
        <React.Suspense fallback={<PlainDiffFallback diff={diff} />}>
            <LazyToolPartDiffPreview diff={diff} diffViewMode={diffViewMode} theme={theme} />
        </React.Suspense>
    );
};

export const ToolDiffEntries: React.FC<{
    entries: DiffPatchEntry[];
    mode: DiffViewMode;
    theme?: Theme;
    renderTitle?: (entry: DiffPatchEntry) => React.ReactNode;
    renderActions?: (entry: DiffPatchEntry) => React.ReactNode;
}> = ({ entries, mode, theme, renderTitle, renderActions }) => (
    <>
        {entries.map((entry) => (
            <div key={entry.id} dir="ltr" className="w-full min-w-0">
                <div className="mb-1 flex min-w-0 items-center gap-1 px-2 py-1">
                    <div className="min-w-0 flex-1 typography-meta font-medium text-muted-foreground">
                        {renderTitle ? renderTitle(entry) : <span dir="ltr">{entry.title}</span>}
                    </div>
                    {renderActions?.(entry)}
                </div>
                {entry.renderMode === 'diff'
                    ? <ToolDiffPreview diff={entry.patch} diffViewMode={mode} theme={theme} />
                    : <PlainDiffFallback diff={entry.patch} />}
            </div>
        ))}
    </>
);
