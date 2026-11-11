/**
 * Résolveur de la page « Exposition » (§17.5) — lot UI.
 *
 * `getExposure` : rapport du domaine (`buildExposureReport`) enrichi pour
 * l'écran — constats par mois, campagnes, exercices. Aucune exception ne
 * remonte : `{ ok: false, error }`.
 *
 * Limites connues (voir PR) : `CanaryRepo` n'expose que les exercices ouverts ;
 * les exercices fermés ne sont pas comptés tant que le stockage Forge SQL
 * (`src/platform/db.ts`) n'offre pas de lecture complète.
 */
import { buildExposureReport } from '../core/exposure';
import { t } from '../core/i18n';
import type { Canary, CanaryHit, OutboundAction, Verdict } from '../core/types';
import type { CanaryHitRow, CanaryRow, IssueStateRow } from '../platform/schema';
import {
  fail,
  ok,
  payloadNumber,
  payloadText,
  type ExposureView,
  type ResolverDeps,
  type UiHandler,
} from '../ui/api';
import { byMonth } from '../ui/format';

const MAX_STATES = 1000;
const DAY_MS = 86_400_000;

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

function hitsByCanary(rows: CanaryHitRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.canaryId, (counts.get(row.canaryId) ?? 0) + 1);
  return counts;
}

interface WindowData {
  from: string;
  to: string;
  states: IssueStateRow[];
  windowFindings: import('../core/types').Finding[];
  verdicts: Verdict[];
  canaries: Canary[];
  allHits: CanaryHitRow[];
  outboundActions: OutboundAction[];
  campaigns: { payloadHash: string; count: number; firstSeen: string; lastSeen: string; issueKeys: string[] }[];
}

async function collectWindow(
  store: ResolverDeps['store'],
  now: () => string,
  projectKey: string,
  days: number,
): Promise<WindowData> {
  const to = now();
  const from = new Date(Date.parse(to) - days * DAY_MS).toISOString();
  const states = (await store.states.bySuspicion('clean', MAX_STATES)).filter(
    (state) => state.projectKey === projectKey,
  );
  const issueIds = new Set(states.map((state) => state.issueId));
  const findings = (await Promise.all(states.map((state) => store.findings.byIssue(state.issueId)))).flat();
  const findingIds = new Set(findings.map((finding) => finding.id));
  const verdicts = toVerdicts(await store.verdicts.since(from), findingIds);
  const canaryRows = (await store.canaries.open()).filter((row) => issueIds.has(row.issueId));
  const canaries = canaryRows.map(toCanary);
  const canaryIds = new Set(canaries.map((canary) => canary.id));
  const allHits = (await store.canaries.allHits()).filter((row) => canaryIds.has(row.canaryId));
  const outboundActions: OutboundAction[] = (await store.outbound.since(from))
    .filter((row) => issueIds.has(row.issueId))
    .map((row) => row.action as OutboundAction);
  const campaigns = (await store.campaigns.list())
    .filter((row) => row.lastSeen >= from)
    .map((row) => ({
      payloadHash: row.payloadHash,
      count: row.count,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      issueKeys: row.issueKeys,
    }));
  return {
    from,
    to,
    states,
    windowFindings: findings.filter((finding) => finding.createdAt >= from),
    verdicts,
    canaries,
    allHits,
    outboundActions,
    campaigns,
  };
}

function toVerdicts(rows: { findingId: string; reviewerAccountId: string; decision: Verdict['decision']; reason: string | null; at: string }[], findingIds: Set<string>): Verdict[] {
  return rows
    .filter((row) => findingIds.has(row.findingId))
    .map((row) => ({
      findingId: row.findingId,
      reviewerAccountId: row.reviewerAccountId,
      decision: row.decision,
      reason: row.reason ?? undefined,
      at: row.at,
    }));
}

/** Fabrique les gestionnaires de la page d'exposition. */
export function exposureResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  const { store, clock } = deps;

  const getExposure: UiHandler = async (payload) => {
    const projectKey = payloadText(payload, 'projectKey');
    if (!projectKey) return fail(t('fr', 'ui.error.missing', { name: 'projectKey' }));
    const days = payloadNumber(payload, 'days', 30, 365);
    try {
      return ok(await buildView(store, () => clock.now(), projectKey, days));
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  return { getExposure };
}

async function buildView(
  store: ResolverDeps['store'],
  now: () => string,
  projectKey: string,
  days: number,
): Promise<ExposureView> {
  const window_ = await collectWindow(store, now, projectKey, days);
  const report = buildExposureReport({
    projectKey,
    from: window_.from,
    to: window_.to,
    requestsExamined: window_.states.length,
    requestsFullyAnalyzed: window_.states.filter((state) => state.unanalyzed.length === 0).length,
    findings: window_.windowFindings,
    verdicts: window_.verdicts,
    canaries: window_.canaries,
    canaryHits: window_.allHits as CanaryHit[],
    outboundActions: window_.outboundActions,
    campaigns: window_.campaigns.length,
  });
  const hits = hitsByCanary(window_.allHits);
  return {
    report,
    findingsByMonth: byMonth(window_.windowFindings.map((finding) => finding.createdAt)),
    campaigns: window_.campaigns,
    canaries: window_.canaries.map((canary) => ({
      issueKey: canary.issueKey,
      createdAt: canary.createdAt,
      closedAt: canary.closedAt ?? null,
      hits: hits.get(canary.id) ?? 0,
    })),
  };
}
