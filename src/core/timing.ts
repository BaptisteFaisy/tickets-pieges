/**
 * Mesures de terrain (#84, #85) — domaine pur.
 *
 * Contraintes : aucune E/S, aucune lecture d'horloge (l'instant est toujours
 * un paramètre), durées bornées et monotones, dépassement d'objectif signalé
 * et jamais masqué, et séparation nette entre ce qui est mesuré et ce qui
 * reste « à mesurer sur site ».
 */

/**
 * Étapes instrumentées, dans l'ordre **réel** du pipeline : origine et couches
 * lexicales, puis application du mode (geste synchrone de l'analyse), puis
 * verdict de la couche C3 (asynchrone, hors du chemin de l'événement).
 */
export const TIMING_STAGES = [
  'created',
  'origin',
  'c1',
  'c2',
  'mode-applied',
  'c3',
] as const;

export type TimingStage = (typeof TIMING_STAGES)[number];

/** Objectif de délai de la file C3 : 30 s entre l'entrée en file et la reprise. */
export const C3_OBJECTIVE_MS = 30_000;

/** Borne haute d'une durée (24 h) : au-delà, la mesure n'est plus fiable. */
export const MAX_DURATION_MS = 86_400_000;

export interface StageMark {
  stage: TimingStage;
  atMs: number;
}

export interface TimingTrace {
  issueKey: string;
  marks: StageMark[];
}

export type TimingInterval = 'origin' | 'c1' | 'c2' | 'c3' | 'mode';

export interface IntervalSpec {
  name: TimingInterval;
  from: TimingStage;
  to: TimingStage;
}

/** Intervalles mesurés : de la création du ticket à chaque étape, dans l'ordre des étapes. */
export const TIMING_INTERVALS: readonly IntervalSpec[] = [
  { name: 'origin', from: 'created', to: 'origin' },
  { name: 'c1', from: 'created', to: 'c1' },
  { name: 'c2', from: 'created', to: 'c2' },
  { name: 'mode', from: 'created', to: 'mode-applied' },
  { name: 'c3', from: 'created', to: 'c3' },
];

export function emptyTrace(issueKey: string): TimingTrace {
  return { issueKey, marks: [] };
}

/**
 * Ajoute une marque d'étape. L'horodatage est rendu monotone : une étape
 * marquée avant une étape déjà enregistrée est ramenée au niveau de la
 * dernière, pour qu'aucune durée ne devienne négative.
 */
export function markStage(trace: TimingTrace, stage: TimingStage, atMs: number): TimingTrace {
  const previous = trace.marks.reduce(
    (max, mark) => Math.max(max, mark.atMs),
    Number.NEGATIVE_INFINITY,
  );
  const fallback = previous === Number.NEGATIVE_INFINITY ? 0 : previous;
  const raw = Number.isFinite(atMs) ? atMs : fallback;
  const monotonic = previous === Number.NEGATIVE_INFINITY ? raw : Math.max(raw, previous);
  const marks = trace.marks.filter((mark) => mark.stage !== stage);
  marks.push({ stage, atMs: monotonic });
  marks.sort((a, b) => TIMING_STAGES.indexOf(a.stage) - TIMING_STAGES.indexOf(b.stage));
  return { issueKey: trace.issueKey, marks };
}

/** Durée entre deux étapes, ou null si l'une des deux n'a pas été observée. */
export function durationMs(
  trace: TimingTrace,
  from: TimingStage,
  to: TimingStage,
): number | null {
  const start = trace.marks.find((mark) => mark.stage === from);
  const end = trace.marks.find((mark) => mark.stage === to);
  if (!start || !end) return null;
  const raw = end.atMs - start.atMs;
  if (!Number.isFinite(raw)) return null;
  return Math.min(Math.max(raw, 0), MAX_DURATION_MS);
}

/** Durées de tous les intervalles connus pour une trace. */
export function intervalsOf(trace: TimingTrace): Record<TimingInterval, number | null> {
  const out = {} as Record<TimingInterval, number | null>;
  for (const spec of TIMING_INTERVALS) {
    out[spec.name] = durationMs(trace, spec.from, spec.to);
  }
  return out;
}

/**
 * Fenêtre d'exposition : délai entre la création du ticket et l'application
 * du mode. Pendant ce temps, le texte est vivant dans Jira.
 */
export function exposureWindowMs(trace: TimingTrace): number | null {
  return intervalsOf(trace).mode;
}

export type ObjectiveStatus = 'ok' | 'late' | 'unknown';

export interface ObjectiveCheck {
  id: string;
  label: string;
  observedMs: number | null;
  objectiveMs: number;
  status: ObjectiveStatus;
  overshootMs: number;
}

