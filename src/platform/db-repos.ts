/**
 * Tiroirs du `Store` sur Forge SQL — première moitié (découpe de `db.ts`).
 *
 * Aucune importation de `@forge/sql` ici : les dépôts reçoivent un
 * `SqlExecutor` (`src/platform/sql.ts`) et construisent des requêtes à
 * paramètres liés. La sémantique est celle de `src/platform/memory.ts` :
 * mêmes tris, mêmes filtres, mêmes effets de bord.
 *
 * Les colonnes JSON (§`FORGE.md` : `TEXT` lu en chaîne) sont sérialisées à
 * l'écriture et reparées à la lecture — jamais de typage automatique.
 */

import { SUSPICION_RANK, type FindingStatus, type SuspicionLevel } from '../core/types';
import type {
  CanaryHitRow,
  CanaryRepo,
  CanaryRow,
  FindingRepo,
  FindingRow,
  IssueStateRow,
  OriginalRepo,
  OriginalRow,
  OutboundCheckRow,
  OutboundRepo,
  SegmentRepo,
  SegmentRow,
  SessionRepo,
  StateRepo,
  TaintedSessionRow,
  VerdictRepo,
  VerdictRow,
} from './schema';
import {
  inlineLimit,
  insertQuery,
  selectQuery,
  SUSPICION_ORDER,
  TABLE,
  updateQuery,
  upsertQuery,
  deleteQuery,
  type SqlExecutor,
  type SqlQuery,
} from './sql';

// ------------------------------------------------------------- encodage colonnes

type Db = Record<string, unknown>;

export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function nullStr(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

export function jsonList(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function selectOne(exec: SqlExecutor, q: SqlQuery): Promise<Db | null> {
  const rows = await exec.rows<Db>(q);
  return rows[0] ?? null;
}

// ------------------------------------------------------------------- segments

function encodeSegment(row: SegmentRow): Db {
  return {
    id: row.id,
    issue_id: row.issueId,
    field: row.field,
    ref_id: row.refId,
    author_account_id: row.authorAccountId,
    account_type: row.accountType,
    org_id: row.orgId,
    channel: row.channel,
    visibility: row.visibility,
    trust_level: row.trustLevel,
    content_hash: row.contentHash,
    text: row.text,
    scanned_at: row.scannedAt,
  };
}

function decodeSegment(r: Db): SegmentRow {
  return {
    id: str(r.id),
    issueId: str(r.issue_id),
    field: r.field as SegmentRow['field'],
    refId: nullStr(r.ref_id),
    authorAccountId: str(r.author_account_id),
    accountType: r.account_type as SegmentRow['accountType'],
    orgId: nullStr(r.org_id),
    channel: r.channel as SegmentRow['channel'],
    visibility: r.visibility === null ? null : (r.visibility as SegmentRow['visibility']),
    trustLevel: r.trust_level as SegmentRow['trustLevel'],
    contentHash: str(r.content_hash),
    text: str(r.text),
    scannedAt: str(r.scanned_at),
  };
}

export function sqlSegmentsRepo(exec: SqlExecutor): SegmentRepo {
  return {
    async put(row) {
      await exec.exec(upsertQuery(TABLE.segment, encodeSegment(row)));
    },
    async byIssue(issueId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.segment, { issue_id: issueId }));
      return rows.map(decodeSegment);
    },
    async byId(id) {
      const row = await selectOne(exec, selectQuery(TABLE.segment, { id }));
      return row === null ? null : decodeSegment(row);
    },
    async byHash(contentHash) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.segment, { content_hash: contentHash }));
      return rows.map(decodeSegment);
    },
  };
}

// ---------------------------------------------------------------------- états

function encodeState(row: IssueStateRow): Db {
  return {
    issue_id: row.issueId,
    issue_key: row.issueKey,
    project_key: row.projectKey,
    trust_level: row.trustLevel,
    suspicion_level: row.suspicionLevel,
    mode_applied: row.modeApplied,
    unanalyzed_json: JSON.stringify(row.unanalyzed),
    inherited_from: row.inheritedFrom,
    updated_at: row.updatedAt,
  };
}

