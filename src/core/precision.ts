/**
 * Revue humaine et apprentissage (§14, TP-14) — file des suspects, verdicts,
 * précision par règle, export des originaux.
 *
 * « Le taux de faux positifs est suivi motif par motif. Un motif imprécis est
 * rétrogradé en simple pondération. » C'est ce qui évite le scénario du §27 :
 * des faux positifs qui lassent le support, et une app désactivée.
 */

import type { DetectionLayer, Finding, FindingKind, Language, RulePrecision, SuspicionLevel, Verdict, VerdictDecision } from './types';
import { SUSPICION_RANK } from './types';
import { t } from './i18n';

/** En dessous de cette précision, et avec assez de retours, la règle est rétrogradée. */
export const DEMOTION_THRESHOLD = 0.5;

/** Nombre minimal de verdicts avant de juger une règle : pas de rétrogradation à chaud. */
export const MIN_SAMPLES = 5;

/** Comptes bruts d'une règle, tels que les verdicts humains les produisent. */
export interface RuleStats {
  ruleId: string;
  layer: DetectionLayer;
  kind: FindingKind;
  truePositives: number;
  falsePositives: number;
}

/** Précision d'une règle : les verdicts `legitimate-risky` comptent comme vrais positifs. */
export function computePrecision(stats: RuleStats): RulePrecision {
  const total = stats.truePositives + stats.falsePositives;
  const precision = total === 0 ? 1 : Number((stats.truePositives / total).toFixed(3));
  return {
    ruleId: stats.ruleId,
    layer: stats.layer,
    kind: stats.kind,
    truePositives: stats.truePositives,
    falsePositives: stats.falsePositives,
    precision,
    enabled: true,
    demoted: false,
  };
}

/** Une règle est-elle à rétrograder en simple pondération ? (§14) */
export function shouldDemote(stats: RuleStats): boolean {
  const total = stats.truePositives + stats.falsePositives;
  if (total < MIN_SAMPLES) return false;
  return computePrecision(stats).precision < DEMOTION_THRESHOLD;
}

/** Compte les verdicts par règle, à partir des constats et de leurs verdicts. */
export function statsByRule(findings: Finding[], verdicts: Verdict[]): RuleStats[] {
  const lastVerdict = new Map<string, Verdict>();
  for (const verdict of verdicts) {
    const known = lastVerdict.get(verdict.findingId);
    if (!known || verdict.at >= known.at) lastVerdict.set(verdict.findingId, verdict);
  }
  const stats = new Map<string, RuleStats>();
  for (const finding of findings) {
    const entry = stats.get(finding.ruleId) ?? {
      ruleId: finding.ruleId,
      layer: finding.layer,
      kind: finding.kind,
      truePositives: 0,
      falsePositives: 0,
    };
    const decision = lastVerdict.get(finding.id)?.decision;
    if (decision === 'false-positive') entry.falsePositives += 1;
    else if (decision) entry.truePositives += 1;
    stats.set(finding.ruleId, entry);
  }
  return [...stats.values()];
}

/** Une ligne de la file des suspects : le constat, son ticket, son verdict éventuel. */
export interface ReviewItem {
  finding: Finding;
  issueKey: string;
  suspicion: SuspicionLevel;
  campaignHash?: string;
  verdict?: VerdictDecision;
}

/**
 * File des suspects (§14, §17.2) : niveau décroissant, campagnes regroupées,
 * puis ancienneté. Les constats déjà jugés passent en dernier — la file montre ce
 * qui reste à trancher. Une campagne n'apparaît qu'une fois par défaut.
 */
export function reviewQueue(
  items: ReviewItem[],
  options: { groupCampaigns?: boolean } = {},
): ReviewItem[] {
  const grouped = options.groupCampaigns === false ? items : groupByCampaign(items);
  return grouped.sort((a, b) => {
    if (Boolean(a.verdict) !== Boolean(b.verdict)) return a.verdict ? 1 : -1;
    const bySuspicion = SUSPICION_RANK[b.suspicion] - SUSPICION_RANK[a.suspicion];
    if (bySuspicion !== 0) return bySuspicion;
    return a.finding.createdAt.localeCompare(b.finding.createdAt);
  });
}

/** Une charge identique sur plusieurs tickets ne fait qu'une entrée (§14). */
function groupByCampaign(items: ReviewItem[]): ReviewItem[] {
  const seen = new Set<string>();
  const out: ReviewItem[] = [];
  for (const item of items) {
    const key = item.campaignHash ?? item.finding.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Libellé d'un verdict, pour l'écran de revue (§17.3). */
export function verdictLabel(decision: VerdictDecision, language: Language): string {
  return t(language, `verdict.${decision}`);
}

/**
 * Export des originaux conservés avant désinstallation (§22).
 *
 * L'export est du JSON stable : aucun secret, aucune clé en clair, et le texte
 * d'origine est rendu tel quel pour que la sécurité puisse le relire — il est
 * destiné à un fichier, jamais à un écran d'agent.
 */
export function exportOriginals(
  rows: { id: string; segmentId: string; issueId: string; content: string; storedAt: string; restoredAt: string | null }[],
): string {
  return JSON.stringify(
    {
      exportedFrom: 'tickets-pieges',
      note: 'Originals kept outside the ticket. Inert text: never render it as markup.',
      count: rows.length,
      originals: rows.map((row) => ({
        id: row.id,
        segmentId: row.segmentId,
        issueId: row.issueId,
        storedAt: row.storedAt,
        restoredAt: row.restoredAt,
        content: row.content,
      })),
    },
    null,
    2,
  );
}
