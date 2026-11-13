/**
 * Listes de confiance et réglages par projet (§5, §14, TP-02).
 *
 * Domaine pur : aucune E/S. Les listes viennent des réglages du projet
 * (`ProjectSettings`), eux-mêmes stockés par la plateforme (table `trust_rule`).
 *
 * Trois listes décident du niveau de confiance (§5) :
 *  - domaines de courriel vérifiés ;
 *  - organisations JSM déclarées de confiance ;
 *  - intégrations (comptes d'app) autorisées — sans elles, une app est T0.
 * Une quatrième liste ne décide rien : les formules à ignorer (§14), utilisées
 * par la couche C2 pour ne pas lever de constat sur des mentions légales.
 */

import type { Language, ProjectSettings, SuspicionLevel, TrustLevel } from './types';

/** Valeur de liste : minuscule, sans espaces de bordure. */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Domaine de courriel normalisé : minuscule, sans `@`, sans point final. */
export function normalizeDomain(value: string): string {
  const clean = normalizeValue(value).replace(/^@/, '').replace(/\.$/, '');
  const at = clean.lastIndexOf('@');
  return at >= 0 ? clean.slice(at + 1) : clean;
}

/** Liste normalisée, sans doublon ni entrée vide. */
export function normalizeList(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const clean = normalizeValue(value);
    if (clean.length > 0) out.add(clean);
  }
  return [...out];
}

/**
 * Un domaine est de confiance s'il est dans la liste, ou s'il est un
 * sous-domaine d'un domaine listé (`mail.acme.fr` pour `acme.fr`).
 * L'inverse n'est jamais vrai : `acme.fr` ne couvre pas `evil-acme.fr`.
 */
export function isTrustedDomain(domain: string | undefined, settings: ProjectSettings): boolean {
  if (!domain) return false;
  const candidate = normalizeDomain(domain);
  if (candidate.length === 0) return false;
  return settings.trustedDomains.some((entry) => {
    const trusted = normalizeDomain(entry);
    return trusted.length > 0 && (candidate === trusted || candidate.endsWith(`.${trusted}`));
  });
}

/** Une organisation est de confiance si son identifiant ou son nom est listé. */
export function isTrustedOrganization(
  organizationId: string | undefined,
  organizationName: string | undefined,
  settings: ProjectSettings,
): boolean {
  const wanted = settings.trustedOrganizations.map(normalizeValue);
  const byId = organizationId ? normalizeValue(organizationId) : null;
  const byName = organizationName ? normalizeValue(organizationName) : null;
  return wanted.some((entry) => entry === byId || entry === byName);
}

/** Une intégration (compte d'app) est de confiance si elle est listée (§5). */
export function isTrustedIntegration(
  accountId: string | undefined,
  displayName: string | undefined,
  settings: ProjectSettings,
): boolean {
  const wanted = settings.trustedIntegrations.map(normalizeValue);
  const byId = accountId ? normalizeValue(accountId) : null;
  const byName = displayName ? normalizeValue(displayName) : null;
  return wanted.some((entry) => entry === byId || entry === byName);
}

/**
 * Formule à ignorer (§14) : mentions légales de courriel, signatures, formules
 * de politesse pleines d'impératifs. Une phrase couverte ne lève pas de constat
 * C2 — la comparaison est normalisée, et une formule vide n'ignore jamais rien.
 */
export function isIgnoredPhrase(text: string, settings: ProjectSettings): boolean {
  const candidate = normalizeValue(text);
  if (candidate.length === 0) return false;
  return settings.ignoredPhrases.some((phrase) => {
    const needle = normalizeValue(phrase);
    return needle.length > 0 && candidate.includes(needle);
  });
}

/** Réglages par défaut d'un projet : mode « signaler », neutre et réversible (§8.1). */
export function defaultSettings(projectKey: string, language: Language = 'fr'): ProjectSettings {
  return {
    projectKey,
    mode: 'report',
    neutralizeFrom: 'suspect' as SuspicionLevel,
    neutralizeOrigins: ['T0', 'T1'] as TrustLevel[],
    trustedDomains: [],
    trustedOrganizations: [],
    trustedIntegrations: [],
    ignoredPhrases: DEFAULT_IGNORED_PHRASES[language],
    c3Enabled: true,
    strictOutbound: false,
    language,
  };
}

/**
 * Formules courantes à ignorer, livrées avec l'app (§14). Elles sont pleines
 * d'impératifs (« veuillez », « ne pas », « merci de ») sans être des consignes
 * adressées à une IA : les ignorer évite du bruit dès l'installation.
 */
export const DEFAULT_IGNORED_PHRASES: Record<Language, string[]> = {
  fr: [
    'ce message et ses pièces jointes sont confidentiels',
    // Pieds de page de courriel d'entreprise : ils sont pleins d'impératifs
    // (« veuillez supprimer », « ne pas imprimer ») sans rien demander à une
    // IA. Le modèle les lisait comme des consignes (mesuré sur `fr-13`) ; ces
    // formules génériques les retirent avant la lecture par modèle.
    'ce message et ses pièces jointes sont destinés à leur seul destinataire',
    'toute diffusion, copie ou utilisation non autorisée est interdite',
    'les opinions exprimées n’engagent que leur auteur',
    'si vous avez reçu ce message par erreur, veuillez le supprimer et en avertir l’expéditeur',
    'veuillez vérifier votre configuration de messagerie avant de répondre',
    'ne pas imprimer ce message',
    'ne pas imprimer si ce n’est pas nécessaire',
    'veuillez ne pas répondre à ce message',
    'merci de ne pas modifier ce message',
    'ce courriel a été vérifié par un antivirus',
    'signature électronique',
    'mentions légales',
    'bien cordialement',
  ],
  en: [
    'this message and its attachments are confidential',
    'this message is intended only for the addressee',
    'any unauthorised copying or distribution is prohibited',
    'the views expressed in this message are those of the author',
    'if you have received this message in error, please delete it',
    'please do not print this message',
    'please do not reply to this message',
    'please consider the environment before printing',
    'this email has been scanned for viruses',
    'electronic signature',
    'legal notice',
    'kind regards',
  ],
};
