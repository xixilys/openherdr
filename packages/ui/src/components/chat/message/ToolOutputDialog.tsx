import { isShellTool, isSubagentTool, isWriteTool } from '@/lib/opencode/tools';
import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { File as PierreFile, PatchDiff } from '@pierre/diffs/react';
import { WorkerHighlightedCode } from '@/components/code/WorkerHighlightedCode';
import { createPortal } from 'react-dom';
import { ImagePreviewView } from '../ImagePreviewView';
import { usePreviewOverlayState, usePreviewViewport } from '../imagePreviewHooks';

import { cn } from '@/lib/utils';
import { SimpleMarkdownRenderer } from '../MarkdownRenderer';
import { toolDisplayStyles } from '@/lib/typography';
import { getLanguageFromExtension } from '@/lib/toolHelpers';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { ensurePierreThemeRegistered } from '@/lib/shiki/appThemeRegistry';
import { getDefaultTheme } from '@/lib/theme/themes';
import {
    renderGrepOutput,
    renderGlobOutput,
    renderWebSearchOutput,
    formatInputForDisplay,
    parseReadToolOutput,
    tryParseJsonOutput,
} from './toolRenderers';
import type { ToolPopupContent, DiffViewMode } from './types';
import { DiffViewToggle } from './DiffViewToggle';
import { useDefaultDiffViewMode } from './useDefaultDiffViewMode';
import { VirtualizedCodeBlock, type CodeLine } from './parts/VirtualizedCodeBlock';
import { JsonTreeView } from '@/components/ui/JsonTreeView';
import { Icon } from "@/components/icon/Icon";
import { getToolIcon } from './parts/toolPresentation';
import { useGuestToolPresentation } from '@/lib/guests/tool-presentation';
import { useI18n, type I18nKey, type I18nParams } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { MermaidLoadFailure, getMermaidDataUrlSourcePromise, isCurrentMermaidLoadRequest, isMermaidLoadFailure, nextMermaidLoadRequestId } from './toolOutputDialogMermaid';
import { PIERRE_DIFF_TINT_CSS } from '@/lib/shiki/pierreDiffTint';

interface ToolOutputDialogProps {
    popup: ToolPopupContent;
    onOpenChange: (open: boolean) => void;
    isMobile: boolean;
}

const mermaidLoadFailure = (key: I18nKey, params?: I18nParams): MermaidLoadFailure => new MermaidLoadFailure(key, params);

const MERMAID_DIALOG_HEADER_HEIGHT = 40;
const MERMAID_ASPECT_RETRY_DELAY_MS = 120;
const MERMAID_ASPECT_MAX_RETRIES = 3;

const DIALOG_CODE_TAG_PROPS = { style: { background: 'transparent', backgroundColor: 'transparent', fontSize: 'inherit' } };

const MERMAID_CONTROLS = { download: false, copy: false, showPanZoomControls: true };

type PierreThemeConfig = {
    theme: { light: string; dark: string };
    themeType: 'light' | 'dark';
};

const TOOL_DIFF_UNSAFE_CSS = `
  ${PIERRE_DIFF_TINT_CSS}
  [data-diff-header],
  [data-diff] {
    [data-separator] {
      height: 24px !important;
    }
  }
`;

const TOOL_DIFF_METRICS = {
    hunkLineCount: 50,
    lineHeight: 24,
    diffHeaderHeight: 44,
    hunkSeparatorHeight: 24,
    spacing: 0,
};

