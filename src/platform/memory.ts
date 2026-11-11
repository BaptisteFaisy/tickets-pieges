/**
 * `Store` en mémoire — double de test et moteur du banc d'essai (§17.7).
 *
 * Aucune dépendance à Forge : les tests unitaires, `tools/replay.mjs` et le jeu
 * d'essai l'utilisent. La production passe par `src/platform/db.ts` (Forge SQL),
 * qui respecte exactement le même contrat (`src/platform/schema.ts`).
 *
 * Chaque tiroir du `Store` a sa fabrique : aucune fonction ne dépasse la limite
 * de taille du dépôt, et l'on voit d'un coup d'œil ce que chaque table sait faire.
 */

import { SUSPICION_RANK, type FindingStatus, type ProjectSettings, type SuspicionLevel } from '../core/types';
import type {
  CampaignRepo,
  CampaignRow,
  CanaryHitRow,
  CanaryRepo,
  CanaryRow,
  DraftRepo,
  DraftRow,
  EventRepo,
  EventRow,
  FindingRepo,
  FindingRow,
  HookTokenRepo,
  HookTokenRow,
  IssueStateRow,
  OriginalRepo,
  OriginalRow,
  OutboundCheckRow,
  OutboundRepo,
  PatternRepo,
  PatternRow,
  SegmentRepo,
  SegmentRow,
  SessionRepo,
  SettingsRepo,
  StateRepo,
  Store,
  TaintedSessionRow,
  TrustRepo,
  TrustRuleRow,
  VerdictRepo,
  VerdictRow,
} from './schema';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Table générique : une Map + les gestes dont tous les tiroirs ont besoin. */
class Table<K, V> {
  private rows = new Map<K, V>();

  put(key: K, row: V): void {
    this.rows.set(key, clone(row));
  }

  get(key: K): V | null {
    const row = this.rows.get(key);
    return row === undefined ? null : clone(row);
  }

  all(): V[] {
    return [...this.rows.values()].map(clone);
  }

  where(predicate: (row: V) => boolean): V[] {
    return this.all().filter(predicate);
  }

  patch(key: K, patch: (row: V) => V): void {
    const row = this.rows.get(key);
    if (row !== undefined) {
      this.rows.set(key, clone(patch(clone(row))));
    }
  }

  remove(key: K): void {
    this.rows.delete(key);
  }

  size(): number {
    return this.rows.size;
  }
}

export interface MemoryStore extends Store {
  /** Nombre de lignes écrites : les tests vérifient l'absence de fuite. */
  counts(): Record<string, number>;
}

function segmentsRepo(table: Table<string, SegmentRow>): SegmentRepo {
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async byIssue(issueId) {
      return table.where((r) => r.issueId === issueId);
    },
    async byId(id) {
      return table.get(id);
    },
    async byHash(contentHash) {
      return table.where((r) => r.contentHash === contentHash);
    },
  };
}

function statesRepo(table: Table<string, IssueStateRow>): StateRepo {
  return {
    async put(row) {
      table.put(row.issueId, row);
    },
    async get(issueId) {
      return table.get(issueId);
    },
    async bySuspicion(min: SuspicionLevel, limit: number) {
      const threshold = SUSPICION_RANK[min];
      return table
        .where((r) => SUSPICION_RANK[r.suspicionLevel] >= threshold)
        .sort((a, b) => SUSPICION_RANK[b.suspicionLevel] - SUSPICION_RANK[a.suspicionLevel])
        .slice(0, limit);
    },
  };
}

function findingsRepo(table: Table<string, FindingRow>): FindingRepo {
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async byIssue(issueId) {
      return table.where((r) => r.issueId === issueId);
    },
    async byId(id) {
      return table.get(id);
    },
    async bySegment(segmentId) {
      return table.where((r) => r.segmentId === segmentId);
    },
    async setStatus(id: string, status: FindingStatus) {
      table.patch(id, (row) => ({ ...row, status }));
    },
    async since(from) {
      return table.where((r) => r.createdAt >= from);
    },
  };
}

