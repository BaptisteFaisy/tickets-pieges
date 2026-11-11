import { invoke } from '@forge/bridge';
import { t } from '../core/i18n';
import type {
  DetectionLayer,
  ExposureReport,
  FindingKind,
  FindingStatus,
  Language,
  ProtectionMode,
  ProjectSettings,
  SampleRequest,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
  VerdictDecision,
} from '../core/types';

/**
 * Pont typé vers les résolveurs (§17). Chaque écran appelle une fonction d'ici,
 * jamais `invoke` directement : la clé et la forme de la réponse sont écrites à
 * un seul endroit. Les clés sont exactement celles de `src/resolvers/index.ts`.
 * Solution reprise de l'app sœur `laddition` (déployée).
 */

export type ResolverKey =
  | 'getIssuePanel'
  | 'listSuspects'
  | 'getFinding'
  | 'setVerdict'
  | 'restoreFinding'
  | 'getSettings'
  | 'saveSettings'
  | 'getExposure'
  | 'listOriginals'
  | 'getOriginal'
  | 'restoreOriginal'
  | 'listSamples'
  | 'runPlayground';

/** Enveloppe uniforme (§17) : aucune exception ne remonte à l'écran. */
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

/* -------------------------------------------------------------- vues (§17) */

/** §17.1 — un segment du ticket, avec son origine. */
export type PanelSegment = {
  segmentId: string;
  field: string;
  trustLevel: TrustLevel;
  accountType: string;
  channel: string;
  scannedAt: string;
};

/** Un constat, tel qu'affiché (extrait borné, résumé neutre — §6, §21). */
export type FindingView = {
  id: string;
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
  excerpt: string;
  askSummary: string;
  confidence: number;
  status: FindingStatus;
};

export type PanelDraft = { id: string; text: string; createdAt: string };

/** §17.1 — bandeau et panneau du ticket. */
export type PanelView = {
  issueKey: string;
  language: Language;
  /** Texte du bandeau ; `null` = rien à dire, le bandeau n'apparaît pas (§21). */
  banner: string | null;
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  modeApplied: ProtectionMode;
  unanalyzed: UnanalyzedReason[];
  analyzedShare: number;
  segments: PanelSegment[];
  findings: FindingView[];
  drafts: PanelDraft[];
  updatedAt: string;
};

/** §17.2 — une entrée de la file des suspects. */
export type SuspectItem = {
  findingId: string;
  issueKey: string;
  suspicion: SuspicionLevel;
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
  excerpt: string;
  askSummary: string;
  confidence: number;
  campaignHash: string | null;
  campaignCount: number;
  verdict: VerdictDecision | null;
  createdAt: string;
};

/** §17.3 — revue d'un constat : contexte, règle, verdicts, restauration. */
export type FindingReview = {
  findingId: string;
  issueKey: string;
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
  excerpt: string;
  askSummary: string;
  confidence: number;
  status: FindingStatus;
  context: string | null;
  rulePrecision: number | null;
  ruleDemoted: boolean;
  verdicts: { decision: VerdictDecision; reason: string | null; at: string }[];
  originalId: string | null;
};

/** §17.5 — rapport d'exposition enrichi pour l'écran. */
export type ExposureView = {
  report: ExposureReport;
  findingsByMonth: { month: string; count: number }[];
  campaigns: { payloadHash: string; count: number; firstSeen: string; lastSeen: string; issueKeys: string[] }[];
  canaries: { issueKey: string; createdAt: string; closedAt: string | null; hits: number }[];
};

/** §17.6 — un original conservé (accès rôle sécurité, texte inerte). */
export type OriginalView = {
  id: string;
  issueKey: string;
  segmentId: string;
  storedAt: string;
  restoredAt: string | null;
  findingIds: string[];
  /** Seulement pour `getOriginal` : rendu inerte, jamais du markup (§17.6). */
  contentInert?: string;
};

/** §17.7 — résultat d'un rejeu sur le banc d'essai. */
export type PlaygroundResult = {
  sampleId: string;
  language: Language;
  expected: SampleRequest['expected'];
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  findings: FindingView[];
  /** Ce que le banc n'a pas pu rejouer (couche absente, modèle hors ligne…). */
  notAnalyzed: string[];
};

/* ------------------------------------------------------------------ appels */

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

async function call<T>(key: ResolverKey, payload: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const result = await invoke<ApiResult<T>>(key, payload);
    if (isApiResult<T>(result)) return result;
    return { ok: false, error: t('fr', 'ui.error.unreadable') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t('fr', 'ui.error.generic') };
  }
}

export const getIssuePanel = (issueKey: string): Promise<ApiResult<PanelView>> =>
  call<PanelView>('getIssuePanel', { issueKey });

export const listSuspects = (projectKey?: string, limit = 100): Promise<ApiResult<SuspectItem[]>> =>
  call<SuspectItem[]>('listSuspects', { projectKey: projectKey ?? null, limit });

export const getFinding = (findingId: string): Promise<ApiResult<FindingReview>> =>
  call<FindingReview>('getFinding', { findingId });

export const setVerdict = (
  findingId: string,
  decision: VerdictDecision,
  reviewerAccountId: string,
  reason?: string,
): Promise<ApiResult<{ findingId: string; decision: VerdictDecision }>> =>
  call('setVerdict', { findingId, decision, reviewerAccountId, reason: reason ?? null });

export const restoreFinding = (findingId: string, reason?: string): Promise<ApiResult<{ findingId: string }>> =>
  call('restoreFinding', { findingId, reason: reason ?? null });

export const getSettings = (projectKey: string): Promise<ApiResult<ProjectSettings>> =>
  call<ProjectSettings>('getSettings', { projectKey });

export const saveSettings = (settings: ProjectSettings): Promise<ApiResult<ProjectSettings>> =>
  call<ProjectSettings>('saveSettings', { settings });

export const getExposure = (projectKey: string, days = 30): Promise<ApiResult<ExposureView>> =>
  call<ExposureView>('getExposure', { projectKey, days });

export const listOriginals = (): Promise<ApiResult<OriginalView[]>> => call<OriginalView[]>('listOriginals', {});

export const getOriginal = (id: string): Promise<ApiResult<OriginalView>> =>
  call<OriginalView>('getOriginal', { id });

export const restoreOriginal = (id: string, reason?: string): Promise<ApiResult<{ id: string }>> =>
  call('restoreOriginal', { id, reason: reason ?? null });

export const listSamples = (): Promise<ApiResult<SampleRequest[]>> => call<SampleRequest[]>('listSamples', {});

export const runPlayground = (sampleId: string): Promise<ApiResult<PlaygroundResult>> =>
  call<PlaygroundResult>('runPlayground', { sampleId });
