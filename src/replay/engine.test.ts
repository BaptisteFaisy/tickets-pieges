/**
 * Tests du moteur du banc (TP-18) — chaîne complète, hors ligne, horloge fixe.
 *
 * Le banc ne doit jamais sortir de la machine : ces tests vérifient la chaîne
 * des cinq étapes du §18 sur le jeu local, l'honnêteté sur les couches non
 * jouées (C1 non fusionné, C3 sans modèle), l'encadrement à identifiant propre
 * et l'écriture dans le `Store` en mémoire.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayerHit, ProjectSettings, SampleRequest } from '../core/types';
import { createMemoryStore } from '../platform/memory';
import { BENCH_NOW, benchSettings, LOCAL_SAMPLES } from './fixtures';
import { replayBench, replaySample, toSegments, type ReplayReport } from './engine';

function sampleOf(id: string): SampleRequest {
  const sample = LOCAL_SAMPLES.find((item) => item.id === id);
  if (!sample) throw new Error(`échantillon inconnu : ${id}`);
  return sample;
}

async function replayOf(id: string, options: Parameters<typeof replaySample>[1] = {}): Promise<ReplayReport> {
  return replaySample(sampleOf(id), { c1Detector: null, ...options });
}

/** Faux détecteur C1 : un coup `invisible-chars` quelle que soit l'entrée. */
function fakeC1(): (text: string) => LayerHit[] {
  return () => [{
    layer: 'C1',
    kind: 'invisible-chars',
    ruleId: 'C1-01',
    startPos: 0,
    endPos: 1,
    excerpt: 'caractère invisible',
    askSummary: 'passage dissimulé',
    confidence: 0.9,
  }];
}

