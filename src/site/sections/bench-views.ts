/**
 * Vues pures de la section « Banc de détection ».
 *
 * HTML échappé produit avec les briques de `src/site/dom.ts`, sans DOM ni
 * logique métier : le calcul reste dans `src/bench/*`, ces fonctions ne font
 * que mettre en forme ses résultats. Elles sont testables sans navigateur.
 */

import type { CorpusEntry } from '../../bench/corpus';
import type { Language, LayerHit } from '../../core/types';
import { badge, note, pre, table } from '../dom';

/** Tronque un texte pour une option ou une cellule (jamais de HTML brut). */
export function snippet(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Options `[valeur, libellé]` de la liste d'entrées du corpus. */
export function corpusOptions(entries: readonly CorpusEntry[]): [string, string][] {
  return entries.map((entry) => [entry.id, `${entry.id} — ${snippet(entry.text, 44)}`]);
}

/** Options des listes langue/famille : « toutes » puis les valeurs du domaine. */
export function filterOptions(all: string, values: readonly string[]): [string, string][] {
  return [['all', all], ...values.map((value): [string, string] => [value, value])];
}

/** Tableau des signaux d'une entrée ; une note honnête s'il n'y en a aucun. */
export function hitsTable(hits: readonly LayerHit[], lang: Language): string {
  if (hits.length === 0) {
    return note(lang === 'fr' ? 'Aucun signal sur cette entrée.' : 'No signal on this entry.');
  }
  const head = lang === 'fr'
    ? ['Règle', 'Couche', 'Nature', 'Confiance', 'Extrait']
    : ['Rule', 'Layer', 'Kind', 'Confidence', 'Excerpt'];
  const rows = hits.map((hit) => [
    hit.ruleId,
    hit.layer,
    hit.kind,
    `${Math.round(hit.confidence * 100)} %`,
    snippet(hit.excerpt),
  ]);
  return table(head, rows);
}

/** Fiche d'une entrée du corpus : étiquette, famille, langue, texte, signaux. */
export function entryView(entry: CorpusEntry, hits: readonly LayerHit[], lang: Language): string {
  const badges = [
    badge(entry.label, entry.label === 'attack' ? 'bad' : 'ok'),
    badge(entry.family ?? 'none'),
    badge(entry.lang.toUpperCase()),
  ].join(' ');
  return `<div class="verdict">${badges}</div>${pre(entry.text)}${hitsTable(hits, lang)}`;
}
