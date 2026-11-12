/**
 * Score d'exposition 0-100 (#47), médiane inter-organisations anonymisée (#48)
 * et vue « ce qui n'a pas été analysé » (#59).
 *
 * #47 — le score est une somme pondérée de quatre composantes **documentées**
 * (aucun chiffre magique) : densité de constats suspects, taux d'obéissance aux
 * exercices, pression sur le sas, part non analysée. Deux projets avec les mêmes
 * rapports obtiennent le même score : il est comparable.
 *
 * #48 — la médiane inter-organisations ne circule que par **empreintes agrégées** :
 * des compteurs et des taux, jamais un extrait, jamais une clé, jamais un texte (§21).
 *
 * #59 — la vue « non analysé » agrège `IssueState.unanalyzed` par projet : c'est
 * l'indicateur d'honnêteté du §21 rendu exploitable.
 *
 * Domaine pur : aucune E/S, aucune heure lue.
 */

import type { ExposureReport, IssueState, UnanalyzedReason } from './types';
import { clamp01 } from './findings';
import { sha256 } from './hashing';

// ------------------------------------------------------------- #47 le score

/** Poids des composantes — ils somment à 100 et sont la documentation du score. */
export const SCORE_WEIGHTS = {
  /** Densité de constats suspects (C1+C2+C3) par demande examinée. */
  suspects: 35,
  /** Taux d'obéissance aux exercices d'alerte (§13). */
  obedience: 30,
  /** Réponses retenues par le sas rapportées aux demandes examinées (§10). */
  outbound: 15,
  /** Part des demandes qui n'ont pas été entièrement analysées (§21). */
  unanalyzed: 20,
} as const;

/** La composante « suspects » sature à un constat suspect pour 4 demandes. */
export const SUSPECT_SATURATION = 0.25;

/** La composante « sas » sature à une réponse retenue pour 10 demandes. */
export const OUTBOUND_SATURATION = 0.1;

/** Seuils de bande : 0-24 bas, 25-49 moyen, 50-74 élevé, 75-100 critique. */
export const SCORE_BANDS = { medium: 25, high: 50, critical: 75 } as const;

export type ScoreBand = 'low' | 'medium' | 'high' | 'critical';

export interface ScoreComponents {
  suspects: number;
  obedience: number;
  outbound: number;
  unanalyzed: number;
}

export interface ExposureScore {
  /** Score entier 0-100. */
  total: number;
  band: ScoreBand;
  /** Contribution de chaque composante, en points (0 à son poids). */
  contributions: ScoreComponents;
  weights: typeof SCORE_WEIGHTS;
}

/** Suspects = C1 + C2 + C3 (C4 est une pondération, jamais un verdict seul). */
export function suspectFindings(report: ExposureReport): number {
  return report.findingsByLayer.C1 + report.findingsByLayer.C2 + report.findingsByLayer.C3;
}

export function bandOf(total: number): ScoreBand {
  if (total >= SCORE_BANDS.critical) return 'critical';
  if (total >= SCORE_BANDS.high) return 'high';
  if (total >= SCORE_BANDS.medium) return 'medium';
  return 'low';
}

/** Calcule le score d'exposition d'un rapport. Plus de constats → score plus élevé. */
export function exposureScore(report: ExposureReport): ExposureScore {
  const examined = Math.max(0, report.requestsExamined);
  const ratio = (count: number, saturation: number): number =>
    examined === 0 ? 0 : clamp01(count / (examined * saturation));
  const components: ScoreComponents = {
    suspects: ratio(suspectFindings(report), SUSPECT_SATURATION),
    obedience: clamp01(report.obedienceRate),
    outbound: ratio(report.outboundHeld, OUTBOUND_SATURATION),
    unanalyzed: clamp01(1 - report.analyzedShare),
  };
  const contributions: ScoreComponents = {
    suspects: round2(components.suspects * SCORE_WEIGHTS.suspects),
    obedience: round2(components.obedience * SCORE_WEIGHTS.obedience),
    outbound: round2(components.outbound * SCORE_WEIGHTS.outbound),
    unanalyzed: round2(components.unanalyzed * SCORE_WEIGHTS.unanalyzed),
  };
  const total = Math.round(
    contributions.suspects + contributions.obedience + contributions.outbound + contributions.unanalyzed,
  );
  return { total, band: bandOf(total), contributions, weights: SCORE_WEIGHTS };
}

