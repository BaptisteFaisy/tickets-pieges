/**
 * Métriques de détection du banc (#15, #16) — domaine pur.
 *
 * Le détecteur est **injecté** (`Detector`) : ce module ne sait pas quelles
 * couches jouent, il mesure seulement ce qu'elles rendent sur un corpus
 * étiqueté. Trois lectures complémentaires :
 * - **globale** : rappel (charges relevées), précision, taux de faux positifs ;
 * - **par `ruleId`** : combien de charges une règle attrape, combien de textes
 *   légitimes elle touche à tort — c'est la base du réglage (#18) et de
 *   l'honnêteté (§21) : une règle sans support est dite « non mesurée », pas 1 ;
 * - **par famille et par langue** : là où le produit est faible est dit.
 *
 * Un ratio sans dénominateur vaut `null` (jamais 0, jamais 1) : inventer un
 * chiffre serait mentir. Les sorties sont triées et arrondies à `PRECISION`
 * décimales : mêmes entrées → mêmes chiffres, exactement.
 */

import type { Language, LayerHit } from '../core/types';
import { clamp01 } from '../core/findings';
import type { AttackFamily, CorpusEntry, ExpectedLabel } from './corpus';

/** Détecteur injecté : rend les signaux d'une entrée du corpus. */
export type Detector = (entry: CorpusEntry) => readonly LayerHit[];

/** Décimales conservées — assez pour comparer deux runs, pas plus. */
export const PRECISION = 4;

/** Réglages de l'évaluation, tous facultatifs. */
export interface MetricsOptions {
  /** Un signal compte seulement à partir de cette confiance (défaut : 0, tout compte). */
  minConfidence?: number;
  /** Nombre maximal de signaux conservés par entrée (défaut : tous). */
  maxHitsPerEntry?: number;
}

export function round(value: number, decimals: number = PRECISION): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Ratio honnête : `null` quand le dénominateur est nul. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round(numerator / denominator);
}

export function f1Of(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return round((2 * precision * recall) / (precision + recall));
}

/** Ce que la détection a donné sur une entrée. */
export interface EntryOutcome {
  readonly id: string;
  readonly label: ExpectedLabel;
  readonly lang: Language;
  readonly family: AttackFamily | 'none';
  readonly scenario: string | null;
  readonly ruleIds: readonly string[];
  readonly detected: boolean;
  readonly expectedRuleIds: readonly string[];
  /** Règles attendues par l'étiquette et jamais touchées : le trou à combler. */
  readonly missedRuleIds: readonly string[];
  readonly confidenceMax: number;
}

/** Scores d'une règle sur tout le corpus. */
export interface RuleScore {
  readonly ruleId: string;
  /** A frappé sur des charges. */
  readonly truePositives: number;
  /** A frappé sur des textes légitimes. */
  readonly falsePositives: number;
  /** Entrées qui déclarent cette règle comme attendue. */
  readonly expected: number;
  /** Parmi elles, celles où la règle a effectivement frappé. */
  readonly satisfied: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
}

/** Scores d'un regroupement (famille, langue) : mêmes définitions. */
export interface GroupScore {
  readonly key: string;
  readonly attacks: number;
  readonly legitimate: number;
  readonly detected: number;
  readonly falsePositives: number;
  readonly recall: number | null;
  readonly precision: number | null;
  readonly f1: number | null;
}

/** Matrice de confusion au niveau de l'entrée. */
export interface Confusion {
  readonly truePositives: number;
  readonly falseNegatives: number;
  readonly falsePositives: number;
  readonly trueNegatives: number;
}

export interface CorpusMetrics {
  readonly total: number;
  readonly attacks: number;
  readonly legitimate: number;
  readonly confusion: Confusion;
  readonly recall: number | null;
  readonly precision: number | null;
  readonly f1: number | null;
  /** Part des textes légitimes touchés à tort. */
  readonly falsePositiveRate: number | null;
  readonly byRule: readonly RuleScore[];
  readonly byFamily: readonly GroupScore[];
  readonly byLang: readonly GroupScore[];
  /** Identifiants des charges passées au travers. */
  readonly missedAttacks: readonly string[];
  /** Identifiants des textes légitimes relevés à tort. */
  readonly falsePositiveIds: readonly string[];
  /** Règles attendues par le corpus mais jamais vues : couverture manquante. */
  readonly neverFiredRules: readonly string[];
  readonly outcomes: readonly EntryOutcome[];
}

