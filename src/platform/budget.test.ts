import { describe, expect, it } from 'vitest';
import { DEFAULT_WRITE_LIMIT, SqlBudget, describeBudget } from './budget';

describe('budget de requêtes (§ quota Forge SQL)', () => {
  it('compte lectures et écritures séparément', () => {
    const budget = new SqlBudget({ limit: 10 });
    budget.countRead();
    budget.countRead();
    budget.countWrite();
    expect(budget.reading.reads).toBe(2);
    expect(budget.reading.writes).toBe(1);
    expect(budget.reading.queries).toBe(3);
  });

  it('n’écrit plus passé le plafond, et le dit', () => {
    const budget = new SqlBudget({ limit: 2 });
    expect(budget.shouldSkipWrite()).toBe(false);
    budget.countWrite();
    expect(budget.shouldSkipWrite()).toBe(false);
    budget.countWrite();
    expect(budget.shouldSkipWrite()).toBe(true);
    budget.markSkipped();
    const reading = budget.reading;
    expect(reading.skippedWrites).toBe(1);
    expect(reading.degraded).toBe(true);
    expect(reading.writes).toBe(2);
  });

  it('signale qu’on approche du plafond, puis bascule en dégradé', () => {
    const budget = new SqlBudget({ limit: 10, warnRatio: 0.8 });
    budget.countWrite();
    budget.countWrite();
    expect(budget.reading.nearLimit).toBe(false);
    for (let i = 0; i < 7; i += 1) budget.countWrite();
    // 9 écritures : on approche du plafond, mais rien n'est encore sauté.
    expect(budget.reading.nearLimit).toBe(true);
    expect(budget.reading.degraded).toBe(false);
    budget.countWrite();
    // 10 écritures : le plafond est atteint, la dégradation commence.
    expect(budget.reading.degraded).toBe(true);
  });

  it('le relevé porte l’instant de début et le plafond', () => {
    const budget = new SqlBudget({ limit: 7, startedAt: '2026-11-12T18:00:00.000Z' });
    expect(budget.reading.startedAt).toBe('2026-11-12T18:00:00.000Z');
    expect(budget.reading.limit).toBe(7);
    expect(budget.max).toBe(7);
  });

  it('le plafond par défaut est raisonnable', () => {
    expect(DEFAULT_WRITE_LIMIT).toBeGreaterThan(10);
    expect(DEFAULT_WRITE_LIMIT).toBeLessThan(1000);
  });

  it('la description lisible dit ce qui s’est passé', () => {
    const budget = new SqlBudget({ limit: 1 });
    budget.countWrite();
    budget.markSkipped();
    const text = describeBudget(budget.reading);
    expect(text).toContain('1/1 écritures');
    expect(text).toContain('sautée');
    expect(text).toContain('mode dégradé');
  });
});
