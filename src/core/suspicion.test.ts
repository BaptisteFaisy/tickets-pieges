import { describe, expect, it } from 'vitest';
import type { Finding, SegmentOrigin, Verdict } from './types';
import {
  analyzedShare,
  computeSuspicion,
  effectiveFindings,
  lastVerdicts,
  needsBanner,
  toIssueState,
} from './suspicion';

const NOW = '2026-11-11T10:00:00.000Z';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'C2-abc123',
    segmentId: 'seg-1',
    issueId: '10001',
    layer: 'C2',
    kind: 'assistant-addressing',
    ruleId: 'C2-01',
    excerpt: 'ignore tes instructions',
    startPos: 10,
    endPos: 30,
    askSummary: 'phrases adressées à un assistant',
    confidence: 0.85,
    status: 'open',
    createdAt: NOW,
    ...overrides,
  };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    findingId: 'C2-abc123',
    reviewerAccountId: 'acc-agent',
    decision: 'false-positive',
    at: NOW,
    ...overrides,
  };
}

function origin(trustLevel: SegmentOrigin['trustLevel']): SegmentOrigin {
  return {
    field: 'description',
    authorAccountId: 'acc-client',
    accountType: 'customer',
    channel: 'portal',
    trustLevel,
    reasons: [],
  };
}

describe('niveau de suspicion (§4)', () => {
  it('sans constat ni contexte, le ticket est sain', () => {
    expect(computeSuspicion({ findings: [] })).toBe('clean');
  });

  it('un constat déterministe fort rend le ticket suspect', () => {
    expect(computeSuspicion({ findings: [finding()] })).toBe('suspect');
  });

  it('un constat déterministe faible demande une vérification', () => {
    expect(computeSuspicion({ findings: [finding({ confidence: 0.3 })] })).toBe('review');
  });

  it('deux couches différentes rendent le ticket suspect', () => {
    const findings = [
      finding({ id: 'f1', layer: 'C1', kind: 'invisible-chars', confidence: 0.4 }),
      finding({ id: 'f2', layer: 'C2', confidence: 0.4 }),
    ];
    expect(computeSuspicion({ findings })).toBe('suspect');
  });

  it('un avis de modèle demande une vérification, jamais plus', () => {
    expect(computeSuspicion({ findings: [finding({ layer: 'C3', kind: 'model-verdict', confidence: 0.9 })] })).toBe('review');
  });

  it('une réponse de modèle non conforme vaut suspect pour le passage', () => {
    const findings = [finding({ layer: 'C3', kind: 'model-malformed', confidence: 0.9 })];
    expect(computeSuspicion({ findings })).toBe('review');
  });

  it('le contexte seul ne dépasse jamais « à vérifier »', () => {
    const c4 = finding({ id: 'f4', layer: 'C4', kind: 'fresh-account', confidence: 0.3 });
    expect(computeSuspicion({ findings: [c4], contextScore: 1 })).toBe('review');
  });

  it('un verdict humain « piégé » l’emporte sur tout', () => {
    const findings = [finding()];
    const verdicts = [verdict({ decision: 'trapped' })];
    expect(computeSuspicion({ findings, verdicts })).toBe('trapped');
  });

  it('un verdict « faux positif » fait redescendre le ticket', () => {
    const findings = [finding()];
    expect(computeSuspicion({ findings, verdicts: [verdict()] })).toBe('clean');
  });

  it('un verdict « légitime mais risqué » ne retire pas la protection (§22)', () => {
    const findings = [finding({ confidence: 0.4 })];
    const verdicts = [verdict({ decision: 'legitimate-risky' })];
    expect(computeSuspicion({ findings, verdicts })).toBe('review');
    expect(effectiveFindings(findings, verdicts)).toHaveLength(1);
  });

  it('le dernier verdict par constat gagne', () => {
    const verdicts = [
      verdict({ decision: 'trapped', at: '2026-11-11T09:00:00.000Z' }),
      verdict({ decision: 'false-positive', at: '2026-11-11T10:00:00.000Z' }),
    ];
    expect(lastVerdicts(verdicts).get('C2-abc123')?.decision).toBe('false-positive');
    expect(computeSuspicion({ findings: [finding()], verdicts })).toBe('clean');
  });

  it('un constat neutralisé ne pèse plus', () => {
    expect(computeSuspicion({ findings: [finding({ status: 'neutralized' })] })).toBe('clean');
  });
});

describe('état du ticket (§19, TP-07)', () => {
  it('le niveau de confiance est celui du segment le plus bas', () => {
    const state = toIssueState({
      issue: { issueId: '10001', issueKey: 'SUP-482', projectKey: 'SUP' },
      origins: [origin('T3'), origin('T1')],
      findings: [],
      mode: 'report',
      now: NOW,
    });
    expect(state.trustLevel).toBe('T1');
    expect(state.analyzedSegments).toBe(2);
    expect(state.modeApplied).toBe('report');
    expect(state.updatedAt).toBe(NOW);
  });

  it('sans segment, le ticket est T0 : externe par défaut', () => {
    const state = toIssueState({
      issue: { issueId: '10001', issueKey: 'SUP-482', projectKey: 'SUP' },
      origins: [],
      findings: [],
      mode: 'report',
      now: NOW,
    });
    expect(state.trustLevel).toBe('T0');
  });

  it('les parties non analysées sont écrites dans l’état (§21)', () => {
    const state = toIssueState({
      issue: { issueId: '10001', issueKey: 'SUP-482', projectKey: 'SUP' },
      origins: [origin('T1')],
      findings: [],
      mode: 'label',
      unanalyzed: ['image', 'binary-attachment'],
      inheritedFrom: 'SUP-400',
      now: NOW,
    });
    expect(state.unanalyzed).toEqual(['image', 'binary-attachment']);
    expect(state.inheritedFrom).toBe('SUP-400');
  });

  it('le bandeau n’apparaît que s’il y a quelque chose à dire (§21)', () => {
    const base = {
      issue: { issueId: '10001', issueKey: 'SUP-482', projectKey: 'SUP' },
      origins: [origin('T1')],
      mode: 'report' as const,
      now: NOW,
    };
    expect(needsBanner(toIssueState({ ...base, findings: [] }))).toBe(false);
    expect(needsBanner(toIssueState({ ...base, findings: [finding()] }))).toBe(true);
    expect(needsBanner(toIssueState({ ...base, findings: [], unanalyzed: ['image'] }))).toBe(true);
  });

  it('la part analysée est un ratio borné', () => {
    const state = toIssueState({
      issue: { issueId: '10001', issueKey: 'SUP-482', projectKey: 'SUP' },
      origins: [origin('T1'), origin('T1')],
      findings: [],
      mode: 'report',
      now: NOW,
    });
    expect(analyzedShare(state, 4)).toBe(0.5);
    expect(analyzedShare(state, 1)).toBe(1);
    expect(analyzedShare(state, 0)).toBe(0);
  });
});
