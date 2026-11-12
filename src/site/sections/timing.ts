/**
 * Section « Mesures de terrain » — la fenêtre d'exposition instrumentée
 * (#84, #85, §18 et §21 du cahier).
 *
 * Une demande du jeu d'essai est rejouée **dans le navigateur** par le banc
 * (`src/replay/engine.ts`) et ses durées sont relevées par le domaine pur
 * (`src/core/timing.ts`) : origine, C1, C2, mode appliqué — la fenêtre
 * d'exposition — puis le verdict C3, qui n'est pas joué hors ligne.
 *
 * Honnêteté (§21) : aucune durée n'est inventée. Ce que le rejeu local ne
 * peut pas séparer est présenté comme une **borne** ; ce que seul le site
 * déployé peut mesurer (file C3 réelle, `get-request-safe`, débit sur
 * 5 000 tickets) reste « à mesurer sur site », comme dans `docs/MESURES.md`.
 */

import {
  emptyTrace,
  formatMs,
  markStage,
  type TimingStage,
  type TimingTrace,
} from '../../core/timing';
import { replaySample, type ReplayReport } from '../../replay/engine';
import { byLanguage, loadDataset, type SampleRequestEntry } from '../../sample/dataset';
import {
  badge,
  buttonHtml,
  byId,
  field,
  grid,
  heading,
  kv,
  note,
  panel,
  selectHtml,
  table,
} from '../dom';
import type { Section, SectionContext } from './types';

/** Budgets de rapidité du §21 — origine + C1 + C2, et `get-request-safe`. */
export const LEXICAL_BUDGET_MS = 2_000;
export const SAFE_TOOL_BUDGET_MS = 2_000;

/** Textes propres à la section (les catalogues du produit ne sont pas modifiés). */
const LABELS = {
  sample: { fr: 'Demande du jeu d’essai', en: 'Sample request' },
  measure: { fr: 'Mesurer sur une demande du jeu', en: 'Measure a sample request' },
  replayed: { fr: 'Demande rejouée', en: 'Replayed request' },
  state: { fr: 'Suspicion · mode', en: 'Suspicion · mode' },
  stepsTitle: { fr: 'Les cinq étapes du §18, rejouées localement', en: 'The five §18 steps, replayed locally' },
  step: { fr: 'Étape', en: 'Step' },
  outputs: { fr: 'Productions', en: 'Outputs' },
  duration: { fr: 'Durée', en: 'Duration' },
  notPlayed: { fr: 'non jouée', en: 'not played' },
  boundNote: {
    fr: 'Durées relevées dans votre navigateur sur un rejeu hors ligne : une seule '
      + 'borne couvre les étapes 1, 2, 4 et 5 (elles ne sont pas séparables ici, '
      + 'docs/MESURES.md §3). L’étape 3 (C3) n’est pas jouée : aucun modèle n’est '
      + 'appelé dans la page.',
    en: 'Durations measured in your browser over an offline replay: a single bound '
      + 'covers steps 1, 2, 4 and 5 (they are not separable here, docs/MESURES.md §3). '
      + 'Step 3 (C3) is not played: no model is called in the page.',
  },
  intro: {
    fr: 'Cette section rejoue une demande du jeu d’essai dans votre navigateur et '
      + 'mesure la fenêtre d’exposition : le temps pendant lequel un texte entré '
      + 'de l’extérieur reste visible avant l’application du mode (§18).',
    en: 'This section replays a sample request in your browser and measures the '
      + 'exposure window: how long externally supplied text stays visible before '
      + 'the mode is applied (§18).',
  },
} as const;

type LabelKey = keyof typeof LABELS;

function label(ctx: SectionContext, key: LabelKey): string {
  return LABELS[key][ctx.lang];
}

/** Horloge injectable : la section mesure, le domaine ne lit jamais l’heure. */
export type Clock = () => number;

/** Horloge du navigateur (ou du banc de test) : `performance.now`. */
export function perfClock(): Clock {
  return () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : 0;
}

/** Ce qu'une mesure locale produit : la trace, le rapport du banc, la durée. */
export interface SampleMeasure {
  trace: TimingTrace;
  report: ReplayReport;
  elapsedMs: number;
}