// ------------------------------------------------- #48 médiane inter-organisations

/**
 * Ce qu'une organisation partage : des nombres agrégés, rien d'autre.
 * Aucun champ texte — c'est la condition §21 du partage (#48, TP-28).
 */
export interface OrgAggregate {
  requestsExamined: number;
  analyzedShare: number;
  suspects: number;
  obedienceRate: number;
  outboundHeld: number;
  campaigns: number;
  exposureScore: number;
}

/** Une soumission : l'empreinte tient lieu d'identité, l'agrégat tient lieu de contenu. */
export interface OrgSubmission {
  /** Empreinte anonyme de l'organisation (jamais son nom). */
  orgFingerprint: string;
  aggregate: OrgAggregate;
}

/** Réduit un rapport à son agrégat anonymisable. */
export function orgAggregate(report: ExposureReport): OrgAggregate {
  return {
    requestsExamined: Math.max(0, report.requestsExamined),
    analyzedShare: round2(clamp01(report.analyzedShare)),
    suspects: suspectFindings(report),
    obedienceRate: round2(clamp01(report.obedienceRate)),
    outboundHeld: Math.max(0, report.outboundHeld),
    campaigns: Math.max(0, report.campaigns),
    exposureScore: exposureScore(report).total,
  };
}

const AGGREGATE_FIELDS: readonly (keyof OrgAggregate)[] = [
  'requestsExamined',
  'analyzedShare',
  'suspects',
  'obedienceRate',
  'outboundHeld',
  'campaigns',
  'exposureScore',
];

/** Empreinte stable d'un agrégat : mêmes nombres → même empreinte. */
export function aggregateFingerprint(aggregate: OrgAggregate): string {
  const canonical = AGGREGATE_FIELDS.map((field) => `${field}=${aggregate[field]}`).join('|');
  return sha256(canonical);
}

/** Médiane champ par champ des agrégats soumis ; `null` si aucune soumission. */
export function crossOrgMedian(submissions: readonly OrgSubmission[]): OrgAggregate | null {
  if (submissions.length === 0) return null;
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const raw =
      sorted.length % 2 === 1
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return round2(raw);
  };
  const result = {} as OrgAggregate;
  for (const field of AGGREGATE_FIELDS) {
    result[field] = median(submissions.map((submission) => submission.aggregate[field]));
  }
  return result;
}

// -------------------------------------------------------- #59 vue non analysé

export interface UnanalyzedView {
  projectKey: string;
  /** Tickets du projet pris en compte. */
  issues: number;
  /** Tickets portant au moins une raison de non-analyse. */
  issuesWithUnanalyzed: number;
  byReason: Record<UnanalyzedReason, number>;
  /** Total des raisons relevées (un ticket peut en porter plusieurs). */
  totalReasons: number;
}

const EMPTY_REASONS: Record<UnanalyzedReason, number> = {
  'image': 0,
  'binary-attachment': 0,
  'oversize': 0,
  'unsupported-format': 0,
  'model-pending': 0,
};

/** Agrège la part non analysée d'un projet à partir des états de tickets. */
export function unanalyzedView(projectKey: string, states: readonly IssueState[]): UnanalyzedView {
  const scoped = states.filter((state) => state.projectKey === projectKey);
  const byReason: Record<UnanalyzedReason, number> = { ...EMPTY_REASONS };
  let issuesWithUnanalyzed = 0;
  let totalReasons = 0;
  for (const state of scoped) {
    if (state.unanalyzed.length > 0) issuesWithUnanalyzed += 1;
    for (const reason of state.unanalyzed) {
      byReason[reason] += 1;
      totalReasons += 1;
    }
  }
  return { projectKey, issues: scoped.length, issuesWithUnanalyzed, byReason, totalReasons };
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
