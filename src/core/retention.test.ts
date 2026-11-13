/**
 * Tests de la rétention — politique, décision de purge, registre et contrat
 * d'export/restauration. Aucun réseau, aucune horloge réelle : les dates sont
 * injectées, donc le résultat est reproductible.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION,
  RETENTION_EXPORT_SCHEMA,
  RETENTION_EXPORT_VERSION,
  TREATMENT_REGISTER,
  ageDays,
  categoryForFinding,
  categoryOfRecord,
  decidePurge,
  horizonDays,
  planRestore,
  planTokenRestore,
  summarizePurge,
  validateRetentionExport,
  type RetentionExport,
  type RetentionPolicy,
  type RetainedRecord,
} from './retention';

const NOW = '2026-11-12T00:00:00.000Z';

/** Fabrique un élément conservé avec un âge connu, en jours avant `NOW`. */
function record(id: string, category: RetainedRecord['category'], daysAgo: number): RetainedRecord {
  const at = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
  return { id, category, at };
}

const POLICY: RetentionPolicy = {
  defaultDays: 90,
  neutralizedDays: 365,
  exerciseDays: 7,
  campaignDays: 180,
};

describe('politique', () => {
  it('mappe chaque famille sur sa durée', () => {
    expect(horizonDays(POLICY, 'default')).toBe(90);
    expect(horizonDays(POLICY, 'neutralized')).toBe(365);
    expect(horizonDays(POLICY, 'exercise')).toBe(7);
    expect(horizonDays(POLICY, 'campaign')).toBe(180);
  });

  it('a une valeur par défaut raisonnable et injectable', () => {
    expect(DEFAULT_RETENTION.exerciseDays).toBeLessThan(DEFAULT_RETENTION.defaultDays);
    expect(DEFAULT_RETENTION.neutralizedDays).toBeGreaterThan(DEFAULT_RETENTION.defaultDays);
  });

  it('classe un constat neutralisé et un exercice', () => {
    expect(categoryForFinding('neutralized')).toBe('neutralized');
    expect(categoryForFinding('open')).toBe('default');
    expect(categoryOfRecord('canary')).toBe('exercise');
    expect(categoryOfRecord('campaign')).toBe('campaign');
  });
});

describe('âge', () => {
  it('compte des jours entiers', () => {
    expect(ageDays('2026-11-10T00:00:00.000Z', NOW)).toBe(2);
  });

  it('rend 0 pour une date inconnue ou future', () => {
    expect(ageDays('pas-une-date', NOW)).toBe(0);
    expect(ageDays('2026-11-13T00:00:00.000Z', NOW)).toBe(0);
  });
});

/** Décision de purge d'un seul élément : la ligne rendue, jamais `undefined`. */
function decide(id: string, category: RetainedRecord['category'], daysAgo: number) {
  return decidePurge([record(id, category, daysAgo)], NOW, POLICY)[0]!;
}

describe('décision de purge', () => {
  it('garde à la limite, purge au-delà', () => {
    expect(decide('a', 'default', 90).purge).toBe(false);
    expect(decide('b', 'default', 91).purge).toBe(true);
  });

  it('conserve une charge neutralisée plus longtemps que le défaut', () => {
    expect(decide('n', 'neutralized', 200).purge).toBe(false);
    expect(decide('p', 'default', 200).purge).toBe(true);
  });

  it('purge l\'exercice après 7 jours, la campagne après 180', () => {
    expect(decide('e1', 'exercise', 7).purge).toBe(false);
    expect(decide('e2', 'exercise', 8).purge).toBe(true);
    expect(decide('c1', 'campaign', 180).purge).toBe(false);
    expect(decide('c2', 'campaign', 181).purge).toBe(true);
  });

  it('rend un décompte exact par famille', () => {
    const decisions = decidePurge(
      [
        record('dkeep', 'default', 10),
        record('dpurge', 'default', 100),
        record('ekeep', 'exercise', 1),
        record('epurge', 'exercise', 30),
      ],
      NOW,
      POLICY,
    );
    const summary = summarizePurge(decisions);
    expect(summary.examined).toBe(4);
    expect(summary.keep).toBe(2);
    expect(summary.purge).toBe(2);
    expect(summary.byCategory.default).toEqual({ keep: 1, purge: 1 });
    expect(summary.byCategory.exercise).toEqual({ keep: 1, purge: 1 });
  });
});

describe('registre des traitements', () => {
  it('est complet et lisible', () => {
    expect(TREATMENT_REGISTER.length).toBeGreaterThanOrEqual(8);
    for (const entry of TREATMENT_REGISTER) {
      expect(entry.purpose.length).toBeGreaterThan(0);
      expect(entry.reads.length).toBeGreaterThan(0);
      expect(entry.writes.length).toBeGreaterThan(0);
      expect(entry.retention.length).toBeGreaterThan(0);
      expect(entry.justification.length).toBeGreaterThan(0);
    }
  });
});

describe('export / restauration', () => {
  const valid: RetentionExport = {
    schema: RETENTION_EXPORT_SCHEMA,
    version: RETENTION_EXPORT_VERSION,
    exportedAt: NOW,
    originals: [
      { id: 'o1', segmentId: 's1', issueId: '10001', findingIds: [], ciphertext: 'v1.ab', storedAt: NOW, restoredAt: null },
    ],
    tokens: [{ id: 't1', ciphertext: 'v1.cd', createdAt: NOW }],
  };

  it('valide un export conforme', () => {
    expect(validateRetentionExport(valid).ok).toBe(true);
  });

  it('refuse un schéma, une version ou un champ inconnu', () => {
    expect(validateRetentionExport({ ...valid, schema: 'autre' })).toEqual({
      ok: false,
      errors: ['schema inattendu'],
    });
    expect(validateRetentionExport({ ...valid, version: 99 }).ok).toBe(false);
    expect(validateRetentionExport({ ...valid, originals: undefined }).ok).toBe(false);
    expect(validateRetentionExport(null).ok).toBe(false);
  });

  it('ne réimporte jamais deux fois (idempotence)', () => {
    const existing = new Set(['o1', 'o2']);
    const incoming = [
      { id: 'o1', segmentId: 's1', issueId: '1', findingIds: [], ciphertext: 'x', storedAt: NOW, restoredAt: null },
      { id: 'o3', segmentId: 's3', issueId: '3', findingIds: [], ciphertext: 'y', storedAt: NOW, restoredAt: null },
    ];
    expect(planRestore(existing, incoming).map((r) => r.id)).toEqual(['o3']);

    const tokens = [{ id: 't1', ciphertext: 'x', createdAt: NOW }, { id: 't2', ciphertext: 'y', createdAt: NOW }];
    const plan = planTokenRestore(new Set(['t1']), tokens);
    expect(plan.toWrite.map((t) => t.id)).toEqual(['t2']);
    expect(plan.skipped).toBe(1);
  });
});