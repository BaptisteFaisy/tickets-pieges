/**
 * Extraction de texte des PDF — pièces jointes §8, honnêteté §21.
 *
 * Lecture **passive** : on parcourt les flux de contenu (`stream … endstream`),
 * on décompresse en Flate si un décompresseur est fourni, et on ne retient que
 * les opérateurs d'affichage de texte (`Tj`, `TJ`, `'`, `"`) avec les sauts de
 * ligne (`Td`, `TD`, `T*`). Rien n'est exécuté, aucun script PDF n'est
 * interprété, aucun appel réseau.
 *
 * Ce qu'on ne sait pas lire est **dit** : `streamsSkipped` compte les flux
 * compressés sans décompresseur disponible, `lowConfidence` signale un PDF
 * dont le texte n'a pas pu être reconstruit (polices à encodage propriétaire
 * sans table `ToUnicode`) — l'appelant marque alors la pièce « non analysée »
 * au lieu de prétendre qu'elle est vide.
 */

import type { Inflate } from './extract-ooxml';

export const MAX_PDF_TEXT = 200_000;
export const MAX_PDF_STREAMS = 400;

/** Ce qu'on a lu d'un PDF. */
export interface PdfExtraction {
  /** Texte reconstruit, dans l'ordre des flux. */
  text: string;
  /** Nombre de pages déclarées (`/Type /Page`), à titre indicatif. */
  pages: number;
  /** Flux effectivement lus. */
  streamsRead: number;
  /** Flux compressés qu'on n'a pas pu ouvrir. */
  streamsSkipped: number;
  /** Lecture arrêtée par une borne. */
  truncated: boolean;
  /** Le PDF semble contenir du texte qu'on n'a pas su reconstruire. */
  lowConfidence: boolean;
}

const FLATE = /\/FlateDecode|\/Fl\b/;
const OTHER_FILTER = /\/LZWDecode|\/ASCII85Decode|\/ASCIIHexDecode|\/RunLengthDecode|\/CCITTFaxDecode|\/DCTDecode|\/JBIG2Decode/;

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 1) out += String.fromCharCode(bytes[at] ?? 0);
  return out;
}

function utf16Be(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at + 1 < bytes.length; at += 2) {
    out += String.fromCharCode(((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0));
  }
  return out;
}

/** Chaîne hexadécimale `<4865…>` → texte (UTF-16BE si BOM, latin1 sinon). */
function decodeHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = new Uint8Array(padded.length / 2);
  for (let at = 0; at < bytes.length; at += 1) bytes[at] = parseInt(padded.slice(at * 2, at * 2 + 2), 16);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16Be(bytes.subarray(2));
  return latin1(bytes);
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
};

/** Chaîne littérale `…` → texte : échappements, octal, continuation de ligne, BOM. */
export function decodeLiteral(raw: string): string {
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] ?? '';
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0));
      continue;
    }
    at += 1;
    const next = body[at] ?? '';
    if (next === '\n' || next === '\r') continue;
    if (ESCAPES[next] !== undefined) {
      for (const out of ESCAPES[next] ?? '') bytes.push(out.charCodeAt(0));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(at))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8) & 0xff);
      at += octal.length - 1;
      continue;
    }
    bytes.push(next.charCodeAt(0));
  }
  const asBytes = Uint8Array.from(bytes);
  if (asBytes[0] === 0xfe && asBytes[1] === 0xff) return utf16Be(asBytes.subarray(2));
  return latin1(asBytes);
}

/**
 * Texte affiché d'un flux de contenu : les chaînes suivies d'un opérateur
 * d'affichage, avec un espace quand le crénage est large et une ligne par
 * déplacement de texte.
 */
export function contentText(stream: string): string {
  const pattern = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?|TJ|Tj|T\*|Td|TD|ET|'/g;
  const pending: string[] = [];
  const chunks: string[] = [];
  let match = pattern.exec(stream);
  while (match !== null) {
    const token = match[0];
    step(token, pending, chunks);
    match = pattern.exec(stream);
  }
  flush(pending, chunks);
  return chunks.join('').slice(0, MAX_PDF_TEXT);
}

function flush(pending: string[], chunks: string[]): void {
  if (pending.length === 0) return;
  chunks.push(pending.join(''));
  pending.length = 0;
}

