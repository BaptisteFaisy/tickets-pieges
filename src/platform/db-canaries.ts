/**
 * Tiroir « canaris » du stockage Forge SQL (§19, §13).
 *
 * Sorti de `db.ts` pour rester sous la limite de taille du dépôt (moins de 500
 * lignes par fichier) — le comportement est inchangé.
 */

import type { CanaryHitRow, CanaryRepo, CanaryRow } from './schema';
import { bool, nullStr, num, selectOne, str } from './db-repos';
import {
  deleteQuery,
  insertQuery,
  selectQuery,
  TABLE,
  updateQuery,
  upsertQuery,
  type SqlExecutor,
} from './sql';

type Db = Record<string, unknown>;

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

function encodeCanary(row: CanaryRow): Db {
  return {
    id: row.id,
    issue_id: row.issueId,
    issue_key: row.issueKey,
    token: row.token,
    instruction: row.instruction,
    label_name: row.labelName,
    created_by: row.createdBy,
    created_at: row.createdAt,
    closed_at: row.closedAt,
  };
}

export function sqlCanariesRepo(exec: SqlExecutor): CanaryRepo {
  return {
    async put(row) {
      await exec.exec(upsertQuery(TABLE.canary, encodeCanary(row)));
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

