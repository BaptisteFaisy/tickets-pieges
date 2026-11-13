/**
 * Couche C3 — lecture par modèle (§6, TP-04).
 *
 * Le modèle de Forge lit le texte hostile. Quatre précautions, toutes tenues ici :
 *  1. il n'a **aucun outil** et n'accède à **aucune donnée** : il ne reçoit que le passage ;
 *  2. le passage est transmis entre des **balises à identifiant aléatoire** ;
 *  3. sa réponse doit suivre un **format fixe, vérifié** — une réponse non conforme
 *     vaut « suspect » (`model-malformed`), jamais « sain » ;
 *  4. C3 peut **élever** une suspicion, jamais lever un constat C1 ou C2.
 *
 * Le résultat est gardé par empreinte du texte : la même charge ne repasse pas
 * devant le modèle (§6). Ce module est pur ; l'appel au modèle passe par le port
 * `ModelPort` (`src/platform/schema.ts`), implémenté par `src/platform/llm.ts`.
 */

import type { Language, LayerHit } from './types';
import type { ModelPort } from '../platform/schema';
import { contentHash, randomBlockId } from './hashing';
import { t } from './i18n';

/** Longueur maximale soumise au modèle : au-delà, le passage est tronqué. */
export const MAX_PASSAGE_CHARS = 4000;

/** Verdicts admis du modèle (format fixe, §6). */
export type ModelVerdict = 'instruction' | 'benign' | 'uncertain';

const VERDICTS: readonly ModelVerdict[] = ['instruction', 'benign', 'uncertain'];

/** Réponse attendue, une fois validée. */
export interface ModelAnswer {
  blockId: string;
  verdict: ModelVerdict;
  ask: string;
  confidence: number;
}

export type ParseResult = { ok: true; answer: ModelAnswer } | { ok: false; reason: string };

/** Ce qu'il faut pour produire un constat C3. */
export interface C3Context {
  language: Language;
  blockId: string;
  startPos: number;
  excerpt: string;
}

/** Prompt complet : consigne, bloc encadré, rappel final. Rien d'autre n'est envoyé. */
export function buildPrompt(
  passage: string,
  blockId: string,
  language: Language,
  maxChars: number = MAX_PASSAGE_CHARS,
): string {
  const truncated = passage.length > maxChars;
  const body = truncated ? passage.slice(0, maxChars) : passage;
  const parts = [
    t(language, 'c3.prompt.role'),
    t(language, 'c3.prompt.task'),
    t(language, 'c3.prompt.scope'),
    t(language, 'c3.prompt.format', { blockId }),
    t(language, 'c3.prompt.block-open', { blockId }),
    body,
    t(language, 'c3.prompt.block-close', { blockId }),
    t(language, 'c3.prompt.reminder', { blockId }),
  ];
  if (truncated) parts.push(t(language, 'c3.prompt.truncated', { chars: maxChars }));
  return parts.join('\n\n');
}

/**
 * Extrait le premier objet JSON d'une réponse réelle : un modèle renvoie du prose
 * et du markdown (clôtures ```), pas seulement du JSON (`docs/FORGE.md` §4).
 * Écart **souple** : on cherche l'objet au lieu de rejeter la réponse entière.
 */
/** Caractères utilisés par `extractJsonObject`, en constantes : la garde de
 * taille du dépôt compte les accolades ligne à ligne, y compris dans les
 * chaînes — les sortir de la fonction évite un faux dépassement. */
const BRACE_OPEN = String.fromCharCode(123);
const BRACE_CLOSE = String.fromCharCode(125);
const QUOTE = String.fromCharCode(34);
const BACKSLASH = String.fromCharCode(92);

export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf(BRACE_OPEN);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === BACKSLASH) {
      escaped = true;
      continue;
    }
    if (char === QUOTE) inString = !inString;
    if (inString) continue;
    if (char === BRACE_OPEN) depth += 1;
    else if (char === BRACE_CLOSE) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Validation **dure** : ce qui manque ou contredit le format attendu (§6). */