function verdictsRepo(table: Table<string, VerdictRow>): VerdictRepo {
  let seq = 0;
  return {
    async put(row) {
      seq += 1;
      table.put(`${row.findingId}#${seq}`, row);
    },
    async byFinding(findingId) {
      return table.where((r) => r.findingId === findingId);
    },
    async since(from) {
      return table.where((r) => r.at >= from);
    },
  };
}

function originalsRepo(
  table: Table<string, OriginalRow>,
  findings: Table<string, FindingRow>,
): OriginalRepo {
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async bySegment(segmentId) {
      return table.where((r) => r.segmentId === segmentId && r.restoredAt === null)[0] ?? null;
    },
    async byId(id) {
      return table.get(id);
    },
    async pending() {
      return table.where((r) => r.restoredAt === null);
    },
    async markRestored(id: string, at: string) {
      const row = table.get(id);
      table.patch(id, (current) => ({ ...current, restoredAt: at }));
      for (const findingId of row?.findingIds ?? []) {
        findings.patch(findingId, (f) => ({ ...f, status: 'restored' }));
      }
    },
  };
}

function outboundRepo(table: Table<string, OutboundCheckRow>): OutboundRepo {
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async byIssue(issueId) {
      return table.where((r) => r.issueId === issueId);
    },
    async since(from) {
      return table.where((r) => r.at >= from);
    },
  };
}

function sessionsRepo(table: Table<string, TaintedSessionRow>): SessionRepo {
  return {
    async taint(row) {
      table.put(row.sessionRef, row);
    },
    async isTainted(sessionRef) {
      return table.get(sessionRef) !== null;
    },
    async list(accountId) {
      return table.where((r) => r.accountId === accountId);
    },
    async clear(sessionRef) {
      table.remove(sessionRef);
    },
  };
}

function canariesRepo(
  table: Table<string, CanaryRow>,
  hits: Table<string, CanaryHitRow>,
): CanaryRepo {
  let seq = 0;
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async get(id) {
      return table.get(id);
    },
    async open() {
      return table.where((r) => r.closedAt === null);
    },
    async close(id: string, at: string) {
      table.patch(id, (row) => ({ ...row, closedAt: at }));
    },
    async addHit(row) {
      seq += 1;
      hits.put(row.id || `hit-${seq}`, row);
    },
    async hits(canaryId) {
      return hits.where((r) => r.canaryId === canaryId);
    },
    async allHits() {
      return hits.all();
    },
  };
}

function trustRepo(table: Table<string, TrustRuleRow>): TrustRepo {
  return {
    async list(projectKey) {
      return table.where((r) => r.projectKey === projectKey);
    },
    async put(row) {
      table.put(row.id, row);
    },
    async remove(id) {
      table.remove(id);
    },
  };
}

function patternsRepo(table: Table<string, PatternRow>): PatternRepo {
  return {
    async list() {
      return table.all();
    },
    async put(row) {
      table.put(row.id, row);
    },
    async setPrecision(id: string, precision: number, demoted: boolean) {
      table.patch(id, (row) => ({ ...row, precision, demoted }));
    },
  };
}

function campaignsRepo(table: Table<string, CampaignRow>): CampaignRepo {
  return {
    async bump(payloadHash: string, issueKey: string, at: string) {
      const existing = table.get(payloadHash);
      const row: CampaignRow = existing
        ? {
            ...existing,
            lastSeen: at,
            count: existing.count + 1,
            issueKeys: existing.issueKeys.includes(issueKey)
              ? existing.issueKeys
              : [...existing.issueKeys, issueKey],
          }
        : { id: payloadHash, payloadHash, firstSeen: at, lastSeen: at, count: 1, issueKeys: [issueKey] };
      table.put(payloadHash, row);
      return clone(row);
    },
    async list() {
      return table.all();
    },
    async byHash(payloadHash) {
      return table.get(payloadHash);
    },
  };
}

