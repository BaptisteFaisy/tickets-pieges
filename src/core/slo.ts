/**
 * Budgets de service (SLO) — §21 du cahier, rendus vérifiables.
 *
 * Le cahier énonce trois exigences de rapidité (« origine et couches C1 et C2
 * en moins de 2 s ; couche C3 en moins de 30 s ; `get-request-safe` en moins
 * de 2 s »). Ici, elles deviennent des **budgets** : un seuil, une fenêtre
 * d'étapes, un verdict (tenu / dépassé, de combien) et une règle d'alerte.
 *
 * Domaine pur : aucun `@forge/*`, aucune E/S, aucune lecture d'horloge. Les
 * durées viennent de `src/core/timing.ts`, où l'instant est injecté — les
 * tests n'attendent donc jamais vraiment.
 *
 * Règle d'alerte (§21) : un budget dépassé n'est pas une faute du code, c'est
 * une information à remonter, avec le taux d'atteinte. Ce module ne lève
 * jamais d'erreur : il rend un verdict et le laisse remonter.
 */

import {
  C3_OBJECTIVE_MS,
  durationMs,
  EVENT_KINDS,
  formatMs,
  groupByEventKind,
  type EventKind,
  type TimingStage,
  type TimingTrace,
} from './timing';

/** Budget « origine + C1 + C2 » (§21 : « en moins de 2 s »). */
export const LEXICAL_BUDGET_MS = 2_000;

/** Budget « get-request-safe » (§21 : « en moins de 2 s »). */
export const SAFE_TOOL_BUDGET_MS = 2_000;

export type SloBudgetId = 'lexical' | 'c3' | 'safe-tool';

/** Un budget : un seuil, et la fenêtre d'étapes sur laquelle il se juge. */
export interface SloBudget {
  id: SloBudgetId;
  fr: string;
  en: string;
  /** Fenêtre mesurée : de la première étape à la dernière, dans l'ordre. */
  stages: readonly TimingStage[];
  budgetMs: number;
}

/** Les trois budgets du §21, dans l'ordre du cahier. */
export const SLO_BUDGETS: readonly SloBudget[] = [
  {
    id: 'lexical',
    fr: 'origine + C1 + C2',
    en: 'origin + C1 + C2',
    stages: ['created', 'origin', 'c1', 'c2'],
    budgetMs: LEXICAL_BUDGET_MS,
  },
  {
    id: 'c3',
    fr: 'couche C3 (file asynchrone)',
    en: 'C3 layer (async queue)',
    stages: ['created', 'c3'],
    budgetMs: C3_OBJECTIVE_MS,
  },
  {
    id: 'safe-tool',
    fr: 'get-request-safe (outil MCP)',
    en: 'get-request-safe (MCP tool)',
    stages: [],
    budgetMs: SAFE_TOOL_BUDGET_MS,
  },
];

export type SloVerdict = 'held' | 'exceeded' | 'unknown';

/** Libellés des verdicts, dans les deux langues (§21). */
export const VERDICT_LABELS: Record<SloVerdict, { fr: string; en: string }> = {
  held: { fr: 'tenu', en: 'held' },
  exceeded: { fr: 'dépassé', en: 'exceeded' },
  unknown: { fr: 'à mesurer', en: 'to measure' },
};

/** La règle d'alerte, en clair : un dépassement est une information. */
export const SLO_RULE_FR =
  'Un budget dépassé n’est pas une faute : c’est une information à remonter, '
  + 'avec le taux d’atteinte.';
export const SLO_RULE_EN =
  'An exceeded budget is not a fault: it is information to escalate, with the '
  + 'hit rate.';

/** Le budget d'un identifiant, s'il existe. */
export function budgetById(id: SloBudgetId): SloBudget | undefined {
  return SLO_BUDGETS.find((budget) => budget.id === id);
}

/**
 * Le budget d'un lot d'étapes : la fenêtre la plus courte qui contient toutes
 * les étapes demandées. `undefined` quand aucune fenêtre ne les couvre — un
 * budget n'est jamais inventé pour un lot d'étapes inconnu.
 */
export function budgetForStages(stages: readonly TimingStage[]): SloBudget | undefined {
  if (stages.length === 0) return undefined;
  const wanted = [...new Set(stages)];
  const covering = SLO_BUDGETS.filter(
    (budget) => budget.stages.length > 0
      && wanted.every((stage) => budget.stages.includes(stage)),
  );
  return covering.sort((a, b) => a.stages.length - b.stages.length)[0];
}

