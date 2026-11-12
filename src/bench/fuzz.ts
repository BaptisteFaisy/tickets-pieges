/**
 * Fuzzing par mutations (#16) — domaine pur, déterministe.
 *
 * Une charge détectée aujourd'hui peut cesser de l'être demain si l'attaquant
 * la réécrit. Ce module mesure cette robustesse : il applique à chaque charge
 * des mutations réalistes (invisibles, découpage de mots, synonymes, casse,
 * découpage sur plusieurs segments) et compte celles qui **cassent** la
 * détection. Une mutation qui casse est comptée, jamais masquée : c'est
 * l'indicateur d'honnêteté du banc (§21).
 *
 * Aucune mutation n'utilise `Math.random` : le tirage vient d'une graine
 * (`mulberry32`), donc deux runs sur les mêmes entrées rendent les mêmes
 * mutants — et les mêmes chiffres.
 */

import type { LayerHit } from '../core/types';
import type { CorpusEntry } from './corpus';
import { ratio, type Detector } from './metrics';

/** Les cinq mutations du brief. */
export type MutationId = 'invisible-insert' | 'word-split' | 'synonym-swap' | 'case-shift' | 'segment-split';

export const MUTATIONS: readonly MutationId[] = [
  'invisible-insert',
  'word-split',
  'synonym-swap',
  'case-shift',
  'segment-split',
];

/** Caractères invisibles réellement employés pour tromper un lexique. */
const INVISIBLES: readonly string[] = ['\u200B', '\u200C', '\u200D', '\uFEFF'];

/** Synonymes lexicaux : même intention, autre mot (fr et en). */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ignore: ['disregard', 'overlook'],
  ignorez: ['ne tenez pas compte de', 'écartez'],
  instruct: ['tell', 'order'],
  instructions: ['consignes', 'directives'],
  system: ['platform', 'internal'],
  système: ['plateforme', 'interne'],
  send: ['transmit', 'forward'],
  envoie: ['transmets', 'fais suivre'],
  password: ['secret', 'credential'],
  'mot de passe': ['identifiant secret', 'code d’accès'],
  assistant: ['agent', 'bot'],
  rules: ['policy', 'guidelines'],
  règles: ['politique', 'consignes'],
  reveal: ['disclose', 'leak'],
  révèle: ['divulgue', 'montre'],
};

/** Plafond de mutants par entrée (le banc doit rester sous 5 min en CI). */
export const MAX_MUTANTS_PER_ENTRY = 5;

/** Taille maximale d'un texte muté (au-delà, la mutation est refusée). */
export const MAX_MUTANT_CHARS = 6000;

export interface MutationOptions {
  /** Graine du tirage — même graine, mêmes mutants. */
  seed?: number;
  /** Plafond de mutants par entrée (défaut : `MAX_MUTANTS_PER_ENTRY`). */
  maxPerEntry?: number;
  /** Restreindre les mutations jouées (défaut : toutes). */
  only?: readonly MutationId[];
}

/** Un mutant : le texte transformé, ou ses segments quand il est découpé. */
export interface Mutant {
  readonly id: string;
  readonly entryId: string;
  readonly mutation: MutationId;
  readonly seed: number;
  /** Texte muté (concaténé pour `segment-split`). */
  readonly text: string;
  /** Segments à rejouer : un seul, sauf pour `segment-split`. */
  readonly segments: readonly string[];
  /** Vrai quand la mutation n'a rien changé (entrée trop courte, mot absent). */
  readonly inert: boolean;
}

/** Empreinte FNV-1a 32 bits d'une chaîne : graine stable propre à chaque entrée. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Générateur pseudo-aléatoire à graine — reproductible, sans `Math.random`. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(random: () => number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

/** Insère un invisible au cœur d'un mot : le lexique ne voit plus le mot. */
export function insertInvisible(text: string, random: () => number): string {
  const words = text.split(' ');
  if (words.length === 0) return text;
  const index = pickIndex(random, words.length);
  const word = words[index] ?? '';
  if (word.length < 3) return text;
  const at = 1 + pickIndex(random, word.length - 2);
  const invisible = INVISIBLES[pickIndex(random, INVISIBLES.length)] ?? INVISIBLES[0];
  words[index] = word.slice(0, at) + invisible + word.slice(at);
  return words.join(' ');
}

