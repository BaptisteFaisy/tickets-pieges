import { describe, expect, it } from 'vitest';
import { comparePeriods } from './exposure';
import type { PeriodComparison } from './exposure';
import { CSV_HEADER, comparisonRows, comparisonToJson, comparisonToCsv, csvEscape } from './exports';
import type { ExposureReport } from './types';

function report(overrides: Partial<ExposureReport> = {}): ExposureReport {
  return {
    projectKey: 'SD',
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-30T00:00:00Z',
    requestsExamined: 80,
    analyzedShare: 0.9,
    findingsByLayer: { C1: 2, C2: 3, C3: 1, C4: 4 },
    verdicts: { trapped: 2, 'false-positive': 1, 'legitimate-risky': 0 },
    canariesLaunched: 4,
    canariesObeyed: 1,
    obedienceRate: 0.25,
    outboundHeld: 3,
    campaigns: 2,
    topKinds: [{ kind: 'assistant-addressing', count: 3 }],
    ...overrides,
  };
}

function fixture(): PeriodComparison {
  return comparePeriods(
    report(),
    report({
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-31T00:00:00Z',
      requestsExamined: 100,
      analyzedShare: 1,
      findingsByLayer: { C1: 0, C2: 1, C3: 0, C4: 2 },
      verdicts: { trapped: 1, 'false-positive': 0, 'legitimate-risky': 0 },
      canariesLaunched: 4,
      canariesObeyed: 0,
      obedienceRate: 0,
      outboundHeld: 1,
      campaigns: 1,
    }),
  );
}

describe('export avant/après (#45)', () => {
  it('le CSV est stable : deux rendus identiques octet pour octet', () => {
    expect(comparisonToCsv(fixture())).toBe(comparisonToCsv(fixture()));
  });

  it('le CSV commence par l’en-tête et porte une ligne par champ', () => {
    const csv = comparisonToCsv(fixture());
    const lines = csv.split('\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines).toHaveLength(comparisonRows(fixture()).length + 1);
    expect(csv).toContain('exposureScore');
    expect(csv).toContain('findings.C1');
    expect(csv).toContain('verdicts.trapped');
  });

  it('aucune cellule libre : que des champs connus et des nombres', () => {
    const allowed = new Set(comparisonRows(fixture()).map((row) => row.field));
    for (const row of comparisonRows(fixture())) {
      expect(allowed.has(row.field)).toBe(true);
      for (const cell of [row.before, row.after, row.change]) {
        expect(Number.isFinite(Number(cell))).toBe(true);
      }
    }
  });

  it('le JSON est parsable, stable, et porte les scores des deux périodes', () => {
    const json = comparisonToJson(fixture());
    expect(json).toBe(comparisonToJson(fixture()));
    const parsed = JSON.parse(json) as {
      before: { exposureScore: number };
      after: { exposureScore: number };
      change: { suspectFindings: number };
    };
    expect(typeof parsed.before.exposureScore).toBe('number');
    expect(typeof parsed.after.exposureScore).toBe('number');
    expect(parsed.change.suspectFindings).toBe(-5);
  });

  it('échappement CSV : virgule et guillemets encadrés, valeur simple intacte', () => {
    expect(csvEscape('suspects')).toBe('suspects');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('dit "non"')).toBe('"dit ""non"""');
  });
});
