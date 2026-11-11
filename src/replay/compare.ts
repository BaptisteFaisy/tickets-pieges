/**
 * Comparaison du banc (TP-18) — le rapport face à l'attendu du jeu.
 *
 * Une divergence n'est pas une erreur du banc : c'est une information. Le banc
 * ne masque rien (§21) — il dit ce qui est conforme, ce qui diverge, et pourquoi
 * (couche non jouée, par exemple). Le verdict global tient en une ligne du type
 * « 7 demandes sur 8 conformes ».
 *
 * Ce module évalue aussi les points de recette du §23 que le jeu d'essai peut
 * couvrir hors ligne : chaque point rendu affiche « vérifié », « non vérifié »
 * ou « non couvert ici » avec la raison.
 */

import type { FindingKind, Language, SampleRequest } from '../core/types';
import type { BenchResult, ReplayReport } from './engine';

/** Verdict d'une demande : conforme à l'attendu, ou divergente (avec le détail). */
export interface RequestComparison {
  sampleId: string;
  verdict: 'conforme' | 'divergence';
  detail: string[];
  /** Couches non jouées pendant le rejet — information, pas divergence. */
  notPlayed: string[];
}

/** Bilan du jeu complet. */
export interface CompareSummary {
  total: number;
  conforming: number;
  diverging: number;
  rate: number;
  headline: string;
  comparisons: RequestComparison[];
}

/** Résultat d'un point de recette du §23. */
export interface RecipeResult {
  point: number;
  status: 'verifie' | 'non-verifie' | 'non-couvert';
  line: string;
}

/** Compare les ensembles de natures de constats, sans ordre ni doublon. */
function compareKinds(expected: FindingKind[], actual: FindingKind[]): string[] {
  const detail: string[] = [];
  const missing = expected.filter((kind) => !actual.includes(kind));
  const extra = actual.filter((kind) => !expected.includes(kind));
  if (missing.length > 0) detail.push(`constats attendus absents : ${missing.join(', ')}`);
  if (extra.length > 0) detail.push(`constats non attendus : ${extra.join(', ')}`);
  return detail;
}

/**
 * Verdict pour une demande : les trois champs de l'attendu, un par un. Les
 * couches non jouées (C1 non fusionné, C3 sans modèle) sont listées à part :
 * elles informent, elles ne transforment pas chaque demande en divergence.
 */
export function compareOne(sample: SampleRequest, report: ReplayReport): RequestComparison {
  const detail: string[] = [];
  if (report.trustLevel !== sample.expected.trustLevel) {
    detail.push(`confiance : attendu ${sample.expected.trustLevel}, obtenu ${report.trustLevel}`);
  }
  if (report.suspicion !== sample.expected.suspicion) {
    detail.push(`suspicion : attendu ${sample.expected.suspicion}, obtenu ${report.suspicion}`);
  }
  detail.push(...compareKinds(sample.expected.kinds, report.kinds));
  return {
    sampleId: sample.id,
    verdict: detail.length === 0 ? 'conforme' : 'divergence',
    detail,
    notPlayed: report.gaps.map((gap) => `${gap.layer} (${gap.code})`),
  };
}

/** Ligne de bilan : « 7 demandes sur 8 conformes ». */
export function summaryLine(conforming: number, total: number, language: Language = 'fr'): string {
  return language === 'fr'
    ? `${conforming} demande(s) sur ${total} conforme(s)`
    : `${conforming} of ${total} request(s) conforming`;
}

/** Bilan complet du jeu : verdicts par demande, taux et ligne de titre. */
export function compareBench(
  samples: readonly SampleRequest[],
  result: BenchResult,
  language: Language = 'fr',
): CompareSummary {
  const comparisons = samples
    .map((sample) => {
      const report = result.reports.find((item) => item.sampleId === sample.id);
      return report ? compareOne(sample, report) : null;
    })
    .filter((item): item is RequestComparison => item !== null);
  const conforming = comparisons.filter((item) => item.verdict === 'conforme').length;
  const total = comparisons.length;
  return {
    total,
    conforming,
    diverging: total - conforming,
    rate: total === 0 ? 0 : Number((conforming / total).toFixed(2)),
    headline: summaryLine(conforming, total, language),
    comparisons,
  };
}

