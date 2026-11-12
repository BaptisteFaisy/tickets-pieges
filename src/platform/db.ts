/**
 * `Store` sur Forge SQL — l'implémentation de production (§19).
 *
 * Sémantique identique à `src/platform/memory.ts` (le contrat :
 * `src/platform/schema.ts`). `@forge/sql` est importé **statiquement**
 * (`docs/FORGE.md` §1) ; les requêtes viennent de `src/platform/sql.ts`
 * (paramètres liés, `LIMIT` inliné après coercion).
 *
 * Le schéma se crée explicitement : `ensureSchema()` est attendu avant la
 * première requête — un schéma jamais créé laisse les tables absentes
 * (`docs/FORGE.md` §2). Création idempotente (`CREATE TABLE IF NOT EXISTS`).
 *
 * Ce fichier importe Forge : il n'est jamais importé par un test. Les tiroirs
 * les plus lourds vivent dans `src/platform/db-repos.ts`.
 */

import { sql } from '@forge/sql';
import type { ProjectSettings } from '../core/types';
import type {
  CampaignRepo,
  CanaryHitRow,
  CanaryRepo,
  CanaryRow,
  CampaignRow,
  DraftRepo,
  DraftRow,
  EventRepo,
  EventRow,
  HookTokenRepo,
  HookTokenRow,
  PatternRepo,
  PatternRow,
  SettingsRepo,
  Store,
  TrustRepo,
  TrustRuleRow,
} from './schema';
import {
  bool,
  jsonList,
  nullStr,
  num,
  selectOne,
  sqlFindingsRepo,
  sqlOriginalsRepo,
  sqlOutboundRepo,
  sqlSegmentsRepo,
  sqlSessionsRepo,
  sqlStatesRepo,
  sqlVerdictsRepo,
  str,
} from './db-repos';
import {
  ddl,
  deleteQuery,
  insertQuery,
  selectQuery,
  TABLE,
  updateQuery,
  upsertQuery,
  type SqlExecutor,
  type SqlQuery,
} from './sql';

type Db = Record<string, unknown>;

// ------------------------------------------------------------------ exécuteur

let schemaPromise: Promise<void> | null = null;

async function createSchema(executor: SqlExecutor): Promise<void> {
  for (const statement of ddl()) {
    await executor.ddl(statement);
  }
}

/** Idempotent et partagé : la première requête attend la création du schéma. */
export function ensureSchema(): Promise<void> {
  if (schemaPromise === null) {
    schemaPromise = createSchema(rawExecutor);
  }
  return schemaPromise;
}

const rawExecutor: SqlExecutor = {
  async rows<T>(q: SqlQuery) {
    const result = await sql.prepare<T>(q.query).bindParams(...q.params).execute();
    return (result.rows ?? []) as T[];
  },
  async exec(q: SqlQuery) {
    await sql.prepare<Db>(q.query).bindParams(...q.params).execute();
  },
  async ddl(statement) {
    await sql.executeDDL(statement);
  },
};

/** Exécuteur gardé : aucune requête ne part avant que le schéma existe. */
const executor: SqlExecutor = {
  async rows<T>(q: SqlQuery) {
    await ensureSchema();
    return rawExecutor.rows<T>(q);
  },
  async exec(q: SqlQuery) {
    await ensureSchema();
    return rawExecutor.exec(q);
  },
  async ddl(statement) {
    return rawExecutor.ddl(statement);
  },
};

// -------------------------------------------------------------- petits tiroirs

function decodeTrustRule(r: Db): TrustRuleRow {
  return {
    id: str(r.id),
    projectKey: str(r.project_key),
    kind: r.kind as TrustRuleRow['kind'],
    value: str(r.value),
    level: nullStr(r.level) as TrustRuleRow['level'],
  };
}

