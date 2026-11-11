/**
 * Rendu du banc d'essai (TP-18, §17.7) — texte français et JSON.
 *
 * Ce module ne fait que rendre : il ne calcule rien, n'imprime rien (la console
 * vit dans `tools/replay.mjs`) et ne lit aucune heure. Le rendu texte est celui
 * de la page « Banc d'essai » et de la recette §23 ; le rendu JSON est destiné à
 * la machine (`node tools/replay.mjs --json`).
 */

import { suspicionLabel, trustLabel, modeLabel, t } from '../core/i18n';
import type { Language } from '../core/types';
import type { BenchResult, ReplayReport } from './engine';
import type { CompareSummary, RecipeResult } from './compare';

/** Le banc, prêt à être rendu : résultats, comparaison, recette. */
export interface BenchView {
  result: BenchResult;
  summary: CompareSummary;
  recipes: RecipeResult[];
  datasetLabel: string;
}

/** Ligne d'en-tête d'une demande rejouée. */
function reportHeader(report: ReplayReport, language: Language): string {
  return [
    `Demande ${report.sampleId} (${report.issueKey}, langue ${report.language})`,
    `origine ${trustLabel(language, report.trustLevel)}`,
    `suspicion ${suspicionLabel(language, report.suspicion)}`,
    `mode ${modeLabel(language, report.modeDecision.mode)}`,
  ].join(' — ');
}

/** Une ligne par étape du §18, avec ce qu'elle a produit. */
function stepLines(report: ReplayReport): string[] {
  return report.steps.flatMap((step) => [
    `  étape ${step.step} · ${step.title}`,
    ...step.outputs.map((output) => `    · ${output}`),
  ]);
}

/** Constats par couche : extrait borné et résumé neutre, jamais la charge brute. */
function findingLines(report: ReplayReport, language: Language): string[] {
  if (report.findings.length === 0) {
    return [`  ${language === 'fr' ? 'aucun constat' : 'no finding'}`];
  }
  return report.findings.map((finding) =>
    `  [${finding.layer}] ${finding.kind} (${finding.ruleId}, confiance ${finding.confidence.toFixed(2)})` +
    ` — extrait « ${finding.excerpt} » — ${finding.askSummary}`);
}

/** Ce qui n'a pas été analysé, dit honnêtement (§21). */
function gapLines(report: ReplayReport, language: Language): string[] {
  const lines = report.gaps.map((gap) => `  couche ${gap.layer} non jouée : ${gap.reason}`);
  if (report.unanalyzed.length > 0) {
    const label = language === 'fr' ? 'non analysé' : 'not analyzed';
    lines.push(`  ${label} : ${report.unanalyzed.map((reason) => t(language, `framing.not-analyzed.${reason}`)).join(', ')}`);
  }
  return lines;
}

/** Texte encadré produit (§8.2) — ce que lirait un agent via `get-request-safe`. */
function framedLines(report: ReplayReport, language: Language): string[] {
  const title = language === 'fr' ? 'texte encadré produit' : 'framed text';
  return [`  ${title} :`, ...report.framedText.split('\n').map((line) => `    ${line}`)];
}

/** Rendu texte d'une demande : étapes, constats, mode, encadrement, manques. */
export function renderReport(report: ReplayReport, language: Language = 'fr'): string {
  return [
    reportHeader(report, language),
    ...stepLines(report),
    ...(language === 'fr' ? ['  constats :'] : ['  findings:']),
    ...findingLines(report, language),
    ...gapLines(report, language),
    ...framedLines(report, language),
  ].join('\n');
}

/** Verdicts de comparaison, demande par demande. */
function comparisonLines(summary: CompareSummary, language: Language): string[] {
  const lines = summary.comparisons.flatMap((item) => {
    const head = `  ${item.sampleId} : ${item.verdict}`;
    return item.detail.length > 0 ? [head, ...item.detail.map((detail) => `    · ${detail}`)] : [head];
  });
  return [language === 'fr' ? 'Comparaison à l’attendu :' : 'Comparison with expectations:', ...lines, `  ${summary.headline}`];
}

/** Lignes de recette §23 : un point par ligne, avec son statut. */
function recipeLines(recipes: RecipeResult[], language: Language): string[] {
  const marks: Record<RecipeResult['status'], string> = {
    'verifie': '✔ vérifié',
    'non-verifie': '✘ non vérifié',
    'non-couvert': '… non couvert',
  };
  const title = language === 'fr' ? 'Recette §23 (points couverts par le jeu) :' : 'Acceptance §23 (points covered by the set):';
  return [title, ...recipes.map((recipe) => `  ${recipe.point}. ${marks[recipe.status]} — ${recipe.line}`)];
}

/** Rendu texte du banc complet : ce que la console affiche. */
export function renderBenchText(view: BenchView, language: Language = 'fr'): string {
  const { result, summary, recipes, datasetLabel } = view;
  const title = language === 'fr'
    ? `Banc d’essai — ${result.played}/${result.total} demande(s) rejouée(s), hors ligne (${datasetLabel})`
    : `Test bench — ${result.played}/${result.total} request(s) replayed, offline (${datasetLabel})`;
  const sections = [
    title,
    ...result.reports.map((report) => renderReport(report, language)),
    comparisonLines(summary, language).join('\n'),
    recipeLines(recipes, language).join('\n'),
  ];
  return sections.join('\n\n');
}

/** Rendu JSON du banc complet : stable, exploitable par la machine. */
export function renderBenchJson(view: BenchView): string {
  const { result, summary, recipes, datasetLabel } = view;
  return JSON.stringify(
    {
      ok: true,
      dataset: result.dataset,
      datasetLabel,
      now: result.now,
      played: result.played,
      total: result.total,
      conforming: summary.conforming,
      diverging: summary.diverging,
      rate: summary.rate,
      headline: summary.headline,
      comparisons: summary.comparisons,
      recipes,
      reports: result.reports,
    },
    null,
    2,
  );
}
