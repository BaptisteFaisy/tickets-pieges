import { describe, expect, it } from 'vitest';
import type { Finding, Verdict } from './types';
import {
  DEMOTION_THRESHOLD,
  MIN_SAMPLES,
  computePrecision,
  exportOriginals,
  reviewQueue,
  shouldDemote,
  statsByRule,
  verdictLabel,
} from './precision';

const NOW = '2026-11-11T10:00:00.000Z';

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id, segmentId: 'seg-1', issueId: '10001', layer: 'C2', kind: 'assistant-addressing',
    ruleId: 'C2-01', excerpt: 'x', startPos: 0, endPos: 5, askSummary: 'consigne à une IA',
    confidence: 0.8, status: 'open', createdAt: NOW, ...overrides,
  };
}

function verdict(findingId: string, decision: Verdict['decision'], at = NOW): Verdict {
  return { findingId, reviewerAccountId: 'acc-agent', decision, at };
}

describe('précision par règle (§14)', () => {
  it('compte vrais et faux positifs à partir des verdicts', () => {
    const stats = statsByRule(
      [finding('f1'), finding('f2'), finding('f3', { ruleId: 'C1-01', layer: 'C1', kind: 'invisible-chars' })],
      [verdict('f1', 'trapped'), verdict('f2', 'false-positive')],
    );
    const c2 = stats.find((s) => s.ruleId === 'C2-01');
    expect(c2?.truePositives).toBe(1);
    expect(c2?.falsePositives).toBe(1);
    expect(computePrecision(c2!).precision).toBe(0.5);
  });

  it('un verdict « légitime mais risqué » compte comme un vrai positif', () => {
    const stats = statsByRule([finding('f1')], [verdict('f1', 'legitimate-risky')]);
    expect(stats[0]?.truePositives).toBe(1);
    expect(stats[0]?.falsePositives).toBe(0);
  });

  it('sans verdict, la précision vaut 1 et rien n’est rétrogradé', () => {
    const stats = statsByRule([finding('f1')], []);
    expect(computePrecision(stats[0]!)).toMatchObject({ precision: 1, demoted: false, enabled: true });
    expect(shouldDemote(stats[0]!)).toBe(false);
  });

  it('une règle imprécise est rétrogradée, mais seulement avec assez de retours', () => {
    const few = { ruleId: 'C2-09', layer: 'C2' as const, kind: 'assistant-addressing' as const, truePositives: 0, falsePositives: 2 };
    const many = { ...few, truePositives: 1, falsePositives: MIN_SAMPLES };
    expect(shouldDemote(few)).toBe(false);
    expect(shouldDemote(many)).toBe(true);
    expect(computePrecision(many).precision).toBeLessThan(DEMOTION_THRESHOLD);
  });

  it('le dernier verdict par constat gagne', () => {
    const stats = statsByRule(
      [finding('f1')],
      [verdict('f1', 'false-positive', '2026-11-11T09:00:00.000Z'), verdict('f1', 'trapped', NOW)],
    );
    expect(stats[0]?.truePositives).toBe(1);
    expect(stats[0]?.falsePositives).toBe(0);
  });
});

describe('file des suspects (§14, §17.2)', () => {
  const items = [
    { finding: finding('f1'), issueKey: 'SUP-1', suspicion: 'review' as const, campaignHash: 'h1' },
    { finding: finding('f2', { createdAt: '2026-11-11T08:00:00.000Z' }), issueKey: 'SUP-2', suspicion: 'suspect' as const, campaignHash: 'h2' },
    { finding: finding('f3'), issueKey: 'SUP-3', suspicion: 'suspect' as const, campaignHash: 'h2' },
    { finding: finding('f4'), issueKey: 'SUP-4', suspicion: 'trapped' as const, verdict: 'trapped' as const },
  ];

  it('niveau décroissant, puis ancienneté, et les constat déjà jugés en dernier', () => {
    const queue = reviewQueue(items);
    expect(queue.map((i) => i.issueKey)).toEqual(['SUP-2', 'SUP-1', 'SUP-4']);
  });

  it('une campagne n’apparaît qu’une fois : une alerte, pas cinq cents (§14)', () => {
    const queue = reviewQueue(items);
    expect(queue.filter((i) => i.campaignHash === 'h2')).toHaveLength(1);
  });

  it('le regroupement peut être désactivé pour un audit', () => {
    expect(reviewQueue(items, { groupCampaigns: false })).toHaveLength(4);
  });

  it('les verdicts ont un libellé dans les deux langues', () => {
    expect(verdictLabel('legitimate-risky', 'fr')).toBe('légitime mais risqué');
    expect(verdictLabel('legitimate-risky', 'en')).toBe('legitimate but risky');
  });
});

describe('export avant désinstallation (§22)', () => {
  it('rend un JSON stable, sans secret, avec le texte inerté', () => {
    const json = exportOriginals([
      { id: 'o1', segmentId: 's1', issueId: '10001', content: 'charge originale', storedAt: NOW, restoredAt: null },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(1);
    expect(parsed.originals[0].content).toBe('charge originale');
    expect(parsed.note).toContain('Inert');
    expect(json).not.toContain('token');
  });
});