/** Ce qu'une fenêtre de budget donne sur une trace. */
export interface BatchMeasure {
  /** Durée mesurée entre les deux extrémités de la fenêtre (null si absente). */
  observedMs: number | null;
  /** Étapes de la fenêtre effectivement datées. */
  measuredStages: readonly TimingStage[];
  /** Étapes de la fenêtre non datées : elles ne sont pas devinées. */
  missingStages: readonly TimingStage[];
  /** `exact` : toute la fenêtre est datée ; `bound` : une partie seulement. */
  completeness: 'exact' | 'bound' | 'none';
}

function hasMark(trace: TimingTrace, stage: TimingStage): boolean {
  return trace.marks.some((mark) => mark.stage === stage);
}

/**
 * Mesure la fenêtre d'un budget sur une trace.
 *
 * Les extrémités de la fenêtre (la première et la dernière étape du budget)
 * doivent être datées : sans elles, aucune durée n'est affirmée. Les étapes
 * du milieu, elles, peuvent manquer — la mesure est alors une **borne**, et
 * le rapport le dit.
 */
export function measureBatch(
  trace: TimingTrace,
  stages: readonly TimingStage[],
): BatchMeasure {
  if (stages.length === 0) {
    return { observedMs: null, measuredStages: [], missingStages: [], completeness: 'none' };
  }
  const first = stages[0] as TimingStage;
  const last = stages[stages.length - 1] as TimingStage;
  const measuredStages = stages.filter((stage) => hasMark(trace, stage));
  const missingStages = stages.filter((stage) => !hasMark(trace, stage));
  const observed = durationMs(trace, first, last);
  if (observed === null) {
    return { observedMs: null, measuredStages, missingStages, completeness: 'none' };
  }
  return {
    observedMs: observed,
    measuredStages,
    missingStages,
    completeness: missingStages.length === 0 ? 'exact' : 'bound',
  };
}

/** Le verdict d'un budget sur une mesure : tenu, dépassé (de combien), ou inconnu. */
export interface SloEvaluation {
  id: SloBudgetId;
  fr: string;
  en: string;
  budgetMs: number;
  observedMs: number | null;
  verdict: SloVerdict;
  /** Écart en ms quand le budget est dépassé (0 sinon). */
  overshootMs: number;
  /** Part du budget consommée, en pourcentage (null si non mesuré). */
  sharePct: number | null;
  completeness: 'exact' | 'bound' | 'none';
  measuredStages: readonly TimingStage[];
  missingStages: readonly TimingStage[];
}

/** Verdict d'un budget sur une mesure unique. */
export function evaluateMeasure(budget: SloBudget, measure: BatchMeasure): SloEvaluation {
  const base = {
    id: budget.id,
    fr: budget.fr,
    en: budget.en,
    budgetMs: budget.budgetMs,
    completeness: measure.completeness,
    measuredStages: measure.measuredStages,
    missingStages: measure.missingStages,
  };
  if (measure.observedMs === null) {
    return { ...base, observedMs: null, verdict: 'unknown', overshootMs: 0, sharePct: null };
  }
  const overshoot = measure.observedMs - budget.budgetMs;
  return {
    ...base,
    observedMs: measure.observedMs,
    verdict: overshoot > 0 ? 'exceeded' : 'held',
    overshootMs: overshoot > 0 ? overshoot : 0,
    sharePct: Math.round((measure.observedMs / budget.budgetMs) * 100),
  };
}

/**
 * Verdict d'un budget sur une durée mesurée en dehors d'une trace (latence
 * d'un outil, attente d'une file). Une durée absente reste « à mesurer ».
 */
export function evaluateDuration(budget: SloBudget, observedMs: number | null): SloEvaluation {
  const measure: BatchMeasure = {
    observedMs,
    measuredStages: [],
    missingStages: [],
    completeness: observedMs === null ? 'none' : 'exact',
  };
  return evaluateMeasure(budget, measure);
}

/** Le verdict d'un budget sur un lot de mesures. */
export interface SloBudgetReport {
  budget: SloBudget;
  /** Le pire verdict observé (null si rien n'est mesuré). */
  worst: SloEvaluation | null;
  /** Nombre de mesures considérées. */
  samples: number;
  held: number;
  exceeded: number;
  unknown: number;
  /** Taux d'atteinte sur les mesures exploitables, en pourcentage (null si aucune). */
  hitRate: number | null;
  /** Écart maximal observé, en ms. */
  worstOvershootMs: number;
}

/** Le pire verdict d'une liste : la durée la plus longue, jamais la moyenne. */
function worstOf(evaluations: readonly SloEvaluation[]): SloEvaluation | null {
  const measured = evaluations.filter((item) => item.observedMs !== null);
  if (measured.length === 0) return null;
  return measured.sort((a, b) => (b.observedMs ?? 0) - (a.observedMs ?? 0))[0] ?? null;
}

