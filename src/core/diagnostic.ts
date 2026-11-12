/**
 * Diagnostic de l'app par elle-même (lot 10) — domaine pur.
 *
 * Le rapport agrège ce que l'app sait d'elle-même, à partir de **données
 * injectées** (jamais lues ici) : version, tables et leurs lignes, budget de
 * requêtes de la dernière invocation, latences par étape, erreurs récentes,
 * tickets traités, files en attente.
 *
 * Contraintes tenues : aucune E/S, aucune horloge, aucun `@forge/*`. La
 * distinction « mesuré » / « à mesurer sur site » est réutilisée de
 * `src/core/timing.ts` (zéro duplication de la notion). Les textes visibles
 * sont bilingues (français et anglais), comme partout ailleurs (§21).
 */

import type { Language } from './types';
import type { Measurement } from './timing';

/** Version publiée de l'app — à tenir alignée sur `package.json`. */
export const APP_VERSION = '0.1.0';

/** Une table du stockage, avec son nombre de lignes (null si illisible). */
export interface TableCount {
  name: string;
  rows: number | null;
}

/** Relevé de budget, sous la forme pure du domaine (sans `@forge/*`). */
export interface BudgetSnapshot {
  writes: number;
  reads: number;
  queries: number;
  skippedWrites: number;
  limit: number;
  degraded: boolean;
  nearLimit: boolean;
  startedAt: string;
}

/** Latence d'une étape du pipeline, avec sa source. */
export interface StageLatency {
  id: string;
  labelFr: string;
  labelEn: string;
  ms: Measurement<number | null>;
}

/** Une erreur récente du journal, débarrassée de tout texte client. */
export interface ErrorEntry {
  at: string;
  kind: string;
  message: string;
}

/** Une file en attente (aujourd'hui : la file C3, hors du chemin d'événement). */
export interface PendingQueue {
  key: string;
  labelFr: string;
  labelEn: string;
  pending: Measurement<number>;
}

/** Les faits injectés par le glue (`src/jobs/diagnostic.ts`). */
export interface DiagnosticInput {
  appVersion: string;
  generatedAt: string;
  tables: readonly TableCount[];
  budget: BudgetSnapshot | null;
  latencies: readonly StageLatency[];
  recentErrors: readonly ErrorEntry[];
  ticketsProcessed: Measurement<number>;
  queues: readonly PendingQueue[];
  caveats?: readonly string[];
}

/** Synthèse calculée (jamais devinée) du rapport. */
export interface DiagnosticSummary {
  tablesListed: number;
  tablesReadable: number;
  totalRows: number | null;
  recentErrors: number;
  degraded: boolean;
}

/** Le rapport assemblé, prêt à être rendu. */
export interface DiagnosticReport {
  appVersion: string;
  generatedAt: string;
  tables: TableCount[];
  budget: BudgetSnapshot | null;
  latencies: StageLatency[];
  recentErrors: ErrorEntry[];
  ticketsProcessed: Measurement<number>;
  queues: PendingQueue[];
  summary: DiagnosticSummary;
  caveats: string[];
}

/** Somme des lignes lisibles, ou null quand aucune table n'est lisible. */
function sumRows(tables: readonly TableCount[]): number | null {
  let any = false;
  let total = 0;
  for (const table of tables) {
    if (table.rows !== null) {
      any = true;
      total += table.rows;
    }
  }
  return any ? total : null;
}

/** Assemble les faits injectés en un seul rapport porteur de sa synthèse. */
export function buildDiagnostic(input: DiagnosticInput): DiagnosticReport {
  return {
    appVersion: input.appVersion,
    generatedAt: input.generatedAt,
    tables: [...input.tables],
    budget: input.budget,
    latencies: [...input.latencies],
    recentErrors: [...input.recentErrors],
    ticketsProcessed: input.ticketsProcessed,
    queues: [...input.queues],
    summary: {
      tablesListed: input.tables.length,
      tablesReadable: input.tables.filter((table) => table.rows !== null).length,
      totalRows: sumRows(input.tables),
      recentErrors: input.recentErrors.length,
      degraded: input.budget?.degraded ?? false,
    },
    caveats: [...(input.caveats ?? [])],
  };
}

// ---------------------------------------------------------------- textes visibles

interface Labels {
  title: string;
  version: string;
  generated: string;
  tables: string;
  rows: string;
  budget: string;
  writes: string;
  reads: string;
  queries: string;
  skipped: string;
  limit: string;
  degraded: string;
  nearLimit: string;
  noBudget: string;
  latencies: string;
  errors: string;
  noErrors: string;
  tickets: string;
  queues: string;
  toMeasure: string;
  yes: string;
  no: string;
}

const LABELS: Record<Language, Labels> = {
  fr: {
    title: 'Diagnostic',
    version: 'Version',
    generated: 'Généré le',
    tables: 'Tables',
    rows: 'lignes',
    budget: 'Budget de requêtes (invocation courante)',
    writes: 'écritures',
    reads: 'lectures',
    queries: 'requêtes',
    skipped: 'écritures sautées',
    limit: 'plafond',
    degraded: 'mode dégradé',
    nearLimit: 'proche du plafond',
    noBudget: 'pas de budget enregistré',
    latencies: 'Latences par étape',
    errors: 'Erreurs récentes',
    noErrors: 'aucune',
    tickets: 'Tickets traités',
    queues: 'Files en attente',
    toMeasure: 'à mesurer sur site',
    yes: 'oui',
    no: 'non',
  },
  en: {
    title: 'Diagnostic',
    version: 'Version',
    generated: 'Generated at',
    tables: 'Tables',
    rows: 'rows',
    budget: 'Request budget (current invocation)',
    writes: 'writes',
    reads: 'reads',
    queries: 'queries',
    skipped: 'skipped writes',
    limit: 'limit',
    degraded: 'degraded mode',
    nearLimit: 'near limit',
    noBudget: 'no budget recorded',
    latencies: 'Latencies by stage',
    errors: 'Recent errors',
    noErrors: 'none',
    tickets: 'Tickets processed',
    queues: 'Pending queues',
    toMeasure: 'to measure on site',
    yes: 'yes',
    no: 'no',
  },
};

