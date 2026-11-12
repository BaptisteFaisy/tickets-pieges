import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LayerHit } from '../core/types';
import type { Detector } from './metrics';
import { createDetector } from './detector';
import {
  checkThreshold,
  defaultThreshold,
  measureLegit,
  splitLegit,
  type LegitCorpusEntry,
  type LegitMeasure,
  type LegitThreshold,
} from './legitimate';

const HERE = dirname(fileURLToPath(import.meta.url));

function entry(id: string, text: string, trap = false): LegitCorpusEntry {
  return { id, lang: 'fr', label: 'legitimate', text, ...(trap ? { trap: true } : {}) };
}

function hit(ruleId: string, layer: LayerHit['layer'] = 'C2'): LayerHit {
  return {
    layer,
    kind: 'assistant-addressing',
    ruleId,
    startPos: 0,
    endPos: 4,
    excerpt: 'x',
    askSummary: 'résumé',
    confidence: 0.9,
  };
}

/** Détecteur de test : lève C2-01 sur « attaque », C1-01 sur « invisible ». */
const keywordDetector: Detector = (candidate) => {
  const hits: LayerHit[] = [];
  if (candidate.text.includes('attaque')) hits.push(hit('C2-01'));
  if (candidate.text.includes('invisible')) hits.push(hit('C1-01', 'C1'));
  return hits;
};

function readLegitimate(): LegitCorpusEntry[] {
  const files = ['legitimate-fr.json', 'legitimate-en.json'];
  return files.flatMap((name) => {
    const doc = JSON.parse(readFileSync(resolve(HERE, '../../data/corpus', name), 'utf8')) as {
      entries: LegitCorpusEntry[];
    };
    return doc.entries;
  });
}

describe('splitLegit', () => {
  it('sépare textes ordinaires et pièges', () => {
    const { plain, trap } = splitLegit([
      entry('a', 'support ordinaire'),
      entry('b', 'mentions légales', true),
    ]);
    expect(plain.map((item) => item.id)).toEqual(['a']);
    expect(trap.map((item) => item.id)).toEqual(['b']);
  });
});

describe('measureLegit', () => {
  const entries = [
    entry('p1', 'demande de support ordinaire'),
    entry('p2', 'ce ticket parle d une attaque'),
    entry('t1', 'guide qui cite un texte invisible', true),
  ];
  const measure = measureLegit(entries, keywordDetector);

  it('compte les textes ordinaires relevés à tort et le C2', () => {
    expect(measure.plainCount).toBe(2);
    expect(measure.trapCount).toBe(1);
    expect(measure.plainFalsePositives).toEqual(['p2']);
    expect(measure.trapFalsePositives).toEqual(['t1']);
    expect(measure.plainC2Fp).toBe(1);
  });

  it('calcule des taux et répartit par règle', () => {
    expect(measure.plainFpRate).toBe(0.5);
    expect(measure.trapFpRate).toBe(1);
    const c2 = measure.perRule.find((rule) => rule.ruleId === 'C2-01');
    const c1 = measure.perRule.find((rule) => rule.ruleId === 'C1-01');
    expect(c2?.falsePositivesPlain).toBe(1);
    expect(c2?.falsePositivesTrap).toBe(0);
    expect(c1?.falsePositivesPlain).toBe(0);
    expect(c1?.falsePositivesTrap).toBe(1);
  });
});

describe('seuil bloquant', () => {
  const clean: LegitMeasure = {
    total: 3,
    plainCount: 2,
    trapCount: 1,
    plainFalsePositives: [],
    trapFalsePositives: ['t1'],
    plainFpRate: 0,
    trapFpRate: 0.5,
    plainC2Fp: 0,
    perRule: [],
  };

  it('pose zéro faux positif ordinaire et aucun motif C2 par défaut', () => {
    expect(defaultThreshold()).toEqual({ plainMaxFpRate: 0, trapMaxFpRate: 0.5, plainMaxC2Fp: 0 });
  });

  it('tient quand la mesure respecte le seuil', () => {
    expect(checkThreshold(clean, defaultThreshold())).toEqual([]);
  });

  it('échoue quand on abaisse le seuil sous la mesure', () => {
    const lowered: LegitThreshold = { plainMaxFpRate: 0, trapMaxFpRate: 0.4, plainMaxC2Fp: 0 };
    const exceeded = checkThreshold(clean, lowered);
    expect(exceeded.length).toBeGreaterThan(0);
    expect(exceeded[0]).toContain('piège');
  });

  it('échoue quand un texte ordinaire est relevé à tort', () => {
    const noisy: LegitMeasure = { ...clean, plainFalsePositives: ['p2'], plainFpRate: 0.5, plainC2Fp: 1 };
    const exceeded = checkThreshold(noisy, defaultThreshold());
    expect(exceeded.some((line) => line.includes('ordinaire'))).toBe(true);
    expect(exceeded.some((line) => line.includes('C2'))).toBe(true);
  });
});

describe('corpus légitime publié', () => {
  const measure = measureLegit(readLegitimate(), createDetector());

  it('ne relève aucun texte ordinaire ni aucun motif C2', () => {
    expect(measure.plainFalsePositives).toEqual([]);
    expect(measure.plainC2Fp).toBe(0);
  });

  it('respecte le seuil mesuré (au moins 40 textes par langue)', () => {
    expect(measure.total).toBeGreaterThanOrEqual(80);
    expect(checkThreshold(measure, defaultThreshold())).toEqual([]);
  });
});