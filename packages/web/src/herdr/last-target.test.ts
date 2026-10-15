import { expect, test } from 'bun:test';
import { clearLastTarget, matchesLastTarget, readLastTarget, rememberLastTarget, type LastTarget } from './last-target';
import { snapshotSchema } from './transport';

const server = 'https://last-target.test';
const target: LastTarget = { machine: 'kansas', workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2', terminalId: 'terminal-original' };
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const snapshot = () => snapshotSchema.parse({ type: 'session_snapshot', snapshot: {
  version: '0.9.3', protocol: 22,
  workspaces: [{ workspace_id: 'w2', label: 'Operations', focused: true, active_tab_id: 'w2:t2', agent_status: 'working', pane_count: 1, tab_count: 1 }],
  tabs: [{ tab_id: 'w2:t2', workspace_id: 'w2', label: 'Workers', focused: true, agent_status: 'working', pane_count: 1 }],
  panes: [{ pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', terminal_id: 'terminal-original', focused: true, revision: 7, agent_status: 'unknown' }], agents: [],
} }).snapshot;

test('the origin-scoped cache round-trips only complete navigation metadata and keeps other origins separate', () => {
  const storage = memoryStorage();
  expect(rememberLastTarget(`${server}/`, target, storage)).toBe(true);
  expect(readLastTarget(server, storage)).toEqual(target);
  expect(readLastTarget('https://other-last-target.test', storage)).toBeNull();
  expect([...storage.values.keys()]).toEqual([`openherdr.last-target.v1:${server}`]);
  expect(JSON.parse(storage.values.get(`openherdr.last-target.v1:${server}`) ?? 'null')).toEqual({ version: 1, target });
  expect(rememberLastTarget('https://other-last-target.test', { ...target, terminalId: 'other-occupant' }, storage)).toBe(true);
  expect(clearLastTarget(server, storage)).toBe(true);
  expect(readLastTarget(server, storage)).toBeNull();
  expect(readLastTarget('https://other-last-target.test', storage)?.terminalId).toBe('other-occupant');
});

test('malformed, oversized, unsupported and incomplete stored values are unusable hints', () => {
  const storage = memoryStorage();
  const invalid = [
    '{broken', 'null', JSON.stringify({ version: 2, target }),
    JSON.stringify({ version: 1, target: { ...target, paneId: '' } }),
    JSON.stringify({ version: 1, target: { ...target, machine: 'x'.repeat(257) } }),
    JSON.stringify({ version: 1, target: { machine: 'kansas', workspaceId: 'w2', tabId: 'w2:t2', paneId: 'w2:p2' } }),
    JSON.stringify({ version: 1, target, token: 'must-not-be-navigation-data' }),
    ' '.repeat(8193),
  ];
  for (const raw of invalid) {
    storage.values.set(`openherdr.last-target.v1:${server}`, raw);
    expect(readLastTarget(server, storage)).toBeNull();
  }
  expect(readLastTarget('https://last-target.test/private', storage)).toBeNull();
});

test('blocked storage and invalid writes never break navigation or replace a good hint', () => {
  const storage = memoryStorage();
  rememberLastTarget(server, target, storage);
  const previous = storage.values.get(`openherdr.last-target.v1:${server}`);
  expect(rememberLastTarget(server, { ...target, terminalId: '' }, storage)).toBe(false);
  expect(storage.values.get(`openherdr.last-target.v1:${server}`)).toBe(previous);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  expect(readLastTarget(server, blocked)).toBeNull();
  expect(rememberLastTarget(server, target, blocked)).toBe(false);
  expect(clearLastTarget(server, blocked)).toBe(false);
  expect(rememberLastTarget('not an origin', target, storage)).toBe(false);
  expect(storage.values.get(`openherdr.last-target.v1:${server}`)).toBe(previous);
});

test('fresh snapshot confirmation requires the same machine, full ancestry and terminal occupant', () => {
  expect(matchesLastTarget(target, 'kansas', snapshot())).toBe(true);
  expect(matchesLastTarget(target, 'local', snapshot())).toBe(false);
  const missingWorkspace = snapshot(); missingWorkspace.workspaces = [];
  expect(matchesLastTarget(target, 'kansas', missingWorkspace)).toBe(false);
  const missingTab = snapshot(); missingTab.tabs = [];
  expect(matchesLastTarget(target, 'kansas', missingTab)).toBe(false);
  const missingPane = snapshot(); missingPane.panes = [];
  expect(matchesLastTarget(target, 'kansas', missingPane)).toBe(false);
  const movedTab = snapshot(); movedTab.tabs[0].workspace_id = 'w1';
  expect(matchesLastTarget(target, 'kansas', movedTab)).toBe(false);
  const movedPane = snapshot(); movedPane.panes[0].tab_id = 'w2:t1';
  expect(matchesLastTarget(target, 'kansas', movedPane)).toBe(false);
  const wrongParent = snapshot(); wrongParent.panes[0].workspace_id = 'w1';
  expect(matchesLastTarget(target, 'kansas', wrongParent)).toBe(false);
  const replacement = snapshot(); replacement.panes[0].terminal_id = 'replacement-terminal';
  expect(matchesLastTarget(target, 'kansas', replacement)).toBe(false);
});
