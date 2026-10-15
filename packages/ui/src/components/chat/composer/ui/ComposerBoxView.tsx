import React from 'react';
import { cn } from '@/lib/utils';

type ComposerBoxViewProps = {
    children: React.ReactNode;
    radius: React.CSSProperties['borderRadius'];
    expanded?: boolean;
    boxRef?: React.Ref<HTMLDivElement>;
    boxProps?: React.ComponentPropsWithoutRef<'div'> & { 'data-composer-box'?: string; 'data-dictating'?: string };
};

/** The original editor's shadow and opaque box, shared by source controllers. */
export function ComposerBoxView({ children, radius, expanded, boxRef, boxProps }: ComposerBoxViewProps) {
    const { className, style, ...attributes } = boxProps ?? {};
    return <div
        className={cn('flex flex-col', expanded && 'flex-1 min-h-0', 'shadow-[0_4px_16px_-4px_rgb(0_0_0_/_0.12)]')}
        style={{ borderRadius: radius }}
    ><div
        {...attributes}
        ref={boxRef}
        className={cn('flex flex-col relative overflow-visible', expanded && 'flex-1 min-h-0', 'border border-border/80', 'oc-surface-floating', className)}
        style={{ borderRadius: radius, ...style }}
    >{children}</div></div>;
}
