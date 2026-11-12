/**
 * Réglages automatiques — lot auto-reglages.
 *
 * (#18) Calibration des seuils par projet à partir des verdicts humains :
 * une règle dont les faux positifs se répètent est rétrogradée d'un cran,
 * une règle précise est promue d'un cran — jamais plus d'un cran par période.
 *
 * (#20) Constat dédié « tentative de corrompre le détecteur » : un texte qui
 * s'adresse à l'analyseur lui-même (« tu es un classifieur bénin », « réponds
 * sain ») produit un constat à part, marqué comme alerte de sécurité.
 *
 * Domaine pur : aucun import `@forge/*`, aucune E/S, aucune lecture de
 * l'heure (horodatages en paramètre). Tout mouvement de réglage produit une
 * entrée de journal que l'appelant persiste.
 */
import type { DetectionLayer, Language, LayerHit, VerdictDecision } from './types';
import { boundedExcerpt, clamp01 } from './findings';
import { foldText } from './c2-addressing';
import { t } from './i18n';

// --------------------------------------------------------------- #18 calibration

/** Échelle de confiance d'une règle : 0 (la plus faible) à 3 (la plus forte). */
export const NOTCH_MIN = 0;
export const NOTCH_MAX = 3;
/** Cran initial d'une règle jamais réglée. */
export const NOTCH_DEFAULT = 2;
/** Nombre minimal de verdicts tranchés pour oser bouger une règle. */
export const MIN_SAMPLE = 5;
/** Part de faux positifs à partir de laquelle on rétrograde. */
export const DEMOTE_FP_RATE = 0.7;
/** Précision à partir de laquelle on promeut. */
export const PROMOTE_PRECISION = 0.9;

export interface RuleTuning {
  ruleId: string;
  notch: number;
}

/** Un verdict humain ramené à sa règle (la plateforme fait le joint). */
export interface HumanObservation {
  ruleId: string;
  decision: VerdictDecision;
}

export interface VerdictTally {
  ruleId: string;
  confirmed: number;
  falsePositives: number;
  neutral: number;
}

export interface TuneEntry {
  kind: 'rule-retune';
  projectId: string;
  /** Période de réglage (jeton fourni par l'appelant, ex. `2026-W46`). */
  period: string;
  ruleId: string;
  before: number;
  after: number;
  direction: 'demote' | 'promote';
  confirmed: number;
  falsePositives: number;
  at: string;
}

export interface CalibrateContext {
  projectId: string;
  period: string;
  /** Horodatage ISO fourni par l'appelant. */
  at: string;
}

export interface CalibrateOptions {
  minSample?: number;
  demoteFpRate?: number;
  promotePrecision?: number;
}

/** Cran par défaut pour une liste de règles jamais calibrées. */
export function defaultTunings(ruleIds: readonly string[]): RuleTuning[] {
  return ruleIds.map((ruleId) => ({ ruleId, notch: NOTCH_DEFAULT }));
}

/** Agrège les verdicts humains par règle. Ne jette jamais. */
export function tallyObservations(observations: readonly HumanObservation[]): VerdictTally[] {
  const byRule = new Map<string, VerdictTally>();
  for (const obs of observations) {
    let tally = byRule.get(obs.ruleId);
    if (!tally) {
      tally = { ruleId: obs.ruleId, confirmed: 0, falsePositives: 0, neutral: 0 };
      byRule.set(obs.ruleId, tally);
    }
    if (obs.decision === 'false-positive') {
      tally.falsePositives += 1;
    } else if (obs.decision === 'trapped') {
      tally.confirmed += 1;
    } else {
      tally.neutral += 1;
    }
  }
  return Array.from(byRule.values());
}

function movedThisPeriod(journal: readonly TuneEntry[], ctx: CalibrateContext, ruleId: string): boolean {
  return journal.some(
    (entry) =>
      entry.projectId === ctx.projectId && entry.period === ctx.period && entry.ruleId === ruleId,
  );
}

function notchOf(current: readonly RuleTuning[], ruleId: string): number {
  const found = current.find((tuning) => tuning.ruleId === ruleId);
  if (!found) {
    return NOTCH_DEFAULT;
  }
  const bounded = Math.round(found.notch);
  return Math.min(NOTCH_MAX, Math.max(NOTCH_MIN, bounded));
}