function decodeState(r: Db): IssueStateRow {
  return {
    issueId: str(r.issue_id),
    issueKey: str(r.issue_key),
    projectKey: str(r.project_key),
    trustLevel: r.trust_level as IssueStateRow['trustLevel'],
    suspicionLevel: r.suspicion_level as SuspicionLevel,
    modeApplied: r.mode_applied as IssueStateRow['modeApplied'],
    unanalyzed: jsonList(r.unanalyzed_json) as IssueStateRow['unanalyzed'],
    inheritedFrom: nullStr(r.inherited_from),
    updatedAt: str(r.updated_at),
  };
}

/** Niveaux au moins aussi suspects que `min`, du plus haut au plus bas. */
function levelsAtLeast(min: SuspicionLevel): SuspicionLevel[] {
  const threshold = SUSPICION_RANK[min];
  return (Object.keys(SUSPICION_RANK) as SuspicionLevel[])
    .filter((level) => SUSPICION_RANK[level] >= threshold)
    .sort((a, b) => SUSPICION_RANK[b] - SUSPICION_RANK[a]);
}

export function sqlStatesRepo(exec: SqlExecutor): StateRepo {
  return {
    async put(row) {
      await exec.exec(upsertQuery(TABLE.issueState, encodeState(row)));
    },
    async get(issueId) {
      const row = await selectOne(exec, selectQuery(TABLE.issueState, { issue_id: issueId }));
      return row === null ? null : decodeState(row);
    },
    async bySuspicion(min, limit) {
      const levels = levelsAtLeast(min);
      const query: SqlQuery = {
        query:
          `SELECT * FROM ${TABLE.issueState} WHERE suspicion_level IN (${levels.map(() => '?').join(', ')}) ` +
          `ORDER BY ${SUSPICION_ORDER} DESC LIMIT ${inlineLimit(limit)}`,
        params: levels,
      };
      const rows = await exec.rows<Db>(query);
      return rows.map(decodeState);
    },
  };
}

// -------------------------------------------------------------------- constats

function encodeFinding(row: FindingRow): Db {
  return {
    id: row.id,
    segment_id: row.segmentId,
    issue_id: row.issueId,
    layer: row.layer,
    kind: row.kind,
    rule_id: row.ruleId,
    excerpt: row.excerpt,
    start_pos: row.startPos,
    end_pos: row.endPos,
    ask_summary: row.askSummary,
    confidence: row.confidence,
    status: row.status,
    campaign_hash: row.campaignHash ?? null,
    created_at: row.createdAt,
  };
}

function decodeFinding(r: Db): FindingRow {
  const row: FindingRow = {
    id: str(r.id),
    segmentId: str(r.segment_id),
    issueId: str(r.issue_id),
    layer: r.layer as FindingRow['layer'],
    kind: r.kind as FindingRow['kind'],
    ruleId: str(r.rule_id),
    excerpt: str(r.excerpt),
    startPos: num(r.start_pos),
    endPos: num(r.end_pos),
    askSummary: str(r.ask_summary),
    confidence: num(r.confidence),
    status: r.status as FindingRow['status'],
    createdAt: str(r.created_at),
  };
  const campaignHash = nullStr(r.campaign_hash);
  return campaignHash === null ? row : { ...row, campaignHash };
}

export function sqlFindingsRepo(exec: SqlExecutor): FindingRepo {
  return {
    async put(row) {
      await exec.exec(upsertQuery(TABLE.finding, encodeFinding(row)));
    },
    async byIssue(issueId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.finding, { issue_id: issueId }));
      return rows.map(decodeFinding);
    },
    async byId(id) {
      const row = await selectOne(exec, selectQuery(TABLE.finding, { id }));
      return row === null ? null : decodeFinding(row);
    },
    async bySegment(segmentId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.finding, { segment_id: segmentId }));
      return rows.map(decodeFinding);
    },
    async setStatus(id, status: FindingStatus) {
      await exec.exec(updateQuery(TABLE.finding, { status }, { id }));
    },
    async since(from) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.finding, { created_at: { op: '>=', value: from } }));
      return rows.map(decodeFinding);
    },
  };
}

