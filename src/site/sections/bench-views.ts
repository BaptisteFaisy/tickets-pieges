/**
 * Vues pures de la section « Banc de détection ».
 *
 * HTML échappé produit avec les briques de `src/site/dom.ts`, sans DOM ni
 * logique métier : le calcul reste dans `src/bench/*`, ces fonctions ne font
 * que mettre en forme ses résultats. Elles sont testables sans navigateur.
 */

import type { CorpusEntry, CorpusStats } from '../../bench/corpus';
import { benchGapLines } from '../../bench/detector';
import { noisiestRules, type Confusion, type CorpusMetrics } from '../../bench/metrics';
import type { Language, LayerHit } from '../../core/types';
import { badge, details, heading, kv, list, note, pre, table } from '../dom';

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

/** Pourcentage honnête : un ratio `null` (sans dénominateur) est dit, pas inventé. */
export function pct(value: number | null, lang: Language): string {
  if (value === null) return lang === 'fr' ? 'non mesuré' : 'not measured';
  return `${(value * 100).toFixed(1)} %`;
}

/** En-tête du résultat : corpus, entrées jouées (plafond) et temps mesuré. */
export function headerView(
  stats: CorpusStats,
  played: number,
  cap: number,
  elapsedMs: number,
  lang: Language,
): string {
  const fr = lang === 'fr';
  return kv([
    [fr ? 'Corpus' : 'Corpus', `${stats.total} — ${stats.attacks} ${fr ? 'charges' : 'attacks'} · ${stats.legitimate} ${fr ? 'légitimes' : 'legitimate'}`],
    [fr ? 'Entrées jouées' : 'Played entries', `${played} / ${fr ? 'plafond' : 'cap'} ${cap}`],
    [fr ? 'Temps mesuré' : 'Measured time', `${elapsedMs.toFixed(1)} ms`],
  ]);
}

/** Ce que le banc joue et ne joue pas — lignes du domaine, citées telles quelles. */
export function gapsView(lang: Language): string {
  return details(
    lang === 'fr' ? 'Blocs joués et non joués (§21)' : 'Played and not played blocks (§21)',
    pre(benchGapLines().join('\n')),
  );
}

/** Ligne de la matrice de confusion, au niveau de l'entrée. */
export function confusionLine(confusion: Confusion): string {
  return `TP ${confusion.truePositives} · FN ${confusion.falseNegatives} · FP ${confusion.falsePositives} · TN ${confusion.trueNegatives}`;
}

/** Tableau des scores par règle : TP, FP, attendu, couvert, rappel, précision, F1. */
export function rulesTable(metrics: CorpusMetrics, lang: Language): string {
  const head = lang === 'fr'
    ? ['Règle', 'TP', 'FP', 'Attendu', 'Couvert', 'Rappel', 'Précision', 'F1']
    : ['Rule', 'TP', 'FP', 'Expected', 'Satisfied', 'Recall', 'Precision', 'F1'];
  const rows = metrics.byRule.map((rule) => [
    rule.ruleId,
    String(rule.truePositives),
    String(rule.falsePositives),
    String(rule.expected),
    String(rule.satisfied),
    pct(rule.recall, lang),
    pct(rule.precision, lang),
    pct(rule.f1, lang),
  ]);
  return table(head, rows);
}

/** Règles les plus bruitées (pire précision avec faux positifs) — jamais un verdict. */
export function noisiestBlock(metrics: CorpusMetrics, lang: Language): string {
  const noisy = noisiestRules(metrics, 5);
  if (noisy.length === 0) {
    return note(lang === 'fr'
      ? 'Aucune règle bruitée sur ce filtre : pas de faux positif par règle.'
      : 'No noisy rule on this filter: no per-rule false positive.');
  }
  const head = lang === 'fr' ? ['Règle', 'Précision', 'FP', 'TP'] : ['Rule', 'Precision', 'FP', 'TP'];
  return table(head, noisy.map((rule) => [
    rule.ruleId,
    pct(rule.precision, lang),
    String(rule.falsePositives),
    String(rule.truePositives),
  ]));
}

/** Ce que le banc avoue : charges manquées, légitimes relevés, règles jamais vues. */
export function honestyList(metrics: CorpusMetrics, lang: Language): string {
  const fr = lang === 'fr';
  const or = (items: readonly string[], none: string): string => (items.length > 0 ? items.join(', ') : none);
  return list([
    `${fr ? 'Charges manquées' : 'Missed attacks'} (${metrics.missedAttacks.length}) : ${or(metrics.missedAttacks, fr ? 'aucune' : 'none')}`,
    `${fr ? 'Textes légitimes relevés à tort' : 'Legitimate texts wrongly flagged'} (${metrics.falsePositiveIds.length}) : ${or(metrics.falsePositiveIds, fr ? 'aucun' : 'none')}`,
    `${fr ? 'Règles attendues jamais vues' : 'Expected rules never fired'} : ${or(metrics.neverFiredRules, fr ? 'aucune' : 'none')}`,
  ]);
}

/** Bloc métriques : synthèse, matrice, règles les plus bruyantes, tableau par règle. */
export function metricsView(metrics: CorpusMetrics, lang: Language): string {
  const fr = lang === 'fr';
  const overall = kv([
    [fr ? 'Rappel charges' : 'Attack recall', pct(metrics.recall, lang)],
    [fr ? 'Précision' : 'Precision', pct(metrics.precision, lang)],
    ['F1', pct(metrics.f1, lang)],
    [fr ? 'Taux de faux positifs' : 'False positive rate', pct(metrics.falsePositiveRate, lang)],
    [fr ? 'Matrice' : 'Confusion', confusionLine(metrics.confusion)],
  ]);
  return heading(fr ? 'Métriques par règle' : 'Metrics by rule') +
    overall +
    heading(fr ? 'Règles les plus bruyantes' : 'Noisiest rules') +
    noisiestBlock(metrics, lang) +
    rulesTable(metrics, lang) +
    details(fr ? 'Honnêteté : manques et trous (§21)' : 'Honesty: misses and gaps (§21)', honestyList(metrics, lang));
}
