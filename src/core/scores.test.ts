import { describe, expect, it } from 'vitest';
import type { ExposureReport, IssueState } from './types';
import {
  SCORE_WEIGHTS,
  aggregateFingerprint,
  bandOf,
  crossOrgMedian,
  exposureScore,
  orgAggregate,
  unanalyzedView,
} from './scores';

function report(overrides: Partial<ExposureReport> = {}): ExposureReport {
  return {
    projectKey: 'SD',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-31T00:00:00Z',
    requestsExamined: 100,
    analyzedShare: 1,
    findingsByLayer: { C1: 0, C2: 0, C3: 0, C4: 0 },
    verdicts: { trapped: 0, 'false-positive': 0, 'legitimate-risky': 0 },
    canariesLaunched: 0,
    canariesObeyed: 0,
    obedienceRate: 0,
    outboundHeld: 0,
    campaigns: 0,
    topKinds: [],
    ...overrides,
  };
}

function state(overrides: Partial<IssueState> = {}): IssueState {
  return {
    issueId: 'i1',
    issueKey: 'SD-1',
    projectKey: 'SD',
    trustLevel: 'T0',
    suspicionLevel: 'suspect',
    modeApplied: 'report',
    analyzedSegments: 2,
    unanalyzed: [],
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('score d’exposition (#47)', () => {
  it('rapport sain → score 0, bande basse', () => {
    const score = exposureScore(report());
    expect(score.total).toBe(0);
    expect(score.band).toBe('low');
  });

  it('les poids sont documentés et somment à 100', () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('le score est borné : pire cas = 100, jamais au-delà', () => {
    const worst = exposureScore(
      report({
        findingsByLayer: { C1: 40, C2: 40, C3: 40, C4: 10 },
        obedienceRate: 1,
        canariesLaunched: 4,
        canariesObeyed: 4,
        outboundHeld: 50,
        analyzedShare: 0,
      }),
    );
    expect(worst.total).toBe(100);
    expect(worst.band).toBe('critical');
    expect(exposureScore(report()).total).toBeGreaterThanOrEqual(0);
  });

  it('monotone : plus de constats suspects → score plus élevé', () => {
    const few = exposureScore(report({ findingsByLayer: { C1: 1, C2: 1, C3: 0, C4: 0 } }));
    const many = exposureScore(report({ findingsByLayer: { C1: 8, C2: 6, C3: 2, C4: 0 } }));
    expect(many.total).toBeGreaterThan(few.total);
  });

  it('C4 ne fait pas le score seul (pondération, jamais un verdict)', () => {
    const withC4 = exposureScore(report({ findingsByLayer: { C1: 0, C2: 0, C3: 0, C4: 9 } }));
    expect(withC4.total).toBe(0);
  });

  it('seuils de bandes stables', () => {
    expect(bandOf(24)).toBe('low');
    expect(bandOf(25)).toBe('medium');
    expect(bandOf(50)).toBe('high');
    expect(bandOf(75)).toBe('critical');
  });
});

describe('agrégats anonymisés (#48)', () => {
  it('l’agrégat ne contient que des nombres — aucun texte', () => {
    const aggregate = orgAggregate(report({ findingsByLayer: { C1: 2, C2: 1, C3: 0, C4: 4 } }));
    for (const value of Object.values(aggregate)) expect(typeof value).toBe('number');
    expect(JSON.stringify(aggregate)).not.toMatch(/[A-Za-z]{2}-\d+/);
  });

  it('l’empreinte est stable et sensible au contenu', () => {
    const a = orgAggregate(report({ requestsExamined: 10 }));
    const b = orgAggregate(report({ requestsExamined: 10 }));
    const c = orgAggregate(report({ requestsExamined: 11 }));
    expect(aggregateFingerprint(a)).toBe(aggregateFingerprint(b));
    expect(aggregateFingerprint(a)).not.toBe(aggregateFingerprint(c));
  });

  it('médiane inter-organisations champ par champ', () => {
    const submissions = [10, 30, 20].map((examined) => ({
      orgFingerprint: `fp-${examined}`,
      aggregate: orgAggregate(report({ requestsExamined: examined })),
    }));
    const median = crossOrgMedian(submissions);
    expect(median).not.toBeNull();
    expect(median!.requestsExamined).toBe(20);
  });

  it('aucune soumission → null ; deux soumises → moyenne', () => {
    expect(crossOrgMedian([])).toBeNull();
    const two = [10, 20].map((examined) => ({
      orgFingerprint: `fp-${examined}`,
      aggregate: orgAggregate(report({ requestsExamined: examined })),
    }));
    expect(crossOrgMedian(two)!.requestsExamined).toBe(15);
  });
});

describe('vue non analysé (#59)', () => {
  it('compte les raisons par projet et ignore les autres projets', () => {
    const view = unanalyzedView('SD', [
      state({ unanalyzed: ['image', 'oversize'] }),
      state({ issueId: 'i2', unanalyzed: ['image'] }),
      state({ issueId: 'i3', projectKey: 'AUTRE', unanalyzed: ['binary-attachment'] }),
    ]);
    expect(view.projectKey).toBe('SD');
    expect(view.issues).toBe(2);
    expect(view.issuesWithUnanalyzed).toBe(2);
    expect(view.byReason.image).toBe(2);
    expect(view.byReason.oversize).toBe(1);
    expect(view.byReason['binary-attachment']).toBe(0);
    expect(view.totalReasons).toBe(3);
  });

  it('projet sans ticket → vue vide mais valide', () => {
    const view = unanalyzedView('SD', []);
    expect(view.issues).toBe(0);
    expect(view.totalReasons).toBe(0);
  });
});