function keepHits(hits: readonly LayerHit[], options: MetricsOptions): LayerHit[] {
  const min = options.minConfidence ?? 0;
  const kept = hits.filter((hit) => clamp01(hit.confidence) >= min);
  const max = options.maxHitsPerEntry;
  return max === undefined ? kept : kept.slice(0, max);
}

function distinctRuleIds(hits: readonly LayerHit[]): string[] {
  const ids = new Set<string>();
  for (const hit of hits) ids.add(hit.ruleId);
  return Array.from(ids).sort();
}

/** Évalue une entrée : signaux, règles touchées, règles attendues manquantes. */
export function evaluateEntry(entry: CorpusEntry, detect: Detector, options: MetricsOptions = {}): EntryOutcome {
  const hits = keepHits(detect(entry) ?? [], options);
  const ruleIds = distinctRuleIds(hits);
  const expected = (entry.expectedRuleIds ?? []).slice().sort();
  const missed = expected.filter((ruleId) => !ruleIds.includes(ruleId));
  const confidenceMax = hits.reduce((acc, hit) => Math.max(acc, clamp01(hit.confidence)), 0);
  return {
    id: entry.id,
    label: entry.label,
    lang: entry.lang,
    family: entry.family ?? 'none',
    scenario: entry.scenario ?? null,
    ruleIds,
    detected: hits.length > 0,
    expectedRuleIds: expected,
    missedRuleIds: missed,
    confidenceMax: round(confidenceMax),
  };
}

export function evaluateCorpus(
  entries: readonly CorpusEntry[],
  detect: Detector,
  options: MetricsOptions = {},
): EntryOutcome[] {
  return entries.map((entry) => evaluateEntry(entry, detect, options));
}

function ruleScores(entries: readonly CorpusEntry[], outcomes: readonly EntryOutcome[]): RuleScore[] {
  const byId = new Map<string, CorpusEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const tp = new Map<string, number>();
  const fp = new Map<string, number>();
  const expected = new Map<string, number>();
  const satisfied = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const outcome of outcomes) {
    for (const ruleId of outcome.ruleIds) bump(outcome.label === 'attack' ? tp : fp, ruleId);
    for (const ruleId of outcome.expectedRuleIds) {
      bump(expected, ruleId);
      if (!outcome.missedRuleIds.includes(ruleId)) bump(satisfied, ruleId);
    }
  }
  const ids = new Set<string>([...tp.keys(), ...fp.keys(), ...expected.keys()]);
  const scores: RuleScore[] = [];
  for (const ruleId of Array.from(ids).sort()) {
    const truePositives = tp.get(ruleId) ?? 0;
    const falsePositives = fp.get(ruleId) ?? 0;
    const exp = expected.get(ruleId) ?? 0;
    const sat = satisfied.get(ruleId) ?? 0;
    const precision = ratio(truePositives, truePositives + falsePositives);
    const recall = ratio(sat, exp);
    scores.push({
      ruleId,
      truePositives,
      falsePositives,
      expected: exp,
      satisfied: sat,
      precision,
      recall,
      f1: f1Of(precision, recall),
    });
  }
  return scores;
}

function groupScores(keyOf: (outcome: EntryOutcome) => string, outcomes: readonly EntryOutcome[]): GroupScore[] {
  const keys = new Map<string, EntryOutcome[]>();
  for (const outcome of outcomes) {
    const key = keyOf(outcome);
    const bucket = keys.get(key);
    if (bucket) bucket.push(outcome);
    else keys.set(key, [outcome]);
  }
  const scores: GroupScore[] = [];
  for (const key of Array.from(keys.keys()).sort()) {
    const group = keys.get(key) ?? [];
    const attacks = group.filter((item) => item.label === 'attack');
    const legitimate = group.filter((item) => item.label === 'legitimate');
    const detected = attacks.filter((item) => item.detected).length;
    const falsePositives = legitimate.filter((item) => item.detected).length;
    const recall = ratio(detected, attacks.length);
    const precision = ratio(detected, detected + falsePositives);
    scores.push({
      key,
      attacks: attacks.length,
      legitimate: legitimate.length,
      detected,
      falsePositives,
      recall,
      precision,
      f1: f1Of(precision, recall),
    });
  }
  return scores;
}

