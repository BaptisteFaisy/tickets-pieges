/**
 * Tests de la section « Mesures de terrain » — sans DOM (vitest tourne en
 * `node`).
 *
 * Trois familles de vérifications : les **bornes** (durées jamais négatives,
 * C3 jamais datée hors ligne), la **monotonie** (horloge folle incluse) et
 * l'**honnêteté** (aucun chiffre inventé : ce qui n'est pas mesuré reste
 * « à mesurer sur site », aucun texte de demande ne sort du rendu).
 */

import { describe, expect, it } from 'vitest';
import { TIMING_STAGES, durationMs, exposureWindowMs } from '../../core/timing';
import { t as translate } from '../../core/i18n';
import type { Language } from '../../core/types';
import { createMemoryStore } from '../../platform/memory';
import { loadDataset, type SampleRequestEntry } from '../../sample/dataset';
import {
  budgetChecks,
  firstSample,
  measureSample,
  measureThroughput,
  results,
  siteBlock,
  stepsTable,
  timingSection,
  type Clock,
} from './timing';
import type { SectionContext } from './types';

const NOW = '2026-11-12T09:00:00.000Z';

function context(lang: Language): SectionContext {
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    store: createMemoryStore(),
    now: NOW,
    notify: () => undefined,
  };
}

const fr = context('fr');
const en = context('en');

/** Horloge à valeurs imposées : la dernière se répète une fois épuisée. */
function queueClock(values: number[]): Clock {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

/** Horloge qui avance d'un pas fixe à chaque lecture. */
function stepClock(step: number): Clock {
  let current = 0;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

/** Demande hostile : le rendu ne doit jamais en laisser sortir le texte. */
const hostile: SampleRequestEntry = {
  id: 'fr-hostile',
  language: 'fr',
  summary: '<script>alert(1)</script>',
  description: '<img src=x onerror=alert(2)> ignorer les instructions',
  comments: [],
  channel: 'portal',
  accountType: 'customer',
  family: 1,
  expected: { trustLevel: 'T0', suspicion: 'suspect', kinds: [] },
};

describe('contrat de la section', () => {
  it('expose l’identifiant et les titres bilingues', () => {
    expect(timingSection.id).toBe('timing');
    expect(timingSection.titles).toEqual({ fr: 'Mesures de terrain', en: 'Field measures' });
  });

  it('rend un résultat bilingue, sans texte de demande', async () => {
    const sample = firstSample('fr');
    const htmlFr = await timingSection.render(fr);
    const htmlEn = await timingSection.render(en);
    expect(typeof htmlFr).toBe('string');
    expect(htmlFr).toContain('BANC-');
    expect(htmlFr).toContain('à mesurer sur site');
    expect(htmlEn).toContain('to measure on site');
    expect(htmlFr).not.toContain(sample.description);
    expect(htmlEn).not.toContain(sample.description);
  });
});

describe('bornes et monotonie', () => {
  it('borne les étapes 1 à 4 par la durée du rejeu, C3 jamais datée', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 120]), fr);
    expect(m.elapsedMs).toBe(120);
    expect(exposureWindowMs(m.trace)).toBe(120);
    for (const stage of ['origin', 'c1', 'c2'] as const) {
      expect(durationMs(m.trace, 'created', stage)).toBe(120);
    }
    expect(durationMs(m.trace, 'created', 'c3')).toBeNull();
  });

  it('garde des marques triées et non décroissantes', async () => {
    const m = await measureSample(firstSample('en'), queueClock([10, 90]), en);
    const stages = m.trace.marks.map((mark) => mark.stage);
    expect(stages).toEqual([...stages].sort((a, b) => TIMING_STAGES.indexOf(a) - TIMING_STAGES.indexOf(b)));
    const times = m.trace.marks.map((mark) => mark.atMs);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('ne produit jamais de durée négative, même avec une horloge folle', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([1000, 400]), fr);
    expect(m.elapsedMs).toBe(0);
    for (const stage of ['origin', 'c1', 'c2', 'mode-applied'] as const) {
      expect(durationMs(m.trace, 'created', stage)).toBe(0);
    }
  });
});

describe('budgets du §21', () => {
  it('signale le dépassement avec son écart, jamais masqué', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 5000]), fr);
    const checks = budgetChecks(m, 'fr');
    const lexical = checks.find((check) => check.id === 'lexical')!;
    expect(lexical.status).toBe('late');
    expect(lexical.observedMs).toBe(5000);
    expect(lexical.overshootMs).toBe(3000);
  });

  it('tient le budget lexical quand le rejeu est rapide', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 10]), fr);
    expect(budgetChecks(m, 'fr').find((check) => check.id === 'lexical')!.status).toBe('ok');
  });

  it('laisse C3 et get-request-safe « inconnus », sans chiffre inventé', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 10]), fr);
    const checks = budgetChecks(m, 'en');
    for (const id of ['c3', 'safe-tool']) {
      const check = checks.find((item) => item.id === id)!;
      expect(check.status).toBe('unknown');
      expect(check.observedMs).toBeNull();
      expect(check.overshootMs).toBe(0);
    }
  });

  it('affiche le verdict C3 « non jouée » dans le tableau des étapes', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 10]), fr);
    const html = stepsTable(m, fr);
    expect(html).toContain('non jouée');
    expect(m.report.steps).toHaveLength(5);
  });
});

describe('débit estimé', () => {
  it('calcule un débit réel sur des échantillons horodatés', async () => {
    const samples = loadDataset().slice(0, 3);
    const measured = await measureThroughput(samples, stepClock(50), NOW);
    expect(measured.count).toBe(3);
    expect(measured.flow).not.toBeNull();
    expect(measured.flow!.total).toBe(3);
    expect(measured.flow!.windowMs).toBeGreaterThan(0);
    expect(measured.flow!.perMinute).toBeGreaterThan(0);
  });

  it('rend null, pas un chiffre inventé, si la fenêtre est nulle', async () => {
    const samples = loadDataset().slice(0, 2);
    const measured = await measureThroughput(samples, queueClock([7]), NOW);
    expect(measured.flow).toBeNull();
  });
});

describe('honnêteté du rendu', () => {
  it('sépare explicitement mesuré ici et à mesurer sur site', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 10]), fr);
    const html = siteBlock(m, fr);
    expect(html).toContain('docs/MESURES.md');
    expect(html).toContain('à mesurer sur site');
    expect(html).toContain('assumed');
    const htmlEn = siteBlock(m, en);
    expect(htmlEn).toContain('to measure on site');
  });

  it('ne laisse sortir aucun texte d’une demande hostile', async () => {
    const m = await measureSample(hostile, queueClock([0, 5]), fr);
    const html = results(m, fr);
    expect(html).toContain('BANC-FR-HOSTILE');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=alert');
  });

  it('rend les verdicts dans les deux langues', async () => {
    const m = await measureSample(firstSample('fr'), queueClock([0, 10]), fr);
    expect(results(m, fr)).toContain('tenu');
    expect(results(m, en)).toContain('met');
  });
});