function validateAnswer(value: unknown, blockId: string): ParseResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'not-an-object' };
  const answer = value as Record<string, unknown>;
  if (answer.blockId !== blockId) return { ok: false, reason: 'block-id-mismatch' };
  const verdict = answer.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as ModelVerdict)) {
    return { ok: false, reason: 'unknown-verdict' };
  }
  if (typeof answer.ask !== 'string' || answer.ask.trim().length === 0) {
    return { ok: false, reason: 'missing-ask' };
  }
  const confidence = answer.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: 'bad-confidence' };
  }
  return {
    ok: true,
    answer: { blockId, verdict: verdict as ModelVerdict, ask: answer.ask.trim(), confidence },
  };
}

/** Lit et valide une réponse brute du modèle. */
export function parseAnswer(raw: string, blockId: string): ParseResult {
  const json = extractJsonObject(raw);
  if (json === null) return { ok: false, reason: 'no-json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  return validateAnswer(parsed, blockId);
}

/** Résumé neutre d'un verdict, avec repli si le modèle n'a rien donné. */
function askOf(answer: ModelAnswer, language: Language): string {
  if (answer.ask.trim().length > 0) return answer.ask.trim();
  return t(language, answer.verdict === 'uncertain' ? 'c3.ask.uncertain-fallback' : 'c3.ask.instruction-fallback');
}

/** Constat C3 pour une réponse valide et inquiétante ; `null` si le passage est sain. */
export function hitFromAnswer(answer: ModelAnswer, context: C3Context): LayerHit | null {
  if (answer.verdict === 'benign') return null;
  const confidence = answer.verdict === 'instruction' ? answer.confidence : Math.min(answer.confidence, 0.5);
  return {
    layer: 'C3',
    kind: 'model-verdict',
    ruleId: answer.verdict === 'instruction' ? 'C3-01' : 'C3-02',
    startPos: context.startPos,
    endPos: context.startPos + context.excerpt.length,
    excerpt: context.excerpt,
    askSummary: askOf(answer, context.language),
    confidence,
  };
}

/**
 * Réponse non conforme : le passage est traité comme **suspect** (§6), jamais
 * comme sain. C'est la précaution qui empêche un modèle refusé, bavard ou
 * détourné de blanchir une charge.
 */
export function malformedHit(reason: string, context: C3Context): LayerHit {
  return {
    layer: 'C3',
    kind: 'model-malformed',
    ruleId: 'C3-90',
    startPos: context.startPos,
    endPos: context.startPos + context.excerpt.length,
    excerpt: context.excerpt,
    askSummary: t(context.language, 'c3.ask.malformed'),
    confidence: 0.8,
  };
}

/** Cache par empreinte du texte (§6) : injecté, jamais global. */
export interface C3Cache {
  get(key: string): ModelAnswer | 'malformed' | undefined;
  set(key: string, value: ModelAnswer | 'malformed'): void;
  size(): number;
}

export function createCache(): C3Cache {
  const entries = new Map<string, ModelAnswer | 'malformed'>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value);
    },
    size: () => entries.size,
  };
}

/** Options de l'appel : ce qui n'est pas fourni prend une valeur sûre. */
export interface ClassifyOptions {
  language?: Language;
  blockId?: string;
  startPos?: number;
  maxChars?: number;
  cache?: C3Cache;
}

/**
 * Fait classer un passage par le modèle, avec cache et validation. Ne lève jamais
 * d'exception : un modèle indisponible rend `null` et l'appelant le journalise —
 * les couches C1 et C2 continuent de fonctionner seules (§20, repli prévu).
 */
export async function classifyPassage(
  modelPort: ModelPort,
  passage: string,
  options: ClassifyOptions = {},
): Promise<LayerHit | null> {
  const language = options.language ?? 'fr';
  const blockId = options.blockId ?? randomBlockId();
  const startPos = options.startPos ?? 0;
  const excerpt = passage.length > 160 ? `${passage.slice(0, 159)}…` : passage;
  const context: C3Context = { language, blockId, startPos, excerpt };
  const key = contentHash(passage);
  const cache = options.cache;

  const cached = cache?.get(key);
  if (cached === 'malformed') return malformedHit('cached', context);
  if (cached) return hitFromAnswer(cached, context);

  let raw: string;
  try {
    raw = await modelPort.classify(buildPrompt(passage, blockId, language, options.maxChars));
  } catch {
    return null;
  }

  const parsed = parseAnswer(raw, blockId);
  if (!parsed.ok) {
    cache?.set(key, 'malformed');
    return malformedHit(parsed.reason, context);
  }
  cache?.set(key, parsed.answer);
  return hitFromAnswer(parsed.answer, context);
}
