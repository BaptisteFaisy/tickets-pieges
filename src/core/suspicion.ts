/**
 * Niveau de suspicion (§4, §6, §14) et état d'un ticket.
 *
 * Le niveau est le seul chiffre que le support lit avant de cliquer :
 * `clean` (sain), `review` (à vérifier), `suspect`, `trapped` (piégé, confirmé
 * par un humain). Il se calcule à partir des constats encore actifs, du score de
 * contexte (C4) et des verdicts humains — jamais d'un seul signal, jamais d'un
 * modèle seul.
 *
 * Règle de tenue (§21) : le doute profite à la protection, pas à l'attaquant.
 * Un verdict humain `false-positive` fait redescendre, un verdict `trapped`
 * l'emporte sur tout, et un verdict `legitimate-risky` ne retire jamais la
 * protection — il la documente (§22).
 */

import type {
  Finding,
  IssueState,
  ProtectionMode,
  SegmentOrigin,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
  Verdict,
} from './types';
import { SUSPICION_RANK } from './types';
import { lowestOf } from './levels';

/** Ce qui entre dans le calcul du niveau de suspicion. */
export interface SuspicionInput {
  findings: Finding[];
  /** Score de contexte borné à 1 (couche C4). */
  contextScore?: number;
  verdicts?: Verdict[];
  /** Vrai si la couche C3 a rendu un avis exploitable. */
  usedModel?: boolean;
}

/** Couches déterministes : leurs constats pèsent plus qu'une pondération. */
const DETERMINISTIC = new Set(['C1', 'C2']);

/** Seuil de confiance au-delà duquel un constat déterministe est « fort ». */
export const STRONG_CONFIDENCE = 0.6;

/** Score de contexte à partir duquel un ticket mérite au moins « à vérifier ». */
export const CONTEXT_REVIEW_THRESHOLD = 0.5;

/** Indexe les verdicts par constat : le dernier verdict d'un constat gagne. */
export function lastVerdicts(verdicts: Verdict[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const verdict of verdicts) {
    const known = map.get(verdict.findingId);
    if (!known || verdict.at >= known.at) map.set(verdict.findingId, verdict);
  }
  return map;
}

/** Constats à prendre en compte : actifs et non écartés par un verdict humain. */
export function effectiveFindings(findings: Finding[], verdicts: Verdict[]): Finding[] {
  const decided = lastVerdicts(verdicts);
  return findings.filter((finding) => {
    if (finding.status !== 'open') return false;
    const verdict = decided.get(finding.id);
    return verdict?.decision !== 'false-positive';
  });
}

/** Le niveau le plus élevé de deux niveaux de suspicion. */
function maxSuspicion(a: SuspicionLevel, b: SuspicionLevel): SuspicionLevel {
  return SUSPICION_RANK[a] >= SUSPICION_RANK[b] ? a : b;
}

/**
 * Calcule le niveau de suspicion. L'ordre des règles est celui du cahier : le
 * verdict humain d'abord, les preuves déterministes ensuite, le contexte en
 * dernier — et le contexte ne peut jamais dépasser « à vérifier ».
 */
export function computeSuspicion(input: SuspicionInput): SuspicionLevel {
  const { findings, verdicts = [], contextScore = 0 } = input;
  const decided = lastVerdicts(verdicts);

  if ([...decided.values()].some((verdict) => verdict.decision === 'trapped')) {
    return 'trapped';
  }

  const active = effectiveFindings(findings, verdicts);
  let level: SuspicionLevel = 'clean';

  const strong = active.some(
    (finding) => DETERMINISTIC.has(finding.layer) && finding.confidence >= STRONG_CONFIDENCE,
  );
  if (strong) level = maxSuspicion(level, 'suspect');

  const layers = new Set(active.filter((f) => f.layer !== 'C4').map((f) => f.layer));
  if (layers.size >= 2) level = maxSuspicion(level, 'suspect');

  const anyDeterministic = active.some((finding) => DETERMINISTIC.has(finding.layer));
  const modelDoubt = active.some(
    (finding) => finding.layer === 'C3' && finding.kind === 'model-verdict',
  );
  // §6 : « une réponse non conforme vaut suspect ». Un modèle refusé, bavard ou
  // détourné ne blanchit jamais un passage : le doute monte, il ne descend pas.
  const modelMalformed = active.some((finding) => finding.kind === 'model-malformed');
  if (modelMalformed) level = maxSuspicion(level, 'suspect');
  if (anyDeterministic || modelDoubt) level = maxSuspicion(level, 'review');

  const riskyVerdict = [...decided.values()].some((verdict) => verdict.decision === 'legitimate-risky');
  if (riskyVerdict) level = maxSuspicion(level, 'review');

  if (contextScore >= CONTEXT_REVIEW_THRESHOLD) level = maxSuspicion(level, 'review');

  return level;
}

/** Ce qu'il faut pour figer l'état d'un ticket. */
export interface StateInput {
  issue: { issueId: string; issueKey: string; projectKey: string };
  origins: SegmentOrigin[];
  findings: Finding[];
  mode: ProtectionMode;
  unanalyzed?: UnanalyzedReason[];
  inheritedFrom?: string;
  verdicts?: Verdict[];
  contextScore?: number;
  now: string;
}

/**
 * État d'un ticket : c'est ce qui alimente la propriété indexée (TP-07), la file
 * des suspects (§17.2) et le bandeau (TP-06). Le niveau de confiance est celui
 * du segment le plus bas : un ticket vaut ce que vaut son texte le plus exposé.
 */
export function toIssueState(input: StateInput): IssueState {
  const trustLevel: TrustLevel = input.origins.length === 0 ? 'T0' : lowestOf(input.origins.map((o) => o.trustLevel));
  const suspicionLevel = computeSuspicion({
    findings: input.findings,
    verdicts: input.verdicts,
    contextScore: input.contextScore,
  });
  return {
    issueId: input.issue.issueId,
    issueKey: input.issue.issueKey,
    projectKey: input.issue.projectKey,
    trustLevel,
    suspicionLevel,
    modeApplied: input.mode,
    analyzedSegments: input.origins.length,
    unanalyzed: input.unanalyzed ?? [],
    inheritedFrom: input.inheritedFrom,
    updatedAt: input.now,
  };
}

/**
 * Faut-il afficher quelque chose sur le ticket ? « Peu de bruit » (§21) : le
 * bandeau n'apparaît que s'il y a quelque chose à dire — un constat, un contexte
 * au-dessus du seuil, ou une partie du ticket qui n'a pas été analysée.
 */
export function needsBanner(state: IssueState): boolean {
  return state.suspicionLevel !== 'clean' || state.unanalyzed.length > 0;
}

/** Phrase courte d'exposition réelle, pour le bandeau et les rapports (§21). */
export function analyzedShare(state: IssueState, totalSegments: number): number {
  if (totalSegments <= 0) return 0;
  return Math.min(1, Number((state.analyzedSegments / totalSegments).toFixed(2)));
}
