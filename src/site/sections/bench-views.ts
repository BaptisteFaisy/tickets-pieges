/**
 * Vues pures de la section « Banc de détection ».
 *
 * HTML échappé produit avec les briques de `src/site/dom.ts`, sans DOM ni
 * logique métier : le calcul reste dans `src/bench/*`, ces fonctions ne font
 * que mettre en forme ses résultats. Elles sont testables sans navigateur.
 */

import type { CorpusEntry, CorpusStats } from '../../bench/corpus';
import { benchGapLines } from '../../bench/detector';
import type { MutationId, RobustnessReport } from '../../bench/fuzz';
import { noisiestRules, round, type Confusion, type CorpusMetrics } from '../../bench/metrics';
import type { DivergenceCode, ShadowReport } from '../../bench/shadow';
import type { Language, LayerHit } from '../../core/types';
import { badge, code, details, heading, kv, list, note, pre, table } from '../dom';

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

/** Mutant qui casse la détection, avec ses textes avant/après (modèle de vue). */
export interface BrokenExample {
  readonly mutation: MutationId;
  readonly entryId: string;
  readonly before: string;
  /** Segments du mutant : un seul, sauf pour `segment-split`. */
  readonly after: readonly string[];
}

/** Libellé bilingue des cinq mutations du brief (#16). */
export function mutationLabel(mutation: MutationId, lang: Language): string {
  const labels: Record<MutationId, [string, string]> = {
    'invisible-insert': ['Caractère invisible inséré', 'Invisible character inserted'],
    'word-split': ['Mot coupé en deux', 'Word split in two'],
    'synonym-swap': ['Mot-clé remplacé par un synonyme', 'Keyword replaced by a synonym'],
    'case-shift': ['Casse modifiée', 'Case shifted'],
    'segment-split': ['Texte découpé en segments', 'Text split into segments'],
  };
  const pair = labels[mutation];
  return lang === 'fr' ? pair[0] : pair[1];
}

/** Tableau des cinq mutations : mutants joués, cassures, robustesse. */
export function mutationsTable(report: RobustnessReport, lang: Language): string {
  const head = lang === 'fr'
    ? ['Mutation', 'Mutants', 'Cassures', 'Survivants', 'Robustesse']
    : ['Mutation', 'Mutants', 'Broken', 'Survived', 'Robustness'];
  const rows = report.byMutation.map((score) => [
    `${mutationLabel(score.mutation, lang)} (${score.mutation})`,
    String(score.total),
    String(score.broken),
    String(score.survived),
    pct(score.robustness, lang),
  ]);
  return table(head, rows);
}

/** Un exemple avant/après : texte d'origine, puis chaque segment muté. */
function exampleBlock(example: BrokenExample, lang: Language): string {
  const after = example.after.map((segment) => pre(segment)).join('');
  return `<div class="block">${badge(mutationLabel(example.mutation, lang), 'warn')} ${code(example.entryId)}` +
    `${pre(example.before)}${note(lang === 'fr' ? 'Après mutation :' : 'After mutation:')}${after}</div>`;
}

/** Bloc fuzzing : taux de cassure, tableau des mutations, exemples avant/après. */
export function fuzzView(report: RobustnessReport, examples: readonly BrokenExample[], lang: Language): string {
  const fr = lang === 'fr';
  const breakRate = report.robustness === null ? null : round(1 - report.robustness);
  const summary = kv([
    [fr ? 'Mutants mesurés' : 'Measured mutants', String(report.total)],
    [fr ? 'Mutants qui cassent la détection' : 'Mutants breaking the detection', String(report.broken)],
    [fr ? 'Taux de cassure' : 'Break rate', pct(breakRate, lang)],
    [fr ? 'Robustesse globale' : 'Overall robustness', pct(report.robustness, lang)],
  ]);
  const blocks = examples.length === 0
    ? note(fr ? 'Aucune cassure sur ce filtre : rien à montrer.' : 'No break on this filter: nothing to show.')
    : examples.map((example) => exampleBlock(example, lang)).join('');
  return heading(fr ? 'Fuzzing — les cinq mutations (#16)' : 'Fuzzing — the five mutations (#16)') +
    summary +
    mutationsTable(report, lang) +
    details(fr ? 'Exemples avant/après (une cassure par mutation)' : 'Before/after examples (one break per mutation)', blocks, true);
}

