/**
 * Export CSV/JSON du rapport d'exposition avant/après (#45).
 *
 * L'export s'appuie sur `comparePeriods` (déjà en place) et ajoute le score
 * d'exposition (#47) aux deux périodes. Deux garanties :
 *  - **stable** : mêmes rapports → sortie identique octet pour octet (aucune
 *    horloge, aucun ordre aléatoire) ;
 *  - **sans texte de ticket** : uniquement des compteurs, des taux et des
 *    identifiants stables (couches, motifs, décisions) — §21.
 *
 * Domaine pur : aucune E/S, c'est l'appelant qui écrit le fichier.
 */

import type { PeriodComparison } from './exposure';
import type { ExposureReport } from './types';
import { exposureScore, suspectFindings } from './scores';

/** Une ligne d'export : un champ et ses valeurs avant / après / variation. */
export interface ExportRow {
  field: string;
  before: string;
  after: string;
  change: string;
}

export const CSV_HEADER: readonly string[] = ['field', 'before', 'after', 'change'];

function delta(after: number, before: number): string {
  return String(round2(after - before));
}

/** Aplatit la comparaison en lignes stables, dans un ordre fixé. */
export function comparisonRows(comparison: PeriodComparison): ExportRow[] {
  const { before, after, change } = comparison;
  const rows: ExportRow[] = [];
  const push = (field: string, b: number, a: number, c?: number): void => {
    rows.push({ field, before: String(b), after: String(a), change: c === undefined ? delta(a, b) : String(c) });
  };
  push('requestsExamined', before.requestsExamined, after.requestsExamined);
  push('analyzedShare', before.analyzedShare, after.analyzedShare, change.analyzedShare);
  push('suspects', suspectFindings(before), suspectFindings(after), change.suspectFindings);
  for (const layer of ['C1', 'C2', 'C3', 'C4'] as const) {
    push(`findings.${layer}`, before.findingsByLayer[layer], after.findingsByLayer[layer]);
  }
  for (const decision of ['trapped', 'false-positive', 'legitimate-risky'] as const) {
    push(`verdicts.${decision}`, before.verdicts[decision], after.verdicts[decision]);
  }
  push('canariesLaunched', before.canariesLaunched, after.canariesLaunched);
  push('canariesObeyed', before.canariesObeyed, after.canariesObeyed);
  push('obedienceRate', before.obedienceRate, after.obedienceRate, change.obedienceRate);
  push('outboundHeld', before.outboundHeld, after.outboundHeld, change.outboundHeld);
  push('campaigns', before.campaigns, after.campaigns);
  push('exposureScore', exposureScore(before).total, exposureScore(after).total);
  return rows;
}

/** Échappe une valeur CSV (RFC 4180) : guillemets doublés, champ entre guillemets. */
export function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.split('"').join('""')}"`;
}

function toCsvLine(values: readonly string[]): string {
  return values.map(csvEscape).join(',');
}

/** Rendu CSV complet : en-tête puis une ligne par champ, séparateur virgule. */
export function comparisonToCsv(comparison: PeriodComparison): string {
  const lines = [toCsvLine(CSV_HEADER)];
  for (const row of comparisonRows(comparison)) {
    lines.push(toCsvLine([row.field, row.before, row.after, row.change]));
  }
  return lines.join('\n');
}

/** Rapport enrichi de son score — sans aucun ajout de texte. */
function scored(report: ExposureReport): Record<string, unknown> {
  const score = exposureScore(report);
  return { ...report, exposureScore: score.total, exposureBand: score.band };
}

/** Rendu JSON stable (clés triées par construction, indentation 2). */
export function comparisonToJson(comparison: PeriodComparison): string {
  return JSON.stringify(
    {
      projectKey: comparison.after.projectKey,
      before: scored(comparison.before),
      after: scored(comparison.after),
      change: comparison.change,
    },
    null,
    2,
  );
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
