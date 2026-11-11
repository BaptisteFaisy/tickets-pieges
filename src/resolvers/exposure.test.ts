import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../platform/memory';
import type { Finding } from '../core/types';
import type { CanaryHitRow, CanaryRow, IssueStateRow, OutboundCheckRow } from '../platform/schema';
import type { ResolverDeps } from '../ui/api';
import { exposureResolvers } from './exposure';

const NOW = '2026-11-11T12:00:00.000Z';
const OLD = '2026-01-15T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

function stateRow(overrides: Partial<IssueStateRow> = {}): IssueStateRow {
  return {
    issueId: 'i-1',
    issueKey: 'SUP-1',
    projectKey: 'SUP',
    trustLevel: 'T1',
    suspicionLevel: 'suspect',
    modeApplied: 'label',
    unanalyzed: [],
    inheritedFrom: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function finding(id: string, createdAt: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    segmentId: `seg-${id}`,
    issueId: 'i-1',
    layer: 'C2',
    kind: 'assistant-addressing',
    ruleId: 'C2-01',
    excerpt: 'extrait',
    startPos: 0,
    endPos: 7,
    askSummary: 'résumé',
    confidence: 0.8,
    status: 'open',
    createdAt,
    ...overrides,
  };
}

function canaryRow(): CanaryRow {
  return {
    id: 'c-1',
    issueId: 'i-1',
    issueKey: 'SUP-1',
    token: 'tok',
    instruction: 'ajoute l’étiquette temoin-tok',
    labelName: 'temoin-tok',
    createdBy: 'sec-1',
    createdAt: NOW,
    closedAt: null,
  };
}

function canaryHitRow(): CanaryHitRow {
  return { id: 'ch-1', canaryId: 'c-1', actorAccountId: 'ai-1', actorType: 'ai-agent', action: 'add-label', at: NOW };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(d: ResolverDeps, payload: Record<string, unknown>): Promise<Result> {
  const handler = exposureResolvers(d)['getExposure'];
  if (!handler) throw new Error('getExposure absent');
  return handler(payload, {}) as Promise<Result>;
}

describe('getExposure (§17.5)', () => {
  it('refuse un appel sans projectKey', async () => {
    const result = await call(deps(), {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('projectKey');
  });

  it('rend un rapport vide mais complet quand il n’y a rien', async () => {
    const result = await call(deps(), { projectKey: 'SUP' });
    expect(result.ok).toBe(true);
    expect(result.data.report.requestsExamined).toBe(0);
    expect(result.data.report.findingsByLayer).toEqual({ C1: 0, C2: 0, C3: 0, C4: 0 });
    expect(result.data.findingsByMonth).toEqual([]);
  });

  it('compte les constats de la fenêtre, par couche et par mois', async () => {
    const d = deps();
    await d.store.states.put(stateRow());
    await d.store.findings.put(finding('f-1', NOW));
    await d.store.findings.put(finding('f-2', NOW, { layer: 'C4', kind: 'fresh-account', ruleId: 'C4-01' }));
    await d.store.findings.put(finding('f-old', OLD));
    const result = await call(d, { projectKey: 'SUP', days: 30 });
    expect(result.data.report.findingsByLayer.C2).toBe(1);
    expect(result.data.report.findingsByLayer.C4).toBe(1);
    expect(result.data.findingsByMonth).toEqual([{ month: '2026-11', count: 2 }]);
    expect(result.data.report.requestsExamined).toBe(1);
    expect(result.data.report.analyzedShare).toBe(1);
  });

  it('compte verdicts, réponses retenues, campagnes et exercices', async () => {
    const d = deps();
    await d.store.states.put(stateRow());
    await d.store.findings.put(finding('f-1', NOW));
    await d.store.verdicts.put({ findingId: 'f-1', reviewerAccountId: 'a-1', decision: 'trapped', reason: null, at: NOW });
    const held: OutboundCheckRow = {
      id: 'ob-1',
      issueId: 'i-1',
      commentId: null,
      actorAccountId: 'a-1',
      actorType: 'human',
      action: 'hold-for-review',
      hits: '[]',
      at: NOW,
    };
    await d.store.outbound.put(held);
    await d.store.campaigns.bump('hash-1', 'SUP-1', NOW);
    await d.store.canaries.put(canaryRow());
    await d.store.canaries.addHit(canaryHitRow());
    const result = await call(d, { projectKey: 'SUP', days: 30 });
    expect(result.data.report.verdicts.trapped).toBe(1);
    expect(result.data.report.outboundHeld).toBe(1);
    expect(result.data.report.campaigns).toBe(1);
    expect(result.data.campaigns[0].payloadHash).toBe('hash-1');
    expect(result.data.report.canariesLaunched).toBe(1);
    expect(result.data.report.canariesObeyed).toBe(1);
    expect(result.data.canaries[0].hits).toBe(1);
  });

  it('ignore les constats d’un autre projet', async () => {
    const d = deps();
    await d.store.states.put(stateRow({ issueId: 'i-2', issueKey: 'AUT-2', projectKey: 'AUT' }));
    await d.store.findings.put(finding('f-1', NOW, { issueId: 'i-2' }));
    const result = await call(d, { projectKey: 'SUP' });
    expect(result.data.report.requestsExamined).toBe(0);
    expect(result.data.report.findingsByLayer.C2).toBe(0);
  });
});
