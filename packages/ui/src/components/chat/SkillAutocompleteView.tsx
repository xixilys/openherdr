import React from 'react';
import { AnimatePresence } from 'motion/react';
import { GlassPopupMotion } from './composer/ui/GlassPopupMotion';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { AutocompleteRowTooltip } from './composer/ui/AutocompleteRowTooltip';
import { rankSkillAutocompleteItems } from './skillAutocompleteItems';

export interface SkillInfo {
  id?: string;
  name: string;
  scope?: string;
  source?: string;
  description?: string;
}

export interface SkillAutocompleteHandle {
  handleKeyDown: (key: string) => void;
}

interface SkillAutocompleteViewProps {
  skills: readonly SkillInfo[];
  isMobile: boolean;
  status?: React.ReactNode;
  searchQuery: string;
  onSkillSelect: (skillName: string) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const SkillAutocompleteView = React.forwardRef<SkillAutocompleteHandle, SkillAutocompleteViewProps>(({
  skills, isMobile, status, searchQuery,
  onSkillSelect,
  onClose,
  style,
}, ref) => {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mobileMaxHeight = useMobileAutocompleteMaxHeight(containerRef, true, 240);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const filteredSkills = React.useMemo(() => rankSkillAutocompleteItems(skills, searchQuery), [skills, searchQuery]);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const ignoreClickRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  React.useEffect(() => { setSelectedIndex(0); }, [filteredSkills]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (!filteredSkills.length) {
        return;
      }

      if (key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % filteredSkills.length);
        return;
      }

      if (key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndexRef.current % filteredSkills.length) + filteredSkills.length) % filteredSkills.length;
        const skill = filteredSkills[safeIndex];
        if (skill) {
          onSkillSelect(skill.name);
        }
      }
    },
  }), [filteredSkills, onSkillSelect, onClose]);

  const renderSkill = (skill: SkillInfo, index: number) => {
    const isProject = skill.scope === 'project';
    return (
      <AutocompleteRowTooltip key={skill.id ?? `${skill.name}-${skill.scope ?? ''}`} description={skill.description} active={!isMobile && index === selectedIndex}>
      <div
        ref={(el) => {
          itemRefs.current[index] = el;
        }}
        className={cn(
          'flex gap-2 px-3 py-1.5 cursor-pointer rounded-lg typography-ui-label',
          isMobile ? 'items-center' : 'items-start',
          index === selectedIndex && 'bg-interactive-selection'
        )}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return;
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
          pointerMovedRef.current = false;
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'touch' || !pointerStartRef.current) return;
          if (Math.hypot(event.clientX - pointerStartRef.current.x, event.clientY - pointerStartRef.current.y) > 6) pointerMovedRef.current = true;
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== 'touch') return;
          const moved = pointerMovedRef.current;
          pointerStartRef.current = null;
          pointerMovedRef.current = false;
          if (moved) return;
          event.preventDefault(); event.stopPropagation();
          ignoreClickRef.current = true;
          onSkillSelect(skill.name);
        }}
        onPointerCancel={() => { pointerStartRef.current = null; pointerMovedRef.current = false; }}
        onClick={() => {
          if (ignoreClickRef.current) { ignoreClickRef.current = false; return; }
          onSkillSelect(skill.name);
        }}
        onMouseMove={() => {
          setSelectedIndex(index);
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{skill.name}</span>
            {skill.scope ? <span className={cn(
              "text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0 transition-colors",
              isProject
                ? "bg-[var(--status-info-background)] text-[var(--status-info)] border-[var(--status-info-border)]"
                : "bg-[var(--status-success-background)] text-[var(--status-success)] border-[var(--status-success-border)]"
            )}>
              {skill.scope}
            </span> : null}
            {skill.source ? <span className="text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0 bg-[var(--surface-muted)] text-muted-foreground border-[var(--interactive-border)]/60">
              {skill.source}
            </span> : null}
          </div>
        </div>
      </div>
      </AutocompleteRowTooltip>
    );
  };

  return (
    <div
      ref={containerRef}
      data-skill-autocomplete="true"
      className="absolute z-[100] min-w-0 w-full max-w-[450px] max-h-60 oc-glass-popover border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 inset-s-0 flex flex-col"
      style={mobileMaxHeight !== undefined ? { ...style, maxHeight: mobileMaxHeight } : style}
    >
      <ScrollableOverlay preventOverscroll outerClassName="flex-1 min-h-0" className="px-0 pb-2">
        {status ?? (filteredSkills.length ? (
          <div>
            {filteredSkills.map((skill, index) => renderSkill(skill, index))}
          </div>
        ) : (
          <div className="px-3 py-2 typography-ui-label text-muted-foreground">
            {t('chat.skillAutocomplete.empty')}
          </div>
        ))}
      </ScrollableOverlay>
      {!isMobile && (
        <div className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
          {t('chat.autocomplete.keyboardHint')}
        </div>
      )}
    </div>
  );
});

SkillAutocompleteView.displayName = 'SkillAutocompleteView';

export const SkillAutocompletePopupView = React.forwardRef<SkillAutocompleteHandle, SkillAutocompleteViewProps & { open: boolean }>(({ open, ...props }, ref) =>
  <AnimatePresence>{open ? <GlassPopupMotion className="absolute inset-x-0 top-0 z-[100] h-0 origin-top-left rtl:origin-top-right">
    <SkillAutocompleteView ref={ref} {...props} />
  </GlassPopupMotion> : null}</AnimatePresence>);
SkillAutocompletePopupView.displayName = 'SkillAutocompletePopupView';
