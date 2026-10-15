import React from 'react';
import { usePreviewOverlayState, usePreviewViewport } from './imagePreviewHooks';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isInsideOpenPopup, isTopmostBackLayer, registerBackLayer } from '@/lib/mobileBackLayers';

/** The source adapter owns URL safety, authentication and lifetime. */
interface PreviewImage {
    url: string;
    filename?: string;
    mimeType?: string;
    size?: number;
}

export const ImagePreviewView: React.FC<{
    open: boolean;
    images: readonly PreviewImage[];
    initialIndex?: number;
    title: string;
    onOpenChange: (open: boolean) => void;
    isMobile: boolean;
}> = ({ open, images: gallery, initialIndex, title, onOpenChange, isMobile }) => {
    const { t, direction } = useI18n();
    const initialImageUrl = gallery[initialIndex ?? 0]?.url ?? gallery[0]?.url;
    const [selectedImageUrl, setSelectedImageUrl] = React.useState(initialImageUrl);
    const currentIndex = Math.max(0, gallery.findIndex((image) => image.url === selectedImageUrl));
    const onCloseRef = React.useRef(onOpenChange);
    React.useLayoutEffect(() => { onCloseRef.current = onOpenChange; }, [onOpenChange]);
    const closeLayer = React.useCallback(() => onCloseRef.current(false), []);
    const hasImages = gallery.length > 0;
    React.useEffect(() => {
        if (!open || !hasImages) return;
        return registerBackLayer(closeLayer);
    }, [open, hasImages, closeLayer]);
    const [imageNaturalSize, setImageNaturalSize] = React.useState<{ url: string; width: number; height: number } | null>(null);
    const { isRendered, isVisible, isTransitioning } = usePreviewOverlayState(open);
    const viewport = usePreviewViewport(open);

    React.useEffect(() => {
        if (open) setSelectedImageUrl(initialImageUrl);
    }, [initialImageUrl, open]);

    const currentImage = gallery[currentIndex] ?? gallery[0];
    const imageTitle = currentImage?.filename || title;
    const hasMultipleImages = gallery.length > 1;

    const showPrevious = React.useCallback(() => {
        if (gallery.length <= 1) return;
        setSelectedImageUrl((previous) => {
            const index = Math.max(0, gallery.findIndex((image) => image.url === previous));
            return gallery[(index - 1 + gallery.length) % gallery.length]?.url;
        });
    }, [gallery]);

    const showNext = React.useCallback(() => {
        if (gallery.length <= 1) return;
        setSelectedImageUrl((previous) => {
            const index = Math.max(0, gallery.findIndex((image) => image.url === previous));
            return gallery[(index + 1) % gallery.length]?.url;
        });
    }, [gallery]);

    React.useEffect(() => {
        if (!open) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isTopmostBackLayer(closeLayer) && !isInsideOpenPopup(event.target)) {
                closeLayer();
                return;
            }

            // "Previous" sits at the start of the row: on the right in RTL.
            const previousKey = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
            const nextKey = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
            if (event.key === previousKey && hasMultipleImages) {
                event.preventDefault();
                showPrevious();
                return;
            }

            if (event.key === nextKey && hasMultipleImages) {
                event.preventDefault();
                showNext();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closeLayer, direction, hasMultipleImages, open, showNext, showPrevious]);

    // The measured size belongs to one URL. Resetting it in an effect on URL
    // change raced the load event of an already-cached image, which left the
    // viewer stuck at its maximum box with wide dead margins around the image.
    const currentImageUrl = currentImage?.url;
    const currentNaturalSize = imageNaturalSize && imageNaturalSize.url === currentImageUrl
        ? imageNaturalSize
        : null;

    const imageDisplaySize = React.useMemo(() => {
        const maxWidth = Math.max(160, viewport.width * (isMobile ? 0.86 : 0.75));
        const maxHeight = Math.max(160, viewport.height * (isMobile ? 0.72 : 0.75));

        if (!currentNaturalSize) {
            return {
                width: Math.round(maxWidth),
                height: Math.round(maxHeight),
            };
        }

        const widthScale = maxWidth / currentNaturalSize.width;
        const heightScale = maxHeight / currentNaturalSize.height;
        const scale = Math.min(widthScale, heightScale);

        return {
            width: Math.max(1, Math.round(currentNaturalSize.width * scale)),
            height: Math.max(1, Math.round(currentNaturalSize.height * scale)),
        };
    }, [currentNaturalSize, isMobile, viewport.height, viewport.width]);

    if (!isRendered || !currentImage || typeof document === 'undefined') {
        return null;
    }

    const content = (
        <div className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}>
            <div
                aria-hidden="true"
                className={cn(
                    // Same scrim as DialogOverlay, so the image viewer sits on
                    // the app the way every other dialog does.
                    'oc-glass-backdrop absolute inset-0 bg-surface-overlay/60',
                    isTransitioning && 'transition-opacity duration-150 ease-out',
                    isVisible ? 'opacity-100' : 'opacity-0'
                )}
                onMouseDown={closeLayer}
            />

            {hasMultipleImages && (
                <>
                    <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={showPrevious}
                        className="absolute inset-s-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full bg-surface-elevated/90 text-surface-elevated-foreground hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label={t('chat.toolOutputDialog.image.previousAria')}
                    >
                        <Icon name="arrow-left-s" className="h-6 w-6" />
                    </button>
                    <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={showNext}
                        className="absolute inset-e-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full bg-surface-elevated/90 text-surface-elevated-foreground hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label={t('chat.toolOutputDialog.image.nextAria')}
                    >
                        <Icon name="arrow-right-s" className="h-6 w-6" />
                    </button>
                </>
            )}

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
                    style={{ width: `${imageDisplaySize.width}px` }}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 text-foreground typography-ui-header font-semibold truncate" title={imageTitle}>
                            {imageTitle}
                        </div>
                        <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            onClick={closeLayer}
                            aria-label={t('chat.toolOutputDialog.image.closeAria')}
                        >
                            <Icon name="close" className="h-4 w-4" />
                        </button>
                    </div>

                    <img
                        src={currentImage.url}
                        alt={imageTitle}
                        className="block object-contain"
                        style={{ width: `${imageDisplaySize.width}px`, height: `${imageDisplaySize.height}px` }}
                        loading="lazy"
                        onLoad={(event) => {
                            const element = event.currentTarget;
                            const width = element.naturalWidth;
                            const height = element.naturalHeight;
                            const url = element.getAttribute('src') ?? '';
                            if (width > 0 && height > 0) {
                                setImageNaturalSize((previous) => {
                                    if (previous && previous.url === url && previous.width === width && previous.height === height) {
                                        return previous;
                                    }
                                    return { url, width, height };
                                });
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );

    return createPortal(content, document.body);
};

