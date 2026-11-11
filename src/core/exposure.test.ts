import { describe, expect, it } from 'vitest';
import type { Canary, CanaryHit, Finding, OutboundAction, Verdict } from './types';
import { buildExposureReport, comparePeriods, findingsByLayer, hitsByActorType, obeyedCanaries, outboundHeld, topKinds, verdictCounts } from './exposure';
import type { ExposureInput } from './exposure';

const NOW = '2026-11-11T10:00:00.000Z';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1', segmentId: 's1', issueId: '10001', layer: 'C2', kind: 'assistant-addressing', ruleId: 'C2-01',
    excerpt: 'x', startPos: 0, endPos: 1, askSummary: 'consigne', confidence: 0.8, status: 'open', createdAt: NOW,
    ...overrides,
  };
}

function base(overrides: Partial<ExposureInput> = {}): ExposureInput {
  return {
    projectKey: 'SUP', from: '2026-10-12T00:00:00.000Z', to: NOW,
    requestsExamined: 10, requestsFullyAnalyzed: 8,
    findings: [], verdicts: [], canaries: [], canaryHits: [], outboundActions: [], campaigns: 0,
    ...overrides,
  };
}

const canaryRow = (id: string): Canary => ({
  id, issueId: '10001', issueKey: 'SUP-900', token: id, instruction: 'x', labelName: `temoin-${id}`,
  createdBy: 'acc-secu', createdAt: NOW, status: 'closed', closedAt: NOW,
});

const hit = (canaryId: string, actorType: CanaryHit['actorType']): CanaryHit => ({
  canaryId, actorAccountId: 'acc-1', actorType, action: 'label', at: NOW,
});

describe('rapport d’exposition (§13, §14, TP-16)', () => {
  it('compte les constats par couche, toutes les couches présentes', () => {
    const counts = findingsByLayer([finding(), finding({ layer: 'C1', kind: 'invisible-chars' }), finding()]);
    expect(counts).toEqual({ C1: 1, C2: 2, C3: 0, C4: 0 });
  });

  it('donne les motifs les plus fréquents, en nombre décroissant', () => {
    const kinds = topKinds([finding(), finding({ id: 'f2' }), finding({ id: 'f3', kind: 'encoded-block', layer: 'C1' })]);
    expect(kinds[0]).toEqual({ kind: 'assistant-addressing', count: 2 });
    expect(kinds).toHaveLength(2);
  });

  it('compte les verdicts humains par décision', () => {
    const counts = verdictCounts([
      { findingId: 'f1', reviewerAccountId: 'a', decision: 'trapped', at: NOW } as Verdict,
      { findingId: 'f2', reviewerAccountId: 'a', decision: 'false-positive', at: NOW } as Verdict,
    ]);
    expect(counts).toEqual({ trapped: 1, 'false-positive': 1, 'legitimate-risky': 0 });
  });

  it('« deux exercices sur cinq ont été suivis d’effet » (§13)', () => {
    const canaries = ['c1', 'c2', 'c3', 'c4', 'c5'].map(canaryRow);
    const hits = [hit('c1', 'ai-agent'), hit('c3', 'ai-agent'), hit('c1', 'human')];
    expect(obeyedCanaries(canaries, hits)).toBe(2);
    const report = buildExposureReport(base({ canaries, canaryHits: hits }));
    expect(report.canariesLaunched).toBe(5);
    expect(report.canariesObeyed).toBe(2);
    expect(report.obedienceRate).toBe(0.4);
  });

  it('compte les réponses retenues par le sas, et pas celles qui sont parties', () => {
    const actions: OutboundAction[] = ['allow', 'hold-for-review', 'convert-to-internal', 'alert', 'allow'];
    expect(outboundHeld(actions)).toBe(3);
  });

  it('dit la part des demandes réellement analysées (§21)', () => {
    expect(buildExposureReport(base()).analyzedShare).toBe(0.8);
    expect(buildExposureReport(base({ requestsExamined: 0 })).analyzedShare).toBe(0);
  });

  it('l’avant/après se lit en un coup d’œil (§13)', () => {
    const before = buildExposureReport(base({ canaries: ['c1', 'c2'].map(canaryRow), canaryHits: [hit('c1', 'ai-agent'), hit('c2', 'ai-agent')] }));
    const after = buildExposureReport(base({ canaries: ['c3', 'c4'].map(canaryRow), canaryHits: [] }));
    const comparison = comparePeriods(before, after);
    expect(comparison.change.obedienceRate).toBe(-1);
    expect(comparison.before.obedienceRate).toBe(1);
    expect(comparison.after.obedienceRate).toBe(0);
  });

  it('les coups se lisent par type d’acteur, jamais par personne (§13)', () => {
    const counts = hitsByActorType([hit('c1', 'ai-agent'), hit('c2', 'ai-agent'), hit('c3', 'human')]);
    expect(counts).toEqual({ 'ai-agent': 2, human: 1, automation: 0, unknown: 0 });
  });
});
