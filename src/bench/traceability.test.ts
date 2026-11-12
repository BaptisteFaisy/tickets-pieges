import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TABLE_HEADER,
  checkTraceability,
  describeGap,
  expectedRequirementIds,
  formatGapReport,
  parseRequirement,
  parseRequirements,
  renderMarkdownTable,
  renderRow,
  verifyRequirement,
  type PathOracle,
  type RequirementRef,
} from './traceability';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Le document réel des exigences, lu sur le disque — la porte s'appuie dessus. */
const document = parseRequirements(JSON.parse(readFileSync(resolve(ROOT, 'data/requirements.json'), 'utf8')));

/** Une exigence de test, minimale. */
function requirement(overrides: Partial<RequirementRef> = {}): RequirementRef {
  return {
    id: 'TP-99',
    title: 'Exigence de test',
    priorite: 'M',
    modules: ['src/core/origin.ts'],
    tests: ['src/core/origin.test.ts'],
    ...overrides,
  };
}

/** Oracle qui nexists que les chemins listés — le faux positif est injectable. */
function onlyThese(paths: readonly string[]): PathOracle {
  const allowed = new Set(paths);
  return (path) => allowed.has(path);
}

describe('matrice des exigences (§15, TP-01 à TP-28)', () => {
  it('porte les vingt-huit identifiants du cahier, dans l\'ordre', () => {
    const ids = document.requirements.map((entry) => entry.id);
    expect(ids).toEqual(expectedRequirementIds(28));
    expect(ids[0]).toBe('TP-01');
    expect(ids[27]).toBe('TP-28');
  });

  it('cite au moins un module et un test pour chaque exigence', () => {
    for (const entry of document.requirements) {
      expect(entry.modules.length, entry.id).toBeGreaterThan(0);
      expect(entry.tests.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('ne cite que des chemins qui existent dans le dépôt', () => {
    const missing: string[] = [];
    for (const entry of document.requirements) {
      for (const path of [...entry.modules, ...entry.tests]) {
        if (!existsSync(resolve(ROOT, path))) missing.push(`${entry.id} → ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('est jugée sans trou quand tous les chemins existent', () => {
    const report = checkTraceability(document, (path) => existsSync(resolve(ROOT, path)));
    expect(report.ok).toBe(true);
    expect(report.holes).toBe(0);
    expect(report.covered).toBe(28);
    expect(report.missingPaths).toEqual([]);
  });
});

describe('contrôle des chemins cités', () => {
  it('signale une exigence dont un module a disparu', () => {
    const verdict = verifyRequirement(requirement(), onlyThese(['src/core/origin.test.ts']));
    expect(verdict.status).toBe('trou');
    expect(verdict.missingModules).toEqual(['src/core/origin.ts']);
    expect(verdict.ecart).toContain('src/core/origin.ts');
  });

  it('signale une exigence dont un test a disparu', () => {
    const verdict = verifyRequirement(requirement(), onlyThese(['src/core/origin.ts']));
    expect(verdict.status).toBe('trou');
    expect(verdict.missingTests).toEqual(['src/core/origin.test.ts']);
  });

  it('signale une exigence qui ne cite aucun module ni aucun test', () => {
    const verdict = verifyRequirement(requirement({ modules: [], tests: [] }), () => true);
    expect(verdict.status).toBe('trou');
    expect(verdict.ecart).toContain('aucun module cité');
    expect(verdict.ecart).toContain('aucun test cité');
  });

  it('liste les chemins absents, uniques et triés', () => {
    const report = checkTraceability(document, onlyThese([]));
    expect(report.ok).toBe(false);
    expect(report.holes).toBe(28);
    expect(report.missingPaths.length).toBeGreaterThan(28);
    expect([...report.missingPaths].sort()).toEqual(report.missingPaths);
    expect(new Set(report.missingPaths).size).toBe(report.missingPaths.length);
  });

  it('conserve les modules et les tests existants dans le verdict', () => {
    const verdict = verifyRequirement(requirement(), onlyThese(['src/core/origin.ts', 'src/core/origin.test.ts']));
    expect(verdict.status).toBe('couvert');
    expect(verdict.modules).toEqual(['src/core/origin.ts']);
    expect(verdict.tests).toEqual(['src/core/origin.test.ts']);
    expect(verdict.ecart).toBeNull();
  });
});

describe('écarts déclarés par le document', () => {
  it('apparaissent dans la colonne « écart » même sans trou', () => {
    const verdict = verifyRequirement(
      requirement({ reste: 'reste à faire : branchement sur le site' }),
      () => true,
    );
    expect(verdict.status).toBe('couvert');
    expect(verdict.ecart).toContain('branchement sur le site');
  });

  it('s\'ajoutent à la description d\'un trou', () => {
    const gap = describeGap({
      modules: [],
      tests: [],
      missingModules: ['src/core/absent.ts'],
      missingTests: [],
      reste: 'reste à faire : reprise du test',
    });
    expect(gap).toContain('src/core/absent.ts');
    expect(gap).toContain('reprise du test');
  });
});

describe('tableau markdown', () => {
  it('cite les vingt-huit exigences et la colonne des écarts', () => {
    const report = checkTraceability(document, (path) => existsSync(resolve(ROOT, path)));
    const table = renderMarkdownTable(report);
    expect(table.startsWith(TABLE_HEADER)).toBe(true);
    for (const entry of document.requirements) {
      expect(table).toContain(`| ${entry.id} |`);
    }
    expect(table.split('\n').length).toBe(30);
  });

  it('dit ce qui manque sur la ligne d\'une exigence en trou', () => {
    const verdict = verifyRequirement(requirement(), onlyThese([]));
    const row = renderRow(verdict);
    expect(row).toContain('TP-99');
    expect(row).toContain('src/core/origin.ts');
  });
});

describe('rapport console', () => {
  it('liste les trous puis le compte des exigences couvertes', () => {
    const report = checkTraceability(document, onlyThese([]));
    const text = formatGapReport(report);
    expect(text).toContain('28 exigence(s) en trou');
    expect(text).toContain('0/28 exigences couvertes');
  });

  it('annonce l\'absence de trou quand tout existe', () => {
    const report = checkTraceability(document, (path) => existsSync(resolve(ROOT, path)));
    expect(formatGapReport(report)).toContain('Aucun trou');
  });
});

describe('validation du document des exigences', () => {
  it('refuse un identifiant en double', () => {
    const twice = {
      version: 1,
      source: 'test',
      requirements: [raw('TP-01'), raw('TP-01')],
    };
    expect(() => parseRequirements(twice)).toThrow(/en double/);
  });

  it('refuse une priorité inconnue', () => {
    expect(() => parseRequirement({ ...raw('TP-01'), priorite: 'X' }, 0)).toThrow(/priorité/);
  });

  it('refuse une exigence sans module ni sans test', () => {
    expect(() => parseRequirement({ ...raw('TP-01'), modules: [] }, 0)).toThrow(/modules/);
    expect(() => parseRequirement({ ...raw('TP-01'), tests: [] }, 0)).toThrow(/tests/);
  });

  it('refuse un document sans version ni sans source', () => {
    expect(() => parseRequirements({ source: 'x', requirements: [] })).toThrow(/version/);
    expect(() => parseRequirements({ version: 1, requirements: [] })).toThrow(/source/);
  });

  it('refuse un identifiant manquant', () => {
    expect(() => parseRequirement({ title: 'sans identifiant', priorite: 'M', modules: ['a.ts'], tests: ['a.test.ts'] }, 0)).toThrow(
      /identifiant/,
    );
  });
});

/** Une exigence brute, au format du document JSON. */
function raw(id: string): Record<string, unknown> {
  return {
    id,
    title: 'Exigence de test',
    priorite: 'M',
    modules: ['src/core/origin.ts'],
    tests: ['src/core/origin.test.ts'],
  };
}
