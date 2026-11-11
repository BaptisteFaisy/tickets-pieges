/**
 * Décodage prudent des blocs encodés (§6, #1, #11). Déterministe, sans modèle,
 * sans réseau, sans horloge.
 *
 * La couche C1 signale les longs blocs encodés (`encoded-block`) mais ne les
 * décode pas. Ce module les décode prudemment pour que les couches de détection
 * repassent sur le texte décodé : une consigne dissimulée devient lisible, ce qui
 * produit des `LayerHit` supplémentaires (via le callback `reanalyze` — injection
 * de dépendance, aucun import circulaire).
 *
 * Schémas couverts : base64, hexadécimal, url-encoding, échappements unicode ;
 * imbrication jusqu'à `maxDepth` (défaut 2). Bornes strictes :
 *  - `maxDecodedLength` (défaut 4096) : « timeout par longueur » — au-delà, le
 *    décodé est tronqué et un avertissement est posé (aucune horloge consultée) ;
 *  - un décodé qui n'est pas du texte lisible est refusé ;
 *  - un bloc tronqué ou corrompu ne plante jamais : il rend un avertissement.
 *
 * Réducteurs de lien (#11) : une URL vers un raccourcisseur connu est signalée
 * comme opaque — sa destination réelle est extraite **sans jamais la consulter**
 * (aucun appel réseau) : on dit ce qu'on ne peut pas savoir, on ne devine rien.
 */

import type { Language, LayerHit } from './types';
import { clamp01 } from './findings';
import { t } from './i18n';
import { hostOf } from './outbound';

/** Schémas d'encodage que ce module sait décoder prudemment. */
export type DecodeScheme = 'base64' | 'hex' | 'url' | 'unicode-escape';

/** Un bloc décodé, avec sa position dans le texte d'origine. */
export interface DecodedBlock {
  scheme: DecodeScheme;
  /** Nombre de niveaux d'encodage effectivement traversés (0 = indécodable). */
  depth: number;
  raw: string;
  decoded: string;
  start: number;
  end: number;
  warning?: 'truncated' | 'too-long';
}

/** Contexte passé au callback de réanalyse. */
export interface ReanalyzeContext {
  language: Language;
  depth: number;
  start: number;
  end: number;
}

/** Réanalyse du texte décodé par les couches passées en injection. */
export type ReanalyzeFn = (decoded: string, ctx: ReanalyzeContext) => LayerHit[];

/** Options de décodage. */
export interface DecodeOptions {
  language?: Language;
  /** Borne de taille du décodé (défaut 4096) — agit comme un garde-fou de longueur. */
  maxDecodedLength?: number;
  /** Profondeur d'imbrication maximale (défaut 2). */
  maxDepth?: number;
  reanalyze?: ReanalyzeFn;
}

/** Longueur minimale d'un run candidat avant de tenter un décodage. */
export const MIN_DECODE_RUN = 20;
/** Taille maximale du texte décodé avant avertissement et troncature. */
export const MAX_DECODED_LENGTH = 4096;
/** Profondeur d'imbrication maximale par défaut. */
export const MAX_DECODE_DEPTH = 2;

/** Référentiel réduit et documenté des hôtes de raccourcisseurs (#11). Non exhaustif :
 * un domaine absent n'est pas un blanc-seing, c'est simplement hors de cette table. */
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'rb.gy',
  'cutt.ly',
  'tiny.cc',
  'short.link',
]);

interface Step {
  scheme: DecodeScheme;
  value: string;
}

interface Run {
  run: string;
  start: number;
  end: number;
}

/** Runs de caractères « token » (alphanumérique, base64, url, unicode). */
const CANDIDATE_PATTERN = /[A-Za-z0-9_+/=%\\-]+/g;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>()]+/gi;

