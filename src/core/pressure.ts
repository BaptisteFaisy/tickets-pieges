/**
 * Couche C4 — pression lexicale (§6) : des signaux **hors lexique**.
 *
 * Trois indicateurs, tous rendus en `LayerHit` de couche **C4** — une
 * pondération, jamais un verdict seul (même contrat que `context.ts`) :
 *   - densité d'impératifs par 100 mots (verbes d'action en tête de phrase,
 *     toutes langues via des formes courtes sans accent) ;
 *   - consignes différées (« plus tard », « quand tu auras fini », « après avoir »…) ;
 *   - stéganographie lexicale simple : acrostiche d'action sur les initiales de
 *     lignes, dès cinq lignes.
 *
 * Règle d'honnêteté (§21) : chaque confiance reste en dessous du seuil d'une
 * preuve déterministe, et un texte de support ordinaire ne lève aucun signal.
 */

import type { FindingKind, Language, LayerHit } from './types';
import { clamp01 } from './findings';
import { t } from './i18n';

/** Types de signal de pression — propres à ce lot, à reporter dans `types.ts`. */
export type PressureKind = 'imperative-density' | 'deferred-instruction' | 'text-acrostich';

/** Réglages de la couche ; la langue choisit les libellés, pas les motifs. */
export interface PressureOptions {
  language?: Language;
}

/** Seuil de densité d'impératifs, en verbes d'action pour 100 mots. */
const IMPERATIVE_DENSITY_PER_100 = 8;
/** Nombre minimal de verbes d'action en tête de phrase pour lever le signal. */
const MIN_IMPERATIVES = 2;
/** Nombre minimal de lignes pour qu'un acrostiche soit lisible. */
const MIN_ACROSTICH_LINES = 5;

/**
 * Verbes d'action courts (infinitif / impératif), sans accent, en minuscules.
 * Formes courtes partagées entre langues : une charge française, anglaise ou
 * bilingue est couverte par le même référentiel.
 */
const IMPERATIVE_FORMS: ReadonlySet<string> = new Set([
  // français
  'ignore', 'ignorez', 'lis', 'lisez', 'efface', 'effacez', 'supprime', 'supprimez',
  'envoie', 'envoyez', 'copie', 'copiez', 'colle', 'collez', 'reponds', 'repondez',
  'affiche', 'affichez', 'montre', 'montrez', 'fais', 'faites', 'donne', 'donnez',
  'ecris', 'ecrivez', 'imprime', 'imprimez', 'execute', 'executez', 'lance', 'lancez',
  'retourne', 'ferme', 'fermez', 'ouvre', 'ouvrez', 'vide', 'vider', 'remets',
  'reinitialise', 'reinitialisez', 'supprimer', 'effacer', 'ignorer', 'afficher',
  // anglais
  'ignore', 'read', 'delete', 'remove', 'send', 'copy', 'paste', 'reply', 'answer',
  'show', 'display', 'print', 'run', 'execute', 'do', 'follow', 'forget', 'reset',
  'clear', 'write', 'return', 'close', 'open', 'list', 'export', 'reveal', 'expose',
  'release', 'bypass', 'override', 'forward', 'dump', 'drop', 'erase', 'wipe',
]);

/** Consignes différées : expressions, sans accent, en minuscules. */
const DEFERRED_PHRASES: readonly string[] = [
  'plus tard', 'quand tu auras', 'quand vous aurez', 'apres avoir', 'apres que',
  'une fois que', 'des que', 'dans un second temps', 'au moment de',
  'when you have', 'when you are', 'once you', 'after you', 'after that',
  'at some point', 'down the line', 'when you are done', 'once this is done',
];

/** Consignes différées : mots isolés (bornés au mot entier). */
const DEFERRED_WORDS: readonly string[] = [
  'ensuite', 'finalement', 'later', 'afterwards', 'eventually', 'finally',
];

/** Verbes d'action reconnus quand un acrostiche les épelle (minuscules). */
const ACROSTICH_VERBS: ReadonlySet<string> = new Set([
  'ignore', 'delete', 'remove', 'reset', 'forget', 'oublie', 'efface', 'supprime',
  'expose', 'reveal', 'revele', 'leak', 'copy', 'copie', 'write', 'erase', 'wipe',
  'kill', 'stop', 'send', 'envoie', 'run', 'steal', 'dump', 'drop', 'echo', 'print',
  'execute', 'bypass',
]);

