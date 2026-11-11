/**
 * Réglages du projet (§17.4) — écran du lot UI.
 * Mode, seuils, domaines et organisations de confiance, intégrations, formules
 * à ignorer : lecture et écriture via le résolveur (`api.ts`). Aucune logique
 * métier ici.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { modeLabel, suspicionLabel, t } from '../core/i18n';
import type { ProjectSettings, ProtectionMode, SuspicionLevel } from '../core/types';
import { getSettings, saveSettings } from './api';
import { useScreenContext } from './context';
import { splitList } from './format';
import { Banner, Form, RadioField, SelectField, Spinner, Stack, Text, TextField, ToggleField } from './kit';
import { mountScreen } from './mount';

const MODES: ProtectionMode[] = ['report', 'label', 'neutralize'];
const LEVELS: SuspicionLevel[] = ['clean', 'review', 'suspect', 'trapped'];

function TrustLists({
  settings,
  onChange,
}: {
  settings: ProjectSettings;
  onChange: (next: ProjectSettings) => void;
}): JSX.Element {
  const lang = settings.language;
  const join = (values: string[]): string => values.join(', ');
  return (
    <Stack space="space.100">
      <Text>{t(lang, 'ui.settings.listHint')}</Text>
      <TextField
        name="trustedDomains"
        label={t(lang, 'ui.settings.trustedDomains')}
        defaultValue={join(settings.trustedDomains)}
        onChange={(value) => onChange({ ...settings, trustedDomains: splitList(value) })}
      />
      <TextField
        name="trustedOrganizations"
        label={t(lang, 'ui.settings.trustedOrganizations')}
        defaultValue={join(settings.trustedOrganizations)}
        onChange={(value) => onChange({ ...settings, trustedOrganizations: splitList(value) })}
      />
      <TextField
        name="trustedIntegrations"
        label={t(lang, 'ui.settings.trustedIntegrations')}
        defaultValue={join(settings.trustedIntegrations)}
        onChange={(value) => onChange({ ...settings, trustedIntegrations: splitList(value) })}
      />
      <TextField
        name="ignoredPhrases"
        label={t(lang, 'ui.settings.ignoredPhrases')}
        defaultValue={join(settings.ignoredPhrases)}
        onChange={(value) => onChange({ ...settings, ignoredPhrases: splitList(value) })}
      />
      <TextField
        name="neutralizeOrigins"
        label={t(lang, 'ui.settings.neutralizeOrigins')}
        defaultValue={join(settings.neutralizeOrigins)}
        onChange={(value) => onChange({ ...settings, neutralizeOrigins: splitList(value) as ProjectSettings['neutralizeOrigins'] })}
      />
    </Stack>
  );
}

function SettingsForm({ settings, onChange }: { settings: ProjectSettings; onChange: (next: ProjectSettings) => void }): JSX.Element {
  const lang = settings.language;
  return (
    <Stack space="space.100">
      <RadioField
        name="mode"
        label={t(lang, 'ui.settings.mode')}
        options={MODES.map((mode) => ({ name: mode, value: mode, label: modeLabel(lang, mode) }))}
        value={settings.mode}
        onChange={(value) => onChange({ ...settings, mode: value as ProtectionMode })}
      />
      <SelectField
        name="neutralizeFrom"
        label={t(lang, 'ui.settings.neutralizeFrom')}
        options={LEVELS.map((level) => ({ value: level, label: suspicionLabel(lang, level) }))}
        value={settings.neutralizeFrom}
        onChange={(value) => onChange({ ...settings, neutralizeFrom: value as SuspicionLevel })}
      />
      <SelectField
        name="language"
        label={t(lang, 'ui.settings.language')}
        options={[
          { value: 'fr', label: 'Français' },
          { value: 'en', label: 'English' },
        ]}
        value={settings.language}
        onChange={(value) => onChange({ ...settings, language: value as ProjectSettings['language'] })}
      />
      <ToggleField
        name="c3Enabled"
        label={t(lang, 'ui.settings.c3Enabled')}
        checked={settings.c3Enabled}
        onChange={(checked) => onChange({ ...settings, c3Enabled: checked })}
      />
      <ToggleField
        name="strictOutbound"
        label={t(lang, 'ui.settings.strictOutbound')}
        checked={settings.strictOutbound}
        onChange={(checked) => onChange({ ...settings, strictOutbound: checked })}
      />
    </Stack>
  );
}

export default function ProjectSettingsScreen(): JSX.Element {
  const context = useScreenContext();
  const projectKey = context.status === 'ready' ? context.data.projectKey : '';
  const language = context.status === 'ready' ? context.data.language : 'fr';
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!projectKey) return;
    void (async () => {
      const result = await getSettings(projectKey);
      if (result.ok) setSettings(result.data);
      else setError(result.error);
    })();
  }, [projectKey]);

  const submit = useCallback(async () => {
    if (!settings) return;
    const result = await saveSettings(settings);
    if (result.ok) {
      setSettings(result.data);
      setSaved(t(settings.language, 'ui.settings.saved'));
      setError(null);
    } else {
      setSaved(null);
      setError(result.error);
    }
  }, [settings]);

  if (context.status === 'loading') return <Spinner />;
  if (context.status === 'error') return <Banner appearance="error">{context.message}</Banner>;
  if (!settings) {
    return error ? <Banner appearance="error">{error}</Banner> : <Spinner />;
  }
  return (
    <Stack space="space.200">
      <Text>{t(language, 'ui.settings.title')} — {projectKey}</Text>
      <Form submitButtonText={t(settings.language, 'ui.settings.save')} onSubmit={submit}>
        <SettingsForm settings={settings} onChange={setSettings} />
        <TrustLists settings={settings} onChange={setSettings} />
      </Form>
      {saved ? <Banner appearance="success">{saved}</Banner> : null}
      {error ? <Banner appearance="error">{error}</Banner> : null}
      <Text>{t(settings.language, 'ui.reduceRisk')}</Text>
    </Stack>
  );
}

mountScreen(<ProjectSettingsScreen />);