function step(token: string, pending: string[], chunks: string[]): void {
  if (token.startsWith('(')) {
    pending.push(decodeLiteral(token));
    return;
  }
  if (token.startsWith('<')) {
    pending.push(decodeHex(token.slice(1, -1)));
    return;
  }
  if (token === 'TJ' || token === 'Tj' || token === "'") {
    flush(pending, chunks);
    if (token === "'") chunks.push('\n');
    return;
  }
  if (token === 'T*' || token === 'Td' || token === 'TD' || token === 'ET') {
    flush(pending, chunks);
    chunks.push('\n');
    return;
  }
  if (/^-?\d/.test(token) && pending.length > 0 && Number(token) <= -120) pending.push(' ');
}

interface StreamSlice {
  dict: string;
  data: Uint8Array;
}

/** Tous les couples dictionnaire + flux brut du document. */
function streamsOf(bytes: Uint8Array): StreamSlice[] {
  const asText = latin1(bytes);
  const out: StreamSlice[] = [];
  const pattern = /stream\r?\n?/g;
  let match = pattern.exec(asText);
  while (match !== null && out.length < MAX_PDF_STREAMS) {
    const start = match.index + match[0].length;
    const end = asText.indexOf('endstream', start);
    if (end < 0) break;
    const dict = asText.slice(Math.max(0, match.index - 1200), match.index);
    out.push({ dict, data: bytes.subarray(start, end) });
    pattern.lastIndex = end + 9;
    match = pattern.exec(asText);
  }
  return out;
}

function openStream(slice: StreamSlice, inflate?: Inflate): { text: string | null; skipped: boolean } {
  const compressed = FLATE.test(slice.dict);
  if (compressed && !inflate) return { text: null, skipped: true };
  if (OTHER_FILTER.test(slice.dict) && !compressed) return { text: null, skipped: false };
  if (compressed) {
    try {
      const inflated = inflate?.(slice.data);
      if (!inflated) return { text: null, skipped: true };
      return { text: latin1(inflated), skipped: false };
    } catch {
      return { text: null, skipped: true };
    }
  }
  return { text: latin1(slice.data), skipped: false };
}

function countPages(asText: string): number {
  return (asText.match(/\/Type\s*\/Page[^sA-Za-z]/g) ?? []).length;
}

/** Extrait le texte d'un PDF. Rend `null` si ce n'est pas un PDF. */
export function extractPdf(bytes: Uint8Array, inflate?: Inflate): PdfExtraction | null {
  if (bytes.length < 8 || latin1(bytes.subarray(0, 5)) !== '%PDF-') return null;
  const asText = latin1(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
  const chunks: string[] = [];
  let read = 0;
  let skipped = 0;
  let truncated = false;
  const slices = streamsOf(bytes);
  for (const slice of slices) {
    const opened = openStream(slice, inflate);
    if (opened.skipped) {
      skipped += 1;
      continue;
    }
    if (opened.text === null) continue;
    const text = contentText(opened.text);
    if (text.trim() === '') continue;
    read += 1;
    chunks.push(text);
    if (chunks.join('').length >= MAX_PDF_TEXT) {
      truncated = true;
      break;
    }
  }
  const text = chunks.join('\n').slice(0, MAX_PDF_TEXT);
  return {
    text,
    pages: countPages(asText),
    streamsRead: read,
    streamsSkipped: skipped,
    truncated: truncated || slices.length >= MAX_PDF_STREAMS,
    lowConfidence: text.trim().length === 0 || (skipped > 0 && read === 0),
  };
}

/** Texte du document hors flux : titre, sujet, mots-clés (souvent porteurs). */
export function pdfMetadataText(bytes: Uint8Array): string[] {
  const asText = latin1(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
  const out: string[] = [];
  for (const key of ['/Title', '/Subject', '/Keywords', '/Author']) {
    const found = new RegExp(`${key}\\s*(\\((?:\\\\.|[^\\\\()])*\\)|<[0-9A-Fa-f\\s]*>)`).exec(asText)?.[1];
    if (!found) continue;
    const value = found.startsWith('(') ? decodeLiteral(found) : decodeHex(found.slice(1, -1));
    if (value.trim() !== '') out.push(value.trim());
  }
  return out;
}
