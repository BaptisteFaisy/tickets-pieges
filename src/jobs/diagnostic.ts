/**
 * Webtrigger « diagnostic » (lot 10) — l'app se diagnostique elle-même.
 *
 * Ce fichier est du **glue mince** : il demande à la plateforme les faits
 * (tables, budget, journal) et rend la parole au domaine pur, qui assemble le
 * rapport (`src/core/diagnostic.ts`). Aucune décision ici.
 *
 * Le webtrigger est déclaré **une seule fois** dans `manifest.yml`
 * (`pieges-diagnostic`) : la plateforme n'accepte pas deux modules du même
 * type, et une page globale ne se duplique pas non plus.
 *
 * Le rapport ne contient **aucun texte de ticket** : que des volumes, des
 * durées, des noms de table et des genres d'incident. L'accès reste protégé
 * par le jeton du hook (§11), comme les autres webtriggers.
 */

import {
  bearerToken,
  headerValue,
  jsonResponse,
  queryParam,
  type WebTriggerRequest,
  type WebTriggerResponse,
} from '../platform/http';
import { TABLE } from '../platform/sql';
import type { EventRow, Store } from '../platform/schema';
import { verifyToken } from '../hook/token';
import type { BudgetReading } from '../platform/budget';
import type { Language } from '../core/types';
import {
  APP_VERSION,
  buildDiagnostic,
  renderDiagnostic,
  type BudgetSnapshot,
  type DiagnosticInput,
  type ErrorEntry,
  type PendingQueue,
  type StageLatency,
  type TableCount,
} from '../core/diagnostic';
import {
  assumed,
  INTERVAL_LABELS,
  measured,
  queueStats,
  TIMING_INTERVALS,
  type Measurement,
  type TimingInterval,
} from '../core/timing';
import { queueSamplesFromEvents } from './timing';

// ------------------------------------------------------------------ constantes

/** Genres du journal qui signent un incident, à coup sûr. */
const ERROR_KINDS: ReadonlySet<string> = new Set([
  'storage-budget-exceeded',
  'c3-enqueue-failed',
  'c3-message-illisible',
  'hook.auth.refused',
]);

/** Suffixes de genres du journal qui signent un incident. */
const ERROR_SUFFIXES: readonly string[] = ['-failed', '-refused', '-illisible', '-exceeded'];

/** Nombre d'entrées de journal lues pour le diagnostic (jamais un parcours infini). */
export const DIAGNOSTIC_EVENT_LIMIT = 2000;

/** Nombre d'erreurs listées dans le rapport. */
export const DIAGNOSTIC_ERROR_LIMIT = 10;

/** Libellés bilingues des intervalles mesurés (§18, `src/core/timing.ts`). */
const INTERVAL_TEXT: Record<TimingInterval, { fr: string; en: string }> = {
  origin: { fr: INTERVAL_LABELS.origin, en: 'origin written' },
  c1: { fr: INTERVAL_LABELS.c1, en: 'layer C1 (concealment)' },
  c2: { fr: INTERVAL_LABELS.c2, en: 'layer C2 (addressing an AI)' },
  mode: { fr: INTERVAL_LABELS.mode, en: 'mode applied — exposure window' },
  c3: { fr: INTERVAL_LABELS.c3, en: 'C3 verdict (async queue)' },
};

/** Les seize tables du modèle (§19), dans l'ordre du manifeste. */
const TABLE_NAMES: readonly string[] = Object.values(TABLE);

// --------------------------------------------------------------- faits bruts

/** Ce que la plateforme sait fournir — tout est injectable, donc testable. */
export interface DiagnosticDeps {
  now(): string;
  lang(request: WebTriggerRequest): Language;
  authorized(request: WebTriggerRequest): Promise<boolean>;
  listTables(): Promise<TableCount[]>;
  budget(): BudgetSnapshot | null;
  recentEvents(): Promise<EventRow[]>;
}

/** Les faits une fois réunis, avant assemblage. */
export interface DiagnosticFacts {
  generatedAt: string;
  lang: Language;
  tables: TableCount[];
  budget: BudgetSnapshot | null;
  events: EventRow[];
  caveats: string[];
}