/** La valeur d'une mesure, réelle ou honnêtement « à mesurer sur site ». */
function measureText(measurement: Measurement<unknown>, labels: Labels): string {
  if (measurement.source === 'measured' && measurement.value !== null && measurement.value !== undefined) {
    return String(measurement.value);
  }
  return labels.toMeasure;
}

/** Durée lisible sans dépendance à la locale (ms, s, min). */
function latencyText(ms: number | null, labels: Labels): string {
  if (ms === null) return labels.toMeasure;
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60_000) return (Math.round(ms / 100) / 10).toFixed(1) + ' s';
  return Math.round(ms / 1000) + ' s';
}

/** Lignes de la section des tables. */
function tableLines(report: DiagnosticReport, labels: Labels, bullet: string): string[] {
  return report.tables.map((table) => {
    const rows = table.rows === null ? labels.toMeasure : String(table.rows);
    return bullet + ' ' + table.name + ' — ' + rows + ' ' + labels.rows;
  });
}

/** Lignes de la section budgétaire. */
function budgetLines(budget: BudgetSnapshot | null, labels: Labels, bullet: string): string[] {
  if (budget === null) return [bullet + ' ' + labels.noBudget];
  const lines = [
    bullet + ' ' + labels.writes + ' — ' + budget.writes + ' / ' + budget.limit,
    bullet + ' ' + labels.reads + ' — ' + budget.reads,
    bullet + ' ' + labels.queries + ' — ' + budget.queries,
    bullet + ' ' + labels.skipped + ' — ' + budget.skippedWrites,
  ];
  if (budget.degraded) lines.push(bullet + ' ' + labels.degraded + ' — ' + labels.yes);
  if (budget.nearLimit && !budget.degraded) lines.push(bullet + ' ' + labels.nearLimit + ' — ' + labels.yes);
  return lines;
}

/** Lignes de la section des latences, label choisi selon la langue. */
function latencyLines(report: DiagnosticReport, labels: Labels, bullet: string, lang: Language): string[] {
  return report.latencies.map((stage) => {
    const value = measureText(stage.ms, labels);
    const duration = stage.ms.source === 'measured' && stage.ms.value !== null
      ? latencyText(stage.ms.value, labels)
      : value;
    const label = lang === 'fr' ? stage.labelFr : stage.labelEn;
    return bullet + ' ' + label + ' — ' + duration;
  });
}

/** Lignes de la section des erreurs récentes. */
function errorLines(report: DiagnosticReport, labels: Labels, bullet: string): string[] {
  if (report.recentErrors.length === 0) return [bullet + ' ' + labels.noErrors];
  return report.recentErrors.slice(-10).map((entry) => {
    const stamp = entry.at.slice(11, 19);
    return bullet + ' [' + stamp + '] ' + entry.kind + ' — ' + entry.message;
  });
}

/** Lignes de la section des files en attente. */
function queueLines(report: DiagnosticReport, labels: Labels, bullet: string, lang: Language): string[] {
  return report.queues.map((queue) => {
    const label = lang === 'fr' ? queue.labelFr : queue.labelEn;
    return bullet + ' ' + label + ' — ' + measureText(queue.pending, labels);
  });
}

/** Rendu lisible du rapport, pour une personne qui n'est pas développeuse. */
export function renderDiagnostic(report: DiagnosticReport, lang: Language = 'fr'): string {
  const labels = LABELS[lang];
  const bullet = '-';
  const lines: string[] = [];
  lines.push(labels.title + ' — Tickets piégés');
  lines.push('');
  lines.push(labels.version + ' — ' + report.appVersion);
  lines.push(labels.generated + ' — ' + report.generatedAt);
  lines.push('');
  lines.push('## ' + labels.tables + ' (' + report.summary.tablesReadable + '/'
    + report.summary.tablesListed + ' ' + labels.rows + ')');
  lines.push(...tableLines(report, labels, bullet));
  lines.push('');
  lines.push('## ' + labels.budget);
  lines.push(...budgetLines(report.budget, labels, bullet));
  lines.push('');
  lines.push('## ' + labels.latencies);
  lines.push(...latencyLines(report, labels, bullet, lang));
  lines.push('');
  lines.push('## ' + labels.errors);
  lines.push(...errorLines(report, labels, bullet));
  lines.push('');
  lines.push('## ' + labels.tickets);
  lines.push(bullet + ' ' + measureText(report.ticketsProcessed, labels));
  lines.push('');
  lines.push('## ' + labels.queues);
  lines.push(...queueLines(report, labels, bullet, lang));
  for (const caveat of report.caveats) {
    lines.push('');
    lines.push(bullet + ' ' + caveat);
  }
  return lines.join('\n');
}