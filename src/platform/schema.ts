/**
 * Modèle de données (§19) et contrat d'accès au stockage.
 *
 * Deux implémentations de `Store` :
 *   - `src/platform/db.ts`     : Forge SQL (`sql:` du manifest), utilisée en production ;
 *   - `src/platform/memory.ts` : tables en mémoire, utilisée par les tests et le banc d'essai.
 *
 * Le domaine (`src/core/`) ne connaît ni l'un ni l'autre : il reçoit des lignes
 * et rend des décisions. Les glue (`src/jobs/`, `src/mcp/`, `src/resolvers/`)
 * sont les seuls à parler au `Store`.
 */

import type {
  AccountType,
  CanaryActorType,
  CommentVisibility,
  DetectionLayer,
  Finding,
  FindingKind,
  FindingStatus,
  ProtectionMode,
  ProjectSettings,
  RequestChannel,
  SegmentField,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
  VerdictDecision,
} from '../core/types';

// ------------------------------------------------------------------- §19 tables

export interface SegmentRow {
  id: string;
  issueId: string;
  field: SegmentField;
  refId: string | null;
  authorAccountId: string;
  accountType: AccountType;
  orgId: string | null;
  channel: RequestChannel;
  visibility: CommentVisibility | null;
  trustLevel: TrustLevel;
  contentHash: string;
  /** Le texte analysé : conservé pour l'encadrement et la recopie (§8.2, §12). */
  text: string;
  scannedAt: string;
}

export interface IssueStateRow {
  issueId: string;
  issueKey: string;
  projectKey: string;
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  modeApplied: ProtectionMode;
  unanalyzed: UnanalyzedReason[];
  inheritedFrom: string | null;
  updatedAt: string;
}

export type FindingRow = Finding;

export interface VerdictRow {
  findingId: string;
  reviewerAccountId: string;
  decision: VerdictDecision;
  reason: string | null;
  at: string;
}

/** Original conservé hors du ticket (§8.3) : accès réservé au rôle sécurité. */
export interface OriginalRow {
  id: string;
  segmentId: string;
  issueId: string;
  content: string;
  findingIds: string[];
  storedAt: string;
  restoredAt: string | null;
}

export interface OutboundCheckRow {
  id: string;
  issueId: string;
  commentId: string | null;
  actorAccountId: string;
  actorType: CanaryActorType;
  action: string;
  hits: string;
  at: string;
}

export interface TaintedSessionRow {
  sessionRef: string;
  accountId: string;
  issueId: string;
  since: string;
}

export interface CanaryRow {
  id: string;
  issueId: string;
  issueKey: string;
  token: string;
  instruction: string;
  labelName: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}

export interface CanaryHitRow {
  id: string;
  canaryId: string;
  actorAccountId: string;
  actorType: CanaryActorType;
  action: string;
  at: string;
}

export type TrustRuleKind = 'domain' | 'organization' | 'integration' | 'ignored-phrase';

export interface TrustRuleRow {
  id: string;
  projectKey: string;
  kind: TrustRuleKind;
  value: string;
  level: TrustLevel | null;
}

export interface PatternRow {
  id: string;
  layer: DetectionLayer;
  kind: FindingKind;
  expression: string;
  language: string;
  precision: number;
  enabled: boolean;
  demoted: boolean;
}

export interface CampaignRow {
  id: string;
  payloadHash: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  issueKeys: string[];
}

export interface EventRow {
  seq: number;
  at: string;
  kind: string;
  issueId: string | null;
  payload: string;
}