// ------------------------------------------------------------------ fonctions pures

/** Ce genre d'événement signale-t-il un incident ? */
export function isErrorKind(kind: string): boolean {
  if (ERROR_KINDS.has(kind)) return true;
  return ERROR_SUFFIXES.some((suffix) => kind.endsWith(suffix));
}

/** Charge utile d'un événement, lue sans échouer si elle est illisible. */
export function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Message court d'un incident : seulement des valeurs scalaires, jamais de
 * texte de ticket (le journal est déjà assaini, on ne rajoute rien).
 */
export function errorMessage(payload: string): string {
  const parsed = parsePayload(payload);
  if (parsed === null) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(key + '=' + String(value).slice(0, 80));
    }
  }
  return parts.join(' ');
}

/** Les dernières erreurs du journal, les plus récentes en dernier. */
export function errorEntriesFromEvents(
  events: readonly EventRow[],
  limit: number = DIAGNOSTIC_ERROR_LIMIT,
): ErrorEntry[] {
  return events
    .filter((row) => isErrorKind(row.kind))
    .slice(-limit)
    .map((row) => ({ at: row.at, kind: row.kind, message: errorMessage(row.payload) }));
}

/** Segments mis en file C3, d'après le journal. */
export function queuedSegments(events: readonly EventRow[]): number {
  let total = 0;
  for (const row of events) {
    if (row.kind !== 'scan') continue;
    const queued = parsePayload(row.payload)?.queued;
    if (typeof queued === 'number' && Number.isFinite(queued)) total += queued;
  }
  return total;
}

/**
 * Segments encore en attente de verdict C3. C'est une **borne basse** : le
 * journal peut être incomplet, et rien n'est inventé quand il est muet.
 */
export function pendingFromEvents(events: readonly EventRow[]): Measurement<number> {
  const queued = queuedSegments(events);
  const done = events.filter((row) => row.kind === 'c3').length;
  if (queued === 0 && done === 0) return assumed('aucune mise en file journalisée');
  return measured(Math.max(0, queued - done), 'borne basse');
}

/**
 * Latences par étape. Le journal ne date pas la création d'un ticket : les
 * intervalles qui en dépendent restent donc « à mesurer sur site ». L'attente
 * dans la file C3, elle, est mesurée (p95 observé).
 */
export function latenciesFromEvents(events: readonly EventRow[]): StageLatency[] {
  const stats = queueStats(queueSamplesFromEvents(events));
  const stages: StageLatency[] = TIMING_INTERVALS.map((spec) => ({
    id: spec.name,
    labelFr: INTERVAL_TEXT[spec.name].fr,
    labelEn: INTERVAL_TEXT[spec.name].en,
    ms: assumed('à mesurer sur site'),
  }));
  stages.push({
    id: 'c3-wait',
    labelFr: 'attente dans la file C3',
    labelEn: 'wait in the C3 queue',
    ms: stats ? measured(stats.p95Ms, 'p95') : assumed('à mesurer sur site'),
  });
  return stages;
}

/** La file C3 : profondeur mesurée (borne basse) ou « à mesurer sur site ». */
export function pendingQueueFromEvents(events: readonly EventRow[]): PendingQueue {
  return {
    key: 'pieges-c3',
    labelFr: 'file C3 (verdict du modèle)',
    labelEn: 'C3 queue (model verdict)',
    pending: pendingFromEvents(events),
  };
}

/** Assemble les faits en entrées de rapport — pur, donc testable. */
export function toDiagnosticInput(facts: DiagnosticFacts): DiagnosticInput {
  const tickets = facts.tables.find((table) => table.name === TABLE.issueState);
  const processed: Measurement<number> =
    tickets && tickets.rows !== null
      ? measured(tickets.rows, 'issues avec un état')
      : assumed('état des tickets illisible');
  return {
    appVersion: APP_VERSION,
    generatedAt: facts.generatedAt,
    tables: facts.tables,
    budget: facts.budget,
    latencies: latenciesFromEvents(facts.events),
    recentErrors: errorEntriesFromEvents(facts.events),
    ticketsProcessed: processed,
    queues: [pendingQueueFromEvents(facts.events)],
    caveats: facts.caveats,
  };
}

