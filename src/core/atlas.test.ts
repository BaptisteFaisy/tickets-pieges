import { describe, expect, it } from 'vitest';
import {
  ATLAS_CATALOGUE,
  ATLAS_GAPS,
  ATLAS_RULES,
  ATLAS_TECHNIQUES,
  ATLAS_UNMAPPED,
  coverageLabel,
  coverageOfFindings,
  coverageOfReport,
  isKnownTechnique,
  isMappedTechnique,
  ruleMapping,
  strongestCoverage,
  techniquesOfRule,
  uncoveredRuleIds,
} from './atlas';
import type { Finding } from './types';
import type { ExposureReport } from './types-flow';

/** Tous les `ruleId` que le dépôt émet, relevés par `grep -rhoE` sur src/. */
const REPO_RULE_IDS = [
  'C1-01', 'C1-02', 'C1-03', 'C1-04', 'C1-05', 'C1-06', 'C1-07', 'C1-08', 'C1-09', 'C1-10',
  'C1-11', 'C1-12', 'C1-13',
  'C2-01', 'C2-02', 'C2-03', 'C2-04', 'C2-05', 'C2-09',
  'C3-01', 'C3-02', 'C3-90',
  'C4-01', 'C4-02', 'C4-03', 'C4-04', 'C4-05', 'C4-06', 'C4-07', 'C4-08',
  'DC-01', 'DC-02', 'DC-03', 'DC-04', 'DC-05', 'DC-06',
  'iban', 'card', 'siret', 'siren', 'nir', 'github-token', 'api-key', 'aws-access-key',
  'jwt', 'email', 'phone',
];

const COVERAGE_LEVELS = ['detected', 'framed', 'blocked', 'not-covered'] as const;

function finding(ruleId: string, layer: Finding['layer'], id = ruleId): Finding {
  return {
    id,
    segmentId: 'seg-1',
    issueId: '10001',
    layer,
    kind: 'invisible-chars',
    ruleId,
    excerpt: 'extrait',
    startPos: 0,
    endPos: 4,
    askSummary: 'consigne dissimulée',
    confidence: 0.9,
    status: 'open',
    createdAt: '2026-11-12T08:00:00.000Z',
  };
}

function report(findings: Finding[]): ExposureReport {
  return {
    projectKey: 'SUP',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-12T00:00:00.000Z',
    requestsExamined: 12,
    analyzedShare: 1,
    findingsByLayer: { C1: findings.length, C2: 0, C3: 0, C4: 0 },
    verdicts: { trapped: 0, 'false-positive': 0, 'legitimate-risky': 0 },
    canariesLaunched: 2,
    canariesObeyed: 0,
    obedienceRate: 0,
    outboundHeld: 0,
    campaigns: 1,
    topKinds: [{ kind: 'invisible-chars', count: findings.length }],
  };
}

describe('table ATLAS — aucune technique inventée', () => {
  it('toute technique de la table existe dans le catalogue MITRE officiel', () => {
    expect(Object.keys(ATLAS_CATALOGUE).length).toBeGreaterThanOrEqual(170);
    for (const technique of ATLAS_TECHNIQUES) {
      expect(isKnownTechnique(technique.id), technique.id).toBe(true);
      expect(ATLAS_CATALOGUE[technique.id], technique.id).toBe(technique.name);
      expect(technique.nameFr.length, technique.id).toBeGreaterThan(0);
    }
  });

  it('toute technique citée par une règle ou par un trou est documentée', () => {
    for (const rule of ATLAS_RULES) {
      for (const techniqueId of rule.techniques) {
        expect(isMappedTechnique(techniqueId), `${rule.ruleId} → ${techniqueId}`).toBe(true);
      }
    }
    for (const gap of ATLAS_GAPS) {
      expect(isKnownTechnique(gap.techniqueId), gap.techniqueId).toBe(true);
    }
  });

  it('chaque règle a un niveau de couverture connu et une note dans les deux langues', () => {
    for (const rule of ATLAS_RULES) {
      expect(COVERAGE_LEVELS, rule.ruleId).toContain(rule.coverage);
      expect(rule.techniques.length, rule.ruleId).toBeGreaterThan(0);
      expect(rule.noteFr.length, rule.ruleId).toBeGreaterThan(0);
      expect(rule.noteEn.length, rule.ruleId).toBeGreaterThan(0);
      expect(rule.noteFr, rule.ruleId).not.toBe(rule.noteEn);
    }
  });
});

