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

import { detectConcealment } from '../core/c1-concealment';
import { detectAddressing } from '../core/c2-addressing';
import { decodeHits } from '../core/decode';
import { dedupeHits } from '../core/findings';
import { pressureHits } from '../core/pressure';
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

/** C1 — dissimulation (invisibles, bidi, couleur, texte alternatif, liens). */
function concealmentHits(entry: CorpusEntry, options: DetectorOptions): LayerHit[] {
  return detectConcealment({
    text: entry.text,
    language: entry.lang,
    knownHosts: [...(options.knownHosts ?? [])],
  });
}

/** C2 — adresse à une IA (lexiques fr et en du tronc). */
function addressingHits(entry: CorpusEntry, options: DetectorOptions): LayerHit[] {
  return detectAddressing(entry.text, {
    language: entry.lang,
    ignoredPhrases: [...(options.ignoredPhrases ?? [])],
    precisionByRule: options.precisionByRule,
    maxHits: options.maxHits,
  });
}

/** Blocs encodés : décodage prudent, puis **réanalyse** du décodé par C2. */
function encodedHits(entry: CorpusEntry, options: DetectorOptions): LayerHit[] {
  return decodeHits(entry.text, {
    language: entry.lang,
    reanalyze: (decoded, context) =>
      detectAddressing(decoded, { language: context.language, ignoredPhrases: [...(options.ignoredPhrases ?? [])] }),
  });
}

/** C4 — pression lexicale hors lexique (densité, consigne différée, acrostiche). */
function pressureSignals(entry: CorpusEntry): LayerHit[] {
  return pressureHits(entry.text, { language: entry.lang });
}

/** Signaux d'une entrée, dédupliqués et triés par position : sortie déterministe. */
export function detectEntry(entry: CorpusEntry, options: DetectorOptions = {}): LayerHit[] {
  const hits: LayerHit[] = [];
  if (plays(options, 'C1')) hits.push(...concealmentHits(entry, options));
  if (plays(options, 'C2')) hits.push(...addressingHits(entry, options));
  if (plays(options, 'decode')) hits.push(...encodedHits(entry, options));
  if (plays(options, 'pressure')) hits.push(...pressureSignals(entry));
  const deduped = dedupeHits(hits);
  const limited = options.maxHits === undefined ? deduped : deduped.slice(0, options.maxHits);
  return limited.sort((a, b) => a.startPos - b.startPos || a.ruleId.localeCompare(b.ruleId));
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