export function sqlTrustRepo(exec: SqlExecutor): TrustRepo {
  return {
    async list(projectKey) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.trustRule, { project_key: projectKey }));
      return rows.map(decodeTrustRule);
    },
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.trustRule, {
          id: row.id,
          project_key: row.projectKey,
          kind: row.kind,
          value: row.value,
          level: row.level,
        }),
      );
    },
    async remove(id) {
      await exec.exec(deleteQuery(TABLE.trustRule, { id }));
    },
  };
}

function decodePattern(r: Db): PatternRow {
  return {
    id: str(r.id),
    layer: r.layer as PatternRow['layer'],
    kind: r.kind as PatternRow['kind'],
    expression: str(r.expression),
    language: str(r.language),
    precision: num(r.rule_precision),
    enabled: bool(r.enabled),
    demoted: bool(r.demoted),
  };
}

export function sqlPatternsRepo(exec: SqlExecutor): PatternRepo {
  return {
    async list() {
      const rows = await exec.rows<Db>(selectQuery(TABLE.pattern));
      return rows.map(decodePattern);
    },
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.pattern, {
          id: row.id,
          layer: row.layer,
          kind: row.kind,
          expression: row.expression,
          language: row.language,
          rule_precision: row.precision,
          enabled: row.enabled ? 1 : 0,
          demoted: row.demoted ? 1 : 0,
        }),
      );
    },
    async setPrecision(id, precision, demoted) {
      await exec.exec(updateQuery(TABLE.pattern, { rule_precision: precision, demoted: demoted ? 1 : 0 }, { id }));
    },
  };
}

// -------------------------------------------------------------------- campagnes

function decodeCampaign(r: Db): CampaignRow {
  return {
    id: str(r.id),
    payloadHash: str(r.payload_hash),
    firstSeen: str(r.first_seen),
    lastSeen: str(r.last_seen),
    count: num(r.count),
    issueKeys: jsonList(r.issue_keys_json),
  };
}

function encodeCampaign(row: CampaignRow): Db {
  return {
    id: row.id,
    payload_hash: row.payloadHash,
    first_seen: row.firstSeen,
    last_seen: row.lastSeen,
    count: row.count,
    issue_keys_json: JSON.stringify(row.issueKeys),
  };
}

export function sqlCampaignsRepo(exec: SqlExecutor): CampaignRepo {
  return {
    async bump(payloadHash, issueKey, at) {
      // Même effet de bord que memory.ts : count + 1, clé ajoutée une seule fois.
      const existing = await selectOne(exec, selectQuery(TABLE.campaign, { payload_hash: payloadHash }));
      const row: CampaignRow =
        existing === null
          ? { id: payloadHash, payloadHash, firstSeen: at, lastSeen: at, count: 1, issueKeys: [issueKey] }
          : {
              ...decodeCampaign(existing),
              lastSeen: at,
              count: num(existing.count) + 1,
              issueKeys: jsonList(existing.issue_keys_json).includes(issueKey)
                ? jsonList(existing.issue_keys_json)
                : [...jsonList(existing.issue_keys_json), issueKey],
            };
      await exec.exec(upsertQuery(TABLE.campaign, encodeCampaign(row)));
      return row;
    },
    async list() {
      const rows = await exec.rows<Db>(selectQuery(TABLE.campaign));
      return rows.map(decodeCampaign);
    },
    async byHash(payloadHash) {
      const row = await selectOne(exec, selectQuery(TABLE.campaign, { payload_hash: payloadHash }));
      return row === null ? null : decodeCampaign(row);
    },
  };
}

// ---------------------------------------------------------------------- journal

export function sqlEventsRepo(exec: SqlExecutor): EventRepo {
  return {
    async append(kind, issueId, payload) {
      await exec.exec(
        insertQuery(TABLE.event, {
          at: new Date().toISOString(),
          kind,
          issue_id: issueId,
          payload: JSON.stringify(payload),
        }),
      );
    },
    async list(issueId, limit) {
      // memory.ts rend les `limit` derniers en ordre croissant : DESC puis inverse.
      const where: Db = issueId === null ? {} : { issue_id: issueId };
      const rows = await exec.rows<Db>(selectQuery(TABLE.event, where, { orderBy: 'seq DESC', limit }));
      return rows.reverse().map((r) => ({
        seq: num(r.seq),
        at: str(r.at),
        kind: str(r.kind),
        issueId: nullStr(r.issue_id),
        payload: str(r.payload),
      }));
    },
  };
}

