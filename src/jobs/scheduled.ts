/**
 * Tâches planifiées (§13, §14, §18).
 *
 * `dailyMaintenance` — ferme les exercices arrivés à échéance (le ticket témoin
 * se ferme seul, §13) et recalcule la précision des règles : un motif imprécis
 * est rétrogradé en simple pondération (§14).
 *
 * `weeklyReport` — produit le rapport d'exposition de la semaine (§14) et le
 * journalise. Le rapport ne nomme personne : les exercices se lisent par type
 * d'acteur (§13).
 */

import { closeCanary, isExpired } from '../core/canary';
import { buildExposureReport, hitsByActorType } from '../core/exposure';
import { computePrecision, shouldDemote, statsByRule } from '../core/precision';
import type { Verdict } from '../core/types';
import type { VerdictRow } from '../platform/schema';
import { createForgeDeps } from './support';

/** Les lignes stockées ont un `reason` nullable ; le domaine veut `undefined`. */
function toVerdicts(rows: VerdictRow[]): Verdict[] {
  return rows.map((row) => ({
    findingId: row.findingId,
    reviewerAccountId: row.reviewerAccountId,
    decision: row.decision,
    reason: row.reason ?? undefined,
    at: row.at,
  }));
}

/** Fenêtre du rapport hebdomadaire, en millisecondes. */
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Ferme les exercices échus et rend leur nombre. */
export async function closeExpiredCanaries(deps: Awaited<ReturnType<typeof createForgeDeps>>, now: string): Promise<number> {
  let closed = 0;
  for (const row of await deps.store.canaries.open()) {
    const canary = { ...row, closedAt: row.closedAt ?? undefined, status: 'open' as const };
    if (!isExpired(canary, now)) continue;
    const done = closeCanary(canary, now);
    await deps.store.canaries.close(done.id, now);
    await deps.store.events.append('canary-closed', done.issueId, { canaryId: done.id });
    closed += 1;
  }
  return closed;
}

/** Recalcule la précision de chaque règle et rétrograde les motifs imprécis (§14). */
export async function refreshRulePrecision(deps: Awaited<ReturnType<typeof createForgeDeps>>): Promise<number> {
  const findings = await deps.store.findings.since(new Date(0).toISOString());
  const verdicts = toVerdicts(await deps.store.verdicts.since(new Date(0).toISOString()));
  let demoted = 0;
  for (const stats of statsByRule(findings, verdicts)) {
    const precision = computePrecision(stats);
    const demote = shouldDemote(stats);
    await deps.store.patterns.setPrecision(stats.ruleId, precision.precision, demote);
    if (demote) demoted += 1;
  }
  return demoted;
}

/** `scheduledTrigger` quotidien. */
export async function dailyMaintenance(): Promise<{ closed: number; demoted: number }> {
  const deps = await createForgeDeps();
  const now = deps.clock.now();
  const closed = await closeExpiredCanaries(deps, now);
  const demoted = await refreshRulePrecision(deps);
  await deps.store.events.append('maintenance', null, { closed, demoted });
  return { closed, demoted };
}

/** `scheduledTrigger` hebdomadaire : le rapport d'exposition (§14). */
export async function weeklyReport(): Promise<{ projects: number }> {
  const deps = await createForgeDeps();
  const now = deps.clock.now();
  const from = new Date(Date.parse(now) - WEEK_MS).toISOString();
  const findings = await deps.store.findings.since(from);
  const verdicts = toVerdicts(await deps.store.verdicts.since(from));
  const outbound = await deps.store.outbound.since(from);
  const canaries = await deps.store.canaries.open();
  const hits = await deps.store.canaries.allHits();
  const projects = new Set(findings.map((finding) => finding.issueId.slice(0, 0) || finding.issueId));

  const report = buildExposureReport({
    projectKey: '*',
    from,
    to: now,
    requestsExamined: (await deps.store.states.bySuspicion('clean', 1000)).length,
    requestsFullyAnalyzed: (await deps.store.states.bySuspicion('clean', 1000)).filter((s) => s.unanalyzed.length === 0).length,
    findings,
    verdicts,
    canaries: canaries.map((row) => ({ ...row, closedAt: row.closedAt ?? undefined, status: 'open' as const })),
    canaryHits: hits,
    outboundActions: outbound.map((row) => row.action as 'allow' | 'hold-for-review' | 'convert-to-internal' | 'alert'),
    campaigns: (await deps.store.campaigns.list()).length,
  });

  await deps.store.events.append('weekly-report', null, { ...report, byActor: hitsByActorType(hits) });
  return { projects: projects.size };
}
