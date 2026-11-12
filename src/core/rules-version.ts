/**
 * Version du catalogue de règles — le contrat de détection figé.
 *
 * Le produit joue quatre familles déterministes : C1 (dissimulation), C2
 * (adresse à une IA), le décodage prudent et la pression lexicale. Le jour où
 * l'une d'elles change de comportement, le résultat d'une détection doit le
 * dire — sinon on ne peut plus comparer un ticket d'aujourd'hui à un ticket
 * d'hier, ni dire quelle règle a produit quoi.
 *
 * Ce module tient deux choses :
 *
 *  1. **la version** — un entier (version majeure du contrat) et une empreinte
 *     des tables de motifs (SHA-256 des tables réellement utilisées). L'entier
 *     se change à la main quand la liste des familles change ; l'empreinte suit
 *     les tables toute seule, sans qu'on ait à y penser.
 *  2. **le refus** — une famille de règles inconnue est refusée, pas ignorée.
 *     C'est la garde qui ferme le glissement mesuré le 12 novembre 2026 : le
 *     banc jouait C1 + C2 + décodage + pression, la production C1 + C2, le site
 *     la production. Un appelant qui demande une famille que le produit ne
 *     connaît pas obtient une erreur, jamais un silence.
 *
 * Règles du domaine (`src/core/*`) : aucune E/S, pas d'horloge, pas
 * `@forge/*`. Le hachage passe par `src/core/hashing.ts` (`node:crypto`, présent
 * dans le runtime Forge).
 */

import { sha256 } from './hashing';
import { C2_RULE_IDS, c2Patterns } from './c2-addressing';
import { COLOR_COLLAPSE_DISTANCE, MIN_ALT_LENGTH, MIN_ENCODED_RUN } from './c1-concealment';
import { MAX_DECODED_LENGTH, MAX_DECODE_DEPTH, MIN_DECODE_RUN } from './decode';
import { decodeCatalog } from './catalog/decode';
import { detectionC1Catalog } from './catalog/detection-c1';
import { pressureCatalog } from './catalog/pressure';
import type { DetectionLanguage } from './langues';

/** Les familles déterministes que le produit sait jouer — la source unique. */
export const RULE_FAMILIES = ['C1', 'C2', 'decode', 'pressure'] as const;

/** Le nom d'une famille de règles. */
export type RulesFamily = (typeof RULE_FAMILIES)[number];

/**
 * Version majeure du contrat de détection.
 *
 * Entier, changé à la main : +1 quand la liste des familles change, quand une
 * famille est renommée, quand une règle disparaît. Les détails de motif sont
 * suivis par l'empreinte, pas par cet entier.
 */
export const RULES_VERSION = 1;

/** Une table de motifs : les entrées fingerprintées d'une famille. */
export interface RulesTable {
  /** Famille à laquelle la table appartient. */
  family: RulesFamily;
  /** Nom court de la table (lexique, seuils, catalogue de règles). */
  name: string;
  /** Entrées canoniques : une par motif, par seuil ou par règle. */
  entries: readonly string[];
}

/** Les clés d'un catalogue qui commencent par un préfixe, préfixe retiré. */
function keysWithPrefix(source: Record<string, string>, prefix: string): string[] {
  return Object.keys(source)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort();
}

/** Les motifs d'un lexique C2, canoniques : règle, genre, confiance, motif. */
function patternEntries(language: DetectionLanguage): string[] {
  return c2Patterns(language).map(
    (pattern) =>
      `${pattern.ruleId}|${pattern.kind}|${pattern.confidence}|${pattern.needsContext === true}|${pattern.source}`,
  );
}

/** Les sept lexiques jouables par C2 (fr/en du tronc, cinq lexiques de plus). */
const SCAN_LANGUAGES: readonly DetectionLanguage[] = ['fr', 'en', 'es', 'de', 'pt', 'it', 'nl'];

/** Une table de seuils : les bornes numériques d'une famille. */
function thresholds(family: RulesFamily, name: string, values: readonly number[]): RulesTable {
  return { family, name, entries: values.map((value) => String(value)) };
}

/**
 * Les tables fingerprintées : une par famille et par nature de données.
 *
 * Ce que l'empreinte couvre, et ce qu'elle ne couvre pas :
 *  - **C2** : les motifs des sept lexiques (expression régulière comprise) —
 *    c'est la table de motifs la plus grosse du produit, elle est vue en entier ;
 *  - **C1, décodage, pression** : les identifiants de règles du catalogue
 *    produit et leurs seuils publics. Leurs motifs internes ne sont pas
 *    exportés : l'empreinte ne les voit pas. C'est une limite dite, pas cachée
 *    (voir `docs/CONTRAT-DETECTION.md`).
 */
