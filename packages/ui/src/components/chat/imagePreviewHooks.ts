import React from 'react';

const PREVIEW_ANIMATION_MS = 150;
type ViewportSize = { width: number; height: number };

const getWindowViewport = (): ViewportSize => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
});

export const usePreviewOverlayState = (open: boolean) => {
    const [isRendered, setIsRendered] = React.useState(open);
    const [isVisible, setIsVisible] = React.useState(open);
    const [isTransitioning, setIsTransitioning] = React.useState(false);

    React.useEffect(() => {
        if (open) {
            setIsRendered(true);
            setIsTransitioning(true);
            if (typeof window === 'undefined') {
                setIsVisible(true);
                return;
            }

            const raf = window.requestAnimationFrame(() => {
                setIsVisible(true);
            });

            const doneId = window.setTimeout(() => {
                setIsTransitioning(false);
            }, PREVIEW_ANIMATION_MS);

            return () => {
                window.cancelAnimationFrame(raf);
                window.clearTimeout(doneId);
            };
        }

        setIsVisible(false);
        setIsTransitioning(true);
        if (typeof window === 'undefined') {
            setIsRendered(false);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setIsRendered(false);
            setIsTransitioning(false);
        }, PREVIEW_ANIMATION_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [open]);

    return { isRendered, isVisible, isTransitioning };
};

export const usePreviewViewport = (open: boolean) => {
    const [viewport, setViewport] = React.useState<ViewportSize>(getWindowViewport);

    React.useEffect(() => {
        if (!open || typeof window === 'undefined') {
            return;
        }

        const onResize = () => {
            setViewport(getWindowViewport());
        };

        onResize();
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
        };
    }, [open]);

    return viewport;
};

