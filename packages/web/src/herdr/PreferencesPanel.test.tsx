import React from 'react';
import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { PreferencesPanel } from './PreferencesPanel';
import { HerdrPreferencesController, type PreferencesSnapshot, type PreferenceSurface } from './preferences-client';

const snapshot = (surface: PreferenceSurface): PreferencesSnapshot => ({ version: 1, revision: 0, surface, values: {} });

for (const surface of ['mobile', 'web'] as const) {
  test(`${surface} preferences use the original settings controls without OpenCode providers`, async () => {
    const controller = new HerdrPreferencesController({ read: async () => snapshot(surface), update: async () => { throw new Error('Server rendering cannot save preferences'); } });
    await controller.refresh();
    const html = renderToString(<I18nProvider><PreferencesPanel model={{ controller, surface, state: controller.getSnapshot() }} allowRemoteFonts={false} /></I18nProvider>);
    expect(html.includes('data-settings-item="appearance.light-theme"')).toBe(true);
    expect(html.includes('data-settings-item="appearance.font-size"')).toBe(true);
    expect(html.includes('data-settings-item="chat.expand-reasoning-while-streaming"')).toBe(true);
    expect(html.includes('data-settings-item="chat.enter-to-send"')).toBe(surface === 'web');
  });
}
