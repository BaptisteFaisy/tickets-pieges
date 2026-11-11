/**
 * Contrats du domaine, seconde moitié : ce qui sort, ce qui suit, ce qui se
 * mesure (§10 sas, §9 portée, §12 hérédité, §13 exercice, §14 revue, §11 hook,
 * §16 outils, TP-18 jeu d'essai).
 *
 * `src/core/types.ts` réexporte ce fichier : les lots n'ont qu'un seul point
 * d'importation, mais le contrat tient dans la limite de taille du dépôt.
 */

import type {
  AccountType,
  CommentVisibility,
  DetectionLayer,
  Finding,
  FindingKind,
  Language,
  ProtectionMode,
  RequestChannel,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
  VerdictDecision,
} from './types';
// ------------------------------------------------------------------- §10 le sas

export type OutboundKind =
  | 'other-customer-data'
  | 'other-organization'
  | 'other-issue-key'
  | 'unknown-url'
  | 'long-query-url'
  | 'encoded-block'
  | 'off-topic';

export interface OutboundHit {
  kind: OutboundKind;
  excerpt: string;
  detail?: string;
  confidence: number;
}

/** Décision du sas (§10) : laisser passer, retenir, repasser en interne, alerter. */
export type OutboundAction = 'allow' | 'hold-for-review' | 'convert-to-internal' | 'alert';

export interface OutboundVerdict {
  issueKey: string;
  allowed: boolean;
  action: OutboundAction;
  hits: OutboundHit[];
  checkedAt: string;
}

/** Ce dont le sas a besoin pour juger, sans accéder lui-même aux données. */
export interface OutboundContext {
  issueKey: string;
  requestText?: string;
  requesterOrganization?: string;
  otherOrganizations?: string[];
  otherIssueKeys?: string[];
  knownUrls?: string[];
  strict: boolean;
  taintedSession: boolean;
}

// --------------------------------------------------------------- §9 session (§20)

export interface TaintedSession {
  sessionRef: string;
  accountId: string;
  issueId: string;
  since: string;
}

// -------------------------------------------------------------- §12 hérédité, S

export interface InheritanceInput {
  sourceIssueKey: string;
  sourceTrustLevel: TrustLevel;
  targetIssueKey: string;
  relation: 'clone' | 'link';
  findings: Finding[];
}

export interface InheritanceResult {
  targetIssueKey: string;
  trustLevel: TrustLevel;
  carriedFindings: number;
  note: string;
}

/** Empremintes de passages, pour repérer une recopie (§12, lot S). */
export interface TextFingerprint {
  hash: string;
  shingles: string[];
}

// ------------------------------------------------------------------ §13 exercice

export interface Canary {
  id: string;
  issueId: string;
  issueKey: string;
  token: string;
  instruction: string;
  labelName: string;
  createdBy: string;
  createdAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
}

export type CanaryActorType = 'human' | 'ai-agent' | 'automation' | 'unknown';

export interface CanaryHit {
  canaryId: string;
  actorAccountId: string;
  actorType: CanaryActorType;
  action: string;
  at: string;
}

// -------------------------------------------------------------- §14/§16 rapports

export interface RulePrecision {
  ruleId: string;
  layer: DetectionLayer;
  kind: FindingKind;
  truePositives: number;
  falsePositives: number;
  precision: number;
  enabled: boolean;
  /** Une règle imprécise est rétrogradée en simple pondération (§14). */
  demoted: boolean;
}

export interface Campaign {
  id: string;
  payloadHash: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  issueKeys: string[];
}

export interface ExposureReport {
  projectKey: string;
  from: string;
  to: string;
  requestsExamined: number;
  analyzedShare: number;
  findingsByLayer: Record<DetectionLayer, number>;
  verdicts: Record<VerdictDecision, number>;
  canariesLaunched: number;
  canariesObeyed: number;
  obedienceRate: number;
  outboundHeld: number;
  campaigns: number;
  topKinds: { kind: FindingKind; count: number }[];
}

// ---------------------------------------------------------------------- §11 hook

export interface HookInboundRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  sessionRef?: string;
  accountId?: string;
}

export interface HookInboundResponse {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse';
    additionalContext: string;
    updatedToolOutput: string;
  };
}

export interface HookOutboundRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionRef?: string;
  accountId?: string;
}

export interface HookOutboundResponse {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'ask' | 'deny';
    permissionDecisionReason: string;
  };
}

/** Fichier de hooks généré par l'app (§11) : noms réglables par poste. */
export interface HookConfig {
  serverName: string;
  readTools: string[];
  writeTools: string[];
  baseUrl: string;
  tokenEnvVar: string;
  timeoutSeconds: number;
}

// ------------------------------------------------------------- §17 jeu d'essai

export interface SampleComment {
  body: string;
  visibility: CommentVisibility;
  authorType: AccountType;
}

/** Une demande d'exemple du jeu d'essai intégré (TP-18, §25). */
export interface SampleRequest {
  id: string;
  language: Language;
  summary: string;
  description: string;
  comments: SampleComment[];
  channel: RequestChannel;
  accountType: AccountType;
  organizationId?: string;
  expected: {
    trustLevel: TrustLevel;
    suspicion: SuspicionLevel;
    kinds: FindingKind[];
  };
}

// ------------------------------------------------------------------ §16 outils

/** Enveloppe uniforme des outils MCP (§16) : une erreur lisible, jamais une pile. */
export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  warnings: string[];
}

// ------------------------------------------------------------------- petits outils

// Les règles d'ordre (niveau le plus bas, suspicion la plus haute, seuils) sont
// dans `src/core/levels.ts` : elles servent à l'origine, l'hérédité, les modes et
// la file des suspects.
