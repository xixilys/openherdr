import { expect, test } from 'bun:test';
import { resolveHerdrTheme } from './preferences-appearance';
import { resolveHerdrPreferences } from './preferences-client';

test('system appearance chooses its configured variant and explicit mode keeps the chosen theme', () => {
  const system = resolveHerdrPreferences({ lightThemeId: 'flexoki-light', darkThemeId: 'flexoki-dark' });
  expect(resolveHerdrTheme(system, false).metadata.id).toBe('flexoki-light');
  expect(resolveHerdrTheme(system, true).metadata.id).toBe('flexoki-dark');
  const manual = resolveHerdrPreferences({ useSystemTheme: false, themeId: 'flexoki-dark' });
  expect(resolveHerdrTheme(manual, false).metadata.id).toBe('flexoki-dark');
  expect(resolveHerdrTheme(resolveHerdrPreferences({ useSystemTheme: false, themeId: 'unavailable-theme' }), true).metadata.id).toBe('openchamber-light');
});