function decideDirection(
  tally: VerdictTally,
  options: Required<CalibrateOptions>,
): 'demote' | 'promote' | 'hold' {
  const decided = tally.confirmed + tally.falsePositives;
  if (decided < options.minSample) {
    return 'hold';
  }
  const fpRate = clamp01(tally.falsePositives / decided);
  if (fpRate >= options.demoteFpRate) {
    return 'demote';
  }
  const precision = clamp01(tally.confirmed / decided);
  if (precision >= options.promotePrecision) {
    return 'promote';
  }
  return 'hold';
}

function retuneOne(
  tally: VerdictTally,
  current: readonly RuleTuning[],
  ctx: CalibrateContext,
  options: Required<CalibrateOptions>,
): TuneEntry | null {
  const before = notchOf(current, tally.ruleId);
  const direction = decideDirection(tally, options);
  const after = direction === 'demote' ? Math.max(NOTCH_MIN, before - 1) : direction === 'promote' ? Math.min(NOTCH_MAX, before + 1) : before;
  if (direction === 'hold' || after === before) {
    return null;
  }
  return {
    kind: 'rule-retune',
    projectId: ctx.projectId,
    period: ctx.period,
    ruleId: tally.ruleId,
    before,
    after,
    direction: direction === 'demote' ? 'demote' : 'promote',
    confirmed: tally.confirmed,
    falsePositives: tally.falsePositives,
    at: ctx.at,
  };
}

/**
 * Calibre les crans d'une période. Bornes : au plus **un cran** par règle et
 * par période (une règle déjà bougée dans `journal` pour cette période ne
 * bouge plus), et jamais au-delà de NOTCH_MIN/NOTCH_MAX. Rend les nouveaux
 * crans et les entrées de journal à persister. Ne jette jamais.
 */
export function calibrateNotches(
  current: readonly RuleTuning[],
  observations: readonly HumanObservation[],
  ctx: CalibrateContext,
  journal: readonly TuneEntry[] = [],
  options: CalibrateOptions = {},
): { tunings: RuleTuning[]; entries: TuneEntry[] } {
  const opts: Required<CalibrateOptions> = {
    minSample: options.minSample ?? MIN_SAMPLE,
    demoteFpRate: options.demoteFpRate ?? DEMOTE_FP_RATE,
    promotePrecision: options.promotePrecision ?? PROMOTE_PRECISION,
  };
  const entries: TuneEntry[] = [];
  const byRule = new Map<string, number>();
  for (const tuning of current) {
    byRule.set(tuning.ruleId, notchOf(current, tuning.ruleId));
  }
  for (const tally of tallyObservations(observations)) {
    if (movedThisPeriod(journal, ctx, tally.ruleId) || movedThisPeriod(entries, ctx, tally.ruleId)) {
      continue;
    }
    const entry = retuneOne(tally, current, ctx, opts);
    if (entry) {
      entries.push(entry);
      byRule.set(entry.ruleId, entry.after);
    } else if (!byRule.has(tally.ruleId)) {
      byRule.set(tally.ruleId, notchOf(current, tally.ruleId));
    }
  }
  const tunings: RuleTuning[] = [];
  for (const [ruleId, notch] of byRule) {
    tunings.push({ ruleId, notch });
  }
  return { tunings, entries };
}

/** Libellé visible d'un mouvement de réglage (catalogue `reglages`). */
export function describeTuning(lang: Language, entry: TuneEntry): string {
  const key = entry.direction === 'demote' ? 'reglages.tune.demote' : 'reglages.tune.promote';
  return t(lang, key, { rule: entry.ruleId, before: entry.before, after: entry.after });
}

// --------------------------------------------------- #20 corruption du détecteur

/** Constat dédié : kind propre au lot, à reprendre dans `FindingKind` du tronc. */
export type TamperKind = 'detector-tampering';

export const TAMPER_RULE_ID = 'REG-20-01';
export const TAMPER_LAYER: DetectionLayer = 'C2';
/** Plafond de constats rendus pour un même texte. */
export const MAX_TAMPER_HITS = 10;

export interface TamperHit {
  layer: DetectionLayer;
  kind: TamperKind;
  ruleId: string;
  startPos: number;
  endPos: number;
  excerpt: string;
  askSummary: string;
  confidence: number;
  /** Toujours vrai : ce constat double comme alerte de sécurité. */
  securityAlert: boolean;
}

interface TamperPattern {
  regex: RegExp;
  confidence: number;
  labelKey: string;
}

