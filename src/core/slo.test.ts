/**
 * Tests des budgets de service (SLO) — §21 du cahier.
 *
 * Aucune attente réelle : tous les instants sont injectés. Ce qui est testé,
 * c'est la règle — un budget dépassé est détecté et caractérisé (écart, part
 * du budget), une mesure absente reste inconnue, une alerte est une
 * information et non une faute.
 */

import { describe, expect, it } from 'vitest';
import {
  C3_OBJECTIVE_MS,
  emptyTrace,
  markStage,
  type EventKind,
  type TimingStage,
  type TimingTrace,
} from './timing';
import {
  LEXICAL_BUDGET_MS,
  SAFE_TOOL_BUDGET_MS,
  SLO_BUDGETS,
  SLO_RULE_EN,
  SLO_RULE_FR,
  VERDICT_LABELS,
  budgetById,
  budgetForStages,
  evaluateBudget,
  evaluateByEventKind,
  evaluateDuration,
  evaluateMeasure,
  measureBatch,
  renderSloMarkdown,
  sloStatus,
  type SloBudget,
} from './slo';

const T0 = 1_700_000_000_000;

/** Une trace dont les étapes sont datées aux instants donnés (croissants). */
function traceWith(
  stages: readonly TimingStage[],
  times: readonly number[],
  kind?: EventKind,
): TimingTrace {
  let trace = emptyTrace('SUP-1', kind);
  stages.forEach((stage, index) => {
    trace = markStage(trace, stage, times[index] as number);
  });
  return trace;
}

/** Trace complète : création, origine, C1, C2. */
function lexicalTrace(totalMs: number, kind?: EventKind): TimingTrace {
  return traceWith(
    ['created', 'origin', 'c1', 'c2'],
    [T0, T0 + 10, T0 + 20, T0 + totalMs],
    kind,
  );
}

const lexical = budgetById('lexical') as SloBudget;

describe('catalogue des budgets', () => {
  it('reprend les trois budgets du §21 et leurs seuils', () => {
    expect(SLO_BUDGETS.map((budget) => budget.id)).toEqual(['lexical', 'c3', 'safe-tool']);
    expect(lexical.budgetMs).toBe(LEXICAL_BUDGET_MS);
    expect(lexical.budgetMs).toBe(2_000);
    expect(budgetById('c3')?.budgetMs).toBe(C3_OBJECTIVE_MS);
    expect(budgetById('c3')?.budgetMs).toBe(30_000);
    expect(budgetById('safe-tool')?.budgetMs).toBe(SAFE_TOOL_BUDGET_MS);
  });

  it('donne un libellé français et anglais à chaque budget', () => {
    for (const budget of SLO_BUDGETS) {
      expect(budget.fr.length).toBeGreaterThan(0);
      expect(budget.en.length).toBeGreaterThan(0);
    }
  });

  it('trouve le budget d’un lot d’étapes', () => {
    expect(budgetForStages(['origin', 'c1', 'c2'])?.id).toBe('lexical');
    expect(budgetForStages(['c3'])?.id).toBe('c3');
  });

  it('n’invente pas de budget pour un lot d’étapes inconnu', () => {
    expect(budgetForStages(['journal'])).toBeUndefined();
    expect(budgetForStages([])).toBeUndefined();
  });
});

describe('mesure d’un lot d’étapes', () => {
  it('mesure la fenêtre du budget quand elle est entièrement datée', () => {
    const measure = measureBatch(lexicalTrace(1_200), lexical.stages);
    expect(measure.observedMs).toBe(1_200);
    expect(measure.completeness).toBe('exact');
    expect(measure.missingStages).toEqual([]);
  });

  it('marque la mesure comme borne quand une étape du milieu manque', () => {
    const trace = traceWith(['created', 'c2'], [T0, T0 + 900]);
    const measure = measureBatch(trace, lexical.stages);
    expect(measure.observedMs).toBe(900);
    expect(measure.completeness).toBe('bound');
    expect(measure.missingStages).toEqual(['origin', 'c1']);
  });

  it('ne mesure rien quand une extrémité de la fenêtre manque', () => {
    const trace = traceWith(['origin', 'c1', 'c2'], [T0, T0 + 10, T0 + 20]);
    const measure = measureBatch(trace, lexical.stages);
    expect(measure.observedMs).toBeNull();
    expect(measure.completeness).toBe('none');
    expect(measure.missingStages).toContain('created');
  });
});

