/**
 * Section « Banc de détection » — le banc hors ligne (#15, #16, #17, #95)
 * rejoué dans le navigateur.
 *
 * Aucune logique métier n'est recopiée : la section appelle les modules du
 * domaine (`src/bench/corpus.ts`, `detector.ts`, `metrics.ts`, `fuzz.ts`,
 * `shadow.ts`) sur le corpus étiqueté chargé par l'adaptateur local
 * `bench-corpus.ts`. Le banc reste rapide dans la page : le nombre d'entrées
 * jouées est borné (`PLAYED_CAP`) et le temps mesuré est affiché.
 */

import { corpusStats, type CorpusEntry } from '../../bench/corpus';
import { createDetector, detectEntry } from '../../bench/detector';
import { measureRobustness, mutateEntry, type MutationId, type MutationOptions, type RobustnessReport } from '../../bench/fuzz';
import { measureCorpus, type CorpusMetrics } from '../../bench/metrics';
import { createRecordingPort, runShadow, type ShadowReport } from '../../bench/shadow';
import { byId, buttonHtml, field, grid, heading, note, panel, selectHtml, valueOf } from '../dom';
import { familyKeys, filterEntries, fullCorpus, humanReference, PLAYED_CAP, playedEntries } from './bench-corpus';
import {
  corpusOptions,
  entryView,
  filterOptions,
  fuzzView,
  gapsView,
  headerView,
  metricsView,
  shadowView,
  type BrokenExample,
} from './bench-views';
import type { Section, SectionContext } from './types';

/** Graine et plafond du fuzzing dans la page : déterministe et rapide. */
const FUZZ_SEED = 1;
const FUZZ_MAX_PER_ENTRY = 3;

/** Textes visibles de la section, dans les deux langues (règle 9 du brief). */
const TEXTS = {
  run: { fr: 'Rejouer le banc', en: 'Replay the bench' },
  empty: { fr: 'Lancez le banc pour afficher les résultats.', en: 'Run the bench to display the results.' },
  hint: {
    fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, rien ne quitte la page.',
    en: 'Everything runs in your browser: no network call, nothing leaves this page.',
  },
  language: { fr: 'Langue', en: 'Language' },
  family: { fr: 'Famille de charges', en: 'Attack family' },
  entry: { fr: 'Entrée du corpus', en: 'Corpus entry' },
  allLangs: { fr: 'Toutes les langues', en: 'All languages' },
  allFamilies: { fr: 'Toutes les familles', en: 'All families' },
  detail: { fr: 'Corpus — entrée sélectionnée', en: 'Corpus — selected entry' },
  results: { fr: 'Résultats du banc', en: 'Bench results' },
} as const;

function text(ctx: SectionContext, key: keyof typeof TEXTS): string {
  return TEXTS[key][ctx.lang];
}

/** Ce que produit un rejeu du banc dans la page. */
export interface BenchRun {
  readonly played: number;
  readonly metrics: CorpusMetrics;
  readonly robustness: RobustnessReport;
  readonly examples: readonly BrokenExample[];
  readonly shadow: ShadowReport;
}

/** Premier exemple avant/après par mutation, parmi les mutants qui cassent. */
export function brokenExamples(
  entries: readonly CorpusEntry[],
  report: RobustnessReport,
  options: MutationOptions,
): BrokenExample[] {
  const byEntryId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<MutationId>();
  const examples: BrokenExample[] = [];
  for (const outcome of report.outcomes) {
    if (!outcome.broken || seen.has(outcome.mutation)) continue;
    const entry = byEntryId.get(outcome.entryId);
    const mutant = entry ? mutateEntry(entry, options).find((item) => item.id === outcome.mutantId) : undefined;
    if (!entry || !mutant) continue;
    seen.add(outcome.mutation);
    examples.push({ mutation: outcome.mutation, entryId: entry.id, before: entry.text, after: mutant.segments });
  }
  return examples;
}

/**
 * Rejeu pur et déterministe : le détecteur du domaine (C1, C2, décodage,
 * pression) sur les entrées choisies. Exposé pour les tests, sans DOM.
 */
