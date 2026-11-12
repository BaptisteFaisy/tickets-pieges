/**
 * Mesures de terrain côté plateforme (#84, #85).
 *
 * Ce fichier reconstruit les étapes du pipeline à partir de ce que le journal
 * **prouve** : chaque entrée du journal est datée, et ce qui n'est pas daté
 * reste « à mesurer sur site » plutôt que d'être estimé.
 *
 * Granularité réelle du journal (`src/jobs/pipeline.ts`, `src/jobs/c3.ts`) :
 * - `scan` est écrit **après** l'application du mode : il borne par le haut la
 *   fin des couches lexicales (origine, C1, C2 non séparées) et par le bas
 *   l'instant où le mode est appliqué ;
 * - `label-applied`, `neutralized`, `state-published` datent le mode appliqué ;
 * - `c3` date le verdict du modèle conservé.
 * L'instant de **mise en file** C3 n'est pas journalisé : le délai de file
 * mesuré ici est donc une **borne basse** (à resserrer côté tronc).
 */

import {
  C3_OBJECTIVE_MS,
  buildTimingReport,
  checkObjective,
  emptyTrace,
  markStage,
  queueStats,
  renderReportMarkdown,
  TIMING_STAGES,
  type ObjectiveCheck,
  type QueueSample,
  type ReportScope,
  type ThroughputSample,
  type TimingReport,
  type TimingStage,
  type TimingTrace,
} from '../core/timing';
import type { Clock, EventRow, JiraPort, Store } from '../platform/schema';

/** Dépendances : les mêmes ports que le pipeline, aucun `@forge/*` en plus. */
export interface TimingDeps {
  store: Store;
  jira: JiraPort;
  clock: Clock;
}

/**
 * Ce que chaque entrée du journal permet de dater. `scan` est écrit après
 * l'application du mode : il **borne par le haut** la fin des couches lexicales
 * et le mode appliqué, sans les séparer. Un `kind` peut borner plusieurs étapes.
 */
export const EVENT_STAGES: readonly { kind: string; stage: TimingStage }[] = [
  { kind: 'scan', stage: 'c2' },
  { kind: 'scan', stage: 'mode-applied' },
  { kind: 'label-applied', stage: 'mode-applied' },
  { kind: 'neutralized', stage: 'mode-applied' },
  { kind: 'state-published', stage: 'mode-applied' },
  { kind: 'c3', stage: 'c3' },
];

/** Borne du nombre d'entrées de journal lues par mesure (jamais un parcours infini). */
export const DEFAULT_EVENT_LIMIT = 5000;

/** Granularité par défaut du débit : une minute. */
export const DEFAULT_BUCKET_MS = 60_000;

export interface TimingOptions {
  /** Échantillon de tickets à tracer ; sans clé, aucune trace n'est inventée. */
  issueKeys?: readonly string[];
  eventLimit?: number;
  bucketMs?: number;
  scope?: ReportScope;
  /** Objectifs supplémentaires, exprimés en ms ; aucun objectif n'est inventé ici. */
  objectives?: readonly { id: string; label: string; objectiveMs: number }[];
}

/** Instant d'une entrée de journal, ou null si la date est illisible. */
export function eventAtMs(row: EventRow): number | null {
  const ms = Date.parse(row.at);
  return Number.isFinite(ms) ? ms : null;
}

/** Étapes datables par une entrée de journal. */
export function stagesOfEvent(row: EventRow): TimingStage[] {
  return EVENT_STAGES.filter((entry) => entry.kind === row.kind).map((entry) => entry.stage);
}

/**
 * Reconstruit une trace : pour chaque étape, le **premier** instant que le
 * journal prouve (la borne la plus serrée), puis ordre et monotonicité garantis
 * par `markStage`.
 */
export function traceFromEvents(
  issueKey: string,
  createdAt: string | null,
  events: readonly EventRow[],
): TimingTrace {
  const earliest = new Map<TimingStage, number>();
  const created = createdAt === null ? null : Date.parse(createdAt);
  if (created !== null && Number.isFinite(created)) earliest.set('created', created);
  for (const row of events) {
    const at = eventAtMs(row);
    if (at === null) continue;
    for (const stage of stagesOfEvent(row)) {
      const known = earliest.get(stage);
      if (known === undefined || at < known) earliest.set(stage, at);
    }
  }
  let trace = emptyTrace(issueKey);
  for (const stage of TIMING_STAGES) {
    const at = earliest.get(stage);
    if (at !== undefined) trace = markStage(trace, stage, at);
  }
  return trace;
}

