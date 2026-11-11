/**
 * Construction des requêtes SQL — pur et testable, sans dépendance Forge.
 *
 * Règles (`docs/FORGE.md` §2) :
 *   - aucune valeur utilisateur concaténée dans une requête : tout passe par
 *     des paramètres liés (`?`) ;
 *   - seule exception : `LIMIT`, que TiDB refuse en paramètre lié — la limite
 *     est inlinée APRÈS coercion entière (`inlineLimit`) ;
 *   - les `ORDER BY` fournis par les dépôts sont des fragments constants du
 *     code, jamais des entrées utilisateur ;
 *   - le schéma se crée explicitement : `ddl()` renvoie les seize
 *     `CREATE TABLE IF NOT EXISTS` (§19), à exécuter au démarrage.
 *
 * `src/platform/db.ts` exécute ces requêtes via `@forge/sql` ; ce fichier-ci
 * est importé par les tests.
 */

/** Une requête prête à lier : texte à trous + paramètres, dans l'ordre. */
export interface SqlQuery {
  query: string;
  params: unknown[];
}

/** Ce dont les dépôts ont besoin pour parler à la base (implémenté par db.ts). */
export interface SqlExecutor {
  rows<T>(q: SqlQuery): Promise<T[]>;
  exec(q: SqlQuery): Promise<void>;
  ddl(statement: string): Promise<void>;
}

// ------------------------------------------------------------------ constantes

/** Noms des seize tables du §19 — une seule source de vérité. */
export const TABLE = {
  segment: 'segment',
  issueState: 'issue_state',
  finding: 'finding',
  verdict: 'verdict',
  original: 'original',
  outboundCheck: 'outbound_check',
  taintedSession: 'tainted_session',
  canary: 'canary',
  canaryHit: 'canary_hit',
  trustRule: 'trust_rule',
  pattern: 'pattern',
  campaign: 'campaign',
  event: 'event',
  hookToken: 'hook_token',
  draft: 'draft',
  settings: 'settings',
} as const;

/**
 * Coercion entière de la limite : `LIMIT ${inlineLimit(n)}` est la seule
 * valeur inlinée du SQL (TiDB rejette `LIMIT ?` — ERROR 1210).
 */
export function inlineLimit(n: number): number {
  return Math.max(1, n | 0);
}

/** Ordre de tri constant de la file des suspects (niveau décroissant). */
export const SUSPICION_ORDER =
  "CASE suspicion_level WHEN 'trapped' THEN 3 WHEN 'suspect' THEN 2 " +
  "WHEN 'review' THEN 1 ELSE 0 END";

// ---------------------------------------------------------------- construction

type Record_ = Record<string, unknown>;

