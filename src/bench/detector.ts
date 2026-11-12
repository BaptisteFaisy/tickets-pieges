/**
 * Détecteur du banc — la seule chaîne de détection utilisée par le banc.
 *
 * Ce module existe pour ne **rien dupliquer** : `tools/bench.mjs` et les tests
 * appellent le même assemblage des couches réelles du produit (C1 dissimulation,
 * C2 adresse à une IA, décodage prudent et sa réanalyse, C4 pression lexicale).
 * Il n'ajoute aucune règle : il joue celles du tronc sur une entrée de corpus.
 *
 * C3 (modèle encadré) n'est **jamais** jouée ici : le banc est hors ligne, aucun
 * modèle n'est appelé, et le rapport le dit (§21 — ce qui n'est pas analysé est
 * déclaré, pas sous-entendu).
 */

import { detectText, type DetectLayer } from '../core/detect';
import type { LayerHit } from '../core/types';
import type { CorpusEntry } from './corpus';
import type { Detector } from './metrics';

/** Blocs joués par le banc hors ligne. */
export type BenchLayer = 'C1' | 'C2' | 'decode' | 'pressure';

export const BENCH_LAYERS: readonly BenchLayer[] = ['C1', 'C2', 'decode', 'pressure'];

/** Couches non jouées, et pourquoi — repris tel quel dans le rapport. */
export const BENCH_GAPS: readonly { layer: string; reason: string }[] = [
  { layer: 'C3', reason: 'modèle non appelé : le banc est hors ligne' },
  { layer: 'C4-contexte', reason: 'métadonnées de segment absentes du corpus (canal, âge du compte)' },
];

export interface DetectorOptions {
  /** Restreindre les blocs joués (défaut : tous). */
  layers?: readonly BenchLayer[];
  /** Formules ignorées du projet, transmises à C2 (§14). */
  ignoredPhrases?: readonly string[];
  /** Précision mesurée par règle, transmise à C2. */
  precisionByRule?: Readonly<Record<string, number>>;
  /** Plafond de constats par entrée. */
  maxHits?: number;
  /** Hôtes connus du site, transmis à C1 (liens). */
  knownHosts?: readonly string[];
}

function plays(options: DetectorOptions, layer: BenchLayer): boolean {
  return (options.layers ?? BENCH_LAYERS).includes(layer);
}

/**
 * Signaux d'une entrée : **la détection partagée** (`src/core/detect.ts`), celle
 * que jouent la production et le site. Le banc ne mesure donc pas autre chose que
 * ce que fait le produit — c'est la condition pour que ses chiffres veuillent
 * dire quelque chose (§14).
 */
export function detectEntry(entry: CorpusEntry, options: DetectorOptions = {}): LayerHit[] {
  return detectText(entry.text, {
    language: entry.lang,
    ignoredPhrases: [...(options.ignoredPhrases ?? [])],
    knownHosts: [...(options.knownHosts ?? [])],
    precisionByRule: options.precisionByRule,
    maxHits: options.maxHits,
    layers: (options.layers ?? BENCH_LAYERS) as readonly DetectLayer[],
  });
}

/** Fabrique le détecteur injectable attendu par `metrics.ts`, `fuzz.ts`, `shadow.ts`. */
export function createDetector(options: DetectorOptions = {}): Detector {
  return (entry) => detectEntry(entry, options);
}

/** Ce que le banc a joué et ce qu'il n'a pas joué — une ligne par écart. */
export function benchGapLines(options: DetectorOptions = {}): string[] {
  const played = (options.layers ?? BENCH_LAYERS).join(', ');
  const lines = [`blocs joués : ${played}`];
  for (const gap of BENCH_GAPS) lines.push(`non joué : ${gap.layer} — ${gap.reason}`);
  return lines;
}
