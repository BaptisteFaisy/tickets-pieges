/**
 * Mode shadow (#17) — domaine pur, **n'écrit rien**.
 *
 * En shadow, le banc calcule exactement ce que le produit ferait (constats,
 * actions prévues) et le compare aux verdicts humains, sans toucher au portail :
 * aucun commentaire, aucune étiquette, aucune retenue de réponse. C'est la
 * condition pour mesurer avant de décider (§21 : en mode `report`, rien ne
 * change pour l'attaquant, qui ne voit aucune différence).
 *
 * Le port d'application distingue donc deux gestes :
 * - `propose` : dire ce qui **aurait** été fait (observabilité, aucune écriture) ;
 * - `apply`   : écrire réellement — ce module ne l'appelle **jamais**.
 *
 * Un test le vérifie avec un port qui compte ; le rapport expose
 * `appliedActions`, qui vaut zéro par construction.
 */

import type { Language, LayerHit } from '../core/types';
import { contentHash } from '../core/hashing';
import type { CorpusEntry } from './corpus';
import { ratio, type Detector } from './metrics';

/** Verdict humain de référence (mêmes valeurs que `VerdictDecision`, plus `pending`). */
export type HumanVerdict = 'trapped' | 'false-positive' | 'legitimate-risky' | 'pending';

export const HUMAN_VERDICTS: readonly HumanVerdict[] = ['trapped', 'false-positive', 'legitimate-risky', 'pending'];

/** Geste que le mode appliqué ferait sur un ticket. */
export type ShadowActionKind = 'internal-comment' | 'label' | 'hold-outbound' | 'frame-only';

export interface ShadowAction {
  readonly kind: ShadowActionKind;
  readonly issueId: string;
  /** Empreinte du contenu, jamais le contenu (§21 : rien de textuel ne sort). */
  readonly payloadHash: string;
  readonly ruleIds: readonly string[];
}

/** Port d'application : `apply` est l'écriture réelle, interdite en shadow. */
export interface ShadowPort {
  propose(action: ShadowAction): void;
  apply(action: ShadowAction): void;
}

/** Port qui compte — sert aux tests et au rapport. */
export interface RecordingPort extends ShadowPort {
  readonly proposed: ShadowAction[];
  readonly applied: ShadowAction[];
}

export function createRecordingPort(): RecordingPort {
  const proposed: ShadowAction[] = [];
  const applied: ShadowAction[] = [];
  return {
    proposed,
    applied,
    propose: (action) => {
      proposed.push(action);
    },
    apply: (action) => {
      applied.push(action);
    },
  };
}

/** Port qui refuse toute écriture : utilisé par défaut en shadow. */
export function createForbiddenPort(): ShadowPort & { applied: ShadowAction[] } {
  const applied: ShadowAction[] = [];
  return {
    applied,
    propose: () => undefined,
    apply: (action) => {
      applied.push(action);
      throw new Error(`mode shadow : écriture interdite (${action.kind})`);
    },
  };
}

/** Ce que le mode appliqué ferait d'un constat : encadrement, étiquette, sas. */
export function plannedActions(entry: CorpusEntry, hits: readonly LayerHit[]): ShadowAction[] {
  const ruleIds = Array.from(new Set(hits.map((hit) => hit.ruleId))).sort();
  const hash = contentHash(`${entry.id}:${ruleIds.join(',')}`);
  const actions: ShadowAction[] = [
    { kind: 'frame-only', issueId: entry.id, payloadHash: hash, ruleIds },
  ];
  if (hits.length === 0) return actions;
  actions.push({ kind: 'internal-comment', issueId: entry.id, payloadHash: hash, ruleIds });
  actions.push({ kind: 'label', issueId: entry.id, payloadHash: hash, ruleIds });
  if (ruleIds.some((ruleId) => ruleId.startsWith('C2-') || ruleId.startsWith('DC-'))) {
    actions.push({ kind: 'hold-outbound', issueId: entry.id, payloadHash: hash, ruleIds });
  }
  return actions;
}

/** Nature du désaccord machine / humain. */
export type DivergenceCode =
  | 'machine-silent-human-trapped'
  | 'machine-acted-human-false-positive'
  | 'machine-acted-human-legitimate-risky'
  | 'human-pending'
  | 'none';

export interface ShadowEntryResult {
  readonly id: string;
  readonly lang: Language;
  readonly label: CorpusEntry['label'];
  readonly machineDetected: boolean;
  readonly machineRuleIds: readonly string[];
  readonly plannedActionCount: number;
  readonly human: HumanVerdict;
  readonly agreement: 'agree' | 'disagree' | 'unknown';
  readonly divergence: DivergenceCode;
}

/** Compare un résultat machine à un verdict humain — la règle tient en une table. */
export function compareWithHuman(machineDetected: boolean, human: HumanVerdict): DivergenceCode {
  if (human === 'pending') return 'human-pending';
  if (human === 'trapped') return machineDetected ? 'none' : 'machine-silent-human-trapped';
  if (machineDetected) {
    return human === 'false-positive' ? 'machine-acted-human-false-positive' : 'machine-acted-human-legitimate-risky';
  }
  return 'none';
}