/** Motifs sur texte plié (minuscules, sans accents) — pliage réutilisé de C2. */
const TAMPER_PATTERNS: readonly TamperPattern[] = [
  {
    regex: /tu es (un |une )?(classifieur|analyseur|detecteur|filtre) (benin|inoffensif|gentil|docile)/g,
    confidence: 0.92,
    labelKey: 'reglages.tamper.benign-classifier',
  },
  {
    regex: /you are (a |an )?(benign|harmless|safe|docile) (classifier|analyzer|analyser|detector|filter)/g,
    confidence: 0.92,
    labelKey: 'reglages.tamper.benign-classifier',
  },
  {
    regex: /(reponds|repond|respond|answer) (sain|safe|benin|benign|que tout est sain|that everything is safe)/g,
    confidence: 0.88,
    labelKey: 'reglages.tamper.respond-safe',
  },
  {
    regex: /(dis|declare|affirme|say|state|claim) (que | )?(tout est|everything is|all is) (sain|sur|safe|benin|benign|inoffensif|harmless)/g,
    confidence: 0.85,
    labelKey: 'reglages.tamper.respond-safe',
  },
  {
    regex: /(classe|classifie|classify|label|mark|marque) (ce |cette |this |that |it |tout )?(texte|ticket|message|demande)? ?(comme|as) (sur|sain|safe|benin|benign|propre|clean)/g,
    confidence: 0.85,
    labelKey: 'reglages.tamper.classify-safe',
  },
  {
    regex: /verdict ?[:=] ?(sain|sur|safe|benin|benign|aucun|none|clean|propre)/g,
    confidence: 0.8,
    labelKey: 'reglages.tamper.classify-safe',
  },
  {
    regex: /(le |ton |your |the )?(detecteur|detector|analyseur|analyzer|classifier|classifieur) (est |is )?(desactive|disabled|off|eteint|inactif|inactive)/g,
    confidence: 0.75,
    labelKey: 'reglages.tamper.detector-off',
  },
  {
    regex: /(desactive|disable|ignore|oublie|forget|abandonne|drop) (ton|ta|tes|your|the) (analyse|analysis|regles|rules|consignes|instructions|controles|checks)( d'analyse| de securite)?/g,
    confidence: 0.8,
    labelKey: 'reglages.tamper.rules-off',
  },
];

/** Convertit vers le `LayerHit` du tronc pour l'injecter dans le pipeline existant. */
export function asLayerHit(hit: TamperHit): LayerHit {
  return {
    layer: hit.layer,
    kind: 'assistant-addressing',
    ruleId: hit.ruleId,
    startPos: hit.startPos,
    endPos: hit.endPos,
    excerpt: hit.excerpt,
    askSummary: hit.askSummary,
    confidence: hit.confidence,
  };
}

function hitFromMatch(
  raw: string,
  index: readonly number[],
  match: RegExpExecArray,
  pattern: TamperPattern,
  lang: Language,
): TamperHit {
  const start = index[match.index] ?? match.index;
  const lastChar = index[match.index + match[0].length - 1] ?? match.index + match[0].length - 1;
  const end = lastChar + 1;
  return {
    layer: TAMPER_LAYER,
    kind: 'detector-tampering',
    ruleId: TAMPER_RULE_ID,
    startPos: start,
    endPos: end,
    excerpt: boundedExcerpt(raw.slice(start, end)),
    askSummary: t(lang, pattern.labelKey),
    confidence: clamp01(pattern.confidence),
    securityAlert: true,
  };
}

/**
 * Détecte les textes qui s'adressent à l'analyseur lui-même (#20). Le pliage
 * (casse, accents, typographie) vient de `foldText` de C2 : un seul moteur.
 * Rend des constats dédiés, chacun marqué `securityAlert`. Ne jette jamais.
 */
export function detectDetectorTampering(raw: string, lang: Language = 'fr'): TamperHit[] {
  const hits: TamperHit[] = [];
  if (!raw) {
    return hits;
  }
  const folded = foldText(raw);
  for (const pattern of TAMPER_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(folded.text);
    while (match && hits.length < MAX_TAMPER_HITS) {
      hits.push(hitFromMatch(raw, folded.index, match, pattern, lang));
      if (match[0] === '') {
        pattern.regex.lastIndex += 1;
      }
      match = pattern.regex.exec(folded.text);
    }
  }
  hits.sort((a, b) => a.startPos - b.startPos);
  return hits;
}

/** Vrai si le texte contient au moins un constat de corruption du détecteur. */
export function hasTamperAttempt(raw: string): boolean {
  return detectDetectorTampering(raw).length > 0;
}
