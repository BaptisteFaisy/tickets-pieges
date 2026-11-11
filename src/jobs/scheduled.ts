/**
 * Tâches planifiées (§13, §14, §18) — lot Jobs.
 *
 * `daily-maintenance` : fermeture des exercices d'alerte arrivés à échéance
 * (§13) et précision des règles recalculée depuis les verdicts humains (§14) —
 * un motif imprécis est rétrogradé en simple pondération.
 * `weekly-report` : rapport d'exposition de la semaine (§14, TP-16), construit
 * par le domaine (`src/core/exposure.ts`) et journalisé.
 *
 * Les dépendances sont injectables (`resolveDeps` par défaut) : les deux tâches
 * se testent sans réseau, avec `createMemoryStore()`.
 */

import type { Canary, CanaryHit, OutboundAction, Verdict } from '../core/types';
import type { ExposureReport } from '../core/types';
import { CANARY_TTL_HOURS, isExpired } from '../core/canary';
import { computePrecision, shouldDemote, statsByRule } from '../core/precision';
import { buildExposureReport } from '../core/exposure';
import type { CanaryRow, VerdictRow } from '../platform/schema';
import { daysBefore, resolveDeps, type JobsDeps } from './support';

/** Fenêtre de la précision des règles : les verdicts des 90 derniers jours. */
const PRECISION_WINDOW_DAYS = 90;
/** Fenêtre du rapport hebdomadaire. */
const REPORT_WINDOW_DAYS = 7;
/** Les actions du sas (§10) : ce qui est journalisé en dehors est ignoré. */
const OUTBOUND_ACTIONS: readonly OutboundAction[] = ['allow', 'hold-for-review', 'convert-to-internal', 'alert'];

function toCanary(row: CanaryRow): Canary {
  return {
    id: row.id,
    issueId: row.issueId,
    issueKey: row.issueKey,
    token: row.token,
    instruction: row.instruction,
    labelName: row.labelName,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    closedAt: row.closedAt ?? undefined,
    status: row.closedAt ? 'closed' : 'open',
  };
}

function toHit(row: { canaryId: string; actorAccountId: string; actorType: CanaryHit['actorType']; action: string; at: string }): CanaryHit {
  return {
    canaryId: row.canaryId,
    actorAccountId: row.actorAccountId,
    actorType: row.actorType,
    action: row.action,
    at: row.at,
  };
}

/** Ligne SQL → verdict du domaine (`reason` nullable côté table). */
function toVerdict(row: VerdictRow): Verdict {
  return {
    findingId: row.findingId,
    reviewerAccountId: row.reviewerAccountId,
    decision: row.decision,
    reason: row.reason ?? undefined,
    at: row.at,
  };
}

/** §13 : les exercices échus se ferment seuls — jamais laissés ouverts. */
async function closeExpiredCanaries(deps: JobsDeps, now: string): Promise<number> {
  const open = await deps.store.canaries.open();
  let closed = 0;
  for (const row of open) {
    if (!isExpired(toCanary(row), now, CANARY_TTL_HOURS)) continue;
    await deps.store.canaries.close(row.id, now);
    closed += 1;
  }
  return closed;
}

/** §14 : précision par règle, rétrogradation des motifs imprécis. */
async function refreshRulePrecision(deps: JobsDeps, now: string): Promise<{ rules: number; demoted: number }> {
  const from = daysBefore(now, PRECISION_WINDOW_DAYS);
  const findings = await deps.store.findings.since(from);
  const verdicts = (await deps.store.verdicts.since(from)).map(toVerdict);
  const byRuleId = new Map((await deps.store.patterns.list()).map((row) => [row.id, row]));
  let demoted = 0;
  for (const stats of statsByRule(findings, verdicts)) {
    const precision = computePrecision(stats);
    const isDemoted = shouldDemote(stats);
    if (isDemoted) demoted += 1;
    const existing = byRuleId.get(stats.ruleId);
    if (existing) await deps.store.patterns.setPrecision(existing.id, precision.precision, isDemoted);
    else {
      await deps.store.patterns.put({
        id: stats.ruleId, layer: stats.layer, kind: stats.kind, expression: '',
        language: 'fr', precision: precision.precision, enabled: true, demoted: isDemoted,
      });
    }
  }
  return { rules: statsByRule(findings, verdicts).length, demoted };
}

/** `scheduledTrigger` quotidien : exercices échus (§13) + précision (§14). */
export async function dailyMaintenance(deps: JobsDeps = resolveDeps()): Promise<{ closed: number; rules: number; demoted: number }> {
  const now = deps.clock.now();
  const closed = await closeExpiredCanaries(deps, now);
  const precision = await refreshRulePrecision(deps, now);
  await deps.store.events.append('maintenance.quotidienne', null, { exercicesFerme: closed, ...precision });
  return { closed, ...precision };
}

/** Rassemble les lignes de la fenêtre pour le rapport d'exposition (§14). */
async function collectExposure(deps: JobsDeps, from: string, to: string) {
  const findings = await deps.store.findings.since(from);
  const verdicts = await deps.store.verdicts.since(from);
  const canaryRows = await deps.store.canaries.open();
  const hitRows = await deps.store.canaries.allHits();
  const outboundRows = await deps.store.outbound.since(from);
  const states = await deps.store.states.bySuspicion('clean', 500);
  const campaigns = await deps.store.campaigns.list();
  return {
    findings,
    verdicts: verdicts.map(toVerdict),
    canaries: canaryRows.map(toCanary),
    canaryHits: hitRows.map(toHit),
    outboundActions: outboundRows
      .map((row) => row.action as OutboundAction)
      .filter((action) => OUTBOUND_ACTIONS.includes(action)),
    requestsExamined: states.length,
    requestsFullyAnalyzed: states.filter((row) => row.unanalyzed.length === 0).length,
    campaigns: campaigns.length,
    to,
  };
}

/** `scheduledTrigger` hebdomadaire : rapport d'exposition (§14, TP-16). */
export async function weeklyReport(deps: JobsDeps = resolveDeps()): Promise<ExposureReport> {
  const now = deps.clock.now();
  const from = daysBefore(now, REPORT_WINDOW_DAYS);
  const collected = await collectExposure(deps, from, now);
  const report = buildExposureReport({ projectKey: '*', from, ...collected });
  await deps.store.events.append('rapport.hebdomadaire', null, report);
  return report;
}