// ------------------------------------------------------------------ assemblage

/** Réunit les faits de façon résiliente : un tiroir illisible n'arrête pas le reste. */
async function gatherFacts(
  request: WebTriggerRequest,
  deps: DiagnosticDeps,
): Promise<DiagnosticFacts> {
  const caveats: string[] = [];
  let tables: TableCount[] = [];
  let events: EventRow[] = [];
  try {
    tables = await deps.listTables();
  } catch {
    caveats.push('les tables sont illisibles : la liste est vide');
  }
  try {
    events = await deps.recentEvents();
  } catch {
    caveats.push('le journal est illisible : erreurs et latences absentes');
  }
  return {
    generatedAt: deps.now(),
    lang: deps.lang(request),
    tables,
    budget: deps.budget(),
    events,
    caveats,
  };
}

/** Le handler, injectable : assemble, rend, répond. */
export async function diagnosis(
  request: WebTriggerRequest,
  deps: DiagnosticDeps,
): Promise<WebTriggerResponse> {
  if (!(await deps.authorized(request))) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }
  const facts = await gatherFacts(request, deps);
  const report = buildDiagnostic(toDiagnosticInput(facts));
  return jsonResponse(200, {
    ok: true,
    generatedAt: facts.generatedAt,
    report,
    text: renderDiagnostic(report, facts.lang),
  });
}

// ------------------------------------------------------------------ plateforme

/** Compte les lignes d'une table ; null si la table est absente ou illisible. */
async function countRows(table: string): Promise<number | null> {
  try {
    const mod = await import('@forge/sql');
    const result = await mod.sql
      .prepare<{ n: number | string }>('SELECT COUNT(*) AS n FROM ' + table)
      .execute();
    const raw = result.rows[0]?.n;
    const count = typeof raw === 'string' ? Number(raw) : raw;
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/** Relevé du budget de l'invocation, adapté à la forme pure du domaine. */
function budgetSnapshot(reading: BudgetReading | null): BudgetSnapshot | null {
  if (reading === null) return null;
  return {
    writes: reading.writes,
    reads: reading.reads,
    queries: reading.queries,
    skippedWrites: reading.skippedWrites,
    limit: reading.limit,
    degraded: reading.degraded,
    nearLimit: reading.nearLimit,
    startedAt: reading.startedAt,
  };
}

/** Les dépendances de production (Forge), résolues à la demande. */
async function forgeDeps(): Promise<DiagnosticDeps> {
  const db = await import('../platform/db');
  await db.ensureSchema();
  const store: Store = db.createSqlStore();
  return {
    now: () => new Date().toISOString(),
    lang: (request) => (queryParam(request, 'lang') === 'en' ? 'en' : 'fr'),
    authorized: async (request) => {
      const accountId = headerValue(request, 'x-account-id') ?? queryParam(request, 'accountId');
      if (!accountId) return false;
      const row = await store.hookTokens.byAccount(accountId);
      return verifyToken(bearerToken(request), row).ok;
    },
    listTables: async () => {
      const tables: TableCount[] = [];
      for (const name of TABLE_NAMES) {
        tables.push({ name, rows: await countRows(name) });
      }
      return tables;
    },
    budget: () => budgetSnapshot(db.budgetReading()),
    recentEvents: () => store.events.list(null, DIAGNOSTIC_EVENT_LIMIT),
  };
}

/** Handler du manifeste (`index.diagnostic`) — un rapport dégradé, jamais de pile. */
export async function diagnostic(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  try {
    return await diagnosis(request, await forgeDeps());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const generatedAt = new Date().toISOString();
    return jsonResponse(200, {
      ok: false,
      generatedAt,
      error: 'diagnostic-indisponible',
      message,
      text: 'Diagnostic indisponible : la base est illisible. ' + message,
    });
  }
}
