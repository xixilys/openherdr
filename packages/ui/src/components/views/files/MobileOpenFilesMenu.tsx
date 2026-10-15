import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icon/Icon';
import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function ScrollingFileName({ name }: { name: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const update = () => setOverflowing(text.scrollWidth > container.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(text);
    return () => observer.disconnect();
  }, [name]);
  return <span ref={containerRef} className="relative block min-w-0 flex-1 overflow-hidden whitespace-nowrap" dir="auto">
    <span ref={textRef} aria-hidden="true" className="invisible absolute whitespace-nowrap">{name}</span>
    {overflowing ? <span className="open-file-name-marquee-track"><span className="open-file-name-marquee-item">{name}</span><span className="open-file-name-marquee-item" aria-hidden="true">{name}</span></span> : <span className="block min-w-0 truncate">{name}</span>}
  </span>;
}

type OpenFile = { id: string; path: string; name: string; extension?: string; dirty?: boolean };

export function MobileOpenFilesMenu({ rows, activeId, open, onOpenChange, onSelect, onCloseFile, disabled = false }: {
  rows: OpenFile[];
  activeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onCloseFile: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const active = rows.find(row => row.id === activeId);
  if (!active) return null;
  return <DropdownMenu open={open && !disabled} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild><button type="button" disabled={disabled} className="inline-flex min-w-0 max-w-full items-center gap-1 text-start typography-ui-label font-medium" aria-label={t('filesView.editor.openFilesAria')}>
      <FileTypeIcon filePath={active.path} extension={active.extension} className="size-3.5 shrink-0" />
      <ScrollingFileName name={active.name} />
      {active.dirty && <span aria-label={t('filesView.unsaved.title')}>*</span>}
      <Icon name="arrow-down-s" className="size-4 shrink-0 text-muted-foreground" />
    </button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
      {rows.map(row => <DropdownMenuItem key={row.id} onSelect={event => {
        if (event.target instanceof Element && event.target.closest('[data-close-open-file]')) { event.preventDefault(); return; }
        onSelect(row.id);
      }} className={cn('flex min-w-0 items-center justify-between gap-2 overflow-hidden', row.id === activeId && 'bg-interactive-selection text-interactive-selection-foreground')}>
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><FileTypeIcon filePath={row.path} extension={row.extension} className="size-3.5 shrink-0" /><ScrollingFileName name={row.name} />{row.dirty && <span aria-label={t('filesView.unsaved.title')}>*</span>}</span>
        <button type="button" data-close-open-file onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpenChange(false); onCloseFile(row.id); }} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label={t('filesView.editor.closeFileAria', { name: row.name })}><Icon name="close" className="size-3.5" /></button>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
