/**
 * Test du contrat de version — `src/core/rules-version.ts`.
 *
 * Ce que le test verrouille :
 *  - la version majeure est un entier, l'empreinte est stable ;
 *  - l'empreinte **change** quand une table de motifs change (le cas « la
 *    règle a bougé, personne n'a rien dit » est le glissement redouté) ;
 *  - une famille de règles inconnue est refusée ;
 *  - une famille déclarée et non jouée est signalée comme telle.
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_TABLES,
  RULE_FAMILIES,
  RULES_FINGERPRINT,
  RULES_ID,
  RULES_VERSION,
  assertFamilies,
  assertKnownFamily,
  checkFamilies,
  fingerprintTables,
  isKnownFamily,
  rulesCatalogue,
  type RulesTable,
} from './rules-version';

/** Un jeu de tables modifié : une entrée de plus dans le lexique français. */
function withExtraFrenchPattern(): RulesTable[] {
  return CURRENT_TABLES.map((table) =>
    table.family === 'C2' && table.name === 'lexique-fr'
      ? { ...table, entries: [...table.entries, 'C2-99|motif-de-test|0.5|false|nouveau'] }
      : table,
  );
}

/** Un jeu de tables modifié : un seuil de la famille C1 change. */
function withOtherThreshold(): RulesTable[] {
  return CURRENT_TABLES.map((table) =>
    table.family === 'C1' && table.name === 'seuils'
      ? { ...table, entries: [...table.entries, 'NOUVEAU_SEUIL=1'] }
      : table,
  );
}

describe('version du catalogue de règles', () => {
  it('la version majeure est un entier positif', () => {
    expect(Number.isInteger(RULES_VERSION)).toBe(true);
    expect(RULES_VERSION).toBeGreaterThan(0);
  });

  it('l’empreinte est stable : elle rend la valeur des tables réellement utilisées', () => {
    expect(fingerprintTables(CURRENT_TABLES)).toBe(RULES_FINGERPRINT);
    expect(fingerprintTables(CURRENT_TABLES)).toBe(fingerprintTables(CURRENT_TABLES));
  });

  it('l’empreinte change quand une table de motifs change', () => {
    expect(fingerprintTables(withExtraFrenchPattern())).not.toBe(RULES_FINGERPRINT);
  });

  it('l’empreinte change quand un seuil change', () => {
    expect(fingerprintTables(withOtherThreshold())).not.toBe(RULES_FINGERPRINT);
  });

  it('l’empreinte ne dépend pas de l’ordre des tables', () => {
    const reversed = [...CURRENT_TABLES].reverse();
    expect(fingerprintTables(reversed)).not.toBe(RULES_FINGERPRINT);
    expect(fingerprintTables(reversed)).toBe(fingerprintTables(reversed));
  });

  it('l’identifiant du catalogue porte la version et l’empreinte', () => {
    expect(RULES_ID).toContain(String(RULES_VERSION));
    expect(RULES_ID).toContain(RULES_FINGERPRINT.slice(0, 12));
  });

  it('chaque famille connue a au moins une table', () => {
    for (const family of RULE_FAMILIES) {
      const tables = CURRENT_TABLES.filter((table) => table.family === family);
      expect(tables.length).toBeGreaterThan(0);
    }
  });

  it('le catalogue rendu par le produit porte la version et les familles', () => {
    const catalogue = rulesCatalogue();
    expect(catalogue.version).toBe(RULES_VERSION);
    expect(catalogue.fingerprint).toBe(RULES_FINGERPRINT);
    expect(catalogue.id).toBe(RULES_ID);
    expect(catalogue.families).toEqual(RULE_FAMILIES);
  });
});

describe('famille de règles inconnue', () => {
  it('une famille connue est reconnue', () => {
    for (const family of RULE_FAMILIES) {
      expect(isKnownFamily(family)).toBe(true);
    }
  });

  it('une famille inconnue est refusée, pas ignorée', () => {
    expect(isKnownFamily('C9')).toBe(false);
    expect(() => assertKnownFamily('C9')).toThrow(/C9/);
  });

  it('une famille inconnue est refusée même si elle ressemble à une connue', () => {
    expect(() => assertKnownFamily('c1')).toThrow();
    expect(() => assertKnownFamily('C1 ')).toThrow();
  });
});

describe('contrat familles déclarées / familles jouées', () => {
  it('aucun écart quand les deux listes coïncident', () => {
    expect(checkFamilies(RULE_FAMILIES, RULE_FAMILIES)).toEqual([]);
    expect(() => assertFamilies(RULE_FAMILIES, RULE_FAMILIES)).not.toThrow();
  });

  it('une famille déclarée et non jouée est signalée', () => {
    const issues = checkFamilies(['C1', 'C2', 'pressure'], ['C1', 'C2']);
    expect(issues).toEqual([{ family: 'pressure', kind: 'declared-not-played' }]);
    expect(() => assertFamilies(['C1', 'C2', 'pressure'], ['C1', 'C2'])).toThrow(/pressure/);
  });

  it('une famille inconnue est signalée comme inconnue', () => {
    const issues = checkFamilies(['C1', 'C9'], ['C1']);
    expect(issues).toEqual([{ family: 'C9', kind: 'unknown-family' }]);
  });

  it('une famille jouée mais non déclarée est signalée', () => {
    const issues = checkFamilies(['C1'], ['C1', 'decode']);
    expect(issues).toEqual([{ family: 'decode', kind: 'played-not-declared' }]);
  });
});