describe('verdict d’un budget', () => {
  it('détecte un dépassement et le caractérise', () => {
    const evaluation = evaluateMeasure(lexical, measureBatch(lexicalTrace(2_500), lexical.stages));
    expect(evaluation.verdict).toBe('exceeded');
    expect(evaluation.observedMs).toBe(2_500);
    expect(evaluation.overshootMs).toBe(500);
    expect(evaluation.sharePct).toBe(125);
  });

  it('déclare le budget tenu quand la mesure est sous le seuil', () => {
    const evaluation = evaluateMeasure(lexical, measureBatch(lexicalTrace(1_200), lexical.stages));
    expect(evaluation.verdict).toBe('held');
    expect(evaluation.overshootMs).toBe(0);
    expect(evaluation.sharePct).toBe(60);
  });

  it('ne déclare jamais « tenu » sans mesure', () => {
    const evaluation = evaluateMeasure(lexical, measureBatch(emptyTrace('SUP-1'), lexical.stages));
    expect(evaluation.verdict).toBe('unknown');
    expect(evaluation.observedMs).toBeNull();
    expect(evaluation.sharePct).toBeNull();
  });

  it('juge une latence mesurée en dehors d’une trace', () => {
    const tool = budgetById('safe-tool') as SloBudget;
    expect(evaluateDuration(tool, 1_100).verdict).toBe('held');
    expect(evaluateDuration(tool, 2_400).verdict).toBe('exceeded');
    expect(evaluateDuration(tool, 2_400).overshootMs).toBe(400);
    expect(evaluateDuration(tool, null).verdict).toBe('unknown');
  });

  it('juge sur le pire cas, jamais sur une moyenne', () => {
    const report = evaluateBudget(lexical, [
      lexicalTrace(400),
      lexicalTrace(1_800),
      lexicalTrace(700),
    ]);
    expect(report.worst?.observedMs).toBe(1_800);
    expect(report.samples).toBe(3);
    expect(report.held).toBe(3);
    expect(report.exceeded).toBe(0);
    expect(report.hitRate).toBe(100);
  });

  it('compte les dépassements et donne le taux d’atteinte', () => {
    const report = evaluateBudget(lexical, [
      lexicalTrace(400),
      lexicalTrace(2_500),
      lexicalTrace(900),
      emptyTrace('SUP-2'),
    ]);
    expect(report.samples).toBe(4);
    expect(report.held).toBe(2);
    expect(report.exceeded).toBe(1);
    expect(report.unknown).toBe(1);
    expect(report.hitRate).toBe(67);
    expect(report.worstOvershootMs).toBe(500);
  });

  it('n’a pas de taux d’atteinte sans aucune mesure exploitable', () => {
    const report = evaluateBudget(lexical, [emptyTrace('SUP-1')]);
    expect(report.hitRate).toBeNull();
    expect(report.worst).toBeNull();
    expect(report.unknown).toBe(1);
  });
});

describe('mesure par type d’événement', () => {
  it('juge chaque type séparément et laisse vides les types absents', () => {
    const traces = [
      lexicalTrace(1_000, 'creation'),
      lexicalTrace(2_400, 'creation'),
      lexicalTrace(300, 'comment'),
    ];
    const byKind = evaluateByEventKind(lexical, traces);
    expect(byKind.creation.samples).toBe(2);
    expect(byKind.creation.exceeded).toBe(1);
    expect(byKind.creation.hitRate).toBe(50);
    expect(byKind.comment.samples).toBe(1);
    expect(byKind.comment.held).toBe(1);
    expect(byKind.update.samples).toBe(0);
    expect(byKind.update.hitRate).toBeNull();
    expect(byKind.link.samples).toBe(0);
  });
});

describe('règle d’alerte', () => {
  it('remonte une information, jamais une faute', () => {
    const status = sloStatus([
      evaluateBudget(lexical, [lexicalTrace(2_500)]),
      evaluateBudget(budgetById('c3') as SloBudget, [traceWith(['created', 'c3'], [T0, T0 + 100])]),
    ]);
    expect(status.level).toBe('info');
    expect(status.exceeded).toBe(1);
    expect(status.held).toBe(1);
    expect(status.exceededIds).toEqual(['lexical']);
    expect(status.worstOvershootMs).toBe(500);
    expect(status.hitRate).toBe(50);
    expect(status.ruleFr).toBe(SLO_RULE_FR);
    expect(status.ruleEn).toBe(SLO_RULE_EN);
  });

  it('reste muet quand tout est tenu', () => {
    const status = sloStatus([evaluateBudget(lexical, [lexicalTrace(400)])]);
    expect(status.level).toBe('none');
    expect(status.exceededIds).toEqual([]);
    expect(status.hitRate).toBe(100);
  });

  it('ne compte pas un budget jamais mesuré comme tenu', () => {
    const status = sloStatus([evaluateBudget(lexical, [emptyTrace('SUP-1')])]);
    expect(status.level).toBe('none');
    expect(status.measured).toBe(0);
    expect(status.unknown).toBe(1);
    expect(status.hitRate).toBeNull();
  });

  it('donne un libellé bilingue à chaque verdict', () => {
    expect(VERDICT_LABELS.held.fr).toBe('tenu');
    expect(VERDICT_LABELS.exceeded.en).toBe('exceeded');
    expect(VERDICT_LABELS.unknown.fr.length).toBeGreaterThan(0);
  });
});

describe('tableau des budgets', () => {
  it('écrit les verdicts, les écarts et les parts', () => {
    const markdown = renderSloMarkdown([evaluateBudget(lexical, [lexicalTrace(2_500)])]);
    expect(markdown).toContain('| Budget | Plafond | Observé | Verdict | Écart | Part du budget |');
    expect(markdown).toContain('dépassé');
    expect(markdown).toContain('+500 ms');
    expect(markdown).toContain('125 %');
  });

  it('écrit « à mesurer sur site » quand rien n’est mesuré', () => {
    const markdown = renderSloMarkdown([evaluateBudget(lexical, [])]);
    expect(markdown).toContain('à mesurer sur site');
    expect(markdown).not.toContain('dépassé');
  });
});