function eventsRepo(rows: EventRow[]): EventRepo {
  return {
    async append(kind: string, issueId: string | null, payload: unknown) {
      rows.push({
        seq: rows.length + 1,
        at: new Date().toISOString(),
        kind,
        issueId,
        payload: JSON.stringify(payload),
      });
    },
    async list(issueId: string | null, limit: number) {
      const selected = issueId === null ? rows : rows.filter((row) => row.issueId === issueId);
      return clone(selected.slice(-limit));
    },
  };
}

function hookTokensRepo(table: Table<string, HookTokenRow>): HookTokenRepo {
  return {
    async put(row) {
      table.put(row.accountId, row);
    },
    async byAccount(accountId) {
      return table.get(accountId);
    },
    async touch(accountId: string, at: string) {
      table.patch(accountId, (row) => ({ ...row, lastUsedAt: at }));
    },
  };
}

function draftsRepo(table: Table<string, DraftRow>): DraftRepo {
  return {
    async put(row) {
      table.put(row.id, row);
    },
    async byIssue(issueId) {
      return table.where((r) => r.issueId === issueId);
    },
    async byId(id) {
      return table.get(id);
    },
    async markPublished(id: string, at: string) {
      table.patch(id, (row) => ({ ...row, publishedAt: at }));
    },
  };
}

function settingsRepo(table: Table<string, ProjectSettings>): SettingsRepo {
  return {
    async get(projectKey) {
      return table.get(projectKey);
    },
    async put(row) {
      table.put(row.projectKey, row);
    },
  };
}

/** Crée un `Store` complet en mémoire, et son compteur d'écritures. */
export function createMemoryStore(): MemoryStore {
  const segments = new Table<string, SegmentRow>();
  const states = new Table<string, IssueStateRow>();
  const findings = new Table<string, FindingRow>();
  const verdicts = new Table<string, VerdictRow>();
  const originals = new Table<string, OriginalRow>();
  const outbound = new Table<string, OutboundCheckRow>();
  const sessions = new Table<string, TaintedSessionRow>();
  const canaries = new Table<string, CanaryRow>();
  const canaryHits = new Table<string, CanaryHitRow>();
  const trust = new Table<string, TrustRuleRow>();
  const patterns = new Table<string, PatternRow>();
  const campaigns = new Table<string, CampaignRow>();
  const hookTokens = new Table<string, HookTokenRow>();
  const drafts = new Table<string, DraftRow>();
  const settings = new Table<string, ProjectSettings>();
  const events: EventRow[] = [];

  return {
    segments: segmentsRepo(segments),
    states: statesRepo(states),
    findings: findingsRepo(findings),
    verdicts: verdictsRepo(verdicts),
    originals: originalsRepo(originals, findings),
    outbound: outboundRepo(outbound),
    sessions: sessionsRepo(sessions),
    canaries: canariesRepo(canaries, canaryHits),
    trust: trustRepo(trust),
    patterns: patternsRepo(patterns),
    campaigns: campaignsRepo(campaigns),
    events: eventsRepo(events),
    hookTokens: hookTokensRepo(hookTokens),
    drafts: draftsRepo(drafts),
    settings: settingsRepo(settings),
    counts: () => ({
      segments: segments.size(),
      states: states.size(),
      findings: findings.size(),
      verdicts: verdicts.size(),
      originals: originals.size(),
      outbound: outbound.size(),
      sessions: sessions.size(),
      canaries: canaries.size(),
      drafts: drafts.size(),
      events: events.length,
    }),
  };
}

/** Horloge fixe : les tests et le banc d'essai veulent des dates stables. */
export function fixedClock(iso: string): { now(): string } {
  return { now: () => iso };
}