export interface HookTokenRow {
  accountId: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface DraftRow {
  id: string;
  issueId: string;
  issueKey: string;
  text: string;
  authorAccountId: string;
  createdAt: string;
  publishedAt: string | null;
}

// ------------------------------------------------------------- §19 contrat Store

export interface SegmentRepo {
  put(row: SegmentRow): Promise<void>;
  byIssue(issueId: string): Promise<SegmentRow[]>;
  byId(id: string): Promise<SegmentRow | null>;
  byHash(contentHash: string): Promise<SegmentRow[]>;
}

export interface StateRepo {
  put(row: IssueStateRow): Promise<void>;
  get(issueId: string): Promise<IssueStateRow | null>;
  bySuspicion(min: SuspicionLevel, limit: number): Promise<IssueStateRow[]>;
}

export interface FindingRepo {
  put(row: FindingRow): Promise<void>;
  byIssue(issueId: string): Promise<FindingRow[]>;
  byId(id: string): Promise<FindingRow | null>;
  bySegment(segmentId: string): Promise<FindingRow[]>;
  setStatus(id: string, status: FindingStatus): Promise<void>;
  since(from: string): Promise<FindingRow[]>;
}

export interface VerdictRepo {
  put(row: VerdictRow): Promise<void>;
  byFinding(findingId: string): Promise<VerdictRow[]>;
  since(from: string): Promise<VerdictRow[]>;
}

export interface OriginalRepo {
  put(row: OriginalRow): Promise<void>;
  bySegment(segmentId: string): Promise<OriginalRow | null>;
  byId(id: string): Promise<OriginalRow | null>;
  pending(): Promise<OriginalRow[]>;
  markRestored(id: string, at: string): Promise<void>;
}

export interface OutboundRepo {
  put(row: OutboundCheckRow): Promise<void>;
  byIssue(issueId: string): Promise<OutboundCheckRow[]>;
  since(from: string): Promise<OutboundCheckRow[]>;
}

export interface SessionRepo {
  taint(row: TaintedSessionRow): Promise<void>;
  isTainted(sessionRef: string): Promise<boolean>;
  list(accountId: string): Promise<TaintedSessionRow[]>;
  clear(sessionRef: string): Promise<void>;
}

export interface CanaryRepo {
  put(row: CanaryRow): Promise<void>;
  get(id: string): Promise<CanaryRow | null>;
  open(): Promise<CanaryRow[]>;
  close(id: string, at: string): Promise<void>;
  addHit(row: CanaryHitRow): Promise<void>;
  hits(canaryId: string): Promise<CanaryHitRow[]>;
  allHits(): Promise<CanaryHitRow[]>;
}

export interface TrustRepo {
  list(projectKey: string): Promise<TrustRuleRow[]>;
  put(row: TrustRuleRow): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PatternRepo {
  list(): Promise<PatternRow[]>;
  put(row: PatternRow): Promise<void>;
  setPrecision(id: string, precision: number, demoted: boolean): Promise<void>;
}

export interface CampaignRepo {
  bump(payloadHash: string, issueKey: string, at: string): Promise<CampaignRow>;
  list(): Promise<CampaignRow[]>;
  byHash(payloadHash: string): Promise<CampaignRow | null>;
}

export interface EventRepo {
  append(kind: string, issueId: string | null, payload: unknown): Promise<void>;
  list(issueId: string | null, limit: number): Promise<EventRow[]>;
}

export interface HookTokenRepo {
  put(row: HookTokenRow): Promise<void>;
  byAccount(accountId: string): Promise<HookTokenRow | null>;
  touch(accountId: string, at: string): Promise<void>;
}

export interface DraftRepo {
  put(row: DraftRow): Promise<void>;
  byIssue(issueId: string): Promise<DraftRow[]>;
  byId(id: string): Promise<DraftRow | null>;
  markPublished(id: string, at: string): Promise<void>;
}

export interface SettingsRepo {
  get(projectKey: string): Promise<ProjectSettings | null>;
  put(settings: ProjectSettings): Promise<void>;
}

/** Le stockage entier, vu du glue. Une seule porte d'entrée, douze tiroirs. */
export interface Store {
  segments: SegmentRepo;
  states: StateRepo;
  findings: FindingRepo;
  verdicts: VerdictRepo;
  originals: OriginalRepo;
  outbound: OutboundRepo;
  sessions: SessionRepo;
  canaries: CanaryRepo;
  trust: TrustRepo;
  patterns: PatternRepo;
  campaigns: CampaignRepo;
  events: EventRepo;
  hookTokens: HookTokenRepo;
  drafts: DraftRepo;
  settings: SettingsRepo;
}

// ------------------------------------------------------------------- contrats Jira

/**
 * Ce dont le domaine a besoin côté Jira (§8, §10). Implémenté par
 * `src/platform/jira.ts` (REST Forge) et par un double en test.
 *
 * Toutes les écritures passent par là : le journal (`events`) et la
 * réversibilité (§8.3) en dépendent.
 */
export interface JiraPort {
  getIssue(issueIdOrKey: string): Promise<JiraIssueView>;
  listComments(issueIdOrKey: string): Promise<JiraCommentView[]>;
  listAttachments(issueIdOrKey: string): Promise<JiraAttachmentView[]>;
  addInternalNote(issueKey: string, body: string): Promise<string>;
  addPublicComment(issueKey: string, body: string): Promise<string>;
  setCommentVisibility(commentId: string, visibility: CommentVisibility): Promise<void>;
  updateField(issueKey: string, field: string, value: string): Promise<void>;
  prependToField(issueKey: string, field: string, banner: string): Promise<void>;
  replaceSegmentText(issueKey: string, field: SegmentField, refId: string | null, text: string): Promise<void>;
  setEntityProperty(issueKey: string, key: string, value: unknown): Promise<void>;
  addLabel(issueKey: string, label: string): Promise<void>;
  listLinked(issueKey: string): Promise<{ issueKey: string; relation: 'clone' | 'link' }[]>;
  searchByJql(jql: string, limit: number): Promise<string[]>;
}

export interface JiraIssueView {
  id: string;
  key: string;
  projectKey: string;
  summary: string;
  description: string;
  reporter: AccountSnapshot;
  channel: RequestChannel;
  createdAt: string;
  organizationId?: string;
  organizationName?: string;
  labels: string[];
}

export interface AccountSnapshot {
  accountId: string;
  accountType: AccountType;
  displayName?: string;
  emailDomain?: string;
  accountCreatedAt?: string;
  supportAgent?: boolean;
}

export interface JiraCommentView {
  id: string;
  body: string;
  visibility: CommentVisibility;
  author: AccountSnapshot;
  createdAt: string;
}

export interface JiraAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  author: AccountSnapshot;
  createdAt: string;
  text?: string;
}

/** Ce dont la couche C3 a besoin (§6) : un modèle sans outil, réponse vérifiée. */
export interface ModelPort {
  /** Renvoie la réponse brute du modèle ; le domaine la valide ensuite. */
  classify(prompt: string): Promise<string>;
}

/** Horloge injectable : les tests et le banc d'essai fixent l'heure. */
export interface Clock {
  now(): string;
}
