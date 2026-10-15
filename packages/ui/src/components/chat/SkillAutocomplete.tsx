import React from 'react';
import { selectSkillsForDirectory, useSkillsStore } from '@/stores/useSkillsStore';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useUIStore } from '@/stores/useUIStore';
import { SkillAutocompleteView, type SkillAutocompleteHandle } from './SkillAutocompleteView';

export type { SkillAutocompleteHandle } from './SkillAutocompleteView';

interface SkillAutocompleteProps {
  searchQuery: string;
  onSkillSelect: (skillName: string) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

/** Original OpenCode owner; the shared view never loads a directory. */
export const SkillAutocomplete = React.forwardRef<SkillAutocompleteHandle, SkillAutocompleteProps>((props, ref) => {
  const isMobile = useUIStore((state) => state.isMobile);
  const directory = useEffectiveDirectory();
  const skills = useSkillsStore((state) => selectSkillsForDirectory(state, directory));
  const loadSkills = useSkillsStore((state) => state.loadSkills);
  React.useEffect(() => { void loadSkills(directory); }, [directory, loadSkills]);
  const rows = React.useMemo(() => skills.map((skill) => ({ ...skill, source: skill.source || 'opencode' })), [skills]);
  return <SkillAutocompleteView ref={ref} {...props} skills={rows} isMobile={isMobile} />;
});
SkillAutocomplete.displayName = 'SkillAutocomplete';