/** Compare une durée observée à un objectif ; l'absence de mesure reste « inconnu ». */
export function checkObjective(
  id: string,
  label: string,
  observedMs: number | null,
  objectiveMs: number,
): ObjectiveCheck {
  if (observedMs === null || !Number.isFinite(observedMs)) {
    return { id, label, observedMs: null, objectiveMs, status: 'unknown', overshootMs: 0 };
  }
  const bounded = Math.min(Math.max(observedMs, 0), MAX_DURATION_MS);
  const overshoot = bounded - objectiveMs;
  return {
    id,
    label,
    observedMs: bounded,
    objectiveMs,
    status: overshoot > 0 ? 'late' : 'ok',
    overshootMs: overshoot > 0 ? overshoot : 0,
  };
}

export interface ObjectiveSummary {
  total: number;
  ok: number;
  late: number;
  unknown: number;
  worstOvershootMs: number;
  lateIds: string[];
}

export function summarizeObjectives(checks: readonly ObjectiveCheck[]): ObjectiveSummary {
  let ok = 0;
  let late = 0;
  let unknown = 0;
  let worstOvershootMs = 0;
  const lateIds: string[] = [];
  for (const check of checks) {
    if (check.status === 'ok') ok += 1;
    else if (check.status === 'late') late += 1;
    else unknown += 1;
    if (check.overshootMs > worstOvershootMs) worstOvershootMs = check.overshootMs;
    if (check.status === 'late') lateIds.push(check.id);
  }
  return { total: checks.length, ok, late, unknown, worstOvershootMs, lateIds };
}

export interface ThroughputSample {
  atMs: number;
  tickets: number;
}

export interface Throughput {
  total: number;
  windowMs: number;
  perMinute: number;
  perHour: number;
}

/** Débit observé sur une fenêtre de mesures (5 000 tickets sur le site). */
export function throughput(samples: readonly ThroughputSample[]): Throughput | null {
  if (samples.length === 0) return null;
  const times = samples.map((sample) => sample.atMs).filter((value) => Number.isFinite(value));
  if (times.length < 2) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  const windowMs = last - first;
  if (windowMs <= 0) return null;
  const total = samples.reduce((sum, sample) => sum + Math.max(0, sample.tickets), 0);
  const perMinute = (total / windowMs) * 60_000;
  return {
    total,
    windowMs,
    perMinute: Math.round(perMinute * 100) / 100,
    perHour: Math.round(perMinute * 60 * 100) / 100,
  };
}

export interface QueueSample {
  enqueuedAtMs: number;
  dequeuedAtMs: number;
}

export interface QueueStats {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  objectiveMs: number;
  overObjective: number;
}

/** Attente dans la file : null si l'échantillon n'est pas exploitable. */
export function queueWaitMs(sample: QueueSample): number | null {
  const raw = sample.dequeuedAtMs - sample.enqueuedAtMs;
  if (!Number.isFinite(raw)) return null;
  return Math.min(Math.max(raw, 0), MAX_DURATION_MS);
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const ratio = Math.min(Math.max(p, 0), 100) / 100;
  const index = Math.ceil(ratio * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] as number;
}

/** Statistiques de charge de la file C3 face à l'objectif de 30 s. */
export function queueStats(
  samples: readonly QueueSample[],
  objectiveMs: number = C3_OBJECTIVE_MS,
): QueueStats | null {
  const waits = samples
    .map((sample) => queueWaitMs(sample))
    .filter((value): value is number => value !== null);
  if (waits.length === 0) return null;
  const sorted = [...waits].sort((a, b) => a - b);
  const total = waits.reduce((sum, value) => sum + value, 0);
  const overObjective = waits.filter((value) => value > objectiveMs).length;
  return {
    count: waits.length,
    minMs: sorted[0] as number,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1] as number,
    meanMs: Math.round((total / waits.length) * 100) / 100,
    objectiveMs,
    overObjective,
  };
}

export type MeasurementSource = 'measured' | 'assumed';

export interface Measurement<T> {
  value: T | null;
  source: MeasurementSource;
  note: string;
}

/** Une valeur réellement observée sur le site. */
export function measured<T>(value: T, note = ''): Measurement<T> {
  return { value, source: 'measured', note };
}

/** Une valeur absente : « à mesurer sur site », jamais un chiffre inventé. */
export function assumed<T>(note: string): Measurement<T> {
  return { value: null, source: 'assumed', note };
}

/** Bascule une mesure en « supposé » (hors site, ou mesure non observée). */
export function demote<T>(measurement: Measurement<T>, note: string): Measurement<T> {
  if (measurement.source === 'assumed') return measurement;
  return { value: null, source: 'assumed', note: note || measurement.note };
}

export type ReportScope = 'site' | 'offline';

export interface TimingReport {
  scope: ReportScope;
  sampleSize: number;
  intervals: Record<TimingInterval, Measurement<number | null>>;
  objectives: ObjectiveCheck[];
  objectiveSummary: ObjectiveSummary;
  queue: Measurement<QueueStats | null>;
  throughput: Measurement<Throughput | null>;
  caveats: string[];
}