/** Coupe un mot en deux, séparé par un espace ou un tiret. */
export function splitWord(text: string, random: () => number): string {
  const words = text.split(' ');
  const longEnough = words.map((word, at) => ({ word, at })).filter((item) => item.word.length >= 6);
  if (longEnough.length === 0) return text;
  const chosen = longEnough[pickIndex(random, longEnough.length)];
  if (!chosen) return text;
  const cut = 2 + pickIndex(random, chosen.word.length - 3);
  const separator = random() < 0.5 ? ' ' : '-';
  words[chosen.at] = chosen.word.slice(0, cut) + separator + chosen.word.slice(cut);
  return words.join(' ');
}

/** Remplace un mot du lexique par un synonyme d'intention identique. */
export function swapSynonym(text: string, random: () => number): string {
  const lowered = text.toLowerCase();
  const keys = Object.keys(SYNONYMS).filter((key) => lowered.includes(key));
  if (keys.length === 0) return text;
  const key = keys[pickIndex(random, keys.length)];
  if (!key) return text;
  const replacements = SYNONYMS[key] ?? [];
  if (replacements.length === 0) return text;
  const replacement = replacements[pickIndex(random, replacements.length)];
  const at = lowered.indexOf(key);
  return text.slice(0, at) + replacement + text.slice(at + key.length);
}

/** Change la casse : tout en majuscules, ou une lettre sur deux. */
export function shiftCase(text: string, random: () => number): string {
  if (random() < 0.5) return text.toUpperCase();
  let out = '';
  let upper = random() < 0.5;
  for (const char of text) {
    out += upper ? char.toUpperCase() : char.toLowerCase();
    if (char !== ' ') upper = !upper;
  }
  return out;
}

