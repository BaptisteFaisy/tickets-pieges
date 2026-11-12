import { describe, expect, it } from 'vitest';
import { KNOWN_GAPS, compareLive, isKnownGap, summarizeLive, type LiveExpectation, type LiveRow } from './check';

const attendu: LiveExpectation = {
  id: 'fr-07-assistant',
  lang: 'fr',
  trustLevel: 'T1',
  suspicion: 'suspect',
  kinds: ['assistant-addressing'],
};

function ligne(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    sampleId: 'fr-07-assistant',
    issueKey: 'SUP-211',
    expectedTrust: 'T1',
    gotTrust: 'T1',
    expectedSuspicion: 'suspect',
    gotSuspicion: 'suspect',
    verdict: 'conforme',
    ...overrides,
  };
}

describe('recette live : comparer le site aux attendus figés', () => {
  it('une demande conforme est conforme', () => {
    const report = compareLive([ligne()], [attendu]);
    expect(report.conformes).toBe(1);
    expect(report.regressions).toBe(0);
    expect(report.verdicts[0]?.kind).toBe('conforme');
  });

  it('une demande absente du rapport est « non semée », pas une régression', () => {
    const report = compareLive([], [attendu]);
    expect(report.nonSemes).toBe(1);
    expect(report.regressions).toBe(0);
  });

  it('une demande sans propriété est une propagation manquante : la régression la plus grave', () => {
    const report = compareLive([ligne({ gotTrust: null, gotSuspicion: null })], [attendu]);
    expect(report.propagationManquante).toBe(1);
    expect(report.regressions).toBe(0);
  });

  it('un écart qui n’est pas connu est une régression', () => {
    const report = compareLive([ligne({ gotSuspicion: 'clean' })], [attendu]);
    expect(report.regressions).toBe(1);
    expect(report.verdicts[0]?.kind).toBe('regression');
    expect(report.verdicts[0]?.attendu).toBe('T1/suspect');
    expect(report.verdicts[0]?.obtenu).toBe('T1/clean');
  });

  it('un écart connu est signalé comme tel, avec sa cause', () => {
    const gap = KNOWN_GAPS[0]!;
    const report = compareLive(
      [ligne({ sampleId: gap.id, gotSuspicion: 'review' })],
      [{ ...attendu, id: gap.id }],
    );
    expect(report.ecartsConnus).toBe(1);
    expect(report.regressions).toBe(0);
    expect(report.verdicts[0]?.raison).toBe(gap.reason);
  });

  it('la liste des écarts connus est stable et testée par son identifiant', () => {
    expect(isKnownGap('fr-02-anonyme')).toBe(true);
    expect(isKnownGap('fr-99-inconnu')).toBe(false);
    expect(KNOWN_GAPS.length).toBeGreaterThanOrEqual(5);
  });

  it('le résumé signale les régressions et les non-propagations', () => {
    const report = compareLive(
      [
        ligne({ gotTrust: null, gotSuspicion: null }),
        ligne({ sampleId: 'fr-08-marqueur', gotSuspicion: 'clean' }),
      ],
      [attendu, { ...attendu, id: 'fr-08-marqueur' }],
    );
    const text = summarizeLive(report);
    expect(text).toContain('régression(s)');
    expect(text).toContain('non propagée(s)');
  });
});