const usePierreThemeConfig = (): PierreThemeConfig => {
    const themeSystem = useOptionalThemeSystem();
    const fallbackLightTheme = React.useMemo(() => getDefaultTheme(false), []);
    const fallbackDarkTheme = React.useMemo(() => getDefaultTheme(true), []);

    const availableThemes = React.useMemo(
        () => themeSystem?.availableThemes ?? [fallbackLightTheme, fallbackDarkTheme],
        [fallbackDarkTheme, fallbackLightTheme, themeSystem?.availableThemes],
    );
    const lightThemeId = themeSystem?.lightThemeId ?? fallbackLightTheme.metadata.id;
    const darkThemeId = themeSystem?.darkThemeId ?? fallbackDarkTheme.metadata.id;

    const lightTheme = React.useMemo(
        () => availableThemes.find((theme) => theme.metadata.id === lightThemeId) ?? fallbackLightTheme,
        [availableThemes, fallbackLightTheme, lightThemeId],
    );
    const darkTheme = React.useMemo(
        () => availableThemes.find((theme) => theme.metadata.id === darkThemeId) ?? fallbackDarkTheme,
        [availableThemes, darkThemeId, fallbackDarkTheme],
    );

    React.useEffect(() => {
        ensurePierreThemeRegistered(lightTheme);
        ensurePierreThemeRegistered(darkTheme);
    }, [darkTheme, lightTheme]);

    const currentVariant = themeSystem?.currentTheme.metadata.variant ?? 'light';

    return {
        theme: { light: lightTheme.metadata.id, dark: darkTheme.metadata.id },
        themeType: currentVariant === 'dark' ? 'dark' : 'light',
    };
};

const PREVIEW_VIEWPORT_LIMITS = {
    mobile: { widthRatio: 0.94, heightRatio: 0.86, padding: 10 },
    desktop: { widthRatio: 0.8, heightRatio: 0.8, padding: 16 },
} as const;

const getPreviewViewportBounds = (viewport: { width: number; height: number }, isMobile: boolean) => {
    const limits = isMobile ? PREVIEW_VIEWPORT_LIMITS.mobile : PREVIEW_VIEWPORT_LIMITS.desktop;
    const paddedWidth = Math.max(160, viewport.width - limits.padding * 2);
    const paddedHeight = Math.max(160, viewport.height - limits.padding * 2);

    return {
        maxWidth: Math.max(160, Math.min(paddedWidth, viewport.width * limits.widthRatio)),
        maxHeight: Math.max(160, Math.min(paddedHeight, viewport.height * limits.heightRatio)),
    };
};

const getSvgAspectRatio = (svg: SVGElement): number | null => {
    try {
        const groups = Array.from(svg.querySelectorAll('g'));
        let bestArea = 0;
        let bestRatio: number | null = null;

        for (const group of groups) {
            if (!(group instanceof SVGGraphicsElement)) {
                continue;
            }
            const box = group.getBBox();
            if (!(box.width > 0 && box.height > 0)) {
                continue;
            }
            const area = box.width * box.height;
            if (area > bestArea) {
                bestArea = area;
                bestRatio = box.width / box.height;
            }
        }

        if (bestRatio && Number.isFinite(bestRatio) && bestRatio > 0) {
            return bestRatio;
        }
    } catch {
        // Ignore getBBox failures and fall back to SVG attrs/viewBox.
    }

    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/\s+/).map(Number);
        if (parts.length === 4) {
            const width = parts[2];
            const height = parts[3];
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                return width / height;
            }
        }
    }

    const attrWidth = Number(svg.getAttribute('width'));
    const attrHeight = Number(svg.getAttribute('height'));
    if (Number.isFinite(attrWidth) && Number.isFinite(attrHeight) && attrWidth > 0 && attrHeight > 0) {
        return attrWidth / attrHeight;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        return rect.width / rect.height;
    }

    return null;
};

const ImagePreviewDialog: React.FC<{
    popup: ToolPopupContent;
    onOpenChange: (open: boolean) => void;
    isMobile: boolean;
}> = ({ popup, onOpenChange, isMobile }) => {
    const images = React.useMemo(() => {
        const image = popup.image;
        if (!image) return [];
        const gallery = image.gallery?.filter((item) => Boolean(item.url)) ?? [];
        return gallery.length > 0 ? gallery : [image];
    }, [popup.image]);
    const matchingIndex = images.findIndex((image) => image.url === popup.image?.url);
    const requestedIndex = popup.image?.index;
    const initialIndex = requestedIndex !== undefined && requestedIndex >= 0 && requestedIndex < images.length
        ? requestedIndex : Math.max(0, matchingIndex);
    return <ImagePreviewView open={popup.open} images={images} initialIndex={initialIndex}
        title={popup.title || 'Image preview'} onOpenChange={onOpenChange} isMobile={isMobile} />;
};