/** Libellé bilingue des codes de divergence du mode shadow (#17). */
export function divergenceLabel(code: DivergenceCode, lang: Language): string {
  const labels: Record<DivergenceCode, [string, string]> = {
    'machine-silent-human-trapped': ['Machine muette sur charge confirmée', 'Machine silent on confirmed attack'],
    'machine-acted-human-false-positive': ['Machine active sur faux positif', 'Machine acted on false positive'],
    'machine-acted-human-legitimate-risky': ['Machine active sur risque légitime', 'Machine acted on legitimate risk'],
    'human-pending': ['Sans verdict humain', 'No human verdict'],
    none: ['Accord machine / humain', 'Machine / human agreement'],
  };
  const pair = labels[code];
  return lang === 'fr' ? pair[0] : pair[1];
}

/** Tableau des divergences observées, codes à zéro exclus. */
function divergenceTable(report: ShadowReport, lang: Language): string {
  const codes = Object.keys(report.byDivergence).sort() as DivergenceCode[];
  const rows = codes
    .map((code): [DivergenceCode, number] => [code, report.byDivergence[code] ?? 0])
    .filter(([, count]) => count > 0)
    .map(([code, count]) => [divergenceLabel(code, lang), code, String(count)]);
  if (rows.length === 0) return note(lang === 'fr' ? 'Aucune divergence observée.' : 'No divergence observed.');
  const head = lang === 'fr' ? ['Divergence', 'Code', 'Entrées'] : ['Divergence', 'Code', 'Entries'];
  return table(head, rows);
}

/** Bloc shadow : taux d'accord, gestes proposés/appliqués, divergences, honnêteté. */
export function shadowView(report: ShadowReport, lang: Language): string {
  const fr = lang === 'fr';
  const summary = kv([
    [fr ? 'Entrées comparées' : 'Compared entries', `${report.compared} / ${report.total}`],
    [fr ? 'Taux d’accord machine / humain' : 'Machine / human agreement rate', pct(report.agreementRate, lang)],
    [fr ? 'Désaccords' : 'Disagreements', String(report.disagreements)],
    [fr ? 'Sans verdict humain' : 'Without human verdict', String(report.unknown)],
    [fr ? 'Gestes proposés' : 'Proposed actions', String(report.proposedActions)],
    [fr ? 'Gestes appliqués' : 'Applied actions', `${report.appliedActions} — ${fr ? 'le shadow n’écrit rien' : 'shadow writes nothing'}`],
  ]);
  const ids = list([
    `${fr ? 'Charges manquées par la machine' : 'Attacks missed by the machine'} (${report.missedIds.length}) : ${report.missedIds.join(', ') || (fr ? 'aucune' : 'none')}`,
    `${fr ? 'Faux positifs confirmés' : 'Confirmed false positives'} (${report.noisyIds.length}) : ${report.noisyIds.join(', ') || (fr ? 'aucun' : 'none')}`,
  ]);
  return heading(fr ? 'Mode shadow — comparaison machine / humain (#17)' : 'Shadow mode — machine / human comparison (#17)') +
    summary +
    divergenceTable(report, lang) +
    details(fr ? 'Divergences : entrées concernées' : 'Divergences: concerned entries', ids) +
    note(fr
      ? 'Référence humaine hors ligne : les étiquettes du corpus, pas de verdict humain réel.'
      : 'Offline human reference: corpus labels, no real human verdict.');
}
