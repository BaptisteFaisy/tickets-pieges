/**
 * Tests du diagnostic — domaine pur, aucune E/S, aucune horloge.
 *
 * Le critère de fin du lot : le rapport s'assemble à partir de données
 * injectées, le budget dégradé est détecté, et le rendu reste lisible dans les
 * deux langues.
 */

import { describe, expect, it } from 'vitest';
import { assumed, measured } from './timing';
import {
  buildDiagnostic,
  renderDiagnostic,
  type BudgetSnapshot,
  type DiagnosticInput,
} from './diagnostic';

const BUDGET: BudgetSnapshot = {
  writes: 98,
  reads: 41,
  queries: 139,
  skippedWrites: 0,
  limit: 120,
  degraded: false,
  nearLimit: true,
  startedAt: '2026-11-12T18:00:00.000Z',
};

/** Un jeu de faits injectés, reproductible. */
function input(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    appVersion: '0.1.0',
    generatedAt: '2026-11-12T18:05:00.000Z',
    tables: [
      { name: 'segment', rows: 120 },
      { name: 'issue_state', rows: 38 },
      { name: 'finding', rows: 41 },
      { name: 'verdict', rows: 7 },
      { name: 'original', rows: 3 },
    ],
    budget: BUDGET,
    latencies: [
      { id: 'origine', labelFr: 'origine écrite', labelEn: 'origin written', ms: measured(350) },
      { id: 'c1', labelFr: 'couche C1', labelEn: 'layer C1', ms: measured(210) },
      { id: 'c3', labelFr: 'verdict C3', labelEn: 'C3 verdict', ms: assumed('à mesurer sur site') },
    ],
    recentErrors: [
      { at: '2026-11-12T18:02:11.000Z', kind: 'c3-enqueue-failed', message: 'file pleine' },
    ],
    ticketsProcessed: measured(38),
    queues: [{ key: 'c3', labelFr: 'file C3', labelEn: 'C3 queue', pending: assumed('à mesurer sur site') }],
    caveats: ['Hors site : les volumes seront relevés sur l’instance installée.'],
    ...overrides,
  };
}

describe('buildDiagnostic', () => {
  it('assemble les faits injectés et calcule la synthèse', () => {
    const report = buildDiagnostic(input());
    expect(report.appVersion).toBe('0.1.0');
    expect(report.tables).toHaveLength(5);
    expect(report.summary).toEqual({
      tablesListed: 5,
      tablesReadable: 5,
      totalRows: 209,
      recentErrors: 1,
      degraded: false,
    });
  });

  it('ne compte que les tables lisibles dans la synthèse', () => {
    const report = buildDiagnostic(
      input({ tables: [{ name: 'segment', rows: 4 }, { name: 'verdict', rows: null }] }),
    );
    expect(report.summary.tablesReadable).toBe(1);
    expect(report.summary.totalRows).toBe(4);
  });

  it('rend un total nul quand aucune table n’est lisible', () => {
    const report = buildDiagnostic(input({ tables: [{ name: 'segment', rows: null }] }));
    expect(report.summary.totalRows).toBeNull();
  });

  it('détecte le mode dégradé du budget', () => {
    const degraded: BudgetSnapshot = { ...BUDGET, degraded: true, skippedWrites: 3 };
    const report = buildDiagnostic(input({ budget: degraded }));
    expect(report.summary.degraded).toBe(true);
  });

  it('rapporte l’absence de budget sans inventer de chiffre', () => {
    const report = buildDiagnostic(input({ budget: null }));
    expect(report.budget).toBeNull();
    expect(report.summary.degraded).toBe(false);
  });
});

describe('renderDiagnostic', () => {
  it('rend un texte lisible en français', () => {
    const text = renderDiagnostic(buildDiagnostic(input()), 'fr');
    expect(text).toContain('Version — 0.1.0');
    expect(text).toContain('## Budget de requêtes');
    expect(text).toContain('écritures — 98 / 120');
    expect(text).toContain('origine écrite — 350 ms');
    expect(text).toContain('file C3 — à mesurer sur site');
  });

  it('rend un texte lisible en anglais', () => {
    const text = renderDiagnostic(buildDiagnostic(input()), 'en');
    expect(text).toContain('## Request budget');
    expect(text).toContain('writes — 98 / 120');
    expect(text).toContain('origin written — 350 ms');
  });

  it('signale les erreurs récentes et l’absence d’erreur', () => {
    const withError = renderDiagnostic(buildDiagnostic(input()), 'fr');
    expect(withError).toContain('c3-enqueue-failed');
    const clean = renderDiagnostic(buildDiagnostic(input({ recentErrors: [] })), 'fr');
    expect(clean).toContain('aucune');
  });
});