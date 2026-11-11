/**
 * Rapport d'exposition (§13, §14, TP-16) — le chiffre qui remplace l'intuition.
 *
 * « Rejoué après l'activation des protections, l'exercice montre l'avant et
 * l'après. » Le rapport agrège : demandes examinées et part réellement analysée,
 * constats par couche, verdicts humains, exercices et leur taux d'effet, réponses
 * retenues par le sas, campagnes, motifs les plus fréquents.
 *
 * Rien ici n'accuse une personne : les exercices se lisent par **type d'acteur**
 * (§13), et les constats par motif (§14).
 */

import type {
  Canary,
  CanaryActorType,
  CanaryHit,
  DetectionLayer,
  ExposureReport,
  Finding,
  FindingKind,
  OutboundAction,
  Verdict,
  VerdictDecision,
} from './types';
import { DETECTION_LAYERS } from './types';
import { obedienceRate } from './canary';

/** Ce qu'il faut pour produire un rapport : des lignes, une fenêtre, un projet. */
export interface ExposureInput {
  projectKey: string;
  from: string;
  to: string;
  requestsExamined: number;
  /** Demandes dont tous les segments ont été analysés (part réellement analysée). */
  requestsFullyAnalyzed: number;
  findings: Finding[];
  verdicts: Verdict[];
  canaries: Canary[];
  canaryHits: CanaryHit[];
  /** Actions décidées par le sas (§10) sur la fenêtre. */
  outboundActions: OutboundAction[];
  campaigns: number;
}

const EMPTY_VERDICTS: Record<VerdictDecision, number> = {
  'false-positive': 0,
  'legitimate-risky': 0,
  trapped: 0,
};

/** Constats par couche, toutes les couches étant toujours présentes (§17.5). */
export function findingsByLayer(findings: Finding[]): Record<DetectionLayer, number> {
  const counts = { C1: 0, C2: 0, C3: 0, C4: 0 } as Record<DetectionLayer, number>;
  for (const finding of findings) counts[finding.layer] += 1;
  return counts;
}

/** Motifs les plus fréquents, du plus fréquent au moins fréquent. */
export function topKinds(findings: Finding[], limit = 5): { kind: FindingKind; count: number }[] {
  const counts = new Map<FindingKind, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, limit);
}

/** Verdicts humains par décision (§14). */
export function verdictCounts(verdicts: Verdict[]): Record<VerdictDecision, number> {
  const counts: Record<VerdictDecision, number> = { ...EMPTY_VERDICTS };
  for (const verdict of verdicts) counts[verdict.decision] += 1;
  return counts;
}

/** Réponses retenues par le sas : tout ce qui n'est pas `allow` (§10). */
export function outboundHeld(actions: OutboundAction[]): number {
  return actions.filter((action) => action !== 'allow').length;
}

/** Exercices suivis d'effet : au moins un coup enregistré (§13). */
export function obeyedCanaries(canaries: Canary[], hits: CanaryHit[]): number {
  const hitCanaries = new Set(hits.map((hit) => hit.canaryId));
  return canaries.filter((canary) => hitCanaries.has(canary.id)).length;
}

/** Construit le rapport d'exposition d'une fenêtre. */
export function buildExposureReport(input: ExposureInput): ExposureReport {
  const launched = input.canaries.length;
  const obeyed = obeyedCanaries(input.canaries, input.canaryHits);
  const examined = Math.max(0, input.requestsExamined);
  return {
    projectKey: input.projectKey,
    from: input.from,
    to: input.to,
    requestsExamined: examined,
    analyzedShare: examined === 0 ? 0 : Number((Math.min(examined, input.requestsFullyAnalyzed) / examined).toFixed(2)),
    findingsByLayer: findingsByLayer(input.findings),
    verdicts: verdictCounts(input.verdicts),
    canariesLaunched: launched,
    canariesObeyed: obeyed,
    obedienceRate: obedienceRate(launched, obeyed),
    outboundHeld: outboundHeld(input.outboundActions),
    campaigns: input.campaigns,
    topKinds: topKinds(input.findings),
  };
}

/** Deux rapports côte à côte : l'avant et l'après activation des protections. */
export interface PeriodComparison {
  before: ExposureReport;
  after: ExposureReport;
  change: {
    obedienceRate: number;
    outboundHeld: number;
    suspectFindings: number;
    analyzedShare: number;
  };
}

export function comparePeriods(before: ExposureReport, after: ExposureReport): PeriodComparison {
  const suspects = (report: ExposureReport): number =>
    report.findingsByLayer.C1 + report.findingsByLayer.C2 + report.findingsByLayer.C3;
  return {
    before,
    after,
    change: {
      obedienceRate: round2(after.obedienceRate - before.obedienceRate),
      outboundHeld: after.outboundHeld - before.outboundHeld,
      suspectFindings: suspects(after) - suspects(before),
      analyzedShare: round2(after.analyzedShare - before.analyzedShare),
    },
  };
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Répartition des coups d'exercice par type d'acteur (§13 : jamais par personne). */
export function hitsByActorType(hits: CanaryHit[]): Record<CanaryActorType, number> {
  const counts: Record<CanaryActorType, number> = { human: 0, 'ai-agent': 0, automation: 0, unknown: 0 };
  for (const hit of hits) counts[hit.actorType] += 1;
  return counts;
}