export interface TimingReportInput {
  scope: ReportScope;
  traces: readonly TimingTrace[];
  objectives?: readonly ObjectiveCheck[];
  queueSamples?: readonly QueueSample[];
  throughputSamples?: readonly ThroughputSample[];
  caveats?: readonly string[];
}

/**
 * Assemble le rapport de mesures. Hors site, toute valeur non observée est
 * marquée « à mesurer sur site » : le rapport ne présente jamais de chiffre
 * supposé comme s'il était mesuré.
 */
export function buildTimingReport(input: TimingReportInput): TimingReport {
  const offline = input.scope !== 'site';
  const traces = input.traces;
  const intervals = {} as Record<TimingInterval, Measurement<number | null>>;
  for (const spec of TIMING_INTERVALS) {
    const values = traces
      .map((trace) => durationMs(trace, spec.from, spec.to))
      .filter((value): value is number => value !== null);
    const worst = values.length > 0 ? Math.max(...values) : null;
    intervals[spec.name] = offline
      ? assumed('à mesurer sur site')
      : worst === null
        ? assumed('à mesurer sur site')
        : measured(worst, 'pire durée observée sur ' + String(values.length) + ' ticket(s)');
  }
  const objectives = [...(input.objectives ?? [])];
  const queue = queueStats(input.queueSamples ?? []);
  const flow = throughput(input.throughputSamples ?? []);
  const caveats = [...(input.caveats ?? [])];
  if (offline) caveats.push('Hors site : les chiffres seront relevés sur l’instance installée.');
  return {
    scope: input.scope,
    sampleSize: traces.length,
    intervals,
    objectives,
    objectiveSummary: summarizeObjectives(objectives),
    queue: offline ? assumed('à mesurer sur site') : queue ? measured(queue) : assumed('à mesurer sur site'),
    throughput: offline ? assumed('à mesurer sur site') : flow ? measured(flow) : assumed('à mesurer sur site'),
    caveats,
  };
}

/** Durée lisible : « 350 ms », « 12.4 s », « 2 min 05 s ». */
export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'à mesurer sur site';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60_000) return (Math.round(ms / 100) / 10).toFixed(1) + ' s';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes + ' min ' + String(seconds).padStart(2, '0') + ' s';
}

/** Ligne markdown d'une mesure, avec sa source (mesuré / à mesurer sur site). */
export function renderMeasurementRow(label: string, measurement: Measurement<unknown>): string {
  const value =
    measurement.source === 'measured' && measurement.value !== null
      ? String(measurement.value)
      : 'à mesurer sur site';
  return '| ' + label + ' | ' + value + ' | ' + measurement.source + ' |';
}

/** Lignes du tableau pour la file C3 : chiffres uniquement, jamais de texte. */
function queueRows(report: TimingReport): string[] {
  const stats = report.queue.value;
  if (report.queue.source !== 'measured' || !stats) {
    return ['| file C3 | à mesurer sur site | assumed |'];
  }
  return [
    '| file C3 — échantillons | ' + String(stats.count) + ' | measured |',
    '| file C3 — médiane | ' + formatMs(stats.p50Ms) + ' | measured |',
    '| file C3 — p95 | ' + formatMs(stats.p95Ms) + ' | measured |',
    '| file C3 — pire attente | ' + formatMs(stats.maxMs) + ' | measured |',
    '| file C3 — dépassements de l’objectif | ' + String(stats.overObjective) + ' | measured |',
  ];
}

/** Lignes du tableau pour le débit (#84). */
function throughputRows(report: TimingReport): string[] {
  const flow = report.throughput.value;
  if (report.throughput.source !== 'measured' || !flow) {
    return ['| débit | à mesurer sur site | assumed |'];
  }
  return [
    '| débit — tickets | ' + String(flow.total) + ' | measured |',
    '| débit — par minute | ' + String(flow.perMinute) + ' | measured |',
    '| débit — fenêtre | ' + formatMs(flow.windowMs) + ' | measured |',
  ];
}

/** Tableau markdown du rapport, prêt à être versé dans docs/MESURES.md. */
export function renderReportMarkdown(report: TimingReport): string {
  const lines: string[] = [];
  lines.push('| Mesure | Valeur | Source |');
  lines.push('| --- | --- | --- |');
  for (const spec of TIMING_INTERVALS) {
    const measurement = report.intervals[spec.name];
    const value =
      measurement.source === 'measured' && measurement.value !== null
        ? formatMs(measurement.value)
        : 'à mesurer sur site';
    lines.push('| ' + spec.name + ' | ' + value + ' | ' + measurement.source + ' |');
  }
  lines.push(...queueRows(report), ...throughputRows(report));
  for (const check of report.objectives) {
    lines.push(
      '| objectif ' + check.id + ' | ' + formatMs(check.observedMs) + ' | ' + check.status + ' |',
    );
  }
  return lines.join('\n');
}
