/**
 * Table de correspondance MITRE ATLAS (#96) — domaine pur, sans E/S.
 *
 * Le produit ne « bloque » pas au sens d'ATLAS : il **cadre**. Ce fichier rend
 * donc la couverture d'un ticket ou d'un rapport d'exposition **par technique
 * ATLAS**, avec les quatre niveaux possibles (§21 : « réduit le risque »,
 * jamais « protège ») :
 *
 *   - `detected`    — la technique est signalée, un constat part en revue ;
 *   - `framed`      — le contenu porteur n'atteint le modèle que comme donnée
 *                     entre balises à identifiant aléatoire ;
 *   - `blocked`     — la sortie est retenue par le sas (§10) ;
 *   - `not-covered` — le produit n'analyse pas cette technique : il le dit.
 *
 * Deux règles d'honnêteté (§21) tiennent la table :
 *   1. toute technique citée existe dans le catalogue MITRE (170 entrées,
 *      reprises de la source officielle) — aucune technique inventée ;
 *   2. toute règle du dépôt a une entrée, ou figure explicitement comme
 *      « non mappée » avec la raison de ce trou.
 *
 * Les textes visibles vivent dans le catalogue i18n (`atlas.*`) ; ce module ne
 * renvoie que des identifiants et des libellés déjà traduits.
 */

import type { Finding, Language } from './types';
import type { ExposureReport } from './types-flow';
import atlasTable from '../../data/atlas.json';

/** Niveau de couverture d'une technique ATLAS par le produit (§21). */
export type AtlasCoverage = 'detected' | 'framed' | 'blocked' | 'not-covered';

/** Une technique MITRE ATLAS, avec son nom officiel et sa traduction. */
export interface AtlasTechnique {
  id: string;
  /** Nom officiel MITRE (anglais). */
  name: string;
  /** Libellé français. */
  nameFr: string;
}

/** Une règle du produit, et la ou les techniques ATLAS qu'elle relève. */
export interface AtlasRuleMapping {
  ruleId: string;
  /** Couche du produit d'où vient la règle (`C1`…`C4`, `S` pour le sas). */
  layer: string;
  techniques: string[];
  coverage: AtlasCoverage;
  noteFr: string;
  noteEn: string;
}

/** Une technique que le produit n'analyse pas : le trou est nommé, pas caché. */
export interface AtlasGap {
  techniqueId: string;
  coverage: AtlasCoverage;
  noteFr: string;
  noteEn: string;
}

/** Couverture d'une technique pour un jeu de constats donné. */
export interface TechniqueCoverage {
  technique: AtlasTechnique;
  /** Niveau atteint par le produit sur cette technique. */
  coverage: AtlasCoverage;
  /** Règles du produit qui l'ont déclenchée. */
  ruleIds: string[];
  /** Nombre de constats qui l'ont déclenchée. */
  findings: number;
}

/** Couverture d'un rapport d'exposition, par technique. */
export interface ReportCoverage {
  /** Fenêtre et projet du rapport d'exposition d'où vient la couverture. */
  projectKey: string;
  from: string;
  to: string;
  requestsExamined: number;
  /** Part réellement analysée : ce qui ne l'est pas ne couvre rien (§21). */
  analyzedShare: number;
  techniques: TechniqueCoverage[];
  /** Techniques que le produit n'analyse pas (§21 : dit, pas caché). */
  gaps: AtlasGap[];
  /** Règles vues sans contrepartie ATLAS : leur couverture reste à écrire. */
  uncoveredRuleIds: string[];
  /** Nombre de constats couverts par au moins une technique. */
  coveredFindings: number;
}

interface AtlasTable {
  version: number;
  coverageLevels: { id: AtlasCoverage; labelFr: string; labelEn: string; descFr: string; descEn: string }[];
  techniques: AtlasTechnique[];
  rules: AtlasRuleMapping[];
  gaps: AtlasGap[];
  unmapped: { ruleId: string; reasonFr: string; reasonEn: string }[];
  catalogue: Record<string, string>;
}

const TABLE = atlasTable as AtlasTable;

/** Techniques ATLAS que le produit connaît (24 documentées sur 170). */
export const ATLAS_TECHNIQUES: readonly AtlasTechnique[] = TABLE.techniques;

/** Règles du produit et leur technique ATLAS. */
export const ATLAS_RULES: readonly AtlasRuleMapping[] = TABLE.rules;

/** Techniques ATLAS non analysées par le produit. */
export const ATLAS_GAPS: readonly AtlasGap[] = TABLE.gaps;

/** Règles explicitement non mappées, avec la raison du trou. */
export const ATLAS_UNMAPPED: readonly { ruleId: string; reasonFr: string; reasonEn: string }[] =
  TABLE.unmapped;

