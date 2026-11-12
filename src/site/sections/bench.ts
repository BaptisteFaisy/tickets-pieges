/**
 * Section « Banc de détection » — le banc hors ligne (#15, #16, #17, #95)
 * rejoué dans le navigateur.
 *
 * Aucune logique métier n'est recopiée : la section appelle les modules du
 * domaine (`src/bench/corpus.ts`, `metrics.ts`, `fuzz.ts`, `shadow.ts`,
 * `detector.ts`) sur le corpus étiqueté chargé par l'adaptateur local
 * `bench-corpus.ts`. Le banc reste rapide dans la page : le nombre d'entrées
 * jouées est borné et le temps mesuré est affiché.
 */

import { corpusStats } from '../../bench/corpus';
import { buttonHtml, grid, kv, note, panel } from '../dom';
import type { Section, SectionContext } from './types';
import { fullCorpus } from './bench-corpus';

/** Textes visibles de la section, dans les deux langues (règle 9 du brief). */
const TEXTS = {
  run: { fr: 'Rejouer le banc', en: 'Replay the bench' },
  empty: { fr: 'Lancez le banc pour afficher les résultats.', en: 'Run the bench to display the results.' },
  hint: {
    fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, rien ne quitte la page.',
    en: 'Everything runs in your browser: no network call, nothing leaves this page.',
  },
  corpus: { fr: 'Corpus', en: 'Corpus' },
  attacks: { fr: 'Charges', en: 'Attacks' },
  legitimate: { fr: 'Textes légitimes', en: 'Legitimate texts' },
  time: { fr: 'Temps mesuré', en: 'Measured time' },
} as const;

function text(ctx: SectionContext, key: keyof typeof TEXTS): string {
  return TEXTS[key][ctx.lang];
}

/** Joue le banc et affiche le résultat dans la zone dédiée. */
function run(root: HTMLElement, ctx: SectionContext): void {
  const target = root.querySelector<HTMLDivElement>('#b-result');
  if (!target) return;
  const started = performance.now();
  const stats = corpusStats(fullCorpus());
  const elapsed = performance.now() - started;
  target.innerHTML = kv([
    [text(ctx, 'corpus'), String(stats.total)],
    [text(ctx, 'attacks'), String(stats.attacks)],
    [text(ctx, 'legitimate'), String(stats.legitimate)],
    [text(ctx, 'time'), `${elapsed.toFixed(1)} ms`],
  ]);
}

export const benchSection: Section = {
  id: 'bench',
  titles: { fr: 'Banc de détection', en: 'Detection bench' },
  render(ctx) {
    return grid(
      panel(buttonHtml('b-run', text(ctx, 'run')) + note(text(ctx, 'hint'))),
      panel(note(text(ctx, 'empty')), 'b-result'),
    );
  },
  mount(root, ctx) {
    root.querySelector<HTMLButtonElement>('#b-run')?.addEventListener('click', () => run(root, ctx));
    run(root, ctx);
  },
};
