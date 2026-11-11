import { describe, expect, it } from 'vitest';
import type { SegmentSource } from './types';
import { contextHits, contextScore, guessLanguage, hoursBetween } from './context';

const NOW = '2026-11-11T10:00:00.000Z';

function segment(overrides: Partial<SegmentSource> = {}): SegmentSource {
  return {
    issueId: '10001',
    issueKey: 'SUP-482',
    projectKey: 'SUP',
    field: 'description',
    text: 'Bonjour, mon export de factures échoue depuis mardi.',
    author: { accountId: 'acc-client', accountType: 'customer' },
    channel: 'portal',
    createdAt: NOW,
    ...overrides,
  };
}

describe('lecture rapide du contexte', () => {
  it('distingue le français de l’anglais sans modèle', () => {
    expect(guessLanguage('Bonjour, merci de vérifier mon export pour vous')).toBe('fr');
    expect(guessLanguage('Hello, please check this export for you and our team')).toBe('en');
    expect(guessLanguage('x')).toBe('other');
    expect(guessLanguage('')).toBe('other');
  });

  it('compte les heures entre deux dates, et refuse l’illisible', () => {
    expect(hoursBetween('2026-11-11T09:00:00.000Z', NOW)).toBe(1);
    expect(hoursBetween(undefined, NOW)).toBeNull();
    expect(hoursBetween('pas une date', NOW)).toBeNull();
  });
});

describe('signaux de contexte (§6, C4)', () => {
  it('un compte créé il y a une heure est un signal', () => {
    const hits = contextHits(
      segment({ author: { accountId: 'acc-neuf', accountType: 'customer', accountCreatedAt: '2026-11-11T09:00:00.000Z' } }),
      {},
      { now: NOW },
    );
    expect(hits.map((h) => h.kind)).toContain('fresh-account');
    expect(hits[0]?.ruleId).toBe('C4-01');
    expect(hits[0]?.layer).toBe('C4');
  });

  it('un compte ancien n’est pas un signal', () => {
    const hits = contextHits(
      segment({ author: { accountId: 'acc-vieux', accountType: 'customer', accountCreatedAt: '2025-01-01T00:00:00.000Z' } }),
      {},
      { now: NOW },
    );
    expect(hits).toHaveLength(0);
  });

  it('le canal anonyme est un signal', () => {
    const hits = contextHits(segment({ channel: 'anonymousportal' }), {}, { now: NOW });
    expect(hits.map((h) => h.kind)).toContain('anonymous-channel');
  });

  it('une longueur très supérieure à la médiane est un signal', () => {
    const hits = contextHits(segment({ text: 'a'.repeat(900) }), { medianLength: 120 }, { now: NOW });
    expect(hits.map((h) => h.kind)).toContain('unusual-length');
  });

  it('une longueur ordinaire ne l’est pas', () => {
    const hits = contextHits(segment({ text: 'a'.repeat(150) }), { medianLength: 120 }, { now: NOW });
    expect(hits.map((h) => h.kind)).not.toContain('unusual-length');
  });

  it('une langue différente du reste du ticket est un signal', () => {
    const hits = contextHits(
      segment({ text: 'Hello, please check the export for you and our team' }),
      { dominantLanguage: 'fr' },
      { now: NOW },
    );
    expect(hits.map((h) => h.kind)).toContain('language-shift');
  });

  it('une pièce jointe illisible est un signal (§22)', () => {
    const hits = contextHits(
      segment({ attachment: { fileName: 'capture.png', mimeType: 'image/png', sizeBytes: 1000, parseable: false } }),
      {},
      { now: NOW },
    );
    expect(hits.map((h) => h.kind)).toContain('unparseable-attachment');
  });

  it('le score de contexte est borné à 1 et ignorera les autres couches', () => {
    const hits = contextHits(
      segment({
        channel: 'anonymousportal',
        text: 'a'.repeat(900),
        author: { accountId: 'acc-neuf', accountType: 'customer', accountCreatedAt: '2026-11-11T09:59:00.000Z' },
        attachment: { fileName: 'x.bin', mimeType: 'application/octet-stream', sizeBytes: 10, parseable: false },
      }),
      { medianLength: 100, dominantLanguage: 'en' },
      { now: NOW },
    );
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(contextScore(hits)).toBe(1);
    expect(contextScore([{ ...hits[0]!, layer: 'C1' }])).toBe(0);
  });

  it('chaque signal porte un résumé neutre, jamais une accusation', () => {
    const hits = contextHits(segment({ channel: 'anonymousportal' }), {}, { now: NOW, language: 'en' });
    expect(hits[0]?.askSummary).toContain('anonymous');
    expect(hits[0]?.askSummary.toLowerCase()).not.toContain('attack');
  });
});