export function agreementOf(divergence: DivergenceCode): 'agree' | 'disagree' | 'unknown' {
  if (divergence === 'human-pending') return 'unknown';
  return divergence === 'none' ? 'agree' : 'disagree';
}

export interface ShadowOptions {
  /** Ne pas proposer les gestes (calcul seul) — utile pour un rapport minimal. */
  silent?: boolean;
  /** Langue du rapport (aucun texte n'est rendu : la langue sert au tri). */
  language?: Language;
}

export interface ShadowReport {
  readonly total: number;
  readonly compared: number;
  readonly agreements: number;
  readonly disagreements: number;
  readonly unknown: number;
  readonly agreementRate: number | null;
  readonly byDivergence: Readonly<Record<DivergenceCode, number>>;
  /** Machines muettes sur une charge confirmée par un humain : à corriger. */
  readonly missedIds: readonly string[];
  /** Machines bavardes sur un faux positif confirmé : à régler. */
  readonly noisyIds: readonly string[];
  readonly proposedActions: number;
  /** Zéro par construction : le shadow n'écrit jamais. */
  readonly appliedActions: number;
  readonly results: readonly ShadowEntryResult[];
}

const EMPTY_DIVERGENCES: Record<DivergenceCode, number> = {
  'machine-silent-human-trapped': 0,
  'machine-acted-human-false-positive': 0,
  'machine-acted-human-legitimate-risky': 0,
  'human-pending': 0,
  none: 0,
};

/**
 * Joue le corpus en shadow : calcule, propose (sauf `silent`), compare.
 * `port.apply` n'est **jamais** appelé : rien n'est écrit nulle part.
 */
export function runShadow(
  entries: readonly CorpusEntry[],
  detect: Detector,
  humanVerdicts: Readonly<Record<string, HumanVerdict>>,
  port: ShadowPort,
  options: ShadowOptions = {},
): ShadowReport {
  const results: ShadowEntryResult[] = [];
  let proposedActions = 0;
  for (const entry of entries) {
    const hits = detect(entry) ?? [];
    const actions = plannedActions(entry, hits);
    if (!options.silent) {
      for (const action of actions) port.propose(action);
      proposedActions += actions.length;
    }
    const human = humanVerdicts[entry.id] ?? 'pending';
    const divergence = compareWithHuman(hits.length > 0, human);
    results.push({
      id: entry.id,
      lang: entry.lang,
      label: entry.label,
      machineDetected: hits.length > 0,
      machineRuleIds: Array.from(new Set(hits.map((hit) => hit.ruleId))).sort(),
      plannedActionCount: actions.length,
      human,
      agreement: agreementOf(divergence),
      divergence,
    });
  }
  return summarizeShadow(results, proposedActions);
}

function summarizeShadow(results: readonly ShadowEntryResult[], proposedActions: number): ShadowReport {
  const byDivergence: Record<DivergenceCode, number> = { ...EMPTY_DIVERGENCES };
  let agreements = 0;
  let disagreements = 0;
  let unknown = 0;
  for (const result of results) {
    byDivergence[result.divergence] = (byDivergence[result.divergence] ?? 0) + 1;
    if (result.agreement === 'agree') agreements += 1;
    else if (result.agreement === 'disagree') disagreements += 1;
    else unknown += 1;
  }
  const compared = agreements + disagreements;
  return {
    total: results.length,
    compared,
    agreements,
    disagreements,
    unknown,
    agreementRate: ratio(agreements, compared),
    byDivergence,
    missedIds: results
      .filter((item) => item.divergence === 'machine-silent-human-trapped')
      .map((item) => item.id)
      .sort(),
    noisyIds: results
      .filter((item) => item.divergence === 'machine-acted-human-false-positive')
      .map((item) => item.id)
      .sort(),
    proposedActions,
    appliedActions: 0,
    results,
  };
}

/**
 * Rapport d'écart prêt à publier : empreintes et compteurs, aucun texte de
 * ticket (§21), et la mention explicite de ce qui n'a pas été comparé.
 */
export function shadowDigest(report: ShadowReport): string[] {
  const lines = [
    `shadow: ${report.total} entrées, ${report.compared} comparées, ${report.unknown} sans verdict humain`,
    `accord: ${report.agreementRate === null ? 'non mesuré' : `${Math.round(report.agreementRate * 100)} %`}`,
    `désaccords: ${report.disagreements} (muets ${report.missedIds.length}, bavards ${report.noisyIds.length})`,
    `gestes proposés: ${report.proposedActions}, appliqués: ${report.appliedActions} (le shadow n'écrit rien)`,
  ];
  for (const code of Object.keys(report.byDivergence).sort()) {
    const count = report.byDivergence[code as DivergenceCode] ?? 0;
    if (count > 0) lines.push(`  écart ${code}: ${count}`);
  }
  return lines;
}
