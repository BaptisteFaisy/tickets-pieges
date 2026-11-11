/**
 * Résolveur des réglages du projet (§17.4, §8.1) — lot UI.
 *
 * `getSettings` : lecture, avec repli sur les réglages par défaut du domaine.
 * `saveSettings` : écriture validée — un champ inconnu ou invalide est refusé
 * avec une phrase lisible, jamais une exception.
 */
import { t } from '../core/i18n';
import { normalizeList } from '../core/trust-rules';
import { defaultSettings, normalizeDomain } from '../core/trust-rules';
import { SUSPICION_RANK, TRUST_LEVELS, type Language, type ProjectSettings, type ProtectionMode, type SuspicionLevel, type TrustLevel } from '../core/types';
import { fail, ok, payloadText, type ResolverDeps, type UiHandler } from '../ui/api';

const MODES: readonly ProtectionMode[] = ['report', 'label', 'neutralize'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? normalizeList(value.filter((item): item is string => typeof item === 'string')) : [];
}

function booleanOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Valide un objet de réglages reçu de l'écran ; `null` si invalide. */
export function parseSettings(raw: unknown, projectKey: string): ProjectSettings | null {
  if (!isRecord(raw)) return null;
  const base = defaultSettings(projectKey);
  const mode = raw['mode'];
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) return null;
  const neutralizeFrom = raw['neutralizeFrom'];
  if (typeof neutralizeFrom !== 'string' || !(neutralizeFrom in SUSPICION_RANK)) return null;
  const language = raw['language'] === 'en' ? 'en' : ('fr' as Language);
  const origins = stringList(raw['neutralizeOrigins']).filter((level): level is TrustLevel =>
    (TRUST_LEVELS as readonly string[]).includes(level),
  );
  const domains = stringList(raw['trustedDomains']).map((domain) => normalizeDomain(domain));
  return {
    projectKey,
    mode: mode as ProtectionMode,
    neutralizeFrom: neutralizeFrom as SuspicionLevel,
    neutralizeOrigins: origins as TrustLevel[],
    trustedDomains: domains,
    trustedOrganizations: stringList(raw['trustedOrganizations']),
    trustedIntegrations: stringList(raw['trustedIntegrations']),
    ignoredPhrases: stringList(raw['ignoredPhrases']),
    c3Enabled: booleanOf(raw['c3Enabled'], base.c3Enabled),
    strictOutbound: booleanOf(raw['strictOutbound'], base.strictOutbound),
    language,
  };
}

/** Fabrique les gestionnaires des réglages du projet. */
export function settingsResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  const { store } = deps;

  const getSettings: UiHandler = async (payload) => {
    const projectKey = payloadText(payload, 'projectKey');
    if (!projectKey) return fail(t('fr', 'ui.error.missing', { name: 'projectKey' }));
    try {
      const settings = (await store.settings.get(projectKey)) ?? defaultSettings(projectKey);
      return ok(settings);
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  const saveSettings: UiHandler = async (payload) => {
    const raw = payload['settings'];
    const projectKey = isRecord(raw) && typeof raw['projectKey'] === 'string' ? raw['projectKey'] : null;
    if (!projectKey) return fail(t('fr', 'ui.error.missing', { name: 'projectKey' }));
    const settings = parseSettings(raw, projectKey);
    if (!settings) return fail(t('fr', 'ui.settings.invalid'));
    try {
      await store.settings.put(settings);
      await store.events.append('settings-saved', null, { projectKey, mode: settings.mode });
      return ok(settings);
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  return { getSettings, saveSettings };
}
