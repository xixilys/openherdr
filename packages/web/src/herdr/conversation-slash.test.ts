import { expect, test } from 'bun:test';
import { classifyConversationInput, TooManyConversationSkillsError } from './conversation-slash';

const signal = () => new AbortController().signal;

test('ordinary text and dollar characters outside the original token grammar read no native registry', async () => {
  const registry = { commands: async () => { throw new Error('Unexpected commands read'); }, skills: async () => { throw new Error('Unexpected skills read'); } };
  for (const text of ['ordinary text', 'Price is $', 'inline$reference', ' $ ']) {
    expect(await classifyConversationInput(text, registry, signal())).toEqual({ kind: 'prompt' });
  }
});

test('inline names follow the shared exact-case scanner and use first-occurrence native IDs', async () => {
  let reads = 0;
  const registry = { commands: async () => { throw new Error('Unexpected commands read'); }, skills: async () => {
    reads++;
    return [{ id: 'folder-two', name: 'two' }, { id: 'folder-one', name: 'My_One' }, { id: 'folder-two', name: 'alias' }];
  } };
  expect(await classifyConversationInput('$My_One $two $my_one $alias $My_One foo$two', registry, signal())).toEqual({
    kind: 'prompt', skills: [{ id: 'folder-one' }, { id: 'folder-two' }],
  });
  expect(reads).toBe(1);
});

test('ten unique IDs are accepted and aliases do not consume another limit slot', async () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ id: `folder-${index}`, name: `skill${index}` }));
  const skills = [...entries, { id: 'folder-0', name: 'alias' }];
  const registry = { commands: async () => [], skills: async () => skills };
  expect((await classifyConversationInput(skills.map(skill => `$${skill.name}`).join(' '), registry, signal())).skills).toHaveLength(10);
  skills.push({ id: 'folder-11', name: 'eleventh' });
  await expect(classifyConversationInput(skills.map(skill => `$${skill.name}`).join(' '), registry, signal())).rejects.toBeInstanceOf(TooManyConversationSkillsError);
});

test('an aborted slash lookup cannot continue into the inline skills registry', async () => {
  const controller = new AbortController(); let skillReads = 0;
  const registry = { commands: async () => { controller.abort(); return [{ name: 'verify' }]; }, skills: async () => { skillReads++; return [{ id: 'folder-audit', name: 'audit' }]; } };
  await expect(classifyConversationInput('/verify $audit', registry, controller.signal)).rejects.toThrow();
  expect(skillReads).toBe(0);
});
