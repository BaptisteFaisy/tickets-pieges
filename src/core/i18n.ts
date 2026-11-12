/**
 * Catalogues de messages — un fichier par domaine, un propriétaire par fichier.
 *
 * Règle : les textes visibles (bandeau, mentions de neutralisation, raisons
 * d'origine, libellés d'écran) vivent ICI, jamais en dur dans le code. Chaque
 * lot complète son propre catalogue ; `src/core/i18n.ts` les assemble.
 *
 * Une clé est stable (anglais, kebab-case, préfixée par le domaine) ; les deux
 * langues sont obligatoires (§21 : français et anglais au minimum).
 */
import { canaryCatalog } from './catalog/canary';
import { decodeCatalog } from './catalog/decode';
import { detectionC1Catalog } from './catalog/detection-c1';
import { detectionC2Catalog } from './catalog/detection-c2';
import { detectionC3Catalog } from './catalog/detection-c3';
import { detectionC4Catalog } from './catalog/detection-c4';
import { expositionCatalog } from './catalog/exposition';
import { framingCatalog } from './catalog/framing';
import { hookCatalog } from './catalog/hook';
import { originCatalog } from './catalog/origin';
import { outboundCatalog } from './catalog/outbound';
import { outboundOpsCatalog } from './catalog/outbound-ops';
import { pressureCatalog } from './catalog/pressure';
import { reglagesCatalog } from './catalog/reglages';
import { sessionCatalog } from './catalog/session';
import { uiCatalog } from './catalog/ui';
import type { Language } from './types';

const CATALOGS = [
  originCatalog,
  detectionC1Catalog,
  detectionC2Catalog,
  detectionC3Catalog,
  detectionC4Catalog,
  expositionCatalog,
  pressureCatalog,
  reglagesCatalog,
  framingCatalog,
  outboundCatalog,
  outboundOpsCatalog,
  canaryCatalog,
  decodeCatalog,
  hookCatalog,
  sessionCatalog,
  uiCatalog,
];

function merge(lang: Language): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const catalog of CATALOGS) {
    Object.assign(merged, catalog[lang]);
  }
  return merged;
}

const FR = merge('fr');
const EN = merge('en');

/** Traduit une clé, avec substitutions `{nom}` ; retombe sur la clé elle-même. */
export function t(
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = lang === 'fr' ? FR : EN;
  let text = table[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** Toutes les clés connues — utilisé par les tests et le banc d'essai. */
export function catalogKeys(): string[] {
  return [...new Set([...Object.keys(FR), ...Object.keys(EN)])].sort();
}

/** Clés absentes d'une langue : à corriger avant soumission (§21). */
export function missingKeys(): Record<Language, string[]> {
  const keys = catalogKeys();
  return {
    fr: keys.filter((key) => FR[key] === undefined),
    en: keys.filter((key) => EN[key] === undefined),
  };
}

/** Libellé d'un niveau de confiance, dans la langue demandée. */
export function trustLabel(lang: Language, level: string): string {
  return t(lang, `trust.${level}`);
}

/** Libellé d'un niveau de suspicion (§4) : sain, à vérifier, suspect, piégé. */
export function suspicionLabel(lang: Language, level: string): string {
  return t(lang, `suspicion.${level}`);
}

/** Libellé d'un mode d'entrée (§8.1) : signaler, étiqueter, neutraliser. */
export function modeLabel(lang: Language, mode: string): string {
  return t(lang, `mode.${mode}`);
}
