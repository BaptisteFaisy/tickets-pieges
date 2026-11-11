/**
 * Contrats partagés du domaine — « Tickets piégés ».
 *
 * Règle d'architecture (docs/ARCHITECTURE.md) : tout ce qui vit dans
 * `src/core/` est **pur** — aucune importation de `@forge/*`, aucune
 * entrée-sortie. Ce fichier est le seul contrat que les lots s'engagent à respecter :
 * y ajouter un type se fait par une PR qui le déclare dans `## Scope`.
 *
 * Références au cahier des charges (docs/CAHIER-DES-CHARGES.md) : §4 vocabulaire,
 * §5 origine, §6 détection, §8 entrée, §9 portée, §10 sortie, §11 hook,
 * §12 hérédité, §13 exercice d'alerte, §14 revue, §19 modèle de données.
 */

// ------------------------------------------------------------------ §4 niveaux

/** Niveau de confiance d'un texte : qui l'a écrit, et par quel canal (§5). */
export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3';

export const TRUST_LEVELS: readonly TrustLevel[] = ['T0', 'T1', 'T2', 'T3'];

/**
 * Niveau de suspicion d'un ticket (§4). Les clés sont stables (base, JQL,
 * file) ; les libellés viennent de `src/core/i18n.ts`.
 */
export type SuspicionLevel = 'clean' | 'review' | 'suspect' | 'trapped';

export const SUSPICION_RANK: Record<SuspicionLevel, number> = {
  clean: 0,
  review: 1,
  suspect: 2,
  trapped: 3,
};

/** Mode d'entrée appliqué par projet (§8.1) : signaler, étiqueter, neutraliser. */
export type ProtectionMode = 'report' | 'label' | 'neutralize';

/** Couche de détection (§6). */
export type DetectionLayer = 'C1' | 'C2' | 'C3' | 'C4';

export const DETECTION_LAYERS: readonly DetectionLayer[] = ['C1', 'C2', 'C3', 'C4'];

// ------------------------------------------------------------------- §5 signaux

/** Type de compte de l'auteur, tel que Jira le rend (§20). */
export type AccountType = 'atlassian' | 'app' | 'customer' | 'unknown';

/** Canal de la demande ; la propriété `request-channel-type` (§20). */
export type RequestChannel =
  | 'jira'
  | 'portal'
  | 'anonymousportal'
  | 'email'
  | 'API'
  | 'deployment'
  | 'unknown';

/** Visibilité d'un commentaire : public (client) ou interne (§20). */
export type CommentVisibility = 'public' | 'internal';

/** Un segment est une unité de texte suivie séparément (§4). */
export type SegmentField =
  | 'summary'
  | 'description'
  | 'comment'
  | 'customField'
  | 'attachmentName'
  | 'attachmentText'
  | 'reporterName'
  | 'worklog';

/** Ce qu'un ticket porte sans qu'on ait pu l'analyser (§21, §22). */
export type UnanalyzedReason =
  | 'image'
  | 'binary-attachment'
  | 'oversize'
  | 'unsupported-format'
  | 'model-pending';

/** Langue de l'interface et de la détection (§21). */
export type Language = 'fr' | 'en';

// ------------------------------------------------------------- §6 les constats

/** Nature d'un constat, toutes couches confondues (§6, §22). */
export type FindingKind =
  // C1 — dissimulation
  | 'invisible-chars'
  | 'bidi-override'
  | 'background-colored-text'
  | 'image-alt-text'
  | 'link-label-mismatch'
  | 'encoded-block'
  // C2 — adresse à une IA
  | 'assistant-addressing'
  | 'role-switch'
  | 'fake-system-marker'
  | 'tool-command'
  | 'exfiltration-url'
  // C3 — lecture par modèle
  | 'model-verdict'
  | 'model-malformed'
  // C4 — contexte
  | 'fresh-account'
  | 'anonymous-channel'
  | 'unusual-length'
  | 'language-shift'
  | 'unparseable-attachment'
  // lot S — hérédité et recopie (§12)
  | 'inherited-external'
  | 'internal-copy-of-external';

/** État du constat dans le ticket (§8.3). */
export type FindingStatus = 'open' | 'neutralized' | 'restored';