export const CURRENT_TABLES: readonly RulesTable[] = [
  { family: 'C1', name: 'regles', entries: keysWithPrefix(detectionC1Catalog.fr, 'c1.rule.') },
  thresholds('C1', 'seuils', [MIN_ENCODED_RUN, MIN_ALT_LENGTH, COLOR_COLLAPSE_DISTANCE]),
  { family: 'C2', name: 'regles', entries: [...C2_RULE_IDS] },
  ...SCAN_LANGUAGES.map(
    (language): RulesTable => ({
      family: 'C2',
      name: `lexique-${language}`,
      entries: patternEntries(language),
    }),
  ),
  { family: 'decode', name: 'regles', entries: keysWithPrefix(decodeCatalog.fr, 'decode.rule.') },
  thresholds('decode', 'seuils', [MIN_DECODE_RUN, MAX_DECODED_LENGTH, MAX_DECODE_DEPTH]),
  { family: 'pressure', name: 'regles', entries: keysWithPrefix(pressureCatalog.fr, 'pressure.summary.') },
  { family: 'pressure', name: 'genres', entries: keysWithPrefix(pressureCatalog.fr, 'pressure.kind.') },
];

/** Empreinte d'un jeu de tables : SHA-256 de leur sérialisation canonique. */
export function fingerprintTables(tables: readonly RulesTable[]): string {
  const payload = tables
    .map((table) =>
      [table.family, table.name, String(table.entries.length), ...table.entries].join('\u0000'),
    )
    .join('\u0001');
  return sha256(payload);
}

/** Empreinte des tables réellement utilisées par le produit. */
export const RULES_FINGERPRINT = fingerprintTables(CURRENT_TABLES);

/** Identifiant court du catalogue : version majeure + empreinte des tables. */
export const RULES_ID = `v${RULES_VERSION}-${RULES_FINGERPRINT.slice(0, 12)}`;

/** Ce que le produit sait de son propre catalogue de règles. */
export interface RulesCatalogue {
  /** Version majeure du contrat. */
  version: number;
  /** Empreinte des tables de motifs. */
  fingerprint: string;
  /** Identifiant court, à poser dans un rapport ou un constat. */
  id: string;
  /** Familles jouées. */
  families: readonly RulesFamily[];
}

/** Le catalogue, tel que le produit le voit. */
export function rulesCatalogue(): RulesCatalogue {
  return {
    version: RULES_VERSION,
    fingerprint: RULES_FINGERPRINT,
    id: RULES_ID,
    families: RULE_FAMILIES,
  };
}

/** La famille est-elle connue du produit ? */
export function isKnownFamily(family: string): family is RulesFamily {
  return (RULE_FAMILIES as readonly string[]).includes(family);
}

/** Refuse une famille inconnue : une erreur, jamais un silence. */
export function assertKnownFamily(family: string): void {
  if (isKnownFamily(family)) return;
  throw new Error(
    `famille de règles inconnue : « ${family} » (connues : ${RULE_FAMILIES.join(', ')})`,
  );
}

/** Ce qui cloche entre les familles déclarées et les familles jouées. */
export type FamilyIssueKind =
  /** La famille n'existe pas dans le catalogue du produit. */
  | 'unknown-family'
  /** La famille est déclarée mais aucune couche ne la joue. */
  | 'declared-not-played'
  /** La famille est jouée mais elle n'est pas déclarée. */
  | 'played-not-declared';

/** Un écart entre le contrat déclaré et le contrat joué. */
export interface FamilyIssue {
  /** Famille concernée. */
  family: string;
  /** Nature de l'écart. */
  kind: FamilyIssueKind;
}

/** Compare les familles déclarées aux familles réellement jouées. */
export function checkFamilies(declared: readonly string[], played: readonly string[]): FamilyIssue[] {
  const issues: FamilyIssue[] = [];
  for (const family of declared) {
    if (!isKnownFamily(family)) issues.push({ family, kind: 'unknown-family' });
    else if (!played.includes(family)) issues.push({ family, kind: 'declared-not-played' });
  }
  for (const family of played) {
    if (!declared.includes(family)) issues.push({ family, kind: 'played-not-declared' });
  }
  return issues;
}

/** Le contrat : une famille déclarée et non jouée est une erreur, pas un silence. */
export function assertFamilies(declared: readonly string[], played: readonly string[]): void {
  const issues = checkFamilies(declared, played);
  if (issues.length === 0) return;
  const detail = issues.map((issue) => `${issue.family} (${issue.kind})`).join(', ');
  throw new Error(`contrat de familles rompu : ${detail}`);
}
