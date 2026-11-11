/**
 * Tests de la comparaison et des rendus (TP-18) — verdicts et recette §23.
 *
 * Une divergence n'est pas une erreur du banc : ces tests vérifient qu'elle est
 * dite (détail), que les couches non jouées ne la fabriquent pas, que le bilan
 * tient en une ligne du type « 7 demandes sur 8 conformes », et que les rendus
 * texte et JSON sont exploitables tels quels par la console et par l'écran.
 */

import { describe, expect, it } from 'vitest';
import type { SampleRequest } from '../core/types';
import { compareBench, compareOne, evaluateRecipes, summaryLine } from './compare';
import { replayBench, replaySample } from './engine';
import { LOCAL_SAMPLES } from './fixtures';
import { renderBenchJson, renderBenchText, renderReport } from './report';

function sampleOf(id: string): SampleRequest {
  const sample = LOCAL_SAMPLES.find((item) => item.id === id);
  if (!sample) throw new Error(`échantillon inconnu : ${id}`);
  return sample;
}

async function fullBench() {
  const result = await replayBench(LOCAL_SAMPLES, { c1Detector: null });
  return { result, summary: compareBench(LOCAL_SAMPLES, result), recipes: evaluateRecipes(result) };
}

describe('compareOne — verdict par demande', () => {
  it('une demande conforme n’a aucun détail de divergence', async () => {
    const sample = sampleOf('fr-001');
    const report = await replaySample(sample, { c1Detector: null });
    const comparison = compareOne(sample, report);
    expect(comparison.verdict).toBe('conforme');
    expect(comparison.detail).toHaveLength(0);
  });

  it('les couches non jouées informent sans transformer en divergence', async () => {
    const sample = sampleOf('fr-001');
    const report = await replaySample(sample, { c1Detector: null });
    const comparison = compareOne(sample, report);
    expect(comparison.verdict).toBe('conforme');
    expect(comparison.notPlayed).toEqual(['C1 (c1-not-merged)', 'C3 (c3-not-played)']);
  });

  it('une confiance divergente est détaillée', async () => {
    const sample = sampleOf('fr-001');
    const report = await replaySample(sample, { c1Detector: null });
    const comparison = compareOne({ ...sample, expected: { ...sample.expected, trustLevel: 'T3' } }, report);
    expect(comparison.verdict).toBe('divergence');
    expect(comparison.detail.join('\n')).toContain('attendu T3');
    expect(comparison.detail.join('\n')).toContain('obtenu T1');
  });

  it('une nature de constat manquante est détaillée', async () => {
    const sample = sampleOf('fr-001');
    const report = await replaySample(sample, { c1Detector: null });
    const forged: SampleRequest = {
      ...sample,
      expected: { ...sample.expected, kinds: ['assistant-addressing'] },
    };
    const comparison = compareOne(forged, report);
    expect(comparison.verdict).toBe('divergence');
    expect(comparison.detail.join('\n')).toContain('attendus absents');
  });
});

describe('compareBench — bilan du jeu', () => {
  it('le jeu local rend 7 demandes sur 8 conformes (fr-005 attend C1)', async () => {
    const { result, summary } = await fullBench();
    expect(summary.total).toBe(8);
    expect(summary.conforming).toBe(7);
    expect(summary.diverging).toBe(1);
    expect(summary.rate).toBe(0.88);
    expect(summary.headline).toBe('7 demande(s) sur 8 conforme(s)');
    const diverging = summary.comparisons.filter((item) => item.verdict === 'divergence');
    expect(diverging.map((item) => item.sampleId)).toEqual(['fr-005']);
    expect(result.reports).toHaveLength(8);
  });

  it('summaryLine rend le total attendu, dans les deux langues', () => {
    expect(summaryLine(3, 4)).toBe('3 demande(s) sur 4 conforme(s)');
    expect(summaryLine(3, 4, 'en')).toBe('3 of 4 request(s) conforming');
  });
});

describe('evaluateRecipes — recette §23', () => {
  it('les 15 points sont rendus dans l’ordre, avec un statut explicite', async () => {
    const { recipes } = await fullBench();
    expect(recipes.map((recipe) => recipe.point)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const byPoint = new Map(recipes.map((recipe) => [recipe.point, recipe]));
    expect(byPoint.get(1)?.status).toBe('verifie');
    expect(byPoint.get(2)?.status).toBe('verifie');
    expect(byPoint.get(3)?.status).toBe('non-verifie'); // lot C1 non fusionné
    expect(byPoint.get(4)?.status).toBe('verifie');
    expect(byPoint.get(5)?.status).toBe('non-couvert'); // couche C3, hors ligne
    expect(byPoint.get(7)?.status).toBe('verifie');
    expect(byPoint.get(8)?.status).toBe('verifie');
    expect(byPoint.get(15)?.status).toBe('verifie');
  });
});

describe('rendus — texte et JSON', () => {
  it('renderReport montre les cinq étapes, les constats et le texte encadré', async () => {
    const report = await replaySample(sampleOf('fr-002'), { c1Detector: null });
    const text = renderReport(report);
    expect(text).toContain('Demande fr-002');
    expect(text).toContain('étape 5');
    expect(text).toContain('[C2]');
    expect(text).toContain('extrait');
    expect(text).toContain('<donnee-');
    expect(text).toContain('C3');
    expect(text).toContain('non analysé');
  });

  it('renderBenchText affiche le bilan et les points de recette', async () => {
    const { result, summary, recipes } = await fullBench();
    const text = renderBenchText({ result, summary, recipes, datasetLabel: 'jeu de test' });
    expect(text).toContain('Banc d’essai');
    expect(text).toContain('7 demande(s) sur 8 conforme(s)');
    expect(text).toContain('Recette §23');
    expect(text).toContain('jeu de test');
  });

  it('renderBenchJson est un JSON valide, exploitable par la machine', async () => {
    const { result, summary, recipes } = await fullBench();
    const parsed = JSON.parse(renderBenchJson({ result, summary, recipes, datasetLabel: 'jeu de test' })) as {
      ok: boolean;
      played: number;
      total: number;
      conforming: number;
      reports: { sampleId: string; steps: unknown[]; framedText: string }[];
      comparisons: { verdict: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.played).toBe(8);
    expect(parsed.total).toBe(8);
    expect(parsed.conforming).toBe(7);
    expect(parsed.reports).toHaveLength(8);
    expect(parsed.reports[0]?.steps).toHaveLength(5);
    expect(parsed.reports[0]?.framedText).toContain('donnee-');
    expect(parsed.comparisons.every((item) => ['conforme', 'divergence'].includes(item.verdict))).toBe(true);
  });
});