function columnsOf(row: Record_): string[] {
  return Object.keys(row);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Clause WHERE : `col = ?` par entrée, `col IS NULL` pour une valeur nulle. */
function whereClause(where: Record_): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(where)) {
    if (value === null) {
      parts.push(`${column} IS NULL`);
    } else {
      parts.push(`${column} = ?`);
      params.push(value);
    }
  }
  return { sql: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

/** INSERT simple (tables à appendice : verdict, canary_hit, event). */
export function insertQuery(table: string, row: Record_): SqlQuery {
  const columns = columnsOf(row);
  return {
    query: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`,
    params: columns.map((c) => row[c]),
  };
}

/** INSERT … ON DUPLICATE KEY UPDATE : l'écriture idempotente des dépôts. */
export function upsertQuery(table: string, row: Record_): SqlQuery {
  const columns = columnsOf(row);
  const updates = columns.map((c) => `${c} = VALUES(${c})`).join(', ');
  return {
    query:
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)}) ` +
      `ON DUPLICATE KEY UPDATE ${updates}`,
    params: columns.map((c) => row[c]),
  };
}

export interface SelectOptions {
  /** Fragment SQL constant (jamais une entrée utilisateur). */
  orderBy?: string;
  /** Inliné après coercion entière — seule exception au paramètre lié. */
  limit?: number;
}

export function selectQuery(table: string, where: Record_ = {}, options: SelectOptions = {}): SqlQuery {
  const clause = whereClause(where);
  const order = options.orderBy ? ` ORDER BY ${options.orderBy}` : '';
  const limit = options.limit === undefined ? '' : ` LIMIT ${inlineLimit(options.limit)}`;
  return { query: `SELECT * FROM ${table}${clause.sql}${order}${limit}`, params: clause.params };
}

export function updateQuery(table: string, set: Record_, where: Record_): SqlQuery {
  const setColumns = columnsOf(set);
  const clause = whereClause(where);
  return {
    query: `UPDATE ${table} SET ${setColumns.map((c) => `${c} = ?`).join(', ')}${clause.sql}`,
    params: [...setColumns.map((c) => set[c]), ...clause.params],
  };
}

export function deleteQuery(table: string, where: Record_): SqlQuery {
  const clause = whereClause(where);
  return { query: `DELETE FROM ${table}${clause.sql}`, params: clause.params };
}

// ------------------------------------------------------------------- schéma §19

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS segment (
    id VARCHAR(191) PRIMARY KEY,
    issue_id VARCHAR(191) NOT NULL,
    field VARCHAR(32) NOT NULL,
    ref_id VARCHAR(191) NULL,
    author_account_id VARCHAR(191) NOT NULL,
    account_type VARCHAR(16) NOT NULL,
    org_id VARCHAR(191) NULL,
    channel VARCHAR(32) NOT NULL,
    visibility VARCHAR(16) NULL,
    trust_level VARCHAR(8) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    text MEDIUMTEXT NOT NULL,
    scanned_at VARCHAR(32) NOT NULL,
    KEY idx_segment_issue (issue_id),
    KEY idx_segment_hash (content_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_state (
    issue_id VARCHAR(191) PRIMARY KEY,
    issue_key VARCHAR(32) NOT NULL,
    project_key VARCHAR(32) NOT NULL,
    trust_level VARCHAR(8) NOT NULL,
    suspicion_level VARCHAR(16) NOT NULL,
    mode_applied VARCHAR(16) NOT NULL,
    unanalyzed_json TEXT NOT NULL,
    inherited_from VARCHAR(191) NULL,
    updated_at VARCHAR(32) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finding (
    id VARCHAR(191) PRIMARY KEY,
    segment_id VARCHAR(191) NOT NULL,
    issue_id VARCHAR(191) NOT NULL,
    layer VARCHAR(4) NOT NULL,
    kind VARCHAR(48) NOT NULL,
    rule_id VARCHAR(191) NOT NULL,
    excerpt TEXT NOT NULL,
    start_pos INT NOT NULL,
    end_pos INT NOT NULL,
    ask_summary TEXT NOT NULL,
    confidence DOUBLE NOT NULL,
    status VARCHAR(16) NOT NULL,
    campaign_hash VARCHAR(64) NULL,
    created_at VARCHAR(32) NOT NULL,
    KEY idx_finding_issue (issue_id),
    KEY idx_finding_segment (segment_id),
    KEY idx_finding_created (created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS verdict (
    seq BIGINT AUTO_INCREMENT PRIMARY KEY,
    finding_id VARCHAR(191) NOT NULL,
    reviewer_account_id VARCHAR(191) NOT NULL,
    decision VARCHAR(32) NOT NULL,
    reason TEXT NULL,
    at VARCHAR(32) NOT NULL,
    KEY idx_verdict_finding (finding_id),
    KEY idx_verdict_at (at)
  )`,
  `CREATE TABLE IF NOT EXISTS original (
    id VARCHAR(191) PRIMARY KEY,
    segment_id VARCHAR(191) NOT NULL,
    issue_id VARCHAR(191) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    finding_ids_json TEXT NOT NULL,
    stored_at VARCHAR(32) NOT NULL,
    restored_at VARCHAR(32) NULL,
    KEY idx_original_segment (segment_id),
    KEY idx_original_restored (restored_at)
  )`,
  `CREATE TABLE IF NOT EXISTS outbound_check (
    id VARCHAR(191) PRIMARY KEY,
    issue_id VARCHAR(191) NOT NULL,
    comment_id VARCHAR(191) NULL,
    actor_account_id VARCHAR(191) NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    action VARCHAR(64) NOT NULL,
    hits_json TEXT NOT NULL,
    at VARCHAR(32) NOT NULL,
    KEY idx_outbound_issue (issue_id),
    KEY idx_outbound_at (at)
  )`,
  `CREATE TABLE IF NOT EXISTS tainted_session (
    session_ref VARCHAR(191) PRIMARY KEY,
    account_id VARCHAR(191) NOT NULL,
    issue_id VARCHAR(191) NOT NULL,
    since VARCHAR(32) NOT NULL,
    KEY idx_session_account (account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS canary (
    id VARCHAR(191) PRIMARY KEY,
    issue_id VARCHAR(191) NOT NULL,
    issue_key VARCHAR(32) NOT NULL,
    token VARCHAR(191) NOT NULL,
    instruction TEXT NOT NULL,
    label_name VARCHAR(191) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    created_at VARCHAR(32) NOT NULL,
    closed_at VARCHAR(32) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS canary_hit (
    id VARCHAR(191) PRIMARY KEY,
    canary_id VARCHAR(191) NOT NULL,
    actor_account_id VARCHAR(191) NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    action VARCHAR(64) NOT NULL,
    at VARCHAR(32) NOT NULL,
    KEY idx_canary_hit_canary (canary_id)
  )`,
  `CREATE TABLE IF NOT EXISTS trust_rule (
    id VARCHAR(191) PRIMARY KEY,
    project_key VARCHAR(32) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    value TEXT NOT NULL,
    level VARCHAR(8) NULL,
    KEY idx_trust_project (project_key)
  )`,
  `CREATE TABLE IF NOT EXISTS pattern (
    id VARCHAR(191) PRIMARY KEY,
    layer VARCHAR(4) NOT NULL,
    kind VARCHAR(48) NOT NULL,
    expression TEXT NOT NULL,
    language VARCHAR(8) NOT NULL,
    precision DOUBLE NOT NULL,
    enabled TINYINT NOT NULL,
    demoted TINYINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaign (
    id VARCHAR(191) PRIMARY KEY,
    payload_hash VARCHAR(64) NOT NULL,
    first_seen VARCHAR(32) NOT NULL,
    last_seen VARCHAR(32) NOT NULL,
    count INT NOT NULL,
    issue_keys_json TEXT NOT NULL,
    UNIQUE KEY idx_campaign_hash (payload_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS event (
    seq BIGINT AUTO_INCREMENT PRIMARY KEY,
    at VARCHAR(32) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    issue_id VARCHAR(191) NULL,
    payload MEDIUMTEXT NOT NULL,
    KEY idx_event_issue (issue_id)
  )`,
  `CREATE TABLE IF NOT EXISTS hook_token (
    account_id VARCHAR(191) PRIMARY KEY,
    token_hash VARCHAR(64) NOT NULL,
    created_at VARCHAR(32) NOT NULL,
    last_used_at VARCHAR(32) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS draft (
    id VARCHAR(191) PRIMARY KEY,
    issue_id VARCHAR(191) NOT NULL,
    issue_key VARCHAR(32) NOT NULL,
    text MEDIUMTEXT NOT NULL,
    author_account_id VARCHAR(191) NOT NULL,
    created_at VARCHAR(32) NOT NULL,
    published_at VARCHAR(32) NULL,
    KEY idx_draft_issue (issue_id)
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    project_key VARCHAR(32) PRIMARY KEY,
    settings_json MEDIUMTEXT NOT NULL
  )`,
];

/** Les seize `CREATE TABLE IF NOT EXISTS` du §19, dans l'ordre de création. */
export function ddl(): string[] {
  return [...DDL];
}
