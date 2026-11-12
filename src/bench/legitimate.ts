/**
 * Taux de faux positifs du corpus **légitime** et seuil bloquant (#lot 7).
 *
 * Le corpus légitime (`data/corpus/legitimate-*.json`) est la contre-partie des
 * charges : des textes ordinaires (support, facture, RGPD, devis, logs, code,
 * courriels internes, contrats) qui ne doivent **jamais** déclencher, plus un
 * sous-ensemble « piège » (`trap: true`) — textes légitimes qui ressemblent à
 * une charge (mentions légales, « ignorez les remarques précédentes » cité dans
 * une documentation, code qui parle d'injection). Les pièges mesurent le bruit ;
 * ils ne portent aucune charge, la détection ne doit pas les relever non plus.
 *
 * Ce module est **pur** : il reçoit les entrées et un détecteur injecté
 * (`metrics.Detector`), et rend des chiffres. Il ne lit aucun fichier.
 *
 * Le **seuil** sépare deux exigences, pas deux objets de même nature :
 * - textes ordinaires : taux de faux positifs nul, et **aucun motif C2** ;
 * - corpus piège : une tolérance explicite, plafonnée (ils sont les cas limites).
 */

import { round } from './metrics';
import type { LayerHit } from '../core/types';
import type { CorpusEntry } from './corpus';
import type { Detector } from './metrics';

/** Entrée du corpus légitime : un texte ordinaire, ou un « piège » marqué. */
export interface LegitCorpusEntry extends CorpusEntry {
  /** Vrai pour un cas limite « piège » (bruit attendu, jamais une charge). */
  readonly trap?: boolean;
}

/** Faux positifs relevés pour une règle, répartis ordinaires / pièges. */
export interface LegitPerRule {
  readonly ruleId: string;
  readonly layer: LayerHit['layer'];
  readonly falsePositivesPlain: number;
  readonly falsePositivesTrap: number;
}

/** Mesure du corpus légitime : ce que le rapport et la porte affichent. */
export interface LegitMeasure {
  readonly total: number;
  readonly plainCount: number;
  readonly trapCount: number;
  /** Identifiants des textes ordinaires relevés à tort (doit être vide). */
  readonly plainFalsePositives: readonly string[];
  /** Identifiants des textes « piège » relevés (bruit mesuré). */
  readonly trapFalsePositives: readonly string[];
  readonly plainFpRate: number;
  readonly trapFpRate: number;
  /** Nombre de textes ordinaires portant au moins un motif C2 (seuil : 0). */
  readonly plainC2Fp: number;
  readonly perRule: readonly LegitPerRule[];
}

/** Seuil bloquant : deux plafonds, ordinaires vs pièges. */
export interface LegitThreshold {
  /** Taux maximal de faux positifs sur les textes ordinaires (0). */
  readonly plainMaxFpRate: number;
  /** Taux maximal de bruit toléré sur le corpus piège. */
  readonly trapMaxFpRate: number;
  /** Nombre maximal de textes ordinaires portant un motif C2 (0). */
  readonly plainMaxC2Fp: number;
}

/** Seuil par défaut du lot : zéro faux positif ordinaire, tolérance sur les pièges. */
export function defaultThreshold(): LegitThreshold {
  return { plainMaxFpRate: 0, trapMaxFpRate: 0.5, plainMaxC2Fp: 0 };
}

/** Sépare le corpus légitime en textes ordinaires et textes « piège ». */
export function splitLegit(
  entries: readonly LegitCorpusEntry[],
): { plain: LegitCorpusEntry[]; trap: LegitCorpusEntry[] } {
  const plain: LegitCorpusEntry[] = [];
  const trap: LegitCorpusEntry[] = [];
  for (const entry of entries) {
    if (entry.trap) trap.push(entry);
    else plain.push(entry);
  }
  return { plain, trap };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

/**
 * Mesure les faux positifs du corpus légitime : combien de textes ordinaires
 * (et de pièges) sont relevés à tort, par règle, et le taux correspondant.
 */
export function measureLegit(
  entries: readonly LegitCorpusEntry[],
  detect: Detector,
): LegitMeasure {
  const { plain, trap } = splitLegit(entries);
  interface RuleCount {
    ruleId: string;
    layer: LayerHit['layer'];
    falsePositivesPlain: number;
    falsePositivesTrap: number;
  }
  const perRule = new Map<string, RuleCount>();

  const count = (hit: LayerHit, isTrap: boolean): void => {
    const current = perRule.get(hit.ruleId) ?? {
      ruleId: hit.ruleId,
      layer: hit.layer,
      falsePositivesPlain: 0,
      falsePositivesTrap: 0,
    };
    if (isTrap) current.falsePositivesTrap += 1;
    else current.falsePositivesPlain += 1;
    perRule.set(hit.ruleId, current);
  };

  const plainFalsePositives: string[] = [];
  const trapFalsePositives: string[] = [];
  let plainC2Fp = 0;

  for (const entry of plain) {
    const hits = detect(entry) ?? [];
    if (hits.length > 0) plainFalsePositives.push(entry.id);
    if (hits.some((hit) => hit.layer === 'C2')) plainC2Fp += 1;
    for (const hit of hits) count(hit, false);
  }
  for (const entry of trap) {
    const hits = detect(entry) ?? [];
    if (hits.length > 0) trapFalsePositives.push(entry.id);
    for (const hit of hits) count(hit, true);
  }

  const perRuleSorted: LegitPerRule[] = Array.from(perRule.values())
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    total: entries.length,
    plainCount: plain.length,
    trapCount: trap.length,
    plainFalsePositives: plainFalsePositives.sort(),
    trapFalsePositives: trapFalsePositives.sort(),
    plainFpRate: rate(plainFalsePositives.length, plain.length),
    trapFpRate: rate(trapFalsePositives.length, trap.length),
    plainC2Fp,
    perRule: perRuleSorted,
  };
}

/**
 * Compare la mesure au seuil. Rend la liste des exigences dépassées (vide = tenu).
 * C'est la décision pure que la porte `tools/check-fp-threshold.mjs` applique.
 */
export function checkThreshold(measure: LegitMeasure, threshold: LegitThreshold): string[] {
  const exceeded: string[] = [];
  if (measure.plainFpRate > threshold.plainMaxFpRate) {
    exceeded.push(
      'faux positifs sur textes ordinaires : ' +
        String(measure.plainFalsePositives.length) +
        '/' +
        String(measure.plainCount) +
        ' (taux ' +
        String(measure.plainFpRate) +
        ') > seuil ' +
        String(threshold.plainMaxFpRate),
    );
  }
  if (measure.plainC2Fp > threshold.plainMaxC2Fp) {
    exceeded.push(
      'motifs C2 sur textes de support ordinaires : ' +
        String(measure.plainC2Fp) +
        ' (seuil ' +
        String(threshold.plainMaxC2Fp) +
        ')',
    );
  }
  if (measure.trapFpRate > threshold.trapMaxFpRate) {
    exceeded.push(
      'bruit du corpus piège : ' +
        String(measure.trapFalsePositives.length) +
        '/' +
        String(measure.trapCount) +
        ' (taux ' +
        String(measure.trapFpRate) +
        ') > seuil ' +
        String(threshold.trapMaxFpRate),
    );
  }
  return exceeded;
}