/** Trace d'un ticket : date de création côté Jira, étapes côté journal. */
export async function traceForIssue(
  deps: TimingDeps,
  issueKey: string,
  eventLimit: number = DEFAULT_EVENT_LIMIT,
): Promise<TimingTrace> {
  const issue = await deps.jira.getIssue(issueKey);
  const events = await deps.store.events.list(issue.id, eventLimit);
  return traceFromEvents(issue.key, issue.createdAt, events);
}

/**
 * Échantillons de file C3 : pour chaque verdict `c3`, l'événement `scan` qui le
 * précède sur le même ticket sert d'instant de mise en file (borne basse, voir
 * l'en-tête du fichier).
 */
export function queueSamplesFromEvents(events: readonly EventRow[]): QueueSample[] {
  const scans: number[] = [];
  const samples: QueueSample[] = [];
  for (const row of events) {
    const at = eventAtMs(row);
    if (at === null) continue;
    if (row.kind === 'scan') {
      scans.push(at);
      continue;
    }
    if (row.kind !== 'c3' || scans.length === 0) continue;
    samples.push({ enqueuedAtMs: scans[scans.length - 1] as number, dequeuedAtMs: at });
  }
  return samples;
}

/** Débit : nombre d'analyses (`scan`) par tranche de `bucketMs`. */
export function throughputFromEvents(
  events: readonly EventRow[],
  bucketMs: number = DEFAULT_BUCKET_MS,
): ThroughputSample[] {
  const buckets = new Map<number, number>();
  for (const row of events) {
    if (row.kind !== 'scan') continue;
    const at = eventAtMs(row);
    if (at === null) continue;
    const start = Math.floor(at / bucketMs) * bucketMs;
    buckets.set(start, (buckets.get(start) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, tickets]) => ({ atMs, tickets }));
}

/** Objectifs : celui de la file C3 (30 s) plus ceux passés par l'appelant. */
export function objectivesFor(
  queue: ReturnType<typeof queueStats>,
  extra: TimingOptions['objectives'] = [],
): ObjectiveCheck[] {
  const checks: ObjectiveCheck[] = [];
  if (queue) {
    checks.push(checkObjective('c3-p95', 'file C3 — p95', queue.p95Ms, C3_OBJECTIVE_MS));
    checks.push(checkObjective('c3-max', 'file C3 — pire attente', queue.maxMs, C3_OBJECTIVE_MS));
  } else {
    checks.push(checkObjective('c3-p95', 'file C3 — p95', null, C3_OBJECTIVE_MS));
  }
  for (const objective of extra) {
    checks.push(checkObjective(objective.id, objective.label, null, objective.objectiveMs));
  }
  return checks;
}

export interface SiteTiming {
  report: TimingReport;
  markdown: string;
  samples: { traces: number; queue: number; throughput: number; events: number };
}

/** Mesure complète : journal global, traces d'un échantillon de tickets, objectifs. */
export async function measureSite(
  deps: TimingDeps,
  options: TimingOptions = {},
): Promise<SiteTiming> {
  const eventLimit = options.eventLimit ?? DEFAULT_EVENT_LIMIT;
  const bucketMs = options.bucketMs ?? DEFAULT_BUCKET_MS;
  const events = await deps.store.events.list(null, eventLimit);
  const traces: TimingTrace[] = [];
  for (const issueKey of options.issueKeys ?? []) {
    traces.push(await traceForIssue(deps, issueKey, eventLimit));
  }
  const queueSamples = queueSamplesFromEvents(events);
  const throughputSamples = throughputFromEvents(events, bucketMs);
  const queue = queueStats(queueSamples);
  const report = buildTimingReport({
    scope: options.scope ?? 'site',
    traces,
    objectives: objectivesFor(queue, options.objectives),
    queueSamples,
    throughputSamples,
    caveats: [
      'Le journal ne sépare pas origine, C1 et C2 : `scan` borne la fin de l’analyse lexicale.',
      'L’instant de mise en file C3 n’est pas journalisé : le délai de file est une borne basse.',
    ],
  });
  return {
    report,
    markdown: renderReportMarkdown(report),
    samples: {
      traces: traces.length,
      queue: queueSamples.length,
      throughput: throughputSamples.length,
      events: events.length,
    },
  };
}

/** Charge utile rendue au probe : chiffres et libellés, jamais de texte de ticket. */
export function timingPayload(site: SiteTiming, generatedAt: string): Record<string, unknown> {
  return {
    ok: true,
    generatedAt,
    samples: site.samples,
    report: site.report,
    markdown: site.markdown,
  };
}
