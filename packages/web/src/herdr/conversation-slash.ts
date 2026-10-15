import type { ConversationRegistry } from '@openchamber/ui/lib/opencode/herdr-driver';
import { collectKnownTokenNames, scanPrefixTokens } from '@openchamber/ui/components/chat/composer/language/prefixTokens';

type NativeCommand = Extract<ConversationRegistry, { kind: 'commands' }>['commands'][number];
type NativeSkill = Extract<ConversationRegistry, { kind: 'skills' }>['skills'][number];
type SubmissionPlan = ({ kind: 'command'; command: string; arguments: string } | { kind: 'prompt' }) & { skills?: { id: string }[] };

export class TooManyConversationSkillsError extends Error {
  readonly max = 10;
  constructor() { super('too_many_conversation_skills'); }
}

/** Preserve slash routing while resolving inline skill names from this native directory. */
export async function classifyConversationInput(text: string, registry: {
  commands: (signal: AbortSignal) => Promise<NativeCommand[]>;
  skills: (signal: AbortSignal) => Promise<NativeSkill[]>;
}, signal: AbortSignal): Promise<SubmissionPlan> {
  let plan: SubmissionPlan = { kind: 'prompt' };
  let slashName: string | null = null;
  if (text.startsWith('/')) {
    // The original parser separates the first column using literal spaces.
    const [head, ...tail] = text.split(' ');
    slashName = head.slice(1);
    const commands = await registry.commands(signal);
    signal.throwIfAborted();
    if (commands.some((command) => command.name === slashName)) plan = { kind: 'command', command: slashName, arguments: tail.join(' ') };
  }
  const inlineTokens = scanPrefixTokens(text, '$');
  if ((plan.kind === 'command' || slashName === null) && inlineTokens.length === 0) return plan;
  const skills = await registry.skills(signal);
  signal.throwIfAborted();
  const slashSkill = plan.kind === 'prompt' && slashName !== null ? skills.find((skill) => skill.name === slashName) : undefined;
  const names = collectKnownTokenNames(text, '$', new Set(skills.map((skill) => skill.name)), 'exact');
  if (slashSkill) names.unshift(slashSkill.name);
  const ids = new Set<string>();
  for (const name of names) {
    const skill = skills.find((entry) => entry.name === name);
    if (skill) ids.add(skill.id);
  }
  if (ids.size > 10) throw new TooManyConversationSkillsError();
  return ids.size ? { ...plan, skills: [...ids].map((id) => ({ id })) } : plan;
}