/**
 * Verdict d'un budget sur un lot de traces. Une fenêtre d'exposition se juge
 * sur son **pire** cas, pas sur une moyenne (docs/MESURES.md §4).
 */
export function evaluateBudget(
  budget: SloBudget,
  traces: readonly TimingTrace[],
): SloBudgetReport {
  const evaluations = traces.map((trace) =>
    evaluateMeasure(budget, measureBatch(trace, budget.stages)),
  );
  const held = evaluations.filter((item) => item.verdict === 'held').length;
  const exceeded = evaluations.filter((item) => item.verdict === 'exceeded').length;
  const unknown = evaluations.length - held - exceeded;
  const measured = held + exceeded;
  const worst = worstOf(evaluations);
  return {
    budget,
    worst,
    samples: evaluations.length,
    held,
    exceeded,
    unknown,
    hitRate: measured > 0 ? Math.round((held / measured) * 100) : null,
    worstOvershootMs: worst?.overshootMs ?? 0,
  };
}

/** Le verdict d'un budget, par type d'événement (création, commentaire…). */
export function evaluateByEventKind(
  budget: SloBudget,
  traces: readonly TimingTrace[],
): Record<EventKind, SloBudgetReport> {
  const groups = groupByEventKind(traces);
  const out = {} as Record<EventKind, SloBudgetReport>;
  for (const kind of EVENT_KINDS) {
    out[kind] = evaluateBudget(budget, groups[kind] ?? []);
  }
  return out;
}

/** Niveau d'alerte : jamais une faute, seulement une information à remonter. */
export type SloAlertLevel = 'none' | 'info';

/** L'état de service : ce qui est tenu, ce qui est dépassé, le taux d'atteinte. */
export interface SloStatus {
  level: SloAlertLevel;
  budgets: number;
  /** Budgets mesurés (tenus ou dépassés). */
  measured: number;
  held: number;
  exceeded: number;
  unknown: number;
  /** Taux d'atteinte global, en pourcentage (null si rien n'est mesuré). */
  hitRate: number | null;
  exceededIds: SloBudgetId[];
  worstOvershootMs: number;
  ruleFr: string;
  ruleEn: string;
}

/**
 * La règle d'alerte : un budget dépassé n'est pas une faute, c'est une
 * information à remonter — avec le taux d'atteinte pour la situer. Un budget
 * jamais mesuré n'est ni tenu ni dépassé : il reste « à mesurer ».
 */
export function sloStatus(reports: readonly SloBudgetReport[]): SloStatus {
  const held = reports.reduce((sum, report) => sum + report.held, 0);
  const exceeded = reports.reduce((sum, report) => sum + report.exceeded, 0);
  const unknown = reports.reduce((sum, report) => sum + report.unknown, 0);
  const measured = held + exceeded;
  const exceededIds = reports
    .filter((report) => report.exceeded > 0)
    .map((report) => report.budget.id);
  const worstOvershootMs = reports.reduce(
    (worst, report) => Math.max(worst, report.worstOvershootMs),
    0,
  );
  return {
    level: exceeded > 0 ? 'info' : 'none',
    budgets: reports.length,
    measured,
    held,
    exceeded,
    unknown,
    hitRate: measured > 0 ? Math.round((held / measured) * 100) : null,
    exceededIds,
    worstOvershootMs,
    ruleFr: SLO_RULE_FR,
    ruleEn: SLO_RULE_EN,
  };
}

/** Le tableau markdown des budgets : chiffres, verdicts, écarts. */
export function renderSloMarkdown(reports: readonly SloBudgetReport[]): string {
  const lines = [
    '| Budget | Plafond | Observé | Verdict | Écart | Part du budget |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const report of reports) {
    const worst = report.worst;
    const observed = worst?.observedMs === null || worst === null
      ? 'à mesurer sur site'
      : '≤ ' + formatMs(worst?.observedMs ?? null);
    const verdict = worst === null ? VERDICT_LABELS.unknown.fr : VERDICT_LABELS[worst.verdict].fr;
    const gap = worst !== null && worst.overshootMs > 0 ? '+' + formatMs(worst.overshootMs) : '—';
    const share = worst !== null && worst.sharePct !== null ? String(worst.sharePct) + ' %' : '—';
    lines.push(
      '| ' + report.budget.fr + ' | < ' + formatMs(report.budget.budgetMs) + ' | '
      + observed + ' | ' + verdict + ' | ' + gap + ' | ' + share + ' |',
    );
  }
  return lines.join('\n');
}