/** Catalogue MITRE complet : identifiant → nom officiel (170 entrées). */
export const ATLAS_CATALOGUE: Readonly<Record<string, string>> = TABLE.catalogue;

const TECHNIQUES_BY_ID = new Map(TABLE.techniques.map((technique) => [technique.id, technique]));
const RULES_BY_ID = new Map(TABLE.rules.map((rule) => [rule.ruleId, rule]));

/** Une technique existe-t-elle dans le catalogue MITRE ? */
export function isKnownTechnique(techniqueId: string): boolean {
  return Object.prototype.hasOwnProperty.call(ATLAS_CATALOGUE, techniqueId);
}

/** La technique est-elle documentée dans la table du produit ? */
export function isMappedTechnique(techniqueId: string): boolean {
  return TECHNIQUES_BY_ID.has(techniqueId);
}

/** Entrée ATLAS d'une règle, ou `undefined` si la règle n'existe pas. */
export function ruleMapping(ruleId: string): AtlasRuleMapping | undefined {
  return RULES_BY_ID.get(ruleId);
}

/** Techniques ATLAS que la règle relève. */
export function techniquesOfRule(ruleId: string): AtlasTechnique[] {
  const rule = RULES_BY_ID.get(ruleId);
  if (!rule) return [];
  return rule.techniques
    .map((techniqueId) => TECHNIQUES_BY_ID.get(techniqueId))
    .filter((technique): technique is AtlasTechnique => technique !== undefined);
}

/** Libellé traduit d'un niveau de couverture. */
export function coverageLabel(coverage: AtlasCoverage, language: Language): string {
  const level = TABLE.coverageLevels.find((item) => item.id === coverage);
  if (!level) return coverage;
  return language === 'fr' ? level.labelFr : level.labelEn;
}

/**
 * Force du niveau : ce qui arrête sort devant ce qui encadre, ce qui encadre
 * devant ce qui signale. Un niveau `not-covered` ne couvre rien.
 */
const STRENGTH: Record<AtlasCoverage, number> = {
  'not-covered': 0,
  detected: 1,
  framed: 2,
  blocked: 3,
};

/** Le niveau le plus fort atteint par une liste de niveaux. */
export function strongestCoverage(levels: AtlasCoverage[]): AtlasCoverage {
  let best: AtlasCoverage = 'not-covered';
  for (const level of levels) {
    if (STRENGTH[level] > STRENGTH[best]) best = level;
  }
  return best;
}

/** Couverture d'un ticket : une ligne par technique ATLAS déclenchée. */
export function coverageOfFindings(findings: Finding[]): TechniqueCoverage[] {
  const counters = new Map<string, { ruleIds: Set<string>; count: number; levels: AtlasCoverage[] }>();
  for (const finding of findings) {
    const rule = RULES_BY_ID.get(finding.ruleId);
    if (!rule) continue;
    for (const techniqueId of rule.techniques) {
      const entry = counters.get(techniqueId) ?? { ruleIds: new Set<string>(), count: 0, levels: [] };
      entry.ruleIds.add(finding.ruleId);
      entry.count += 1;
      entry.levels.push(rule.coverage);
      counters.set(techniqueId, entry);
    }
  }
  return [...counters.entries()]
    .map(([techniqueId, entry]) => ({
      technique: TECHNIQUES_BY_ID.get(techniqueId) as AtlasTechnique,
      coverage: strongestCoverage(entry.levels),
      ruleIds: [...entry.ruleIds].sort(),
      findings: entry.count,
    }))
    .sort((a, b) => b.findings - a.findings || a.technique.id.localeCompare(b.technique.id));
}

/** Règles vues dans les constats sans contrepartie ATLAS : leur couverture reste à écrire. */
export function uncoveredRuleIds(findings: Finding[]): string[] {
  const ids = new Set<string>();
  for (const finding of findings) {
    if (!RULES_BY_ID.has(finding.ruleId)) ids.add(finding.ruleId);
  }
  return [...ids].sort();
}

/**
 * Couverture d'un rapport d'exposition, par technique ATLAS.
 *
 * Le rapport compte des constats ; la table dit ce que ces constats couvrent.
 * Les techniques que le produit n'analyse pas sont rendues à part : un
 * rapport qui affiche « AML.T0029 — non couvert » vaut mieux qu'un rapport
 * silencieux sur un déni de service.
 */
export function coverageOfReport(report: ExposureReport, findings: Finding[]): ReportCoverage {
  const techniques = coverageOfFindings(findings);
  const covered = techniques.reduce((total, entry) => total + entry.findings, 0);
  return {
    projectKey: report.projectKey,
    from: report.from,
    to: report.to,
    requestsExamined: report.requestsExamined,
    analyzedShare: report.analyzedShare,
    techniques,
    gaps: [...ATLAS_GAPS],
    uncoveredRuleIds: uncoveredRuleIds(findings),
    coveredFindings: covered,
  };
}