function decodeBase64(run: string): string | null {
  const cleaned = run.replace(/[^A-Za-z0-9+/=]/g, '');
  if (cleaned.length < 8 || cleaned.length % 4 === 1) return null;
  const pad = (4 - (cleaned.length % 4)) % 4;
  const padded = cleaned + '='.repeat(pad);
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeHex(run: string): string | null {
  const body = run.replace(/^0x/i, '');
  if (body.length < 8 || body.length % 2 !== 0) return null;
  if (!/^[0-9A-Fa-f]+$/.test(body)) return null;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeUrl(run: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(run)) return null;
  try {
    return decodeURIComponent(run);
  } catch {
    return null;
  }
}

function decodeUnicode(run: string): string | null {
  if (!/\\u[0-9A-Fa-f]{4}/.test(run)) return null;
  return run.replace(/\\u([0-9A-Fa-f]{4})/g, (_m, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

/** Un décodé doit être du texte lisible : mots séparés, voyelles, peu de contrôle.
 * Une chaîne encore encodée (base64/hex) n'a ni espace ni voyelles en proportion :
 * elle n'est pas « lisible », ce qui permet d'arrêter l'imbrication au bon moment. */
function isReadableText(value: string): boolean {
  if (value.length === 0) return false;
  const letters = (value.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (letters === 0) return false;
  const spaces = (value.match(/\s/g) ?? []).length;
  const vowels = (value.match(/[aeiouyàâäéèêëîïôöùûüÿ]/gi) ?? []).length;
  const controls = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []).length;
  if (controls / value.length > 0.05) return false;
  if (spaces === 0 && value.length > 12) return false;
  return vowels / letters > 0.15 && (letters + spaces) / value.length > 0.4;
}

/** Un run ressemblant à de l'encodé mais indécodable : signalé comme corrompu. */
function looksEncodedLike(run: string): boolean {
  const letters = (run.match(/[A-Za-z]/g) ?? []).length;
  if (letters === 0 || letters / run.length < 0.5) return false;
  const vowels = (run.match(/[aeiouy]/gi) ?? []).length;
  return vowels / letters < 0.15;
}

/** Une tentative de décodage à un seul niveau. */
function decodeOnce(run: string): Step | null {
  const attempts: Step[] = [];
  const hex = decodeHex(run);
  if (hex !== null) attempts.push({ scheme: 'hex', value: hex });
  const b64 = decodeBase64(run);
  if (b64 !== null) attempts.push({ scheme: 'base64', value: b64 });
  const url = decodeUrl(run);
  if (url !== null) attempts.push({ scheme: 'url', value: url });
  const uni = decodeUnicode(run);
  if (uni !== null) attempts.push({ scheme: 'unicode-escape', value: uni });
  for (const step of attempts) {
    if (step.value !== run && isReadableText(step.value)) return step;
  }
  for (const step of attempts) {
    if (step.value !== run && step.value.length > 0) return step;
  }
  return null;
}

interface DecodeResult {
  decoded: string;
  scheme: DecodeScheme;
  depth: number;
}

function decodeRecursive(run: string, maxDepth: number): DecodeResult {
  let current = run;
  let scheme: DecodeScheme = 'base64';
  let depth = 0;
  for (let i = 0; i < maxDepth; i += 1) {
    const step = decodeOnce(current);
    if (step === null) break;
    scheme = step.scheme;
    current = step.value;
    depth += 1;
    // texte final atteint (lisible) : on s'arrête, sinon on tenterait de
    // re-décoder un texte clair en garbage. Sinon on poursuit l'imbrication.
    if (isReadableText(current)) break;
  }
  return { decoded: current, scheme, depth };
}

function candidateRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const match of text.matchAll(CANDIDATE_PATTERN)) {
    const run = match[0];
    if (run.length >= MIN_DECODE_RUN) {
      runs.push({ run, start: match.index ?? 0, end: (match.index ?? 0) + run.length });
    }
  }
  return runs;
}

function truncatedBlock(candidate: Run, scheme: DecodeScheme): DecodedBlock {
  return {
    scheme,
    depth: 0,
    raw: candidate.run,
    decoded: '',
    start: candidate.start,
    end: candidate.end,
    warning: 'truncated',
  };
}

/** Décode prudemment tous les blocs encodés repérés dans `text`. */
export function decodeBlocks(text: string, options: DecodeOptions = {}): DecodedBlock[] {
  const maxDepth = options.maxDepth ?? MAX_DECODE_DEPTH;
  const maxLen = options.maxDecodedLength ?? MAX_DECODED_LENGTH;
  const blocks: DecodedBlock[] = [];
  for (const candidate of candidateRuns(text)) {
    const result = decodeRecursive(candidate.run, maxDepth);
    if (result.depth === 0) {
      if (looksEncodedLike(candidate.run)) {
        blocks.push(truncatedBlock(candidate, result.scheme));
      }
      continue;
    }
    if (!isReadableText(result.decoded)) continue;
    const block: DecodedBlock = {
      scheme: result.scheme,
      depth: result.depth,
      raw: candidate.run,
      decoded: result.decoded,
      start: candidate.start,
      end: candidate.end,
    };
    if (result.decoded.length > maxLen) {
      block.decoded = result.decoded.slice(0, maxLen);
      block.warning = 'too-long';
    }
    blocks.push(block);
  }
  return blocks;
}

function ruleFor(block: DecodedBlock): string {
  if (block.depth >= 2) return 'DC-05';
  switch (block.scheme) {
    case 'hex':
      return 'DC-02';
    case 'url':
      return 'DC-03';
    case 'unicode-escape':
      return 'DC-04';
    default:
      return 'DC-01';
  }
}

function decodeHit(block: DecodedBlock, language: Language): LayerHit {
  const askKey = block.warning ? 'decode.warn.' + block.warning : 'decode.ask.decoded';
  const excerpt = block.warning ? block.raw.slice(0, 24) + '…' : block.decoded.slice(0, 80);
  return {
    layer: 'C1',
    kind: 'encoded-block',
    ruleId: ruleFor(block),
    startPos: block.start,
    endPos: Math.max(block.start, block.end - 1),
    excerpt,
    askSummary: t(language, askKey),
    confidence: clamp01(block.warning ? 0.5 : 0.85),
  };
}

/** Signale les URL vers un raccourcisseur connu, sans jamais les consulter (#11). */
export function shortenedUrlHits(text: string, language: Language): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    const host = hostOf(url);
    if (host === null || !SHORTENER_HOSTS.has(host)) continue;
    const start = match.index ?? 0;
    hits.push({
      layer: 'C1',
      kind: 'link-label-mismatch',
      ruleId: 'DC-06',
      startPos: start,
      endPos: start + url.length - 1,
      excerpt: url.slice(0, 80),
      askSummary: t(language, 'decode.ask.shortener'),
      confidence: clamp01(0.8),
    });
  }
  return hits;
}

/**
 * Décodage + réanalyse : rend les `LayerHit` du décodage, les coups que les
 * couches injectées produisent sur le texte décodé, et les raccourcisseurs.
 */
export function decodeHits(text: string, options: DecodeOptions = {}): LayerHit[] {
  const language = options.language ?? 'fr';
  const hits: LayerHit[] = [];
  const blocks = decodeBlocks(text, options);
  for (const block of blocks) {
    hits.push(decodeHit(block, language));
    if (options.reanalyze && block.depth > 0) {
      const extra = options.reanalyze(block.decoded, {
        language,
        depth: block.depth,
        start: block.start,
        end: block.end,
      });
      for (const hit of extra) {
        hits.push({ ...hit, startPos: hit.startPos + block.start, endPos: hit.endPos + block.start });
      }
    }
  }
  hits.push(...shortenedUrlHits(text, language));
  return hits;
}