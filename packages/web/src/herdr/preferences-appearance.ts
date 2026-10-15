import { CODE_FONT_OPTION_MAP, DEFAULT_MONO_FONT, DEFAULT_UI_FONT, UI_FONT_OPTION_MAP } from '@/lib/fontOptions';
import { loadMonoFont, loadUiFont } from '@/lib/fontLoader';
import { CSSVariableGenerator } from '@/lib/theme/cssGenerator';
import { getDefaultTheme, getThemeById } from '@/lib/theme/themes';
import type { ResolvedHerdrPreferences } from './preferences-client';

export function resolveHerdrTheme(values: ResolvedHerdrPreferences, prefersDark: boolean) {
  const mode = values.useSystemTheme ? (prefersDark ? 'dark' : 'light') : getThemeById(values.themeId)?.metadata.variant ?? 'light';
  const selectedId = values.useSystemTheme ? mode === 'dark' ? values.darkThemeId : values.lightThemeId : values.themeId;
  const selected = getThemeById(selectedId);
  return selected?.metadata.variant === mode ? selected : getDefaultTheme(mode === 'dark');
}

/** Uses the original theme generator and font stacks without global settings stores. */
export function applyHerdrPreferencesAppearance(values: ResolvedHerdrPreferences, options: { prefersDark: boolean; allowRemoteFonts: boolean }) {
  const theme = resolveHerdrTheme(values, options.prefersDark);
  new CSSVariableGenerator().apply(theme);
  const uiChoice = UI_FONT_OPTION_MAP[values.uiFont];
  const monoChoice = CODE_FONT_OPTION_MAP[values.monoFont];
  const uiFont = uiChoice && (options.allowRemoteFonts || !uiChoice.source) ? values.uiFont : DEFAULT_UI_FONT;
  const monoFont = monoChoice && (options.allowRemoteFonts || !monoChoice.source) ? values.monoFont : DEFAULT_MONO_FONT;
  const root = document.documentElement;
  const sans = UI_FONT_OPTION_MAP[uiFont].stack;
  const mono = CODE_FONT_OPTION_MAP[monoFont].stack;
  root.style.setProperty('--font-family-sans', sans);
  root.style.setProperty('--font-family-mono', mono);
  root.style.setProperty('--font-sans', sans);
  root.style.setProperty('--font-mono', mono);
  if (values.fontSize === 100) root.style.removeProperty('font-size');
  else root.style.fontSize = `${values.fontSize}%`;
  if (options.allowRemoteFonts) { void loadUiFont(uiFont); void loadMonoFont(monoFont); }
  return theme;
}