/** Découpe le texte en segments, comme plusieurs messages d'une campagne. */
export function splitSegments(text: string, random: () => number): string[] {
  const sentences = text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (sentences.length < 2) {
    const middle = Math.max(1, Math.floor(text.length * (0.35 + random() * 0.3)));
    return [text.slice(0, middle).trim(), text.slice(middle).trim()].filter((part) => part.length > 0);
  }
  const groups: string[] = [];
  let current: string[] = [];
  for (const sentence of sentences) {
    current.push(sentence);
    if (current.length >= 1 + pickIndex(random, 2)) {
      groups.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) groups.push(current.join(' '));
  return groups.length >= 2 ? groups : [sentences.join(' '), text];
}

function applyMutation(text: string, mutation: MutationId, random: () => number): string[] {
  switch (mutation) {
    case 'invisible-insert':
      return [insertInvisible(text, random)];
    case 'word-split':
      return [splitWord(text, random)];
    case 'synonym-swap':
      return [swapSynonym(text, random)];
    case 'case-shift':
      return [shiftCase(text, random)];
    case 'segment-split':
      return splitSegments(text, random);
    default:
      return [text];
  }
}

/** Produit les mutants d'une entrée (les charges seulement : un texte sain n'a rien à casser). */
export function mutateEntry(entry: CorpusEntry, options: MutationOptions = {}): Mutant[] {
  if (entry.label !== 'attack') return [];
  const seed = options.seed ?? 1;
  const max = Math.min(options.maxPerEntry ?? MAX_MUTANTS_PER_ENTRY, MAX_MUTANTS_PER_ENTRY);
  const played = (options.only ?? MUTATIONS).filter((mutation) => MUTATIONS.includes(mutation));
  // Rotation déterministe par empreinte de l'identifiant : quand le plafond est
  // bas, chaque entrée ne joue pas toujours les mêmes mutations — la couverture
  // des cinq reste équilibrée sur tout le corpus.
  const entrySeed = hashSeed(`${seed}:${entry.id}`);
  const rotation = played.length === 0 ? 0 : entrySeed % played.length;
  const ordered = [...played.slice(rotation), ...played.slice(0, rotation)];
  const mutants: Mutant[] = [];
  for (let i = 0; i < ordered.length && mutants.length < max; i += 1) {
    const mutation = ordered[i];
    if (!mutation) continue;
    const random = mulberry32(entrySeed + i * 7919);
    const segments = applyMutation(entry.text, mutation, random).filter((part) => part.length <= MAX_MUTANT_CHARS);
    if (segments.length === 0) continue;
    const text = segments.join(' \u2029 ');
    mutants.push({
      id: `${entry.id}~${mutation}~${entrySeed + i}`,
      entryId: entry.id,
      mutation,
      seed: entrySeed + i,
      text,
      segments,
      inert: segments.length === 1 && segments[0] === entry.text,
    });
  }
  return mutants;
}

export function mutateCorpus(entries: readonly CorpusEntry[], options: MutationOptions = {}): Mutant[] {
  const all: Mutant[] = [];
  for (const entry of entries) all.push(...mutateEntry(entry, options));
  return all;
}

/** Entrée synthétique rejouée pour un mutant — même type, donc même détecteur. */
export function mutantAsEntry(entry: CorpusEntry, mutant: Mutant, text: string): CorpusEntry {
  return { ...entry, id: mutant.id, text, expectedRuleIds: [] };
}

export interface MutationOutcome {
  readonly mutantId: string;
  readonly entryId: string;
  readonly mutation: MutationId;
  readonly inert: boolean;
  /** Détecté avant mutation (référence : sans elle, rien à casser). */
  readonly baselineDetected: boolean;
  readonly mutatedDetected: boolean;
  /** La mutation a fait tomber la détection : c'est le chiffre qui compte. */
  readonly broken: boolean;
  readonly ruleIdsBefore: readonly string[];
  readonly ruleIdsAfter: readonly string[];
  /** Segments touchés sur le total (découpage multi-messages). */
  readonly segmentsDetected: number;
  readonly segmentsTotal: number;
}

function ruleIdsOf(hits: readonly LayerHit[]): string[] {
  return Array.from(new Set(hits.map((hit) => hit.ruleId))).sort();
}

/** Rejoue un mutant : union des signaux de ses segments. */
export function detectMutant(entry: CorpusEntry, mutant: Mutant, detect: Detector): MutationOutcome {
  const baseline = detect(entry);
  let after: LayerHit[] = [];
  let segmentsDetected = 0;
  for (const segment of mutant.segments) {
    const hits = detect(mutantAsEntry(entry, mutant, segment));
    if (hits.length > 0) segmentsDetected += 1;
    after.push(...hits);
  }
  const baselineDetected = baseline.length > 0;
  const mutatedDetected = after.length > 0;
  return {
    mutantId: mutant.id,
    entryId: mutant.entryId,
    mutation: mutant.mutation,
    inert: mutant.inert,
    baselineDetected,
    mutatedDetected,
    broken: baselineDetected && !mutatedDetected,
    ruleIdsBefore: ruleIdsOf(baseline),
    ruleIdsAfter: ruleIdsOf(after),
    segmentsDetected,
    segmentsTotal: mutant.segments.length,
  };
}

export interface MutationScore {
  readonly mutation: MutationId;
  readonly total: number;
  readonly survived: number;
  readonly broken: number;
  /** Part des mutants encore détectés ; `null` si aucun mutant joué. */
  readonly robustness: number | null;
}

export interface RobustnessReport {
  readonly total: number;
  readonly survived: number;
  readonly broken: number;
  readonly robustness: number | null;
  readonly byMutation: readonly MutationScore[];
  /** Mutants qui ont cassé la détection : à corriger en priorité. */
  readonly brokenIds: readonly string[];
  readonly outcomes: readonly MutationOutcome[];
}

/** Mesure la robustesse d'un corpus : mutants joués, cassures comptées. */
export function measureRobustness(
  entries: readonly CorpusEntry[],
  detect: Detector,
  options: MutationOptions = {},
): RobustnessReport {
  const outcomes: MutationOutcome[] = [];
  for (const entry of entries) {
    for (const mutant of mutateEntry(entry, options)) outcomes.push(detectMutant(entry, mutant, detect));
  }
  const scored = outcomes.filter((outcome) => outcome.baselineDetected && !outcome.inert);
  const byMutation: MutationScore[] = MUTATIONS.map((mutation) => {
    const group = scored.filter((outcome) => outcome.mutation === mutation);
    const broken = group.filter((outcome) => outcome.broken).length;
    return {
      mutation,
      total: group.length,
      survived: group.length - broken,
      broken,
      robustness: ratio(group.length - broken, group.length),
    };
  });
  const broken = scored.filter((outcome) => outcome.broken).length;
  return {
    total: scored.length,
    survived: scored.length - broken,
    broken,
    robustness: ratio(scored.length - broken, scored.length),
    byMutation,
    brokenIds: scored.filter((outcome) => outcome.broken).map((outcome) => outcome.mutantId).sort(),
    outcomes,
  };
}