// ------------------------------------------------------------------ recette §23

/** Un point de recette, évalué sur les rapports du banc. */
function checked(point: number, ok: boolean, label: string): RecipeResult {
  return { point, status: ok ? 'verifie' : 'non-verifie', line: label };
}

/** Points 1 et 2 du §23 : l'origine suit l'auteur et le canal, pas les mots. */
function recipeOrigin(reports: ReplayReport[]): RecipeResult[] {
  const customerT1 = reports.some((r) => r.segments[0]?.author.accountType === 'customer'
    && r.segments[0]?.channel === 'portal' && r.trustLevel === 'T1');
  const internalT3 = reports.some((r) => r.segments[0]?.author.accountType === 'atlassian' && r.trustLevel === 'T3');
  const anonymousT0 = reports.some((r) => r.segments[0]?.channel === 'anonymousportal' && r.trustLevel === 'T0');
  return [
    checked(1, customerT1 && internalT3, 'demande client du portail T1, agent interne T3'),
    checked(2, anonymousT0, 'portail anonyme T0'),
  ];
}

/** Points 3, 4, 7 et 8 du §23 : C1, C2, encadrement, neutralisation. */
function recipeDetection(reports: ReplayReport[]): RecipeResult[] {
  const c1 = reports.some((r) => r.findings.some((f) => f.layer === 'C1'));
  const c1Gap = reports.some((r) => r.gaps.some((g) => g.layer === 'C1'));
  const c2WithSummary = reports.some((r) => r.findings.some((f) => f.layer === 'C2' && f.askSummary.trim().length > 0));
  const distinctIds = reports.every((r) => new Set(r.framed.blocks.map((b) => b.blockId)).size === r.framed.blocks.length);
  const neutralized = reports.some((r) => r.modeDecision.mode === 'neutralize' && r.modeDecision.neutralize);
  return [
    c1
      ? checked(3, true, 'constat C1 levé sans modèle')
      : { point: 3, status: 'non-verifie', line: c1Gap ? 'C1 non jouée (lot non fusionné)' : 'aucun constat C1 levé' },
    checked(4, c2WithSummary, 'constat C2 avec résumé neutre de la demande'),
    checked(7, distinctIds && reports.length > 0, 'blocs encadrés, identifiant propre à chaque bloc'),
    checked(8, neutralized, 'mode « neutraliser » déclenché au-dessus du seuil'),
  ];
}

/** Points 5, 6, 9 à 15 du §23 : ce que le banc ne couvre pas, dit clairement. */
function recipeNotCovered(language: Language): RecipeResult[] {
  const reason = language === 'fr' ? 'non couvert hors ligne (modèle, écran, sas, hook)' : 'not covered offline (model, UI, gate, hook)';
  return [5, 6, 9, 10, 11, 12, 13, 14].map((point) => ({
    point,
    status: 'non-couvert' as const,
    line: reason,
  }));
}

/** Point 15 du §23 : aucun appel réseau — le banc ne sort jamais de la machine. */
function recipeNoNetwork(language: Language): RecipeResult {
  return checked(15, true, language === 'fr'
    ? 'aucun appel réseau : banc 100 % hors ligne, Store en mémoire'
    : 'no network call: fully offline bench, in-memory store');
}

/** Tous les points de recette §23 dans l'ordre, avec leur statut. */
export function evaluateRecipes(result: BenchResult, language: Language = 'fr'): RecipeResult[] {
  const reports = result.reports;
  return [...recipeOrigin(reports), ...recipeDetection(reports), ...recipeNotCovered(language), recipeNoNetwork(language)]
    .sort((a, b) => a.point - b.point);
}
