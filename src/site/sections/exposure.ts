/**
 * Section « Exposition » — le rapport qui remplace l'intuition (§13, §14).
 *
 * « Rejoué après l'activation des protections, l'exercice montre l'avant et
 * l'après. » La section n'agrège rien elle-même : elle construit des lignes de
 * démonstration (`exposure-demo.ts`) et les donne au domaine —
 * `buildExposureReport` (§13), `exposureScore` (#47), `comparePeriods` (#45),
 * `obedienceByAssistant` (#42), `statsByRule`/`shouldDemote` (§14).
 *
 * Deux gestes suffisent : l'onglet affiche déjà les deux périodes, leurs scores
 * et la comparaison ; un sélecteur change la période détaillée, deux boutons
 * téléchargent le CSV et le JSON en local (`Blob`, aucun réseau). Les exports ne
 * contiennent que des compteurs et des taux : aucun texte de ticket (§21).
 */

import { buildExposureReport, comparePeriods, hitsByActorType, type PeriodComparison } from '../../core/exposure';
import { assistantLabel, obedienceByAssistant } from '../../core/assistants';
import { comparisonRows, comparisonToCsv, comparisonToJson } from '../../core/exports';
import {
  SCORE_BANDS,
  SCORE_WEIGHTS,
  exposureScore,
  suspectFindings,
} from '../../core/scores';
import type { ScoreBand } from '../../core/scores';
import {
  DEMOTION_THRESHOLD,
  MIN_SAMPLES,
  computePrecision,
  shouldDemote,
  statsByRule,
  verdictLabel,
} from '../../core/precision';
import type { CanaryActorType, ExposureReport, VerdictDecision } from '../../core/types';
import { DETECTION_LAYERS } from '../../core/types';
import {
  badge,
  buttonHtml,
  byId,
  details,
  esc,
  field,
  grid,
  heading,
  note,
  panel,
  pre,
  selectHtml,
  table,
} from '../dom';
import { demoPeriods, periodById, type DemoPeriod } from './exposure-demo';
import type { Section, SectionContext } from './types';

/** Textes propres à la section (les catalogues du produit ne sont pas modifiés). */
const LABELS = {
  period: { fr: 'Période détaillée', en: 'Detailed period' },
  indicator: { fr: 'Indicateur', en: 'Indicator' },
  value: { fr: 'Valeur', en: 'Value' },
  layer: { fr: 'Couche', en: 'Layer' },
  findings: { fr: 'Constats', en: 'Findings' },
  suspects: { fr: 'Constats suspects (C1+C2+C3)', en: 'Suspect findings (C1+C2+C3)' },
  window: { fr: 'Fenêtre', en: 'Window' },
  actors: { fr: 'Coups d’exercice par type d’acteur (§13)', en: 'Exercise hits by actor type (§13)' },
  actor: { fr: 'Type d’acteur', en: 'Actor type' },
  hits: { fr: 'Coups', en: 'Hits' },
  assistant: { fr: 'Assistant (intégration)', en: 'Assistant (integration)' },
  launched: { fr: 'Lancés', en: 'Launched' },
  obeyed: { fr: 'Suivis d’effet', en: 'Obeyed' },
  rate: { fr: 'Taux', en: 'Rate' },
  rule: { fr: 'Règle', en: 'Rule' },
  kind: { fr: 'Motif', en: 'Kind' },
  tp: { fr: 'Vrais positifs', en: 'True positives' },
  fp: { fr: 'Faux positifs', en: 'False positives' },
  precision: { fr: 'Précision', en: 'Precision' },
  precisionTitle: { fr: 'Précision par règle (§14)', en: 'Precision by rule (§14)' },
  state: { fr: 'État', en: 'State' },
  kept: { fr: 'active', en: 'kept' },
  weight: { fr: 'Poids', en: 'Weight' },
  points: { fr: 'Points', en: 'Points' },
  component: { fr: 'Composante', en: 'Component' },
  csv: { fr: 'Télécharger le CSV', en: 'Download CSV' },
  json: { fr: 'Télécharger le JSON', en: 'Download JSON' },
  csvPreview: { fr: 'Aperçu du CSV avant/après', en: 'Preview of the before/after CSV' },
  downloaded: { fr: 'Export téléchargé : tout est resté dans votre navigateur.', en: 'Export downloaded: everything stayed in your browser.' },
  blocked: { fr: 'Téléchargement indisponible dans ce contexte.', en: 'Download unavailable in this context.' },
  demo: {
    fr: 'Données de démonstration, construites dans la page : aucun ticket réel, '
      + 'aucun texte, aucune identité. Les dates dérivent de l’instant de la session.',
    en: 'Demonstration data built in the page: no real ticket, no text, no identity. '
      + 'Dates derive from the session instant.',
  },
  noText: {
    fr: 'Les exports ne contiennent que des compteurs et des taux : aucun texte de ticket n’en sort.',
    en: 'The exports hold counters and rates only: no ticket text ever leaves them.',
  },
  human: { fr: 'humain', en: 'human' },
  'ai-agent': { fr: 'agent IA', en: 'AI agent' },
  automation: { fr: 'automatisation', en: 'automation' },
  unknown: { fr: 'inconnu', en: 'unknown' },
} as const;

