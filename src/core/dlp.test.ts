import { describe, expect, it } from 'vitest';
import type { OutboundContext } from './types';
import { detectDlp } from './dlp';
import { checkOutbound, findDlpHits, requiresDoubleReview } from './outbound';

const IBAN_VALIDE = 'FR7630006000011234567890189';
const IBAN_INVALIDE = 'FR0030006000011234567890189';
const CARTE = '4970101234567893';
const SIRET = '73282932000074';
const SIREN = '732829320';

function contexte(overrides: Partial<OutboundContext> = {}): OutboundContext {
  return {
    issueKey: 'SUP-482',
    requestText: 'Bonjour, mon export de factures échoue depuis mardi.',
    requesterOrganization: 'ACME',
    otherOrganizations: ['Globex', 'Initech'],
    otherIssueKeys: ['SUP-100'],
    knownUrls: ['https://support.acme.fr'],
    strict: false,
    taintedSession: false,
    ...overrides,
  };
}

describe('motifs de données personnelles (§34, #35)', () => {
  it('un IBAN à clé juste est relevé avec une confiance forte', () => {
    const [f] = detectDlp(`virement vers ${IBAN_VALIDE} merci`);
    expect(f?.ruleId).toBe('iban');
    expect(f?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(f?.excerpt).not.toContain(IBAN_VALIDE);
  });

  it('un IBAN dont la clé est fausse reste un signal, mais faible', () => {
    const [f] = detectDlp(`virement vers ${IBAN_INVALIDE}`);
    expect(f?.ruleId).toBe('iban');
    expect(f?.confidence).toBeLessThan(0.6);
  });

  it('une carte bancaire est relevée quand Luhn passe', () => {
    const [f] = detectDlp(`réglez par carte ${CARTE}`);
    expect(f?.ruleId).toBe('card');
    expect(f?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('un SIRET est relevé comme SIRET, pas comme carte', () => {
    const [f] = detectDlp(`société ${SIRET}`);
    expect(f?.ruleId).toBe('siret');
  });

  it('un SIREN est relevé', () => {
    const [f] = detectDlp(`SIREN ${SIREN}`);
    expect(f?.ruleId).toBe('siren');
  });

  it('un jeton GitHub ghp_… est relevé', () => {
    const ghp = `ghp_${'A'.repeat(36)}`;
    const [f] = detectDlp(`voici mon jeton ${ghp}`);
    expect(f?.ruleId).toBe('github-token');
    expect(f?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('un JWT est relevé', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'sig'].join('.');
    const [f] = detectDlp(`token ${jwt}`);
    expect(f?.ruleId).toBe('jwt');
  });

  it('un texte ordinaire ne relève aucune donnée personnelle', () => {
    expect(detectDlp('Bonjour, votre export est rétabli et vous pouvez clôturer le mois.')).toHaveLength(0);
  });
});

describe('sas étendu (#33, #37)', () => {
  it('un lien vers un domaine hors liste est retenu', () => {
    const verdict = checkOutbound('Voir https://evil.example/x pour le détail.', contexte(), { now: '2026-11-11T10:00:00.000Z' });
    expect(verdict.hits.map((h) => h.kind)).toContain('unknown-url');
    expect(verdict.allowed).toBe(false);
  });

  it('une donnée DLP exige une double relecture humaine', () => {
    const verdict = checkOutbound(`Envoyez le relevé ${IBAN_VALIDE} au client.`, contexte(), { now: '2026-11-11T10:00:00.000Z' });
    expect(verdict.requiresDoubleReview).toBe(true);
    expect(verdict.redactedText).not.toContain(IBAN_VALIDE);
  });

  it('un domaine inconnu exige aussi une double relecture', () => {
    const verdict = checkOutbound('Voir https://evil.example/x.', contexte(), { now: '2026-11-11T10:00:00.000Z' });
    expect(verdict.requiresDoubleReview).toBe(true);
  });

  it('une réponse propre n’exige pas de double relecture', () => {
    const verdict = checkOutbound('Bonjour, votre export est rétabli. Bonne journée.', contexte(), { now: '2026-11-11T10:00:00.000Z' });
    expect(verdict.requiresDoubleReview).toBe(false);
  });
});

describe('éléments DLP rendus au sas', () => {
  it('chaque motif devient un élément de type donnée d’un autre client', () => {
    const findings = detectDlp(`virement ${IBAN_VALIDE}`);
    const hits = findDlpHits(findings, 'fr');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('other-customer-data');
    expect(hits[0]?.detail).toContain('IBAN');
  });

  it('la double relecture se déclenche dès qu’une donnée DLP est présente', () => {
    expect(requiresDoubleReview([], [])).toBe(false);
    expect(requiresDoubleReview([], [{ ruleId: 'iban', value: 'x', start: 0, end: 1, confidence: 1, excerpt: 'x' }])).toBe(true);
  });
});