function confusionOf(outcomes: readonly EntryOutcome[]): Confusion {
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  for (const outcome of outcomes) {
    if (outcome.label === 'attack') {
      if (outcome.detected) truePositives += 1;
      else falseNegatives += 1;
    } else if (outcome.detected) falsePositives += 1;
    else trueNegatives += 1;
  }
  return { truePositives, falseNegatives, falsePositives, trueNegatives };
}

/** Règles déclarées attendues mais jamais apparues dans les signaux. */
export function neverFired(outcomes: readonly EntryOutcome[]): string[] {
  const declared = new Set<string>();
  const fired = new Set<string>();
  for (const outcome of outcomes) {
    for (const ruleId of outcome.expectedRuleIds) declared.add(ruleId);
    for (const ruleId of outcome.ruleIds) fired.add(ruleId);
  }
  return Array.from(declared)
    .filter((ruleId) => !fired.has(ruleId))
    .sort();
}

/** Calcule toutes les métriques d'un corpus évalué. */
export function computeMetrics(
  entries: readonly CorpusEntry[],
  outcomes: readonly EntryOutcome[],
): CorpusMetrics {
  const confusion = confusionOf(outcomes);
  const attacks = confusion.truePositives + confusion.falseNegatives;
  const legitimate = confusion.falsePositives + confusion.trueNegatives;
  const recall = ratio(confusion.truePositives, attacks);
  const precision = ratio(confusion.truePositives, confusion.truePositives + confusion.falsePositives);
  const missed = outcomes.filter((item) => item.label === 'attack' && !item.detected).map((item) => item.id);
  const falsePositiveIds = outcomes
    .filter((item) => item.label === 'legitimate' && item.detected)
    .map((item) => item.id);
  return {
    total: outcomes.length,
    attacks,
    legitimate,
    confusion,
    recall,
    precision,
    f1: f1Of(precision, recall),
    falsePositiveRate: ratio(confusion.falsePositives, legitimate),
    byRule: ruleScores(entries, outcomes),
    byFamily: groupScores((item) => item.family, outcomes),
    byLang: groupScores((item) => item.lang, outcomes),
    missedAttacks: missed.sort(),
    falsePositiveIds: falsePositiveIds.sort(),
    neverFiredRules: neverFired(outcomes),
    outcomes,
  };
}

/** Enchaîne évaluation et calcul : le point d'entrée du rapport. */
export function measureCorpus(
  entries: readonly CorpusEntry[],
  detect: Detector,
  options: MetricsOptions = {},
): CorpusMetrics {
  return computeMetrics(entries, evaluateCorpus(entries, detect, options));
}

/** Deux runs identiques doivent rendre des métriques identiques (test de stabilité). */
export function metricsDigest(metrics: CorpusMetrics): string {
  const parts = [
    metrics.total,
    metrics.attacks,
    metrics.legitimate,
    metrics.confusion.truePositives,
    metrics.confusion.falseNegatives,
    metrics.confusion.falsePositives,
    metrics.confusion.trueNegatives,
    metrics.byRule.map((rule) => `${rule.ruleId}:${rule.truePositives}/${rule.falsePositives}`).join(','),
    metrics.missedAttacks.join(','),
    metrics.falsePositiveIds.join(','),
  ];
  return parts.join('|');
}

/** Pire règle en précision (la plus bruitée) — utile au rapport, jamais un verdict. */
export function noisiestRules(metrics: CorpusMetrics, limit = 5): RuleScore[] {
  return metrics.byRule
    .filter((rule) => rule.precision !== null && rule.falsePositives > 0)
    .slice()
    .sort((a, b) => (a.precision ?? 0) - (b.precision ?? 0) || a.ruleId.localeCompare(b.ruleId))
    .slice(0, limit);
}