// ── PERF-007: Virtualised sub-components for dialog ──────────────────

const DialogUnifiedDiff: React.FC<{
    popup: ToolPopupContent;
    diffViewMode: DiffViewMode;
    pierreThemeConfig: PierreThemeConfig;
}> = React.memo(({ popup, diffViewMode, pierreThemeConfig }) => {
    const patchContent = popup.content || '';

    return (
        <div className="typography-code">
            <PatchDiff
                patch={patchContent}
                metrics={TOOL_DIFF_METRICS}
                options={{
                    diffStyle: diffViewMode === 'unified' ? 'unified' : 'split',
                    diffIndicators: 'none',
                    hunkSeparators: 'line-info-basic',
                    lineDiffType: 'none',
                    disableFileHeader: true,
                    maxLineDiffLength: 1000,
                    expansionLineCount: 20,
                    overflow: 'wrap',
                    theme: pierreThemeConfig.theme,
                    themeType: pierreThemeConfig.themeType,
                    unsafeCSS: TOOL_DIFF_UNSAFE_CSS,
                }}
                className="block w-full"
            />
        </div>
    );
});

DialogUnifiedDiff.displayName = 'DialogUnifiedDiff';

const DialogReadContent: React.FC<{
    popup: ToolPopupContent;
    pierreThemeConfig: PierreThemeConfig;
}> = React.memo(({ popup, pierreThemeConfig }) => {
    const parsedReadOutput = React.useMemo(() => parseReadToolOutput(popup.content), [popup.content]);

    const inputMeta = popup.metadata?.input;
    const inputObj = typeof inputMeta === 'object' && inputMeta !== null ? (inputMeta as Record<string, unknown>) : {};
    const offset = typeof inputObj.offset === 'number' ? inputObj.offset : 0;
    const filePath =
        typeof inputObj.file_path === 'string'
            ? inputObj.file_path
            : typeof inputObj.filePath === 'string'
                ? inputObj.filePath
                : typeof inputObj.path === 'string'
                    ? inputObj.path
                    : 'read-output';

    const fileContents = React.useMemo(() => parsedReadOutput.lines.map((line) => line.text).join('\n'), [parsedReadOutput]);
    const detectedLanguage = React.useMemo(
        () => popup.language || getLanguageFromExtension(filePath) || 'text',
        [filePath, popup.language],
    );

    const codeLines: CodeLine[] = React.useMemo(() => {
        const hasExplicitLineNumbers = parsedReadOutput.lines.some((line) => line.lineNumber !== null);
        const result: CodeLine[] = [];
        let nextLineNumber = offset;

        for (const line of parsedReadOutput.lines) {
            if (line.lineNumber !== null) {
                nextLineNumber = line.lineNumber;
            }
            const shouldAssignFallback =
                parsedReadOutput.type === 'file'
                && !hasExplicitLineNumbers
                && line.lineNumber === null
                && !line.isInfo;
            const effectiveLineNumber = line.lineNumber ?? (shouldAssignFallback
                ? (nextLineNumber + 1)
                : null);
            if (typeof effectiveLineNumber === 'number') {
                nextLineNumber = effectiveLineNumber;
            }

            result.push({
                text: line.text,
                lineNumber: effectiveLineNumber,
                isInfo: line.isInfo,
            });
        }

        return result;
    }, [offset, parsedReadOutput]);

    if (parsedReadOutput.type === 'file') {
        return (
            <PierreFile
                file={{
                    name: filePath,
                    contents: fileContents,
                    lang: detectedLanguage || undefined,
                }}
                options={{
                    disableFileHeader: true,
                    overflow: 'wrap',
                    theme: pierreThemeConfig.theme,
                    themeType: pierreThemeConfig.themeType,
                }}
                className="block w-full"
            />
        );
    }

    return (
        <VirtualizedCodeBlock
            lines={codeLines}
            language={detectedLanguage}
            maxHeight="70vh"
        />
    );
});