// --------------------------------------------------------------------- verdicts

function decodeVerdict(r: Db): VerdictRow {
  return {
    findingId: str(r.finding_id),
    reviewerAccountId: str(r.reviewer_account_id),
    decision: r.decision as VerdictRow['decision'],
    reason: nullStr(r.reason),
    at: str(r.at),
  };
}

export function sqlVerdictsRepo(exec: SqlExecutor): VerdictRepo {
  return {
    async put(row) {
      // Appendice pur : `seq` AUTO_INCREMENT, comme la clé `findingId#seq` en mémoire.
      await exec.exec(
        insertQuery(TABLE.verdict, {
          finding_id: row.findingId,
          reviewer_account_id: row.reviewerAccountId,
          decision: row.decision,
          reason: row.reason ?? null,
          at: row.at,
        }),
      );
    },
    async byFinding(findingId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.verdict, { finding_id: findingId }, { orderBy: 'seq' }));
      return rows.map(decodeVerdict);
    },
    async since(from) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.verdict, { at: { op: '>=', value: from } }, { orderBy: 'seq' }));
      return rows.map(decodeVerdict);
    },
  };
}

// ---------------------------------------------------------- originaux (§8.3)

function encodeOriginal(row: OriginalRow): Db {
  return {
    id: row.id,
    segment_id: row.segmentId,
    issue_id: row.issueId,
    content: row.content,
    finding_ids_json: JSON.stringify(row.findingIds),
    stored_at: row.storedAt,
    restored_at: row.restoredAt,
  };
}

function decodeOriginal(r: Db): OriginalRow {
  return {
    id: str(r.id),
    segmentId: str(r.segment_id),
    issueId: str(r.issue_id),
    content: str(r.content),
    findingIds: jsonList(r.finding_ids_json),
    storedAt: str(r.stored_at),
    restoredAt: nullStr(r.restored_at),
  };
}

export function sqlOriginalsRepo(exec: SqlExecutor, findings: FindingRepo): OriginalRepo {
  return {
    async put(row) {
      await exec.exec(upsertQuery(TABLE.original, encodeOriginal(row)));
    },
    async bySegment(segmentId) {
      const row = await selectOne(
        exec,
        selectQuery(TABLE.original, { segment_id: segmentId, restored_at: null }, { limit: 1 }),
      );
      return row === null ? null : decodeOriginal(row);
    },
    async byId(id) {
      const row = await selectOne(exec, selectQuery(TABLE.original, { id }));
      return row === null ? null : decodeOriginal(row);
    },
    async pending() {
      const rows = await exec.rows<Db>(selectQuery(TABLE.original, { restored_at: null }));
      return rows.map(decodeOriginal);
    },
    async markRestored(id, at) {
      // Effet de bord identique à memory.ts : les constats liés passent en `restored`.
      const row = await selectOne(exec, selectQuery(TABLE.original, { id }));
      await exec.exec(updateQuery(TABLE.original, { restored_at: at }, { id }));
      for (const findingId of jsonList(row?.finding_ids_json)) {
        await findings.setStatus(findingId, 'restored');
      }
    },
  };
}

// ------------------------------------------------------------------- sorties

function decodeOutbound(r: Db): OutboundCheckRow {
  return {
    id: str(r.id),
    issueId: str(r.issue_id),
    commentId: nullStr(r.comment_id),
    actorAccountId: str(r.actor_account_id),
    actorType: r.actor_type as OutboundCheckRow['actorType'],
    action: str(r.action),
    hits: str(r.hits_json),
    at: str(r.at),
  };
}

