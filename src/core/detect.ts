/**
 * **Une seule implémentation de la détection** — le point d'entrée commun du
 * produit, du banc d'essai et du site.
 *
 * Pourquoi ce fichier existe : jusqu'ici, trois appelants assemblaient les couches
 * à leur main, et ils n'assemblaient pas la même chose. Le banc jouait C1 + C2 +
 * décodage + pression, la production (les déclencheurs Forge) ne jouait que C1 +
 * C2, et le site rejouait la production. Résultat mesuré sur le site réel le
 * 12 novembre 2026 : une demande contenant un long bloc encodé était
 * « suspecte » dans le jeu d'essai et **propre** sur le ticket — parce que le
 * décodeur n'était branché ni dans la production ni dans le banc d'essai.
 *
 * La règle de la maison (`docs/ARCHITECTURE.md` §1) s'applique ici aussi : une
 * règle écrite une fois, utilisée partout.
 */

import { detectConcealment } from './c1-concealment';
import { detectAddressing } from './c2-addressing';
import { decodeHits } from './decode';
import { pressureHits } from './pressure';
import { dedupeHits } from './findings';
import type { Language, LayerHit } from './types';

/** Les familles déterministes qu'une détection peut jouer. */
export type DetectLayer = 'C1' | 'C2' | 'decode' | 'pressure';

/** Toutes les familles : le comportement par défaut du produit. */
export const DETECT_LAYERS: readonly DetectLayer[] = ['C1', 'C2', 'decode', 'pressure'];

export interface DetectOptions {
  /** Langue de détection (fr, en, ou une langue de lexique). */
  language: Language;
  /** Formules à ignorer (§14) : mentions légales, signatures. */
  ignoredPhrases?: readonly string[];
  /** Hôtes connus du site : un lien vers un autre hôte est signalé (C1). */
  knownHosts?: readonly string[];
  /** Précision par règle : une règle rétrogradée ne lève plus de constat (§14). */
  precisionByRule?: Readonly<Record<string, number>>;
  /** Plafond de constats rendus (le banc l'utilise pour rester rapide). */
  maxHits?: number;
  /** Familles à jouer ; par défaut, toutes. */
  layers?: readonly DetectLayer[];
}

/** C1 — dissimulation : invisibles, bidi, couleur du fond, alt d'image, liens. */
function concealmentHits(text: string, options: DetectOptions): LayerHit[] {
  return detectConcealment({
    text,
    language: options.language,
    knownHosts: [...(options.knownHosts ?? [])],
  });
}

/** C2 — adresse à une IA : impératifs, rôle, faux système, outils, exfiltration. */
function addressingHits(text: string, options: DetectOptions): LayerHit[] {
  return detectAddressing(text, {
    language: options.language,
    ignoredPhrases: [...(options.ignoredPhrases ?? [])],
    precisionByRule: options.precisionByRule,
    maxHits: options.maxHits,
  });
}

/**
 * Blocs encodés : décodage prudent, puis **réanalyse** du décodé par C2 — un
 * encodage ne doit pas servir d'écran.
 */
function encodedHits(text: string, options: DetectOptions): LayerHit[] {
  return decodeHits(text, {
    language: options.language,
    reanalyze: (decoded, context) =>
      detectAddressing(decoded, {
        language: context.language,
        ignoredPhrases: [...(options.ignoredPhrases ?? [])],
      }),
  });
}

/** Pression lexicale hors lexique : densité, consigne différée, acrostiche (C4). */
function pressureSignals(text: string, options: DetectOptions): LayerHit[] {
  return pressureHits(text, { language: options.language });
}

/** Constats d'un texte : dédupliqués, bornés, triés par position. */
export function detectText(text: string, options: DetectOptions): LayerHit[] {
  const layers = options.layers ?? DETECT_LAYERS;
  const hits: LayerHit[] = [];
  if (layers.includes('C1')) hits.push(...concealmentHits(text, options));
  if (layers.includes('C2')) hits.push(...addressingHits(text, options));
  if (layers.includes('decode')) hits.push(...encodedHits(text, options));
  if (layers.includes('pressure')) hits.push(...pressureSignals(text, options));
  const deduped = dedupeHits(hits);
  const limited = options.maxHits === undefined ? deduped : deduped.slice(0, options.maxHits);
  return limited.sort((a, b) => a.startPos - b.startPos || a.ruleId.localeCompare(b.ruleId));
}
