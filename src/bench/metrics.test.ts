import { describe, expect, it } from 'vitest';
import type { LayerHit } from '../core/types';
import {
  evaluateEntry,
  f1Of,
  measureCorpus,
  metricsDigest,
  noisiestRules,
  ratio,
  round,
  type Detector,
} from './metrics';
import type { CorpusEntry } from './corpus';

function hit(ruleId: string, confidence = 0.9): LayerHit {
  return {
    layer: 'C2',
    kind: 'assistant-addressing',
    ruleId,
    startPos: 0,
    endPos: 10,
    excerpt: 'extrait',
    askSummary: 'résumé',
    confidence,
  };
}

/** Détecteur de test : ne lève un signal que si le texte contient un mot-clé. */
const keywordDetector: Detector = (entry: CorpusEntry) => {
  const hits: LayerHit[] = [];
  if (entry.text.includes('attaque')) hits.push(hit('C2-01'));
  if (entry.text.includes('outil')) hits.push(hit('C2-04', 0.4));
  return hits;
};

const corpus: CorpusEntry[] = [
  { id: 'a-1', lang: 'fr', label: 'attack', text: 'attaque directe', family: 'role-switch', expectedRuleIds: ['C2-01'] },
  { id: 'a-2', lang: 'fr', label: 'attack', text: 'attaque indirecte', family: 'role-switch', expectedRuleIds: ['C2-01'] },
  { id: 'a-3', lang: 'en', label: 'attack', text: 'rien de spécial', family: 'exfiltration', expectedRuleIds: ['C2-05'] },
  { id: 'l-1', lang: 'fr', label: 'legitimate', text: 'demande normale' },
  { id: 'l-2', lang: 'fr', label: 'legitimate', text: 'demande avec un outil mentionné' },
];

describe('mesures élémentaires', () => {
  it('arrondit de façon stable', () => {
    expect(round(1 / 3)).toBe(0.3333);
    expect(round(0.5, 2)).toBe(0.5);
  });

  it('ne fabrique pas de ratio sans dénominateur', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 2)).toBe(0.5);
    expect(f1Of(null, 0.5)).toBeNull();
    expect(f1Of(1, 0)).toBe(0);
    expect(f1Of(0.5, 0.5)).toBe(0.5);
  });
});

describe('métriques du corpus', () => {
  const metrics = measureCorpus(corpus, keywordDetector);

  it('compte la matrice de confusion', () => {
    expect(metrics.confusion).toEqual({ truePositives: 2, falseNegatives: 1, falsePositives: 1, trueNegatives: 1 });
    expect(metrics.attacks).toBe(3);
    expect(metrics.legitimate).toBe(2);
  });

  it('calcule rappel, précision et faux positifs', () => {
    expect(metrics.recall).toBe(round(2 / 3));
    expect(metrics.precision).toBe(round(2 / 3));
    expect(metrics.falsePositiveRate).toBe(0.5);
  });

  it('mesure chaque règle séparément', () => {
    const c201 = metrics.byRule.find((rule) => rule.ruleId === 'C2-01');
    expect(c201?.truePositives).toBe(2);
    expect(c201?.expected).toBe(2);
    expect(c201?.satisfied).toBe(2);
    expect(c201?.recall).toBe(1);
    const c204 = metrics.byRule.find((rule) => rule.ruleId === 'C2-04');
    expect(c204?.truePositives).toBe(0);
    expect(c204?.falsePositives).toBe(1);
    expect(c204?.precision).toBe(0);
    expect(c204?.recall).toBeNull();
  });

  it('liste les charges manquées et les faux positifs', () => {
    expect(metrics.missedAttacks).toEqual(['a-3']);
    expect(metrics.falsePositiveIds).toEqual(['l-2']);
  });

  it('déclare les règles attendues mais jamais vues', () => {
    expect(metrics.neverFiredRules).toEqual(['C2-05']);
  });

  it('regroupe par famille et par langue', () => {
    const family = metrics.byFamily.find((group) => group.key === 'role-switch');
    expect(family?.attacks).toBe(2);
    expect(family?.detected).toBe(2);
    const en = metrics.byLang.find((group) => group.key === 'en');
    expect(en?.attacks).toBe(1);
    expect(en?.recall).toBe(0);
  });

  it('reste stable : mêmes entrées, mêmes chiffres', () => {
    const again = measureCorpus(corpus, keywordDetector);
    expect(metricsDigest(again)).toBe(metricsDigest(metrics));
  });

  it('classe les règles les plus bruyantes', () => {
    expect(noisiestRules(metrics).map((rule) => rule.ruleId)).toEqual(['C2-04']);
  });

  it('respecte un seuil de confiance', () => {
    const strict = measureCorpus(corpus, keywordDetector, { minConfidence: 0.8 });
    expect(strict.confusion.falsePositives).toBe(0);
    expect(strict.precision).toBe(1);
  });

  it('évalue une entrée seule', () => {
    const outcome = evaluateEntry(corpus[0] as CorpusEntry, keywordDetector);
    expect(outcome.detected).toBe(true);
    expect(outcome.ruleIds).toEqual(['C2-01']);
    expect(outcome.missedRuleIds).toEqual([]);
  });
});
