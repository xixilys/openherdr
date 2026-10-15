import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsViewPresentation } from '@/components/views/SettingsViewPresentation';
import type { SettingsPageSlug, SettingsRuntimeContext } from '@/lib/settings/metadata';
import { buildSettingsSearchResults, type SettingsSearchItem } from '@/lib/settings/search-index';
import {
  SettingsSection, SettingsFieldRow, SettingsStackedField, SettingsTwoColumn,
  SettingsRadioGroup, SettingsRadioOption, SettingsCheckboxRow,
  SETTINGS_FIELDS_STACK_CLASS, SETTINGS_SELECT_ROW_TRIGGER_CLASS,
  SETTINGS_SELECT_TRIGGER_CLASS, SETTINGS_NUMBER_INPUT_CLASS, SETTINGS_NUMBER_STEPPER_ROW_CLASS, SETTINGS_NUMBER_UNIT_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { CODE_FONT_OPTIONS, UI_FONT_OPTIONS } from '@/lib/fontOptions';
import { getThemeById, themes } from '@/lib/theme/themes';
import type { ThemeMode } from '@/types/theme';
import { useHerdrText } from './herdr.i18n';
import { HERDR_PREFERENCE_KEYS, type PreferencesValues } from './preferences-client';
import type { HerdrPreferencesModel } from './useHerdrPreferences';

const PREFERENCE_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  { id: 'appearance.language', page: 'appearance', titleKey: 'settings.appearance.language.label', descriptionKey: 'settings.appearance.language.description', keywords: ['locale', 'translation', 'ui language'] },
  { id: 'appearance.light-theme', page: 'appearance', titleKey: 'settings.openchamber.visual.field.lightTheme', keywords: ['theme', 'color', 'light mode'] },
  { id: 'appearance.dark-theme', page: 'appearance', titleKey: 'settings.openchamber.visual.field.darkTheme', keywords: ['theme', 'color', 'dark mode'] },
  { id: 'appearance.interface-font', page: 'appearance', titleKey: 'settings.openchamber.visual.field.interfaceFont', keywords: ['font', 'typeface', 'ui'] },
  { id: 'appearance.code-font', page: 'appearance', titleKey: 'settings.openchamber.visual.field.codeFont', keywords: ['font', 'typeface', 'mono', 'monospace'] },
  { id: 'appearance.interface-font-size', page: 'appearance', titleKey: 'settings.openchamber.visual.field.interfaceFontSize', keywords: ['font', 'text size', 'ui scale'] },
  { id: 'chat.expand-reasoning-while-streaming', page: 'chat', titleKey: 'settings.openchamber.visual.field.expandReasoningWhileStreaming', descriptionKey: 'settings.openchamber.visual.field.expandReasoningWhileStreamingInfo', keywords: ['thinking', 'reasoning', 'expand', 'streaming'] },
];
const ENTER_SEARCH_ITEM: SettingsSearchItem = { id: 'chat.enter-to-send', page: 'chat', titleKey: 'settings.openchamber.visual.field.enterToSend', descriptionKey: 'settings.openchamber.visual.field.enterToSendHint', keywords: ['keyboard', 'enter', 'send', 'submit'] };
const PAGES: SettingsPageSlug[] = ['appearance', 'chat'];

type PreferencesPanelProps = {
  model: HerdrPreferencesModel;
  allowRemoteFonts: boolean;
  isMobile: boolean;
  onClose: () => void;
  registerBackHandler: (handler: (() => boolean) | null) => void;
};

/** Original Settings navigation with instance-owned preferences and exact search targets. */
export function PreferencesPanel({ model, allowRemoteFonts, isMobile, onClose, registerBackHandler }: PreferencesPanelProps) {
  const { t } = useI18n();
  const [page, setPage] = useState<SettingsPageSlug>('appearance');
  const runtimeCtx = useMemo<SettingsRuntimeContext>(() => ({
    isMobile, isDesktop: false, isVSCode: false, isWeb: true,
    routingAvailable: false, enterpriseMode: false, jevBlockedByEnterprise: true,
  }), [isMobile]);
  const search = useCallback((query: string, getPageTitle: (slug: SettingsPageSlug) => string) => buildSettingsSearchResults({
    query, runtimeCtx: { ...runtimeCtx, isDesktopLocalOrigin: false, isMac: false, isWindows: false, isLinux: false },
    items: model.surface === 'mobile' ? PREFERENCE_SEARCH_ITEMS : [...PREFERENCE_SEARCH_ITEMS, ENTER_SEARCH_ITEM],
    visiblePageSlugs: PAGES, t, getPageTitle,
  }), [runtimeCtx, model.surface, t]);
  return <SettingsViewPresentation page={page} onPageChange={setPage} runtimeCtx={runtimeCtx} isWindowed visiblePageSlugs={PAGES} buildSearchResults={search} onClose={onClose} registerBackHandler={registerBackHandler} renderPageContent={slug => slug === 'appearance' || slug === 'chat' ? <PreferencesPage page={slug} model={model} allowRemoteFonts={allowRemoteFonts} /> : null} />;
}

