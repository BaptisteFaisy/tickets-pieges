import { describe, expect, it } from 'vitest';
import {
  renderTraceabilityMarkdown,
  verifyRequirement,
  verifyTraceability,
  type RequirementEntry,
} from './traceability';

function exigence(overrides: Partial<RequirementEntry> = {}): RequirementEntry {
  return {
    id: 'TP-01',
    titre: 'Origine de chaque segment',
    priorite: 'M',
    etat: 'complet',
    modules: ['src/core/origin.ts'],
    tests: ['src/core/origin.test.ts'],
    ...overrides,
  };
}

describe('traçabilité des exigences', () => {
  it('une exigence dont les fichiers existent n’est pas un écart', () => {
    const status = verifyRequirement(exigence(), new Set(['src/core/origin.ts', 'src/core/origin.test.ts']));
    expect(status.ecart).toBe(false);
    expect(status.modulesManquants).toEqual([]);
  });

  it('un fichier disparu est un écart, même si l’état déclaré est « complet »', () => {
    const status = verifyRequirement(exigence(), new Set(['src/core/origin.test.ts']));
    expect(status.ecart).toBe(true);
    expect(status.modulesManquants).toEqual(['src/core/origin.ts']);
  });

  it('un test disparu est un écart', () => {
    const status = verifyRequirement(exigence(), new Set(['src/core/origin.ts']));
    expect(status.ecart).toBe(true);
    expect(status.testsManquants).toEqual(['src/core/origin.test.ts']);
  });

  it('une exigence sans module ni test est un écart', () => {
    const status = verifyRequirement(exigence({ modules: [], tests: [] }), new Set());
    expect(status.ecart).toBe(true);
  });

  it('un état « partiel » ou « à faire » est un écart assumé', () => {
    const files = new Set(['src/core/origin.ts', 'src/core/origin.test.ts']);
    expect(verifyRequirement(exigence({ etat: 'partiel' }), files).ecart).toBe(true);
    expect(verifyRequirement(exigence({ etat: 'a-faire' }), files).ecart).toBe(true);
  });

  it('le rapport compte les états et isole les écarts', () => {
    const report = verifyTraceability(
      [
        exigence({ id: 'TP-01' }),
        exigence({ id: 'TP-02', etat: 'partiel' }),
        exigence({ id: 'TP-03', modules: ['src/core/absent.ts'], tests: [] }),
      ],
      ['src/core/origin.ts', 'src/core/origin.test.ts'],
    );
    expect(report.total).toBe(3);
    expect(report.complets).toBe(1);
    expect(report.partiels).toBe(1);
    expect(report.ecarts.map((status) => status.id)).toEqual(['TP-02', 'TP-03']);
  });

  it('le tableau markdown cite chaque exigence et les écarts', () => {
    const requirements = [exigence({ id: 'TP-01' }), exigence({ id: 'TP-02', etat: 'a-faire', remarque: 'reste à construire' })];
    const report = verifyTraceability(requirements, ['src/core/origin.ts', 'src/core/origin.test.ts']);
    const markdown = renderTraceabilityMarkdown(report, requirements);
    expect(markdown).toContain('| TP-01 |');
    expect(markdown).toContain('| TP-02 |');
    expect(markdown).toContain('reste à construire');
    expect(markdown).toContain('2 exigences');
  });
});