describe('table ATLAS — chaque ruleId du dépôt est traité', () => {
  it('chaque ruleId du dépôt a une entrée ATLAS ou est explicitement non mappé', () => {
    const unmapped = new Set(ATLAS_UNMAPPED.map((entry) => entry.ruleId));
    for (const ruleId of REPO_RULE_IDS) {
      const mapped = ruleMapping(ruleId) !== undefined;
      expect(mapped || unmapped.has(ruleId), `ruleId sans entrée ATLAS : ${ruleId}`).toBe(true);
    }
  });

  it('une règle non mappée donne sa raison, dans les deux langues', () => {
    expect(ATLAS_UNMAPPED.length).toBeGreaterThan(0);
    for (const entry of ATLAS_UNMAPPED) {
      expect(entry.reasonFr.length, entry.ruleId).toBeGreaterThan(0);
      expect(entry.reasonEn.length, entry.ruleId).toBeGreaterThan(0);
      expect(ruleMapping(entry.ruleId), entry.ruleId).toBeUndefined();
    }
  });

  it('aucune entrée de la table ne porte sur un ruleId absent du dépôt', () => {
    for (const rule of ATLAS_RULES) {
      expect(REPO_RULE_IDS, rule.ruleId).toContain(rule.ruleId);
    }
  });

  it('les identifiants de règles sont uniques', () => {
    const ids = ATLAS_RULES.map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('couverture d’un ticket, par technique', () => {
  it('une règle de dissimulation remonte la technique d’obscurcissement, encadrée', () => {
    const coverage = coverageOfFindings([finding('C1-01', 'C1')]);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.technique.id).toBe('AML.T0068');
    expect(coverage[0]?.coverage).toBe('framed');
    expect(coverage[0]?.ruleIds).toEqual(['C1-01']);
    expect(coverage[0]?.findings).toBe(1);
  });

  it('deux règles sur la même technique s’additionnent et gardent le niveau le plus fort', () => {
    const coverage = coverageOfFindings([
      finding('C1-01', 'C1', 'f1'),
      finding('C1-13', 'C1', 'f2'),
      finding('C4-04', 'C4', 'f3'),
    ]);
    const obfuscation = coverage.find((entry) => entry.technique.id === 'AML.T0068');
    expect(obfuscation?.findings).toBe(3);
    expect(obfuscation?.ruleIds).toEqual(['C1-01', 'C1-13', 'C4-04']);
    expect(obfuscation?.coverage).toBe('framed');
  });

  it('le sas bloque : un motif de donnée personnelle remonte « blocked »', () => {
    const coverage = coverageOfFindings([finding('iban', 'C1')]);
    expect(coverage.some((entry) => entry.coverage === 'blocked')).toBe(true);
    expect(coverage.some((entry) => entry.technique.id === 'AML.T0057')).toBe(true);
  });

  it('une injection indirecte et une exfiltration donnent deux techniques distinctes', () => {
    const coverage = coverageOfFindings([
      finding('C2-01', 'C2', 'f1'),
      finding('C2-05', 'C2', 'f2'),
    ]);
    const ids = coverage.map((entry) => entry.technique.id);
    expect(ids).toContain('AML.T0051.001');
    expect(ids).toContain('AML.T0025');
  });

  it('une pièce jointe non analysable est dite non couverte, jamais « protégée »', () => {
    const coverage = coverageOfFindings([finding('C4-05', 'C4')]);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.coverage).toBe('not-covered');
  });

  it('sans constat, aucune technique n’est annoncée', () => {
    expect(coverageOfFindings([])).toEqual([]);
  });

  it('les constats sont rendus du plus fréquent au moins fréquent', () => {
    const coverage = coverageOfFindings([
      finding('C1-01', 'C1', 'f1'),
      finding('C1-02', 'C1', 'f2'),
      finding('C2-01', 'C2', 'f3'),
    ]);
    const counts = coverage.map((entry) => entry.findings);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('couverture d’un rapport d’exposition', () => {
  it('la couverture d’un rapport est cohérente avec ses constats', () => {
    const findings = [
      finding('C1-01', 'C1', 'f1'),
      finding('C1-05', 'C1', 'f2'),
      finding('C2-04', 'C2', 'f3'),
    ];
    const coverage = coverageOfReport(report(findings), findings);
    expect(coverage.coveredFindings).toBe(
      coverage.techniques.reduce((total, entry) => total + entry.findings, 0),
    );
    expect(coverage.coveredFindings).toBeGreaterThanOrEqual(findings.length);
    expect(coverage.uncoveredRuleIds).toEqual([]);
    expect(coverage.projectKey).toBe('SUP');
    expect(coverage.analyzedShare).toBe(1);
  });

  it('chaque constat du rapport retrouve sa technique, aucun ne disparaît', () => {
    const findings = REPO_RULE_IDS.filter((id) => ruleMapping(id)).map((id, index) =>
      finding(id, 'C1', `f${index}`),
    );
    const coverage = coverageOfReport(report(findings), findings);
    const seen = new Set<string>();
    for (const entry of coverage.techniques) {
      for (const ruleId of entry.ruleIds) seen.add(ruleId);
    }
    expect(seen.size).toBe(findings.length);
  });

  it('un rapport nomme les techniques que le produit n’analyse pas', () => {
    const coverage = coverageOfReport(report([]), []);
    expect(coverage.gaps.length).toBeGreaterThan(0);
    const ids = coverage.gaps.map((gap) => gap.techniqueId);
    expect(ids).toContain('AML.T0029');
    expect(ids).toContain('AML.T0080');
    for (const gap of coverage.gaps) expect(gap.coverage).toBe('not-covered');
  });

  it('une règle inconnue du rapport est dite non couverte, pas silently ignorée', () => {
    const coverage = coverageOfReport(report([]), [finding('ZZ-99', 'C1')]);
    expect(coverage.uncoveredRuleIds).toEqual(['ZZ-99']);
    expect(coverage.techniques).toEqual([]);
    expect(uncoveredRuleIds([finding('ZZ-99', 'C1'), finding('C1-01', 'C1')])).toEqual(['ZZ-99']);
  });

  it('la part analysée du rapport est rendue telle quelle (§21)', () => {
    const partial = { ...report([]), analyzedShare: 0.4 };
    expect(coverageOfReport(partial, []).analyzedShare).toBe(0.4);
  });
});

describe('niveaux de couverture', () => {
  it('le niveau le plus fort l’emporte', () => {
    expect(strongestCoverage(['detected', 'framed'])).toBe('framed');
    expect(strongestCoverage(['framed', 'blocked'])).toBe('blocked');
    expect(strongestCoverage(['not-covered', 'detected'])).toBe('detected');
    expect(strongestCoverage([])).toBe('not-covered');
  });

  it('chaque niveau a un libellé dans les deux langues, et les deux diffèrent', () => {
    for (const level of COVERAGE_LEVELS) {
      expect(coverageLabel(level, 'fr').length).toBeGreaterThan(0);
      expect(coverageLabel(level, 'en').length).toBeGreaterThan(0);
      expect(coverageLabel(level, 'fr')).not.toBe(coverageLabel(level, 'en'));
    }
  });

  it('un niveau inconnu retombe sur l’identifiant, sans inventer de texte', () => {
    expect(coverageLabel('inconnu' as never, 'fr')).toBe('inconnu');
  });

  it('les techniques d’une règle sont rendues traduites', () => {
    const techniques = techniquesOfRule('C2-05');
    expect(techniques.map((technique) => technique.id)).toEqual(['AML.T0025', 'AML.T0086']);
    expect(techniques[0]?.nameFr.length).toBeGreaterThan(0);
    expect(techniquesOfRule('ZZ-99')).toEqual([]);
  });
});
