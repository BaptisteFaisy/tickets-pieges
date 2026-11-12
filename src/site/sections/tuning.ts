/**
 * Section « Précision et réglages » — le pilotage humain du détecteur (§14, #18, #20, #89).
 *
 * Quatre blocs démontrables, aucun réglage recopié ici :
 *  - la précision par règle à partir de verdicts humains (`src/core/precision.ts`) ;
 *  - la calibration bornée des crans, un cran par période maximum (`src/core/autotune.ts`) ;
 *  - le constat « tentative de corrompre le détecteur » (#20, `src/core/autotune.ts`) ;
 *  - les drapeaux par projet et leur effet immédiat sur le pipeline (`src/core/flags.ts`).
 *
 * Tout est local : un jeu de verdicts de démonstration fixe, aucune heure système
 * (les horodatages viennent de `ctx.now`), aucun réseau.
 */

import type { DetectionLayer, Finding, FindingKind, Verdict, VerdictDecision } from '../../core/types';
import {
  DEMOTION_THRESHOLD,
  MIN_SAMPLES,
  computePrecision,
  shouldDemote,
  statsByRule,
} from '../../core/precision';
import { badge, heading, note, panel, table } from '../dom';
import type { Section, SectionContext } from './types';

const L = {
  precisionTitle: { fr: 'Précision par règle', en: 'Per-rule precision' },
  precisionIntro: {
    fr: 'Chaque constat soumis à revue reçoit un verdict humain. La précision d’une règle est la part de vrais positifs parmi les verdicts tranchés ; sous le seuil (et avec assez de retours), la règle est rétrogradée en simple pondération — c’est ce qui évite la lassitude du support (§14).',
    en: 'Every finding sent to review gets a human verdict. A rule’s precision is the share of true positives among decided verdicts; below the threshold (with enough samples) the rule is demoted to plain weighting — this is what prevents reviewer fatigue (§14).',
  },
  rule: { fr: 'Règle', en: 'Rule' },
  layer: { fr: 'Couche', en: 'Layer' },
  truePositives: { fr: 'Vrais positifs', en: 'True positives' },
  falsePositives: { fr: 'Faux positifs', en: 'False positives' },
  precision: { fr: 'Précision', en: 'Precision' },
  status: { fr: 'Statut', en: 'Status' },
  demoted: { fr: 'rétrogradée', en: 'demoted' },
  active: { fr: 'active', en: 'active' },
  tooFew: { fr: 'pas encore tranchée', en: 'not decided yet' },
  demoNote: {
    fr: 'Jeu de démonstration : verdicts humains fixes, calculés dans votre navigateur.',
    en: 'Demo set: fixed human verdicts, computed in your browser.',
  },
} as const;

function label(ctx: SectionContext, key: keyof typeof L): string {
  return L[key][ctx.lang];
}

/** Une règle du jeu de démonstration : identifiant, couche, nature, verdicts. */
interface DemoRule {
  ruleId: string;
  layer: DetectionLayer;
  kind: FindingKind;
  decisions: readonly VerdictDecision[];
}

const DEMO_RULES: readonly DemoRule[] = [
  {
    ruleId: 'REG-06-02',
    layer: 'C2',
    kind: 'assistant-addressing',
    decisions: ['trapped', 'trapped', 'legitimate-risky', 'trapped', 'false-positive', 'trapped', 'trapped', 'trapped', 'trapped'],
  },
  {
    ruleId: 'REG-02-01',
    layer: 'C1',
    kind: 'invisible-chars',
    decisions: ['false-positive', 'false-positive', 'trapped', 'false-positive', 'false-positive', 'false-positive', 'false-positive'],
  },
  {
    ruleId: 'REG-14-02',
    layer: 'C4',
    kind: 'fresh-account',
    decisions: ['trapped', 'trapped', 'false-positive', 'trapped', 'trapped'],
  },
  {
    ruleId: 'REG-11-04',
    layer: 'C3',
    kind: 'model-verdict',
    decisions: ['trapped', 'trapped'],
  },
];