describe('moteur du banc — chaîne complète sur trois demandes', () => {
  it('une demande saine du portail est T1 et ne lève aucun constat', async () => {
    const report = await replayOf('fr-001');
    expect(report.trustLevel).toBe('T1');
    expect(report.suspicion).toBe('clean');
    expect(report.findings).toHaveLength(0);
    expect(report.kinds).toEqual([]);
    expect(report.modeDecision.mode).toBe('report');
    expect(report.modeDecision.silent).toBe(true);
  });

  it('une injection anonyme est T0, suspect, et déclenche la neutralisation', async () => {
    const report = await replayOf('fr-002');
    expect(report.trustLevel).toBe('T0');
    expect(report.suspicion).toBe('suspect');
    expect(report.kinds).toEqual(
      expect.arrayContaining(['assistant-addressing', 'tool-command', 'fake-system-marker']),
    );
    expect(report.modeDecision.mode).toBe('neutralize');
    expect(report.modeDecision.neutralize).toBe(true);
    const c2 = report.findings.filter((finding) => finding.layer === 'C2');
    expect(c2.length).toBeGreaterThan(0);
    for (const finding of c2) {
      expect(finding.excerpt.length).toBeGreaterThan(0);
      expect(finding.askSummary.trim().length).toBeGreaterThan(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('un agent interne est T3 ; sans constat, rien n’est neutralisé', async () => {
    const report = await replayOf('fr-006');
    expect(report.trustLevel).toBe('T3');
    expect(report.suspicion).toBe('clean');
    expect(report.modeDecision.neutralize).toBe(false);
    expect(report.findings).toHaveLength(0);
  });
});

describe('moteur du banc — honnêteté sur les couches (§21)', () => {
  it('C3 n’est jamais jouée hors ligne et le rapport le dit', async () => {
    const report = await replayOf('fr-001');
    const c3 = report.gaps.find((gap) => gap.layer === 'C3');
    expect(c3).toBeDefined();
    expect(c3?.code).toBe('c3-not-played');
    expect(report.unanalyzed).toContain('model-pending');
  });

  it('C1 absent : couche signalée non jouée, aucun coup inventé', async () => {
    const report = await replayOf('fr-001', { c1Detector: null });
    const c1 = report.gaps.find((gap) => gap.layer === 'C1');
    expect(c1?.code).toBe('c1-not-merged');
    expect(report.findings.filter((finding) => finding.layer === 'C1')).toHaveLength(0);
  });

  it('C1 présent : pas d’écart, et le constat invisible-chars rend fr-005 suspect', async () => {
    const report = await replayOf('fr-005', { c1Detector: fakeC1() });
    expect(report.gaps.find((gap) => gap.layer === 'C1')).toBeUndefined();
    expect(report.kinds).toContain('invisible-chars');
    expect(report.suspicion).toBe('suspect');
  });
});

describe('moteur du banc — encadrement et étapes (§8.2, §18)', () => {
  it('le texte encadré porte une balise par bloc et les avertissements', async () => {
    let counter = 0;
    const report = await replayOf('fr-001', { blockId: () => `aaaa0${counter += 1}` });
    expect(report.framed.blocks).toHaveLength(3);
    expect(report.framedText).toContain('<donnee-aaaa01');
    expect(report.framedText).toContain('</donnee-aaaa03>');
    expect(report.framedText).toContain('pas été analysé');
  });

  it('deux rejets successifs produisent des identifiants de blocs différents', async () => {
    const first = await replayOf('fr-001');
    const second = await replayOf('fr-001');
    const idsFirst = first.framed.blocks.map((block) => block.blockId);
    const idsSecond = second.framed.blocks.map((block) => block.blockId);
    expect(new Set(idsFirst).size).toBe(idsFirst.length);
    expect(idsFirst.join()).not.toBe(idsSecond.join());
  });

  it('les cinq étapes du §18 apparaissent dans l’ordre, avec leurs sorties', async () => {
    const report = await replayOf('fr-002');
    expect(report.steps.map((step) => step.step)).toEqual([1, 2, 3, 4, 5]);
    for (const step of report.steps) expect(step.outputs.length).toBeGreaterThan(0);
    expect(report.steps[0]?.outputs.join('\n')).toContain('T0');
  });
});

describe('moteur du banc — réglages, contexte et journalisation', () => {
  it('en mode « étiqueter », un encart est produit pour un ticket suspect', async () => {
    const settings: ProjectSettings = { ...benchSettings(), mode: 'label' };
    const report = await replayOf('fr-002', { settings });
    expect(report.modeDecision.mode).toBe('label');
    expect(report.modeDecision.banner).not.toBeNull();
    expect(report.modeDecision.banner ?? '').toContain('suspect');
  });

  it('le canal anonyme pèse sur le contexte (C4) sans jamais suffire seul', async () => {
    const report = await replayOf('fr-002');
    expect(report.contextScore).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.layer === 'C4' && finding.kind === 'anonymous-channel')).toBe(true);
    // C4 est une pondération : il ne monte pas au-dessus de « à vérifier » seul.
    const clean = await replayOf('fr-001');
    expect(clean.contextScore).toBeLessThan(0.5);
  });

  it('le rejeu s’écrit dans le Store en mémoire (segments, constats, état, journal)', async () => {
    const store = createMemoryStore();
    await replaySample(sampleOf('fr-002'), { store, c1Detector: null });
    const counts = store.counts();
    expect(counts.segments).toBe(3);
    expect(counts.findings).toBeGreaterThan(0);
    expect(counts.states).toBe(1);
    expect(counts.events).toBe(1);
    const state = await store.states.get('sample-fr-002');
    expect(state?.suspicionLevel).toBe('suspect');
    expect(state?.trustLevel).toBe('T0');
  });

  it('replayBench rejoue tout le jeu, sans lire l’heure', async () => {
    const result = await replayBench(LOCAL_SAMPLES, { c1Detector: null });
    expect(result.total).toBe(8);
    expect(result.played).toBe(8);
    expect(result.now).toBe(BENCH_NOW);
    expect(result.reports.every((report) => report.now === BENCH_NOW)).toBe(true);
  });

  it('toSegments découpe résumé, description et commentaires, positions stables', () => {
    const segments = toSegments(sampleOf('en-008'), BENCH_NOW);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.field)).toEqual(['summary', 'description', 'comment']);
    expect(segments[2]?.refId).toBe('comment-1');
    expect(segments[2]?.author.accountType).toBe('unknown');
  });
});

describe('contrat dur du banc', () => {
  it('aucune importation de la plateforme Forge dans src/replay', () => {
    const forbidden = /from\s+['"]@forge\//;
    for (const file of ['engine.ts', 'compare.ts', 'report.ts', 'fixtures.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(forbidden.test(source), file).toBe(false);
    }
  });
});