/** Verdict humain d'un constat (§14). */
export type VerdictDecision = 'trapped' | 'false-positive' | 'legitimate-risky';

// -------------------------------------------------------------------- §5 origine

/** Ce que la plateforme sait de l'auteur d'un segment. */
export interface AuthorContext {
  accountId: string;
  accountType: AccountType;
  displayName?: string;
  emailDomain?: string;
  organizationId?: string;
  organizationName?: string;
  organizationTrusted?: boolean;
  accountCreatedAt?: string;
  supportAgent?: boolean;
}

/** Un texte à examiner, avec tout ce que Jira connaît de son contexte. */
export interface SegmentSource {
  issueId: string;
  issueKey: string;
  projectKey: string;
  field: SegmentField;
  refId?: string;
  text: string;
  author: AuthorContext;
  channel: RequestChannel;
  visibility?: CommentVisibility;
  createdAt: string;
  attachment?: AttachmentMeta;
}

export interface AttachmentMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parseable: boolean;
}

/** Une raison d'origine : code stable (clé i18n) + détail brut. */
export interface OriginReason {
  code: string;
  detail?: string;
}

/** Origine calculée d'un segment (§5) — déterministe, sans modèle. */
export interface SegmentOrigin {
  field: SegmentField;
  refId?: string;
  authorAccountId: string;
  accountType: AccountType;
  organizationId?: string;
  channel: RequestChannel;
  visibility?: CommentVisibility;
  trustLevel: TrustLevel;
  reasons: OriginReason[];
}

// --------------------------------------------------------------------- §6 constat

export interface Finding {
  id: string;
  segmentId: string;
  issueId: string;
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
  excerpt: string;
  startPos: number;
  endPos: number;
  /** Résumé neutre de ce que le passage demande (§6) — jamais la charge brute. */
  askSummary: string;
  confidence: number;
  status: FindingStatus;
  campaignHash?: string;
  createdAt: string;
}

export interface Verdict {
  findingId: string;
  reviewerAccountId: string;
  decision: VerdictDecision;
  reason?: string;
  at: string;
}

/** Résultat brut d'une couche déterministe sur un texte. */
export interface LayerHit {
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
  startPos: number;
  endPos: number;
  excerpt: string;
  askSummary: string;
  confidence: number;
}

// -------------------------------------------------------------- §8 état et modes

export interface IssueState {
  issueId: string;
  issueKey: string;
  projectKey: string;
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  modeApplied: ProtectionMode;
  analyzedSegments: number;
  unanalyzed: UnanalyzedReason[];
  inheritedFrom?: string;
  updatedAt: string;
}

/** Réglages par projet (§8.1, §14, §21). */
export interface ProjectSettings {
  projectKey: string;
  mode: ProtectionMode;
  /** À partir de quel niveau on neutralise (§8.1 : « suspect », T0 et T1). */
  neutralizeFrom: SuspicionLevel;
  neutralizeOrigins: TrustLevel[];
  trustedDomains: string[];
  trustedOrganizations: string[];
  trustedIntegrations: string[];
  ignoredPhrases: string[];
  c3Enabled: boolean;
  strictOutbound: boolean;
  language: Language;
}

// ------------------------------------------------------------- §8.2 encadrement

/** Un bloc encadré : balise à identifiant aléatoire (§8.2). */
export interface FramedSegment {
  blockId: string;
  field: SegmentField;
  refId?: string;
  trustLevel: TrustLevel;
  suspicion: SuspicionLevel;
  originLabel: string;
  body: string;
  findings: Finding[];
}

export interface FramedRequest {
  issueKey: string;
  preamble: string;
  blocks: FramedSegment[];
  warnings: string[];
  notAnalyzed: UnanalyzedReason[];
}

/** Effet d'une neutralisation (§8.3) : mention posée, original conservé. */
export interface NeutralizationResult {
  segmentId: string;
  issueId: string;
  replacedText: string;
  originalId: string;
  mentionRefs: string[];
  journalized: boolean;
}

// ------------------------------------------------------------------ §10 à §18

// Le reste du contrat (sas, session, hérédité, exercice, rapports, hook,
// jeu d'essai, enveloppe des outils) vit dans `types-flow.ts`, réexporté ici :
// un seul point d'importation pour les lots, deux fichiers sous la limite.
export type * from './types-flow';