type LabelKey = keyof typeof LABELS;

function label(ctx: SectionContext, key: LabelKey): string {
  return LABELS[key][ctx.lang];
}

/** Pourcentage lisible d'un taux 0-1. */
export function percent(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

/** Ton de pastille d'une bande de score (liste fermée de `dom.ts`). */
export function bandTone(band: ScoreBand): string {
  if (band === 'low') return 'clean';
  if (band === 'medium') return 'review';
  return band === 'high' ? 'suspect' : 'trapped';
}

/** Les deux périodes du jeu, avec leur rapport déjà construit par le domaine. */
export function demoComparison(now: string): { periods: DemoPeriod[]; reports: ExposureReport[]; comparison: PeriodComparison } {
  const periods = demoPeriods(now);
  const reports = periods.map((period) => buildExposureReport(period.input));
  return { periods, reports, comparison: comparePeriods(reports[0]!, reports[1]!) };
}

/** Lignes du rapport : ce que le §13 agrège, libellés par le catalogue du produit. */
export function reportRows(report: ExposureReport, ctx: SectionContext): [string, string][] {
  const layers = DETECTION_LAYERS.map((layer) => `${layer} ${report.findingsByLayer[layer]}`).join(' · ');
  const kinds = report.topKinds.map((entry) => `${entry.kind} ×${entry.count}`).join(', ');
  const decisions: VerdictDecision[] = ['trapped', 'false-positive', 'legitimate-risky'];
  const verdicts = decisions.map((decision) => `${verdictLabel(decision, ctx.lang)} ${report.verdicts[decision]}`).join(' · ');
  return [
    [label(ctx, 'window'), `${report.from} → ${report.to}`],
    [ctx.t('ui.exposure.requests'), String(report.requestsExamined)],
    [ctx.t('ui.exposure.analyzedShare'), percent(report.analyzedShare)],
    [ctx.t('ui.exposure.byLayer'), layers],
    [label(ctx, 'suspects'), String(suspectFindings(report))],
    [ctx.t('ui.exposure.topKinds'), kinds],
    [ctx.t('ui.exposure.verdicts'), verdicts],
    [ctx.t('ui.exposure.canaries'), ctx.t('ui.exposure.canariesDetail', {
      launched: report.canariesLaunched,
      obeyed: report.canariesObeyed,
      rate: percent(report.obedienceRate),
    })],
    [ctx.t('ui.exposure.outbound'), String(report.outboundHeld)],
    [ctx.t('ui.exposure.campaigns'), String(report.campaigns)],
  ];
}

/** Score 0-100 et ses quatre pondérations (#47) — aucune composante cachée. */
export function scoreBlock(report: ExposureReport, ctx: SectionContext): string {
  const score = exposureScore(report);
  const components = Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[];
  const rows = components.map((name) => [
    ctx.t(`exposition.score.component.${name}`),
    String(SCORE_WEIGHTS[name]),
    score.contributions[name].toFixed(2),
  ]);
  const bands = note(
    `${ctx.t('exposition.score.band.low')} < ${SCORE_BANDS.medium} · `
    + `${ctx.t('exposition.score.band.medium')} < ${SCORE_BANDS.high} · `
    + `${ctx.t('exposition.score.band.high')} < ${SCORE_BANDS.critical} · ${ctx.t('exposition.score.band.critical')}`,
  );
  return `${badge(ctx.t('exposition.score.value', { score: score.total }), bandTone(score.band))}
    ${badge(ctx.t(`exposition.score.band.${score.band}`), bandTone(score.band))}
    ${table([label(ctx, 'component'), label(ctx, 'weight'), label(ctx, 'points')], rows)}
    ${bands}${note(ctx.t('exposition.score.honesty'))}`;
}

/** Répartition des coups d'exercice par type d'acteur : jamais par personne (§13). */
export function actorTable(period: DemoPeriod, ctx: SectionContext): string {
  const hits = hitsByActorType(period.hits);
  const rows = (Object.keys(hits) as CanaryActorType[]).map((actor) => [
    `${actor} — ${label(ctx, actor as LabelKey)}`,
    String(hits[actor]),
  ]);
  return table([label(ctx, 'actor'), label(ctx, 'hits')], rows);
}

/** Obéissance par assistant (#42) : une intégration, pas une personne. */
export function assistantTable(period: DemoPeriod, ctx: SectionContext): string {
  const rows = obedienceByAssistant(period.launches).map((entry) => [
    assistantLabel(ctx.lang, entry.assistant),
    String(entry.launched),
    String(entry.obeyed),
    percent(entry.rate),
  ]);
  return `${table([label(ctx, 'assistant'), label(ctx, 'launched'), label(ctx, 'obeyed'), label(ctx, 'rate')], rows)}
    ${note(ctx.t('exposition.assistant.honesty'))}`;
}

/** Précision par règle (§14) : la règle bruyante est rétrogradée, pas supprimée. */
export function precisionTable(period: DemoPeriod, ctx: SectionContext): string {
  const stats = statsByRule(period.input.findings, period.input.verdicts)
    .sort((a, b) => Number(shouldDemote(b)) - Number(shouldDemote(a)) || a.ruleId.localeCompare(b.ruleId));
  const rows = stats.map((entry) => {
    const judged = entry.truePositives + entry.falsePositives;
    const precision = judged === 0 ? '—' : percent(computePrecision(entry).precision);
    const demoted = shouldDemote(entry);
    return [
      esc(entry.ruleId),
      esc(entry.layer),
      esc(entry.kind),
      esc(entry.truePositives),
      esc(entry.falsePositives),
      esc(precision),
      demoted ? badge(ctx.t('ui.review.demoted'), 'warn') : badge(label(ctx, 'kept'), 'ok'),
    ];
  });
  const rule = note(
    `${ctx.t('ui.review.precision', { value: percent(DEMOTION_THRESHOLD) })} · ${MIN_SAMPLES} verdicts minimum`,
  );
  return `${table(
    [label(ctx, 'rule'), label(ctx, 'layer'), label(ctx, 'kind'), label(ctx, 'tp'), label(ctx, 'fp'),
      label(ctx, 'precision'), label(ctx, 'state')],
    rows,
    true,
  )}${rule}`;
}

/** Comparaison avant/après (#45) : les mêmes lignes que l'export CSV. */
export function comparisonTable(comparison: PeriodComparison, ctx: SectionContext): string {
  const head = [
    ctx.t('exposition.export.header.field'),
    ctx.t('exposition.export.header.before'),
    ctx.t('exposition.export.header.after'),
    ctx.t('exposition.export.header.change'),
  ];
  const rows = comparisonRows(comparison).map((row) => [row.field, row.before, row.after, row.change]);
  return `${heading(ctx.t('exposition.export.title'))}${table(head, rows)}${note(ctx.t('exposition.export.honesty'))}`;
}

/** Tout ce qui dépend de la période choisie : rapport, score, assistants, règles. */
export function renderPeriod(period: DemoPeriod, report: ExposureReport, ctx: SectionContext): string {
  const title = `${period.titles[ctx.lang]} · ${period.input.projectKey}`;
  return `${heading(title)}
    ${table([label(ctx, 'indicator'), label(ctx, 'value')], reportRows(report, ctx))}
    ${heading(ctx.t('exposition.score.title'))}${scoreBlock(report, ctx)}
    ${heading(label(ctx, 'actors'))}${actorTable(period, ctx)}
    ${heading(ctx.t('exposition.assistant.title'))}${assistantTable(period, ctx)}
    ${heading(label(ctx, 'precisionTitle'))}${precisionTable(period, ctx)}`;
}

/** Téléchargement local : `Blob` + URL d'objet, rien ne sort de la page. */
export function downloadText(fileName: string, text: string, mime: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Colonne de gauche : choix de la période, exports et ce qu'ils contiennent. */
function controls(ctx: SectionContext, comparison: PeriodComparison, periods: DemoPeriod[]): string {
  const options = periods.map((period) => [period.id, `${period.titles[ctx.lang]} (${period.input.from} → ${period.input.to})`] as [string, string]);
  const buttons = `<div class="row">${buttonHtml('e-csv', label(ctx, 'csv'))}${buttonHtml('e-json', label(ctx, 'json'), 'ghost')}</div>`;
  return panel(
    field(label(ctx, 'period'), selectHtml('e-period', options, periods[0]?.id))
    + note(label(ctx, 'demo'))
    + heading(ctx.t('exposition.export.title'))
    + buttons
    + note(label(ctx, 'noText'))
    + details(label(ctx, 'csvPreview'), pre(comparisonToCsv(comparison)))
    + details('JSON', pre(comparisonToJson(comparison))),
  );
}

/** Câblage : le sélecteur change la période détaillée, les boutons téléchargent. */
function wire(root: HTMLElement, ctx: SectionContext): void {
  const { periods, reports, comparison } = demoComparison(ctx.now);
  const select = byId<HTMLSelectElement>(root, 'e-period');
  select?.addEventListener('change', () => {
    const target = byId<HTMLDivElement>(root, 'e-result');
    const index = periods.findIndex((period) => period.id === select.value);
    if (!target || index < 0) return;
    const period = periods[index]!;
    target.innerHTML = renderPeriod(period, reports[index]!, ctx);
  });
  const download = (id: string, fileName: string, text: string, mime: string): void => {
    byId<HTMLButtonElement>(root, id)?.addEventListener('click', () => {
      ctx.notify(downloadText(fileName, text, mime) ? label(ctx, 'downloaded') : label(ctx, 'blocked'));
    });
  };
  download('e-csv', 'exposition-avant-apres.csv', comparisonToCsv(comparison), 'text/csv;charset=utf-8');
  download('e-json', 'exposition-avant-apres.json', comparisonToJson(comparison), 'application/json');
}

export const exposureSection: Section = {
  id: 'exposure',
  titles: { fr: 'Exposition', en: 'Exposure' },
  render(ctx) {
    const { periods, reports, comparison } = demoComparison(ctx.now);
    return panel(
      grid(controls(ctx, comparison, periods), panel(renderPeriod(periods[0]!, reports[0]!, ctx), 'e-result'))
      + comparisonTable(comparison, ctx),
    );
  },
  mount: wire,
};