export function playBench(entries: readonly CorpusEntry[]): BenchRun {
  const detect = createDetector();
  const fuzzOptions: MutationOptions = { seed: FUZZ_SEED, maxPerEntry: FUZZ_MAX_PER_ENTRY };
  const robustness = measureRobustness(entries, detect, fuzzOptions);
  const shadow = runShadow(entries, detect, humanReference(entries), createRecordingPort());
  return {
    played: entries.length,
    metrics: measureCorpus(entries, detect),
    robustness,
    examples: brokenExamples(entries, robustness, fuzzOptions),
    shadow,
  };
}

/** Remplit une liste déroulante sans HTML brut (`textContent` : jamais injecté). */
function fillSelect(select: HTMLSelectElement, options: [string, string][], selected?: string): void {
  select.replaceChildren();
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  }
}

/** Filtre courant lu dans le formulaire (`'all'` par défaut). */
function currentFilter(root: HTMLElement): { lang: string; family: string } {
  return { lang: valueOf(root, 'b-lang') || 'all', family: valueOf(root, 'b-family') || 'all' };
}

/** Fiche de l'entrée choisie : texte brut + signaux du détecteur du banc. */
function showEntry(root: HTMLElement, ctx: SectionContext): void {
  const target = byId<HTMLDivElement>(root, 'b-entry-view');
  if (!target) return;
  const { lang, family } = currentFilter(root);
  const id = valueOf(root, 'b-entry');
  const entry = filterEntries(lang, family).find((item) => item.id === id);
  target.innerHTML = entry ? entryView(entry, detectEntry(entry), ctx.lang) : note(text(ctx, 'empty'));
}

/** Reconstruit la liste des entrées après un changement de filtre. */
function refreshEntries(root: HTMLElement, ctx: SectionContext): void {
  const select = byId<HTMLSelectElement>(root, 'b-entry');
  if (!select) return;
  const { lang, family } = currentFilter(root);
  const entries = filterEntries(lang, family);
  const keep = entries.some((item) => item.id === select.value) ? select.value : entries[0]?.id;
  fillSelect(select, corpusOptions(entries), keep);
  showEntry(root, ctx);
}

/** Joue le banc (entrées bornées) et affiche en-tête, écarts et métriques. */
function run(root: HTMLElement, ctx: SectionContext): void {
  const target = byId<HTMLDivElement>(root, 'b-result');
  if (!target) return;
  const { lang, family } = currentFilter(root);
  const started = performance.now();
  const outcome = playBench(playedEntries(lang, family));
  const elapsed = performance.now() - started;
  target.innerHTML =
    headerView(corpusStats(fullCorpus()), outcome.played, PLAYED_CAP, elapsed, ctx.lang) +
    gapsView(ctx.lang) +
    metricsView(outcome.metrics, ctx.lang) +
    fuzzView(outcome.robustness, outcome.examples, ctx.lang) +
    shadowView(outcome.shadow, ctx.lang);
}

/** Formulaire : filtres du corpus, entrée navigable, bouton de rejeu. */
function form(ctx: SectionContext): string {
  return panel(
    field(text(ctx, 'language'), selectHtml('b-lang', filterOptions(text(ctx, 'allLangs'), ['fr', 'en']), 'all')) +
      field(text(ctx, 'family'), selectHtml('b-family', filterOptions(text(ctx, 'allFamilies'), familyKeys()), 'all')) +
      field(text(ctx, 'entry'), selectHtml('b-entry', corpusOptions(fullCorpus()))) +
      buttonHtml('b-run', text(ctx, 'run')) +
      note(text(ctx, 'hint')),
  );
}

export const benchSection: Section = {
  id: 'bench',
  titles: { fr: 'Banc de détection', en: 'Detection bench' },
  render(ctx) {
    const right =
      heading(text(ctx, 'detail')) +
      panel(note(text(ctx, 'empty')), 'b-entry-view') +
      heading(text(ctx, 'results')) +
      panel(note(text(ctx, 'empty')), 'b-result');
    return grid(form(ctx), right);
  },
  mount(root, ctx) {
    byId<HTMLSelectElement>(root, 'b-lang')?.addEventListener('change', () => refreshEntries(root, ctx));
    byId<HTMLSelectElement>(root, 'b-family')?.addEventListener('change', () => refreshEntries(root, ctx));
    byId<HTMLSelectElement>(root, 'b-entry')?.addEventListener('change', () => showEntry(root, ctx));
    byId<HTMLButtonElement>(root, 'b-run')?.addEventListener('click', () => run(root, ctx));
    refreshEntries(root, ctx);
    run(root, ctx);
  },
};