/** Étapes bornées par la fin du rejeu : jamais datées séparément hors ligne. */
const BOUNDED_STAGES: readonly TimingStage[] = ['origin', 'c1', 'c2', 'mode-applied'];

/**
 * Rejoue une demande et relève ses durées. `created` est marqué au départ,
 * les étapes 1 à 4 à l'arrivée (borne haute honnête) ; `c3` n'est jamais
 * marqué hors ligne — son intervalle reste `null`, donc « à mesurer ».
 */
export async function measureSample(
  sample: SampleRequestEntry,
  clock: Clock,
  ctx: SectionContext,
): Promise<SampleMeasure> {
  const issueKey = `BANC-${sample.id.toUpperCase()}`;
  const start = clock();
  let trace = markStage(emptyTrace(issueKey), 'created', start);
  const report = await replaySample(sample, { now: ctx.now, store: ctx.store });
  const end = clock();
  for (const stage of BOUNDED_STAGES) trace = markStage(trace, stage, end);
  return { trace, report, elapsedMs: Math.max(0, end - start) };
}

/** Première demande du jeu dans la langue de la page (sinon du jeu entier). */
export function firstSample(lang: SectionContext['lang']): SampleRequestEntry {
  const samples = byLanguage(lang);
  return (samples.length > 0 ? samples[0] : loadDataset()[0])!;
}

/** Tableau des cinq étapes du §18 avec leurs productions et leurs durées. */
export function stepsTable(m: SampleMeasure, ctx: SectionContext): string {
  const bound = `≤ ${formatMs(m.elapsedMs)}`;
  const rows = m.report.steps.map((step) => [
    `${step.step} — ${step.title}`,
    String(step.outputs.length),
    step.code === 'step-c3' ? label(ctx, 'notPlayed') : bound,
  ]);
  return (
    heading(label(ctx, 'stepsTitle'))
    + table([label(ctx, 'step'), label(ctx, 'outputs'), label(ctx, 'duration')], rows)
    + note(label(ctx, 'boundNote'))
  );
}

/** En-tête du résultat : la demande rejouée et sa fenêtre d'exposition. */
export function measureHead(m: SampleMeasure, ctx: SectionContext): string {
  return kv([
    [label(ctx, 'replayed'), m.trace.issueKey],
    [label(ctx, 'state'), `${m.report.suspicion} · ${m.report.modeDecision.mode}`],
  ])
    + badge(`${formatMs(m.elapsedMs)}`, 'review');
}

/** Options du sélecteur : le jeu d'essai de la langue de la page. */
function sampleOptions(ctx: SectionContext): [string, string][] {
  const samples = byLanguage(ctx.lang);
  const entries = samples.length > 0 ? samples : loadDataset();
  return entries.map((entry) => [entry.id, `${entry.id} · famille ${entry.family}`]);
}

/** Colonne de gauche : choix de la demande et bouton de mesure. */
function controls(ctx: SectionContext): string {
  const options = sampleOptions(ctx);
  return panel(
    field(label(ctx, 'sample'), selectHtml('t-sample', options, options[0]?.[0]))
    + buttonHtml('t-measure', label(ctx, 'measure'))
    + note(label(ctx, 'intro')),
  );
}

/** Tout le résultat d'une mesure locale. */
export function results(m: SampleMeasure, ctx: SectionContext): string {
  return measureHead(m, ctx) + stepsTable(m, ctx);
}

/** Câblage : le bouton rejoue la demande choisie et rafraîchit le résultat. */
function wire(root: HTMLElement, ctx: SectionContext): void {
  const select = byId<HTMLSelectElement>(root, 't-sample');
  const target = byId<HTMLDivElement>(root, 't-result');
  byId<HTMLButtonElement>(root, 't-measure')?.addEventListener('click', () => {
    const sample =
      byLanguage(ctx.lang).find((entry) => entry.id === select?.value) ?? firstSample(ctx.lang);
    void measureSample(sample, perfClock(), ctx).then((m) => {
      if (target) target.innerHTML = results(m, ctx);
    });
  });
}

export const timingSection: Section = {
  id: 'timing',
  titles: { fr: 'Mesures de terrain', en: 'Field measures' },
  async render(ctx) {
    const m = await measureSample(firstSample(ctx.lang), perfClock(), ctx);
    return panel(grid(controls(ctx), panel(results(m, ctx), 't-result')));
  },
  mount: wire,
};
