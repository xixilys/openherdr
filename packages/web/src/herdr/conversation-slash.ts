import type { ConversationRegistry } from '@openchamber/ui/lib/opencode/herdr-driver';

type NativeCommand = Extract<ConversationRegistry, { kind: 'commands' }>['commands'][number];
type NativeSkill = Extract<ConversationRegistry, { kind: 'skills' }>['skills'][number];
type SlashPlan = { kind: 'command'; command: string; arguments: string } | { kind: 'prompt'; skills?: { id: string }[] };

/** Match the original command parser: first column and literal space separators. */
export async function classifyConversationSlash(text: string, registry: {
  commands: (signal: AbortSignal) => Promise<NativeCommand[]>;
  skills: (signal: AbortSignal) => Promise<NativeSkill[]>;
}, signal: AbortSignal): Promise<SlashPlan> {
  if (!text.startsWith('/')) return { kind: 'prompt' };
  const [head, ...tail] = text.split(' ');
  const name = head.slice(1);
  const commands = await registry.commands(signal);
  signal.throwIfAborted();
  if (commands.some((command) => command.name === name)) return { kind: 'command', command: name, arguments: tail.join(' ') };
  const skills = await registry.skills(signal);
  signal.throwIfAborted();
  const skill = skills.find((item) => item.name === name);
  return skill ? { kind: 'prompt', skills: [{ id: skill.id }] } : { kind: 'prompt' };
}