/** Minuscules + suppression des accents : un seul alphabet pour tous les motifs. */
function stripAccents(word: string): string {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Les mots alphabétiques d'un texte (les chiffres seuls ne comptent pas). */
function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
}

/** Premier mot de chaque phrase — le verbe d'action s'y lit en tête. */
function sentenceFirsts(text: string): string[] {
  const firsts: string[] = [];
  for (const raw of text.split(/[.!?;:\n]+/)) {
    const first = tokens(raw)[0];
    if (first) firsts.push(stripAccents(first));
  }
  return firsts;
}

/** Densité (pour 100 mots) et décompte des verbes d'action en tête de phrase. */
function imperativeMeasure(text: string): { density: number; count: number } {
  const total = tokens(text).length;
  const firsts = sentenceFirsts(text);
  const count = firsts.filter((word) => IMPERATIVE_FORMS.has(word)).length;
  const density = total === 0 ? 0 : (count * 100) / total;
  return { density, count };
}

/** L'acrostiche des initiales de lignes, ou '' s'il est illisible. */
function acrostichOf(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < MIN_ACROSTICH_LINES) return '';
  let out = '';
  for (const line of lines) {
    const first = line.match(/[a-zà-ÿ]/i)?.[0];
    if (!first) return '';
    out += stripAccents(first).toLowerCase();
  }
  return out;
}

/** Premier déclencheur de consigne différée trouvé, sinon `null`. */
function deferredTrigger(text: string): string | null {
  const norm = stripAccents(text.toLowerCase()).replace(/\s+/g, ' ');
  for (const phrase of DEFERRED_PHRASES) {
    if (norm.includes(phrase)) return phrase;
  }
  for (const word of DEFERRED_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) return word;
  }
  return null;
}

/**
 * Fabrique un `LayerHit` C4. Les `kind` de ce lot sont propres au fichier : ils
 * n'existent pas encore dans `FindingKind` (types.ts est hors périmètre) — le
 * cast est documenté ici et à reporter dans le tronc.
 */
function pressureHit(
  kind: PressureKind,
  ruleId: string,
  confidence: number,
  startPos: number,
  endPos: number,
  language: Language,
  summaryKey: string,
): LayerHit {
  const summary = t(language, summaryKey);
  return {
    layer: 'C4',
    kind: kind as unknown as FindingKind,
    ruleId,
    startPos,
    endPos,
    excerpt: summary,
    askSummary: summary,
    confidence: clamp01(confidence),
  };
}

/** Signal de densité d'impératifs, borné, ou `null` si le texte est ordinaire. */
export function imperativeDensityHit(
  text: string,
  options: PressureOptions = {},
): LayerHit | null {
  const language = options.language ?? 'fr';
  const { density, count } = imperativeMeasure(text);
  if (count < MIN_IMPERATIVES || density < IMPERATIVE_DENSITY_PER_100) return null;
  const confidence = Math.min(0.5, clamp01(0.2 + density / 100));
  return pressureHit('imperative-density', 'C4-06', confidence, 0, 0, language,
    'pressure.summary.C4-06');
}

/** Signal de consigne différée, ou `null` si aucune n'est détectée. */
export function deferredInstructionHit(
  text: string,
  options: PressureOptions = {},
): LayerHit | null {
  const language = options.language ?? 'fr';
  if (!deferredTrigger(text)) return null;
  return pressureHit('deferred-instruction', 'C4-07', 0.3, 0, 0, language,
    'pressure.summary.C4-07');
}

/** Signal d'acrostiche d'action, ou `null` si les initiales ne forment pas un verbe. */
export function acrostichHit(text: string, options: PressureOptions = {}): LayerHit | null {
  const language = options.language ?? 'fr';
  const word = acrostichOf(text);
  if (!word || !ACROSTICH_VERBS.has(word)) return null;
  return pressureHit('text-acrostich', 'C4-08', 0.35, 0, text.length, language,
    'pressure.summary.C4-08');
}

/** Tous les signaux de pression d'un texte, en couche C4 (pondération). */
export function pressureHits(text: string, options: PressureOptions = {}): LayerHit[] {
  const hits = [
    imperativeDensityHit(text, options),
    deferredInstructionHit(text, options),
    acrostichHit(text, options),
  ];
  return hits.filter((hit): hit is LayerHit => hit !== null);
}