// ------------------------------------------------- jetons de hook, brouillons

function decodeHookToken(r: Db): HookTokenRow {
  return {
    accountId: str(r.account_id),
    tokenHash: str(r.token_hash),
    createdAt: str(r.created_at),
    lastUsedAt: nullStr(r.last_used_at),
  };
}

export function sqlHookTokensRepo(exec: SqlExecutor): HookTokenRepo {
  return {
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.hookToken, {
          account_id: row.accountId,
          token_hash: row.tokenHash,
          created_at: row.createdAt,
          last_used_at: row.lastUsedAt,
        }),
      );
    },
    async byAccount(accountId) {
      const row = await selectOne(exec, selectQuery(TABLE.hookToken, { account_id: accountId }));
      return row === null ? null : decodeHookToken(row);
    },
    async touch(accountId, at) {
      await exec.exec(updateQuery(TABLE.hookToken, { last_used_at: at }, { account_id: accountId }));
    },
  };
}

function decodeDraft(r: Db): DraftRow {
  return {
    id: str(r.id),
    issueId: str(r.issue_id),
    issueKey: str(r.issue_key),
    text: str(r.text),
    authorAccountId: str(r.author_account_id),
    createdAt: str(r.created_at),
    publishedAt: nullStr(r.published_at),
  };
}

export function sqlDraftsRepo(exec: SqlExecutor): DraftRepo {
  return {
    async put(row) {
      await exec.exec(
        upsertQuery(TABLE.draft, {
          id: row.id,
          issue_id: row.issueId,
          issue_key: row.issueKey,
          text: row.text,
          author_account_id: row.authorAccountId,
          created_at: row.createdAt,
          published_at: row.publishedAt,
        }),
      );
    },
    async byIssue(issueId) {
      const rows = await exec.rows<Db>(selectQuery(TABLE.draft, { issue_id: issueId }));
      return rows.map(decodeDraft);
    },
    async byId(id) {
      const row = await selectOne(exec, selectQuery(TABLE.draft, { id }));
      return row === null ? null : decodeDraft(row);
    },
    async markPublished(id, at) {
      await exec.exec(updateQuery(TABLE.draft, { published_at: at }, { id }));
    },
  };
}

// -------------------------------------------------------------------- réglages

export function sqlSettingsRepo(exec: SqlExecutor): SettingsRepo {
  return {
    async get(projectKey) {
      const row = await selectOne(exec, selectQuery(TABLE.settings, { project_key: projectKey }));
      if (row === null) return null;
      try {
        return JSON.parse(str(row.settings_json)) as ProjectSettings;
      } catch {
        return null;
      }
    },
    async put(settings) {
      await exec.exec(
        upsertQuery(TABLE.settings, { project_key: settings.projectKey, settings_json: JSON.stringify(settings) }),
      );
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

// ------------------------------------------------------------------ assemblage

/** Le `Store` de production : Forge SQL, schéma créé à la première requête. */
export function createSqlStore(): Store {
  const findings = sqlFindingsRepo(executor);
  return {
    segments: sqlSegmentsRepo(executor),
    states: sqlStatesRepo(executor),
    findings,
    verdicts: sqlVerdictsRepo(executor),
    originals: sqlOriginalsRepo(executor, findings),
    outbound: sqlOutboundRepo(executor),
    sessions: sqlSessionsRepo(executor),
    canaries: sqlCanariesRepo(executor),
    trust: sqlTrustRepo(executor),
    patterns: sqlPatternsRepo(executor),
    campaigns: sqlCampaignsRepo(executor),
    events: sqlEventsRepo(executor),
    hookTokens: sqlHookTokensRepo(executor),
    drafts: sqlDraftsRepo(executor),
    settings: sqlSettingsRepo(executor),
  };
}