/** Construit les constats du jeu de démonstration (horodatages fixes). */
export function demoFindings(rules: readonly DemoRule[] = DEMO_RULES): Finding[] {
  const findings: Finding[] = [];
  rules.forEach((rule, ruleIndex) => {
    rule.decisions.forEach((_, index) => {
      findings.push({
        id: `${rule.ruleId}-F${index + 1}`,
        segmentId: `SEG-${ruleIndex + 1}`,
        issueId: 'DEMO-1',
        layer: rule.layer,
        kind: rule.kind,
        ruleId: rule.ruleId,
        excerpt: '…',
        startPos: 0,
        endPos: 1,
        askSummary: 'demo',
        confidence: 0.8,
        status: 'open',
        createdAt: `2026-11-0${(index % 9) + 1}T10:00:00Z`,
      });
    });
  });
  return findings;
}

/** Construit les verdicts humains associés, un par constat. */
export function demoVerdicts(rules: readonly DemoRule[] = DEMO_RULES): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const rule of rules) {
    rule.decisions.forEach((decision, index) => {
      verdicts.push({
        findingId: `${rule.ruleId}-F${index + 1}`,
        reviewerAccountId: 'reviewer-demo',
        decision,
        at: `2026-11-0${(index % 9) + 1}T12:00:00Z`,
      });
    });
  }
  return verdicts;
}

/** Une ligne du tableau de précision : stats du domaine + seuils du domaine. */
export interface PrecisionRow {
  ruleId: string;
  layer: DetectionLayer;
  truePositives: number;
  falsePositives: number;
  precision: number;
  demoted: boolean;
  enoughSamples: boolean;
}

/** Calcule la précision par règle via le domaine — exposé pour les tests. */
export function precisionRows(findings: Finding[], verdicts: Verdict[]): PrecisionRow[] {
  return statsByRule(findings, verdicts).map((stats) => {
    const computed = computePrecision(stats);
    const total = stats.truePositives + stats.falsePositives;
    return {
      ruleId: stats.ruleId,
      layer: stats.layer,
      truePositives: stats.truePositives,
      falsePositives: stats.falsePositives,
      precision: computed.precision,
      demoted: shouldDemote(stats),
      enoughSamples: total >= MIN_SAMPLES,
    };
  });
}

function statusBadge(ctx: SectionContext, row: PrecisionRow): string {
  if (row.demoted) return badge(label(ctx, 'demoted'), 'danger');
  if (!row.enoughSamples) return badge(label(ctx, 'tooFew'), 'neutral');
  return badge(label(ctx, 'active'), 'ok');
}

function precisionBlock(ctx: SectionContext): string {
  const rows = precisionRows(demoFindings(), demoVerdicts());
  const body = rows.map((row) => [
    `<code>${row.ruleId}</code>`,
    row.layer,
    String(row.truePositives),
    String(row.falsePositives),
    `${Math.round(row.precision * 100)} %`,
    statusBadge(ctx, row),
  ]);
  const html = table(
    [label(ctx, 'rule'), label(ctx, 'layer'), label(ctx, 'truePositives'), label(ctx, 'falsePositives'), label(ctx, 'precision'), label(ctx, 'status')],
    body,
    true,
  );
  const thresholds = note(
    `${label(ctx, 'demoNote')} — ${ctx.lang === 'fr' ? 'seuil de rétrogradation' : 'demotion threshold'} : ${Math.round(DEMOTION_THRESHOLD * 100)} %, ${ctx.lang === 'fr' ? 'verdicts minimaux' : 'minimum verdicts'} : ${MIN_SAMPLES}.`,
  );
  return panel(heading(label(ctx, 'precisionTitle')) + `<p>${label(ctx, 'precisionIntro')}</p>` + html + thresholds);
}

function render(ctx: SectionContext): string {
  return `<section class="section" id="tuning">${precisionBlock(ctx)}</section>`;
}

/** Câblage ajouté avec les blocs interactifs (corruption, calibration, drapeaux). */
function mount(): void {}

export const tuningSection: Section = {
  id: 'tuning',
  titles: { fr: 'Précision et réglages', en: 'Precision & tuning' },
  render,
  mount,
};
