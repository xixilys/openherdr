import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHerdrPreferences } from './preferences.js';

const fixture = async testContext => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-preferences-'));
  const preferences = createHerdrPreferences({ stateDir });
  testContext.after(async () => { await preferences.close(); await fs.chmod(stateDir, 0o700); await fs.rm(stateDir, { recursive: true, force: true }); });
  return { stateDir, preferences };
};
const read = (preferences, surface = 'mobile') => preferences.read({ operation: 'read', surface });
const update = (preferences, expectedRevision, changes, surface = 'mobile') => preferences.update({ operation: 'update', surface, expectedRevision, changes });

test('missing preferences remain missing, with original profile and per-surface scopes', async t => {
  const { preferences, stateDir } = await fixture(t);
  assert.deepEqual(await read(preferences), { version: 1, revision: 0, surface: 'mobile', values: {} });
  await update(preferences, 0, { uiFont: 'inter', monoFont: 'fira-code', fontSize: 125, useSystemTheme: true, expandReasoningWhileStreaming: true });
  assert.deepEqual((await read(preferences, 'web')).values, { uiFont: 'inter', monoFont: 'fira-code', expandReasoningWhileStreaming: true });
  await update(preferences, 1, { fontSize: 90, themeId: 'openchamber-dark', enterToSend: true, enterToSendConfigured: true }, 'web');
  assert.equal((await read(preferences)).values.fontSize, 125);
  assert.equal((await read(preferences)).values.enterToSend, true);
  assert.equal((await fs.stat(path.join(stateDir, 'preferences.json'))).mode & 0o777, 0o600);
  const restarted = createHerdrPreferences({ stateDir });
  assert.deepEqual(await read(restarted), await read(preferences));
  await restarted.close();
});

test('selected field scopes match the original generated registry', async t => {
  const { preferences } = await fixture(t);
  const { fields } = JSON.parse(await fs.readFile(new URL('../lib/opencode/settings-registry.json', import.meta.url), 'utf8'));
  const shared = { uiFont: 'system', monoFont: 'system-mono', enterToSend: false, enterToSendConfigured: true, expandReasoningWhileStreaming: false };
  const scoped = { fontSize: 100, themeId: 'openchamber-light', lightThemeId: 'openchamber-light', darkThemeId: 'openchamber-dark', useSystemTheme: false };
  for (const key of Object.keys(shared)) assert.deepEqual(fields[key], { scope: 'profile' });
  for (const key of Object.keys(scoped)) assert.deepEqual(fields[key], { scope: 'profile', perSurface: true });
  await update(preferences, 0, { ...shared, ...scoped });
  assert.deepEqual((await read(preferences, 'desktop')).values, shared);
});

test('strict requests reject unknown, device, provider, path, and malformed fields', async t => {
  const { preferences } = await fixture(t);
  for (const changes of [{ token: 'secret' }, { provider: {} }, { mobileKeyboardMode: 'native' }, { path: '/tmp/elsewhere' }, { fontSize: '100' }, { uiFont: 'custom' }, { enterToSend: 1 }, {}]) {
    assert.throws(() => update(preferences, 0, changes), { code: 'invalid_preferences' });
  }
  assert.throws(() => preferences.read({ operation: 'read', surface: 'phone' }), { code: 'invalid_preferences' });
  assert.throws(() => preferences.read({ operation: 'read', surface: 'mobile', path: '/tmp/elsewhere' }), { code: 'invalid_preferences' });
  assert.deepEqual((await read(preferences)).values, {});
  assert.equal((await update(preferences, 0, { fontSize: 900 })).values.fontSize, 200);
});

test('concurrent updates preserve the first write and reject the stale revision', async t => {
  const { preferences } = await fixture(t);
  const results = await Promise.allSettled([update(preferences, 0, { uiFont: 'inter' }), update(preferences, 0, { monoFont: 'fira-code' })]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'preferences_conflict');
  const current = await read(preferences);
  assert.equal(current.revision, 1);
  assert.deepEqual(current.values, { uiFont: 'inter' });
  await update(preferences, current.revision, { monoFont: 'fira-code' });
  assert.deepEqual((await read(preferences)).values, { uiFont: 'inter', monoFont: 'fira-code' });
});

test('malformed and symlink files are failures and remain untouched', async t => {
  const { preferences, stateDir } = await fixture(t);
  const file = path.join(stateDir, 'preferences.json');
  await fs.writeFile(file, '{broken', { mode: 0o600 });
  await assert.rejects(read(preferences), { code: 'preferences_storage' });
  await assert.rejects(update(preferences, 0, { uiFont: 'inter' }), { code: 'preferences_storage' });
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  const other = path.join(stateDir, 'unrelated');
  await fs.writeFile(other, 'keep');
  await fs.rm(file);
  await fs.symlink(other, file);
  await assert.rejects(update(preferences, 0, { uiFont: 'inter' }), { code: 'preferences_storage' });
  assert.equal(await fs.readFile(other, 'utf8'), 'keep');
  assert.equal((await fs.lstat(file)).isSymbolicLink(), true);
});

test('a failed atomic write keeps the last persisted revision and later operations recover', async t => {
  const { preferences, stateDir } = await fixture(t);
  await update(preferences, 0, { uiFont: 'inter' });
  const file = path.join(stateDir, 'preferences.json');
  const before = await fs.readFile(file, 'utf8');
  await fs.chmod(stateDir, 0o500);
  try { await assert.rejects(update(preferences, 1, { uiFont: 'roboto' }), { code: 'preferences_storage' }); }
  finally { await fs.chmod(stateDir, 0o700); }
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal((await read(preferences)).revision, 1);
  await update(preferences, 1, { uiFont: 'roboto' });
  assert.equal((await read(preferences)).values.uiFont, 'roboto');
});

test('close drains an accepted save and refuses later work', async t => {
  const { preferences } = await fixture(t);
  const saving = update(preferences, 0, { uiFont: 'inter' });
  await preferences.close();
  assert.equal((await saving).revision, 1);
  await assert.rejects(read(preferences), { code: 'preferences_closed' });
});