export function sqlOutboundRepo(exec: SqlExecutor): OutboundRepo {
  return {
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.outboundCheck, {
          id: row.id,
          issue_id: row.issueId,
          comment_id: row.commentId,
          actor_account_id: row.actorAccountId,
          actor_type: row.actorType,
          action: row.action,
          hits_json: row.hits,
          at: row.at,
        }),
      );
    },
    async byIssue(issueId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.outboundCheck, { issue_id: issueId }));
      return rows.map(decodeOutbound);
    },
    async since(from) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.outboundCheck, { at: { op: '>=', value: from } }));
      return rows.map(decodeOutbound);
    },
  };
}

// ------------------------------------------------------------------- sessions

function decodeSession(r: Db): TaintedSessionRow {
  return {
    sessionRef: str(r.session_ref),
    accountId: str(r.account_id),
    issueId: str(r.issue_id),
    since: str(r.since),
  };
}

export function sqlSessionsRepo(exec: SqlExecutor): SessionRepo {
  return {
    async taint(row) {
      await exec.exec(
        upsertQuery(TABLE.taintedSession, {
          session_ref: row.sessionRef,
          account_id: row.accountId,
          issue_id: row.issueId,
          since: row.since,
        }),
      );
    },
    async isTainted(sessionRef) {
      return (await selectOne(exec, selectQuery(TABLE.taintedSession, { session_ref: sessionRef }))) !== null;
    },
    async list(accountId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.taintedSession, { account_id: accountId }));
      return rows.map(decodeSession);
    },
    async clear(sessionRef) {
      await exec.exec(deleteQuery(TABLE.taintedSession, { session_ref: sessionRef }));
    },
  };
}

// -------------------------------------------------------------------- canaris

function decodeCanary(r: Db): CanaryRow {
  return {
    id: str(r.id),
    issueId: str(r.issue_id),
    issueKey: str(r.issue_key),
    token: str(r.token),
    instruction: str(r.instruction),
    labelName: str(r.label_name),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    closedAt: nullStr(r.closed_at),
  };
}

function decodeCanaryHit(r: Db): CanaryHitRow {
  return {
    id: str(r.id),
    canaryId: str(r.canary_id),
    actorAccountId: str(r.actor_account_id),
    actorType: r.actor_type as CanaryHitRow['actorType'],
    action: str(r.action),
    at: str(r.at),
  };
}

let hitSeq = 0;

export function sqlCanariesRepo(exec: SqlExecutor): CanaryRepo {
  return {
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.canary, {
          id: row.id,
          issue_id: row.issueId,
          issue_key: row.issueKey,
          token: row.token,
          instruction: row.instruction,
          label_name: row.labelName,
          created_by: row.createdBy,
          created_at: row.createdAt,
          closed_at: row.closedAt,
        }),
      );
    },
    async get(id) {
      const row = await selectOne(exec, selectQuery(TABLE.canary, { id }));
      return row === null ? null : decodeCanary(row);
    },
    async open() {
      const rows = await exec.rows<Db>(selectQuery(TABLE.canary, { closed_at: null }));
      return rows.map(decodeCanary);
    },
    async close(id, at) {
      await exec.exec(updateQuery(TABLE.canary, { closed_at: at }, { id }));
    },
    async addHit(row) {
      // id vide → identifiant technique, comme `hit-${seq}` en mémoire.
      hitSeq += 1;
      const id = row.id === '' ? `hit-${Date.now()}-${hitSeq}` : row.id;
      await exec.exec(
        upsertQuery(TABLE.canaryHit, {
          id,
          canary_id: row.canaryId,
          actor_account_id: row.actorAccountId,
          actor_type: row.actorType,
          action: row.action,
          at: row.at,
        }),
      );
    },
    async hits(canaryId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.canaryHit, { canary_id: canaryId }));
      return rows.map(decodeCanaryHit);
    },
    async allHits() {
      const rows = await exec.rows<Db>(selectQuery(TABLE.canaryHit));
      return rows.map(decodeCanaryHit);
    },
  };
}