function PreferencesPage({ page, model, allowRemoteFonts }: { page: 'appearance' | 'chat'; model: HerdrPreferencesModel; allowRemoteFonts: boolean }) {
  const { t, locale, locales, setLocale, label } = useI18n();
  const h = useHerdrText();
  const { state, controller, surface } = model;
  const values = state.values;
  const disabled = state.snapshot === null;
  const mode: ThemeMode = values.useSystemTheme ? 'system' : getThemeById(values.themeId)?.metadata.variant ?? 'light';
  const setMode = (next: ThemeMode) => {
    const changes: PreferencesValues = { useSystemTheme: next === 'system' };
    if (next !== 'system') changes.themeId = next === 'dark' ? values.darkThemeId : values.lightThemeId;
    controller.change(changes);
  };
  const setTheme = (id: string, variant: 'light' | 'dark') => {
    const selected = themes.find(theme => theme.metadata.id === id && theme.metadata.variant === variant);
    if (!selected) return;
    const changes: PreferencesValues = variant === 'light' ? { lightThemeId: id } : { darkThemeId: id };
    if (mode === variant) changes.themeId = id;
    controller.change(changes);
  };
  const dirty = HERDR_PREFERENCE_KEYS.some(key => state.changes[key] !== undefined);
  return <SettingsPageLayout title={t(page === 'appearance' ? 'settings.page.appearance.title' : 'settings.page.chat.title')} showSaveStatus headerEnd={<div className="flex items-center gap-2">
    <Button size="sm" variant="ghost" disabled={state.loading || state.saving} onClick={() => void controller.refresh({ explicit: true })} aria-label={t('gitView.history.refresh')}><Icon name="refresh" className="size-4" /></Button>
    {dirty && <Button size="sm" variant="outline" disabled={state.saving || state.loading || disabled || state.failure === 'conflict'} onClick={() => void controller.save()}>{t('settings.common.actions.saveChanges')}</Button>}
  </div>}>
    {state.loading && disabled && <p className="typography-meta text-muted-foreground">{t('common.loading')}</p>}
    {state.failure && <p role="alert" className="typography-meta text-status-error">{h(state.failure === 'load' ? 'preferencesLoadError' : state.failure === 'conflict' ? 'preferencesConflict' : 'preferencesSaveError')}</p>}
    {page === 'appearance' && <>
    <SettingsSection title={t('settings.openchamber.visual.section.colorModeAndTheme')} divider={false}>
      <SettingsTwoColumn>
        <SettingsRadioGroup aria-label={t('settings.openchamber.visual.section.colorMode')}>
          <SettingsRadioOption selected={mode === 'system'} onSelect={() => setMode('system')} disabled={disabled} label={t('settings.openchamber.visual.option.themeMode.system')} ariaLabel={t('settings.openchamber.visual.option.themeMode.system')} />
          <SettingsRadioOption selected={mode === 'light'} onSelect={() => setMode('light')} disabled={disabled} label={t('settings.openchamber.visual.option.themeMode.light')} ariaLabel={t('settings.openchamber.visual.option.themeMode.light')} />
          <SettingsRadioOption selected={mode === 'dark'} onSelect={() => setMode('dark')} disabled={disabled} label={t('settings.openchamber.visual.option.themeMode.dark')} ariaLabel={t('settings.openchamber.visual.option.themeMode.dark')} />
        </SettingsRadioGroup>
        <div className={SETTINGS_FIELDS_STACK_CLASS}>
          <SettingsStackedField label={t('settings.openchamber.visual.field.lightTheme')} settingsItem="appearance.light-theme">
            <Select disabled={disabled} value={values.lightThemeId} onValueChange={id => { if (id) setTheme(id, 'light'); }}>
              <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS} aria-label={t('settings.openchamber.visual.field.selectLightThemeAria')}><SelectValue /></SelectTrigger>
              <SelectContent>{themes.filter(theme => theme.metadata.variant === 'light').map(theme => <SelectItem key={theme.metadata.id} value={theme.metadata.id}>{theme.metadata.name}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsStackedField>
          <SettingsStackedField label={t('settings.openchamber.visual.field.darkTheme')} settingsItem="appearance.dark-theme">
            <Select disabled={disabled} value={values.darkThemeId} onValueChange={id => { if (id) setTheme(id, 'dark'); }}>
              <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS} aria-label={t('settings.openchamber.visual.field.selectDarkThemeAria')}><SelectValue /></SelectTrigger>
              <SelectContent>{themes.filter(theme => theme.metadata.variant === 'dark').map(theme => <SelectItem key={theme.metadata.id} value={theme.metadata.id}>{theme.metadata.name}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsStackedField>
        </div>
      </SettingsTwoColumn>
    </SettingsSection>
    <SettingsSection title={t('settings.openchamber.visual.section.localization')}>
      <SettingsTwoColumn>
        <SettingsStackedField label={t('settings.appearance.language.label')} info={t('settings.appearance.language.description')} settingsItem="appearance.language">
          <Select value={locale} onValueChange={value => { const next = locales.find(item => item === value); if (next) setLocale(next); }}>
            <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS} aria-label={t('settings.appearance.language.select')}><SelectValue>{label(locale)}</SelectValue></SelectTrigger>
            <SelectContent>{locales.map(item => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent>
          </Select>
        </SettingsStackedField>
      </SettingsTwoColumn>
    </SettingsSection>
    <SettingsSection title={t('settings.openchamber.visual.section.densityAndType')} contentClassName={SETTINGS_FIELDS_STACK_CLASS}>
      <SettingsFieldRow label={t('settings.openchamber.visual.field.interfaceFont')} settingsItem="appearance.interface-font">
        <Select disabled={disabled} value={values.uiFont} onValueChange={id => { const option = UI_FONT_OPTIONS.find(item => item.id === id); if (option) controller.change({ uiFont: option.id }); }}>
          <SelectTrigger className={SETTINGS_SELECT_ROW_TRIGGER_CLASS} aria-label={t('settings.openchamber.visual.field.selectInterfaceFontAria')}><SelectValue /></SelectTrigger>
          <SelectContent>{UI_FONT_OPTIONS.map(option => <SelectItem key={option.id} value={option.id} disabled={!allowRemoteFonts && !!option.source}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsFieldRow>
      <SettingsFieldRow label={t('settings.openchamber.visual.field.codeFont')} settingsItem="appearance.code-font">
        <Select disabled={disabled} value={values.monoFont} onValueChange={id => { const option = CODE_FONT_OPTIONS.find(item => item.id === id); if (option) controller.change({ monoFont: option.id }); }}>
          <SelectTrigger className={SETTINGS_SELECT_ROW_TRIGGER_CLASS} aria-label={t('settings.openchamber.visual.field.selectCodeFontAria')}><SelectValue /></SelectTrigger>
          <SelectContent>{CODE_FONT_OPTIONS.map(option => <SelectItem key={option.id} value={option.id} disabled={!allowRemoteFonts && !!option.source}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsFieldRow>
      {!allowRemoteFonts && <p className="typography-meta text-muted-foreground">{t('settings.openchamber.visual.field.webFontsEnterprise')}</p>}
      <SettingsFieldRow label={t('settings.openchamber.visual.field.interfaceFontSize')} settingsItem="appearance.interface-font-size">
        <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}><NumberInput disabled={disabled} value={values.fontSize} onValueChange={fontSize => controller.change({ fontSize })} min={50} max={200} step={5} className={SETTINGS_NUMBER_INPUT_CLASS} aria-label={t('settings.openchamber.visual.field.fontSizePercentageAria')} /><span className={SETTINGS_NUMBER_UNIT_CLASS}>%</span></div>
      </SettingsFieldRow>
    </SettingsSection>
    </>}
    {page === 'chat' && <>
    <SettingsSection title={t('settings.openchamber.visual.section.reasoning')} divider={false}>
      <SettingsCheckboxRow disabled={disabled} checked={values.expandReasoningWhileStreaming} onChange={expandReasoningWhileStreaming => controller.change({ expandReasoningWhileStreaming })} label={t('settings.openchamber.visual.field.expandReasoningWhileStreaming')} ariaLabel={t('settings.openchamber.visual.field.expandReasoningWhileStreamingAria')} info={t('settings.openchamber.visual.field.expandReasoningWhileStreamingInfo')} settingsItem="chat.expand-reasoning-while-streaming" />
    </SettingsSection>
    {surface !== 'mobile' && <SettingsSection title={t('settings.openchamber.visual.section.composer')}>
      <SettingsStackedField label={t('settings.openchamber.visual.field.enterToSend')} info={t('settings.openchamber.visual.field.enterToSendHint')} settingsItem="chat.enter-to-send">
        <SettingsRadioGroup aria-label={t('settings.openchamber.visual.field.enterToSend')}>
          <SettingsRadioOption disabled={disabled} selected={!values.enterToSendConfigured || values.enterToSend} onSelect={() => controller.change({ enterToSend: true, enterToSendConfigured: true })} label={t('settings.openchamber.visual.option.enterToSend.enter.label')} ariaLabel={t('settings.openchamber.visual.option.enterToSend.enter.label')} />
          <SettingsRadioOption disabled={disabled} selected={values.enterToSendConfigured && !values.enterToSend} onSelect={() => controller.change({ enterToSend: false, enterToSendConfigured: true })} label={t('settings.openchamber.visual.option.enterToSend.modifier.label')} ariaLabel={t('settings.openchamber.visual.option.enterToSend.modifier.label')} />
        </SettingsRadioGroup>
      </SettingsStackedField>
    </SettingsSection>}
    </>}
  </SettingsPageLayout>;
}
