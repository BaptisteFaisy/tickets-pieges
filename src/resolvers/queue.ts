/**
 * Résolveur de la file « Suspects » (§17.2, §14) — lot UI.
 *
 * `listSuspects` : demandes à examiner, triées par niveau, regroupées par
 * campagne (le domaine tranche via `reviewQueue`). `setVerdict` : verdict en un
 * clic — piégé / faux positif / légitime mais risqué —, journalisé.
 * Aucune exception ne remonte : `{ ok: false, error }`.
 */
import { t } from '../core/i18n';
import { reviewQueue, type ReviewItem } from '../core/precision';
import type { SuspicionLevel, VerdictDecision } from '../core/types';
import type { IssueStateRow, Store, VerdictRow } from '../platform/schema';
import {
  fail,
  ok,
  payloadNumber,
  payloadText,
  accountIdOf,
  type ResolverDeps,
  type SuspectItem,
  type UiHandler,
} from '../ui/api';

const DECISIONS: readonly VerdictDecision[] = ['trapped', 'false-positive', 'legitimate-risky'];

function isDecision(value: string | null): value is VerdictDecision {
  return value !== null && (DECISIONS as readonly string[]).includes(value);
}

function lastVerdict(rows: { decision: VerdictDecision; at: string }[]): VerdictDecision | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  return sorted[sorted.length - 1]?.decision ?? null;
}

async function collectItems(store: Store, states: IssueStateRow[], projectKey: string | null): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const state of states) {
    if (projectKey && state.projectKey !== projectKey) continue;
    const findings = await store.findings.byIssue(state.issueId);
    for (const finding of findings) {
      const verdict = lastVerdict(await store.verdicts.byFinding(finding.id));
      items.push({ finding, issueKey: state.issueKey, suspicion: state.suspicionLevel, campaignHash: finding.campaignHash, verdict: verdict ?? undefined });
    }
  }
  return items;
}

async function toSuspectItems(store: Store, items: ReviewItem[]): Promise<SuspectItem[]> {
  const counts = new Map<string, number>();
  const out: SuspectItem[] = [];
  for (const item of items) {
    let campaignCount = 0;
    if (item.campaignHash) {
      if (!counts.has(item.campaignHash)) {
        const campaign = await store.campaigns.byHash(item.campaignHash);
        counts.set(item.campaignHash, campaign?.count ?? 0);
      }
      campaignCount = counts.get(item.campaignHash) ?? 0;
    }
    out.push({
      findingId: item.finding.id,
      issueKey: item.issueKey,
      suspicion: item.suspicion as SuspicionLevel,
      layer: item.finding.layer,
      kind: item.finding.kind,
      ruleId: item.finding.ruleId,
      excerpt: item.finding.excerpt,
      askSummary: item.finding.askSummary,
      confidence: item.finding.confidence,
      campaignHash: item.campaignHash ?? null,
      campaignCount,
      verdict: item.verdict ?? null,
      createdAt: item.finding.createdAt,
    });
  }
  return out;
}

/** Fabrique les gestionnaires de la file des suspects. */
export function queueResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  const { store, clock } = deps;

  const listSuspects: UiHandler = async (payload) => {
    const limit = payloadNumber(payload, 'limit', 100);
    const projectKey = payloadText(payload, 'projectKey');
    try {
      const states = await store.states.bySuspicion('review', limit);
      const items = await collectItems(store, states, projectKey);
      return ok(await toSuspectItems(store, reviewQueue(items, { groupCampaigns: true })));
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  const setVerdict: UiHandler = async (payload, context) => {
    const findingId = payloadText(payload, 'findingId');
    const decision = payloadText(payload, 'decision');
    if (!findingId) return fail(t('fr', 'ui.error.missing', { name: 'findingId' }));
    if (!isDecision(decision)) return fail(t('fr', 'ui.error.missing', { name: 'decision' }));
    try {
      const finding = await store.findings.byId(findingId);
      if (!finding) return fail(t('fr', 'ui.error.notFound', { name: findingId }));
      const reviewerAccountId = payloadText(payload, 'reviewerAccountId') ?? accountIdOf(context) ?? 'unknown';
      const row: VerdictRow = {
        findingId,
        reviewerAccountId,
        decision,
        reason: payloadText(payload, 'reason'),
        at: clock.now(),
      };
      await store.verdicts.put(row);
      await store.events.append('verdict', finding.issueId, { findingId, decision, by: reviewerAccountId });
      return ok({ findingId, decision });
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  return { listSuspects, setVerdict };
}