DialogReadContent.displayName = 'DialogReadContent';
const MermaidPreviewDialog: React.FC<{
    popup: ToolPopupContent;
    onOpenChange: (open: boolean) => void;
    isMobile: boolean;
}> = ({ popup, onOpenChange, isMobile }) => {
    const { t } = useI18n();
    const [source, setSource] = React.useState<string>(popup.mermaid?.source || '');
    const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>(popup.mermaid?.source ? 'ready' : 'idle');
    const [errorMessage, setErrorMessage] = React.useState<string>('');
    const { isRendered, isVisible, isTransitioning } = usePreviewOverlayState(popup.open);
    const [diagramAspectRatio, setDiagramAspectRatio] = React.useState<number | null>(null);
    const viewport = usePreviewViewport(popup.open);
    const requestIdRef = React.useRef(0);
    const mermaidPreviewRef = React.useRef<HTMLDivElement | null>(null);

    const normalizeFilePath = React.useCallback((rawPath: string): string | null => {
        const input = rawPath.trim();
        if (!input.toLowerCase().startsWith('file://')) {
            return null;
        }

        const isSafeLocalPath = (path: string): boolean => {
            if (!path || /[\0\r\n]/.test(path)) {
                return false;
            }

            const normalized = path.replace(/\\/g, '/');
            const segments = normalized.split('/').filter(Boolean);
            if (segments.includes('..')) {
                return false;
            }

            if (normalized.startsWith('/')) {
                return true;
            }

            return /^[A-Za-z]:\//.test(normalized);
        };

        const decodeLoose = (value: string): string => {
            return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
                const codePoint = Number.parseInt(hex, 16);
                return Number.isFinite(codePoint) ? String.fromCharCode(codePoint) : `%${hex}`;
            });
        };

        const canParse = typeof URL.canParse === 'function'
            ? URL.canParse(input)
            : false;

        if (canParse) {
            let pathname = decodeLoose(new URL(input).pathname || '');
            if (/^\/[A-Za-z]:\//.test(pathname)) {
                pathname = pathname.slice(1);
            }
            return isSafeLocalPath(pathname) ? pathname : null;
        }

        const stripped = input.replace(/^file:\/\//i, '');
        const decoded = decodeLoose(stripped);
        return isSafeLocalPath(decoded) ? decoded : (isSafeLocalPath(stripped) ? stripped : null);
    }, []);

    const loadMermaidSource = React.useCallback(async () => {
        const target = popup.mermaid;
        const requestId = nextMermaidLoadRequestId(requestIdRef.current);
        requestIdRef.current = requestId;

        if (!target?.url) {
            setStatus('error');
            setErrorMessage(t('chat.toolOutputDialog.mermaid.missingSource'));
            return;
        }

        if (target.source) {
            setSource(target.source);
            setStatus('ready');
            setErrorMessage('');
            return;
        }

        setStatus('loading');
        setErrorMessage('');

        let sourcePromise: Promise<string>;
        if (target.url.startsWith('data:')) {
            sourcePromise = getMermaidDataUrlSourcePromise(target.url);
        } else if (target.url.toLowerCase().startsWith('file://')) {
            const normalizedPath = normalizeFilePath(target.url);
            if (!normalizedPath) {
                sourcePromise = Promise.reject(mermaidLoadFailure('chat.toolOutputDialog.mermaid.invalidLocalPath'));
            } else {
                sourcePromise = runtimeFetch('/api/fs/raw', { query: { path: normalizedPath } })
                    .then((response) => {
                        if (!response.ok) {
                            return Promise.reject(mermaidLoadFailure('chat.toolOutputDialog.mermaid.readFileFailedWithStatus', { status: response.status }));
                        }
                        return response.text();
                    });
            }
        } else {
            const canParse = typeof URL.canParse === 'function'
                ? URL.canParse(target.url, window.location.origin)
                : false;
            const resolvedUrl = canParse ? new URL(target.url, window.location.origin) : null;

            if (!resolvedUrl || (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:')) {
                sourcePromise = Promise.reject(mermaidLoadFailure('chat.toolOutputDialog.mermaid.unsupportedUrlProtocol'));
            } else {
                sourcePromise = fetch(resolvedUrl.toString())
                    .then((response) => {
                        if (!response.ok) {
                            return Promise.reject(mermaidLoadFailure('chat.toolOutputDialog.mermaid.loadFailedWithStatus', { status: response.status }));
                        }
                        return response.text();
                    });
            }
        }

        await sourcePromise
            .then((resolvedSource) => {
                if (!isCurrentMermaidLoadRequest(requestIdRef.current, requestId)) {
                    return;
                }

                setSource(resolvedSource);
                setStatus('ready');
            })
            .catch((error) => {
                if (!isCurrentMermaidLoadRequest(requestIdRef.current, requestId)) {
                    return;
                }
                setStatus('error');
                setErrorMessage(isMermaidLoadFailure(error) ? t(error.key, error.params) : t('chat.toolOutputDialog.mermaid.loadFailed'));
            });
    }, [normalizeFilePath, popup.mermaid, t]);

    React.useEffect(() => {
        if (!popup.open || !popup.mermaid) {
            return;
        }
        void loadMermaidSource();
    }, [loadMermaidSource, popup.mermaid, popup.open]);

    React.useEffect(() => {
        if (!popup.open) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onOpenChange(false);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [onOpenChange, popup.open]);

    React.useEffect(() => {
        if (!popup.open || status !== 'ready') {
            setDiagramAspectRatio(null);
            return;
        }

        const measureAspectRatio = () => {
            const svg = mermaidPreviewRef.current?.querySelector('svg');
            if (!svg) {
                return false;
            }

            const aspectRatio = getSvgAspectRatio(svg as SVGElement);
            if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                return false;
            }

            setDiagramAspectRatio((previous) => {
                if (previous && Math.abs(previous - aspectRatio) < 0.001) {
                    return previous;
                }
                return aspectRatio;
            });
            return true;
        };

        let rafId = window.requestAnimationFrame(() => {
            if (!measureAspectRatio()) {
                rafId = window.requestAnimationFrame(() => {
                    measureAspectRatio();
                });
            }
        });

        let retryCount = 0;
        let timeoutId: number | undefined;
        const scheduleRetry = () => {
            if (retryCount >= MERMAID_ASPECT_MAX_RETRIES) {
                return;
            }

            timeoutId = window.setTimeout(() => {
                retryCount += 1;
                if (!measureAspectRatio()) {
                    scheduleRetry();
                }
            }, MERMAID_ASPECT_RETRY_DELAY_MS);
        };
        scheduleRetry();

        const observer = new MutationObserver(() => {
            measureAspectRatio();
        });

        if (mermaidPreviewRef.current) {
            observer.observe(mermaidPreviewRef.current, { childList: true, subtree: true, attributes: true });
        }

        return () => {
            window.cancelAnimationFrame(rafId);
            if (typeof timeoutId === 'number') {
                window.clearTimeout(timeoutId);
            }
            observer.disconnect();
        };
    }, [popup.open, source, status]);

    const mermaidMarkdown = `\`\`\`mermaid\n${source}\n\`\`\``;

    const dialogSize = React.useMemo(() => {
        const { maxWidth, maxHeight } = getPreviewViewportBounds(viewport, isMobile);
        const availableDiagramHeight = Math.max(160, maxHeight - MERMAID_DIALOG_HEADER_HEIGHT);

        if (diagramAspectRatio && diagramAspectRatio < 1) {
            const squareSide = Math.min(maxWidth, availableDiagramHeight);
            return { width: Math.round(squareSide), height: Math.round(squareSide) };
        }

        return { width: Math.round(maxWidth), height: Math.round(availableDiagramHeight) };
    }, [diagramAspectRatio, isMobile, viewport]);

    if (!isRendered || typeof document === 'undefined') {
        return null;
    }

    const content = (
        <div className={cn('fixed inset-0 z-50', popup.open ? 'pointer-events-auto' : 'pointer-events-none')}>
            <div
                aria-hidden="true"
                className={cn(
                    'absolute inset-0',
                    isTransitioning && 'transition-opacity duration-150 ease-out',
                    isVisible ? 'opacity-100' : 'opacity-0'
                )}
                style={{ backgroundColor: 'color-mix(in srgb, var(--surface-elevated) 70%, transparent)', color: 'var(--surface-elevated-foreground)' }}
                onMouseDown={() => onOpenChange(false)}
            />

            <div
                className={cn(
                    'absolute inset-0 flex items-center justify-center pointer-events-none',
                    isMobile ? 'p-2.5' : 'p-4'
                )}
            >
                <div
                    className={cn(
                        'pointer-events-auto flex flex-col gap-2',
                        isTransitioning && 'transition-opacity duration-150 ease-out',
                        isVisible ? 'opacity-100' : 'opacity-0'
                    )}
                    style={{ width: `${dialogSize.width}px` }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-end">
                        <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            onClick={() => onOpenChange(false)}
                            aria-label={t('chat.toolOutputDialog.mermaid.closeAria')}
                        >
                            <Icon name="close" className="h-4 w-4" />
                        </button>
                    </div>
                    <div
                        className="relative overflow-hidden"
                        style={{ height: `${dialogSize.height}px` }}
                    >
                        <div className="h-full overflow-hidden">
                            {status === 'loading' && (
                                <div className="h-full min-h-28 flex items-center justify-center gap-2 text-muted-foreground typography-meta">
                                    <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                                    <span>{t('chat.toolOutputDialog.mermaid.loading')}</span>
                                </div>
                            )}

                            {status === 'error' && (
                                <div
                                    className="rounded-xl border p-3 space-y-3"
                                    style={{
                                        backgroundColor: 'var(--status-error-background)',
                                        borderColor: 'var(--status-error-border)',
                                    }}
                                >
                                    <p className="typography-markdown" style={{ color: 'var(--status-error)' }}>
                                        {errorMessage || t('chat.toolOutputDialog.mermaid.renderFailed')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void loadMermaidSource();
                                        }}
                                        className="px-3 py-1.5 rounded-lg typography-meta border transition-colors hover:bg-[var(--interactive-hover)]"
                                        style={{
                                            borderColor: 'var(--interactive-border)',
                                            color: 'var(--surface-foreground)',
                                        }}
                                    >
                                        {t('chat.toolOutputDialog.mermaid.retry')}
                                    </button>
                                </div>
                            )}

                            {status === 'ready' && (
                                <div ref={mermaidPreviewRef} className="h-full">
                                    <SimpleMarkdownRenderer
                                        content={mermaidMarkdown}
                                        variant="tool"
                                        allowMermaidWheelEvents
                                        className="markdown-mermaid-fullscreen h-full"
                                        mermaidControls={MERMAID_CONTROLS}
                                        enableFileReferences={false}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(content, document.body);
};

const ToolOutputDialog: React.FC<ToolOutputDialogProps> = ({ popup, onOpenChange, isMobile }) => {
    const { t } = useI18n();
    const defaultDiffViewMode = useDefaultDiffViewMode();
    const [diffViewMode, setDiffViewMode] = React.useState<DiffViewMode>(defaultDiffViewMode);
    const pierreThemeConfig = usePierreThemeConfig();
    const popupToolName = typeof popup.metadata?.tool === 'string' ? popup.metadata.tool : null;
    const popupToolPresentation = useGuestToolPresentation(popupToolName);

    React.useEffect(() => {
        if (!popup.open) return;
        setDiffViewMode(defaultDiffViewMode);
    }, [defaultDiffViewMode, popup.open, popup.title]);

    if (popup.image) {
        return <ImagePreviewDialog popup={popup} onOpenChange={onOpenChange} isMobile={isMobile} />;
    }

    if (popup.mermaid) {
        return <MermaidPreviewDialog popup={popup} onOpenChange={onOpenChange} isMobile={isMobile} />;
    }

    return (
        <Dialog open={popup.open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'overflow-hidden flex flex-col min-h-0 pt-3 pb-4 px-4 gap-1',
                    '[&>button]:top-1.5',
                    isMobile ? 'w-[95vw] max-w-[95vw]' : 'max-w-5xl',
                    isMobile ? '[&>button]:inset-e-1' : '[&>button]:top-2.5 [&>button]:inset-e-4'
                )}
                style={{ maxHeight: '90vh' }}
            >
                <div className="flex-shrink-0 pb-1">
                    <div className="flex items-start gap-2 text-foreground typography-ui-header font-semibold">
                        {popupToolName ? getToolIcon(popupToolName, popupToolPresentation) : (
                            <Icon name="tools" className="h-3.5 w-3.5 text-foreground flex-shrink-0" />
                        )}
                        <span className="break-words flex-1 leading-tight">{popup.title}</span>
                        {popup.isDiff && (
                            <DiffViewToggle
                                mode={diffViewMode}
                                onModeChange={setDiffViewMode}
                                className="me-8 flex-shrink-0"
                            />
                        )}
                    </div>
                </div>
                <div className="flex-1 min-h-0 rounded-xl border border-border/30 bg-muted/10 overflow-hidden">
                    <div className="tool-output-surface h-full max-h-[75vh] overflow-y-auto px-3 pe-4">
                        {popup.metadata?.input && typeof popup.metadata.input === 'object' &&
                            Object.keys(popup.metadata.input).length > 0 &&
                            popup.metadata?.tool !== 'patch' ? (() => {
                                const meta = popup.metadata!;
                                const metaTool = typeof meta.tool === 'string' ? meta.tool : undefined;
                                const input = meta.input as Record<string, unknown>;

                                const getInputValue = (key: string): string | null => {
                                  const val = input[key];
                                  return typeof val === 'string' ? val : (typeof val === 'number' ? String(val) : null);
                                };
                                // v2 file tools report `path`.
                                const writeTarget = getInputValue('path') || getInputValue('filePath') || getInputValue('file_path') || '';
                                return (
                                <div className="border-b border-border/20 p-4 -mx-3">
                                    <div className="typography-markdown font-medium text-muted-foreground mb-2 px-3">
                                        {isShellTool(metaTool)
                                            ? 'Command:'
                                            : isSubagentTool(metaTool)
                                                ? 'Subagent Details:'
                                                : 'Input:'}
                                    </div>
                                    {isShellTool(metaTool) && getInputValue('command') ? (
                                        <div className="tool-input-surface bg-transparent rounded-xl border border-border/20 mx-3">
                                            <WorkerHighlightedCode
                                                language="bash"
                                                code={getInputValue('command')!}
                                                style={toolDisplayStyles.getPopupStyles()}
                                                codeStyle={DIALOG_CODE_TAG_PROPS.style}
                                                wrap
                                            />
                                        </div>
                                    ) : isSubagentTool(metaTool) && getInputValue('prompt') ? (
                                        <div
                                            className="tool-input-surface bg-transparent rounded-xl border border-border/20 font-mono whitespace-pre-wrap text-foreground/90 mx-3"
                                            style={toolDisplayStyles.getPopupStyles()}
                                        >
                                            {getInputValue('description') ? `Task: ${getInputValue('description')}\n` : ''}
                                            {getInputValue('agent') ? `Agent: ${getInputValue('agent')}\n` : ''}
                                            {`Instructions:\n${getInputValue('prompt')}`}
                                        </div>
                                    ) : isWriteTool(metaTool) && getInputValue('content') ? (
                                        <div className="tool-input-surface bg-transparent rounded-xl border border-border/20 mx-3">
                                            <PierreFile
                                                file={{
                                                    name: writeTarget || 'new-file',
                                                    contents: getInputValue('content')!,
                                                    lang: getLanguageFromExtension(writeTarget) || undefined,
                                                }}
                                                options={{
                                                    disableFileHeader: true,
                                                    overflow: 'wrap',
                                                    theme: pierreThemeConfig.theme,
                                                    themeType: pierreThemeConfig.themeType,
                                                }}
                                                className="block w-full"
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            className="tool-input-surface bg-transparent rounded-xl border border-border/20 font-mono whitespace-pre-wrap text-foreground/90 mx-3"
                                            style={toolDisplayStyles.getPopupStyles()}
                                        >
                                            {formatInputForDisplay(input, meta.tool as string)}
                                        </div>
                                    )}
                                </div>
                            );
                            })() : null}

                        {popup.isDiff ? (
                            <DialogUnifiedDiff
                                popup={popup}
                                diffViewMode={diffViewMode}
                                pierreThemeConfig={pierreThemeConfig}
                            />
                        ) : popup.content ? (
                        <div className="p-4">
                            {(() => {
                                const tool = typeof popup.metadata?.tool === 'string' ? popup.metadata.tool : undefined;

                                if (tool === 'grep') {
                                    return (
                                        renderGrepOutput(popup.content, isMobile) || (
                                            <pre className="typography-code bg-muted/30 p-2 rounded-xl border border-border/20 font-mono whitespace-pre-wrap">
                                                {popup.content}
                                            </pre>
                                        )
                                    );
                                }

                                if (tool === 'glob') {
                                    return (
                                        renderGlobOutput(popup.content, isMobile) || (
                                            <pre className="typography-code bg-muted/30 p-2 rounded-xl border border-border/20 font-mono whitespace-pre-wrap">
                                                {popup.content}
                                            </pre>
                                        )
                                    );
                                }

                                if (isSubagentTool(tool) || tool === 'reasoning') {
                                    return (
                                        <div className={tool === 'reasoning' ? "text-muted-foreground/70" : ""}>
                                            <SimpleMarkdownRenderer content={popup.content} variant="tool" />
                                        </div>
                                    );
                                }

                                if (tool === 'web-search' || tool === 'websearch' || tool === 'search_web') {
                                    return (
                                        renderWebSearchOutput(popup.content) || (
                                            <WorkerHighlightedCode
                                                language="text"
                                                code={popup.content}
                                                style={toolDisplayStyles.getPopupContainerStyles()}
                                                codeStyle={DIALOG_CODE_TAG_PROPS.style}
                                                wrap
                                            />
                                        )
                                    );
                                }

                                if (tool === 'read') {
                                    return <DialogReadContent popup={popup} pierreThemeConfig={pierreThemeConfig} />;
                                }

                                // JSON tree viewer for generic JSON outputs
                                const jsonResult = popup.content ? tryParseJsonOutput(popup.content) : { data: null, isJson: false };
                                if (jsonResult.isJson) {
                                    return (
                                        <JsonTreeView
                                            jsonString={popup.content}
                                            initiallyExpandedDepth={3}
                                            maxHeight="70vh"
                                        />
                                    );
                                }

                                return (
                                    <WorkerHighlightedCode
                                        language={popup.language || 'text'}
                                        code={popup.content}
                                        style={toolDisplayStyles.getPopupContainerStyles()}
                                        codeStyle={DIALOG_CODE_TAG_PROPS.style}
                                        wrap
                                    />
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="p-8 text-muted-foreground typography-ui-header">
                            <div className="mb-2">{t('chat.toolOutputDialog.commandCompleted')}</div>
                            <div className="typography-meta">{t('chat.toolOutputDialog.noOutputProduced')}</div>
                        </div>
                    )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// Mounted by every chat message, which re-renders on each streamed chunk
// while the popup state and handlers stay the same.
export default React.memo(ToolOutputDialog);
