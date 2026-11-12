/**
 * Extraction OOXML (DOCX / XLSX / PPTX) — pièces jointes §8, honnêteté §21.
 *
 * Ce qu'une pièce Office peut cacher : du texte **masqué** (`w:vanish`),
 * du texte **blanc sur blanc** (`w:color` val `FFFFFF`), des **textes
 * alternatifs** d'images (une consigne peut y être cachée) et des feuilles ou
 * diapositives **cachées**. Tout cela est extrait et rendu visible à
 * l'analyse : ce qui est caché n'est pas « absent », c'est « à vérifier ».
 *
 * Contraintes : aucune exécution du contenu, aucun appel réseau, taille
 * bornée. Le décompresseur Flate est **injecté** (le runtime Forge ne
 * garantit pas `zlib`) : sans lui, seules les entrées ZIP « stored » sont
 * lisibles, et le reste est dit non analysé plutôt que deviné.
 */

/**
 * Décodage UTF-8 maison : ni `Buffer` ni `TextDecoder` ne sont garantis dans
 * le runtime Forge, et aucune dépendance n'est ajoutée (zéro duplication :
 * PDF et OOXML utilisent ce même décodeur).
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let at = 0;
  while (at < bytes.length) {
    const byte = bytes[at] ?? 0;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
      at += 1;
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | ((bytes[at + 1] ?? 0) & 0x3f));
      at += 2;
    } else if (byte < 0xf0) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | (((bytes[at + 1] ?? 0) & 0x3f) << 6) | ((bytes[at + 2] ?? 0) & 0x3f));
      at += 3;
    } else {
      const code = ((byte & 0x07) << 18) | (((bytes[at + 1] ?? 0) & 0x3f) << 12) | (((bytes[at + 2] ?? 0) & 0x3f) << 6) | ((bytes[at + 3] ?? 0) & 0x3f);
      out += String.fromCodePoint(code);
      at += 4;
    }
  }
  return out;
}

/** Décompression Flate brute (raw deflate) : fournie par l'appelant. */
export type Inflate = (data: Uint8Array) => Uint8Array;

export type OoxmlKind = 'docx' | 'xlsx' | 'pptx';

/** Ce qu'on a lu d'une pièce Office. */
export interface OoxmlExtraction {
  kind: OoxmlKind;
  /** Texte visible, dans l'ordre du document. */
  visible: string;
  /** Textes masqués (`w:vanish`), supprimés (`w:delText`), feuilles cachées. */
  concealed: string[];
  /** Textes en blanc sur blanc (`w:color` val `FFFFFF`). */
  whiteOnWhite: string[];
  /** Textes alternatifs des images. */
  altTexts: string[];
  /** Parties effectivement lues. */
  parts: string[];
  /** Vrai si la lecture a été arrêtée par une borne. */
  truncated: boolean;
}

/** Bornes de lecture : une pièce enormous ne doit pas consommer le quota. */
export const MAX_OOXML_ENTRIES = 200;
export const MAX_OOXML_TEXT = 200_000;

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

interface ZipEntryMeta {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  const floor = Math.max(0, bytes.length - 66_000);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (u32(bytes, at) === EOCD_SIG) return at;
  }
  return -1;
}

function centralEntries(bytes: Uint8Array): ZipEntryMeta[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) return [];
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const entries: ZipEntryMeta[] = [];
  for (let index = 0; index < count && offset + 46 <= bytes.length; index += 1) {
    if (u32(bytes, offset) !== CEN_SIG) break;
    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLen));
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryData(bytes: Uint8Array, entry: ZipEntryMeta, inflate?: Inflate): Uint8Array | null {
  if (u32(bytes, entry.localOffset) !== LOC_SIG) return null;
  const nameLen = u16(bytes, entry.localOffset + 26);
  const extraLen = u16(bytes, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflate ? inflate(raw) : null;
  return null;
}

/**
 * Lit les parties d'un ZIP. Sans décompresseur, seules les entrées
 * « stored » sont rendues : le reste est simplement absent (et dit tel quel).
 */
export function readZip(bytes: Uint8Array, inflate?: Inflate): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const entry of centralEntries(bytes)) {
    const data = entryData(bytes, entry, inflate);
    if (data) out.set(entry.name, data);
  }
  return out;
}

// ------------------------------------------------------------------ XML

/** Entités XML usuelles, déséchappées. */
export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function matchAll(source: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match = regex.exec(source);
  while (match !== null) {
    out.push(match[1] ?? '');
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
    match = regex.exec(source);
  }
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const found = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return found?.[1];
}

// ------------------------------------------------------- WordprocessingML

/** Nature d'un run Word : vu, masqué, ou blanc sur blanc. */
export type RunKind = 'visible' | 'hidden' | 'white';

interface WordRun {
  text: string;
  kind: RunKind;
}

/** Texte d'un run Word : `w:t`, tabulations, sauts de ligne, texte supprimé. */
function runText(run: string): string {
  const parts = matchAll(run, /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g).map(unescapeXml);
  const deleted = matchAll(run, /<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/g).map(unescapeXml);
  const tabs = (run.match(/<w:tab\b/g) ?? []).length;
  const breaks = (run.match(/<w:br\b/g) ?? []).length;
  return parts.join('') + ' '.repeat(tabs) + '\n'.repeat(breaks) + deleted.join('');
}

/** Classe un run : masqué, supprimé, blanc sur blanc, ou simplement visible. */
function runKind(run: string): RunKind {
  if (/<w:vanish\b/.test(run) || /<w:delText\b/.test(run)) return 'hidden';
  const color = /<w:color[^>]*w:val="([0-9a-fA-F]{6}|white)"/.exec(run)?.[1]?.toLowerCase();
  return color === 'ffffff' || color === 'white' ? 'white' : 'visible';
}

function wordRuns(xml: string): WordRun[] {
  const runs: WordRun[] = [];
  for (const body of matchAll(xml, /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const text = runText(body).trim();
    if (text === '') continue;
    runs.push({ text, kind: runKind(body) });
  }
  return runs;
}

function docxText(xml: string): { visible: string; concealed: string[]; white: string[] } {
  const visible: string[] = [];
  const concealed: string[] = [];
  const white: string[] = [];
  for (const paragraph of matchAll(xml, /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const line: string[] = [];
    for (const run of wordRuns(paragraph)) {
      if (run.kind === 'hidden') concealed.push(run.text);
      else if (run.kind === 'white') white.push(run.text);
      else line.push(run.text);
    }
    if (line.length > 0) visible.push(line.join(' '));
  }
  return { visible: visible.join('\n'), concealed, white };
}

// -------------------------------------------------------------- Spreadsheet

function sharedStrings(xml: string): string[] {
  return matchAll(xml, /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g).map((si) =>
    matchAll(si, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g).map(unescapeXml).join(''),
  );
}

function xlsxText(xml: string, strings: string[]): { visible: string; concealed: string[]; white: string[] } {
  const visible: string[] = [];
  const concealed: string[] = [];
  const white: string[] = [];
  for (const cell of matchAll(xml, /<c\b[^>]*\/>|<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
    const inline = matchAll(cell, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g).map(unescapeXml).join('');
    if (inline !== '') {
      visible.push(inline);
      continue;
    }
    const value = matchAll(cell, /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/g).map(unescapeXml).join('');
    if (value === '') continue;
    const index = Number(value);
    const shared = Number.isInteger(index) ? strings[index] : undefined;
    visible.push(shared ?? value);
  }
  for (const sheet of matchAll(xml, /<sheet(?:\s[^>]*)?>/g)) {
    if (/state="hidden"/i.test(sheet)) {
      const name = attr(sheet, 'name');
      if (name) concealed.push(name);
    }
  }
  return { visible: visible.join('\n'), concealed, white };
}

// ------------------------------------------------------------- Présentation

/** Diapositive ou note : texte des runs, blanc sur blanc mis à part. */
function slideRuns(xml: string): { visible: string; white: string[] } {
  const visible: string[] = [];
  const white: string[] = [];
  for (const run of matchAll(xml, /<a:r(?:\s[^>]*)?>([\s\S]*?)<\/a:r>/g)) {
    const text = matchAll(run, /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g).map(unescapeXml).join(' ').trim();
    if (text === '') continue;
    if (/srgbClr\s+val="(?:FFFFFF|white)"/i.test(run)) white.push(text);
    else visible.push(text);
  }
  return { visible: visible.join(' '), white };
}

// ------------------------------------------------------------------ Alt text

/** Textes alternatifs des images (`docPr descr`, `cNvPr descr`, `v:shape alt`). */
function altTextsOf(xml: string): string[] {
  const found: string[] = [];
  for (const tag of xml.match(/<(?:wp:docPr|pic:cNvPr|a:cNvPr)\b[^>]*>/g) ?? []) {
    const descr = attr(tag, 'descr') ?? attr(tag, 'title');
    if (descr && descr.trim() !== '') found.push(descr.trim());
  }
  for (const tag of xml.match(/<v:shape\b[^>]*>/g) ?? []) {
    const alt = attr(tag, 'alt');
    if (alt && alt.trim() !== '') found.push(alt.trim());
  }
  return found;
}

// ------------------------------------------------------------------- API

function kindOf(entries: Map<string, Uint8Array>): OoxmlKind | null {
  if (entries.has('word/document.xml')) return 'docx';
  if (entries.has('xl/workbook.xml')) return 'xlsx';
  if (entries.has('ppt/presentation.xml')) return 'pptx';
  return null;
}

function namesMatching(entries: Map<string, Uint8Array>, prefixes: string[]): string[] {
  return [...entries.keys()]
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix) && name.endsWith('.xml')))
    .sort();
}

function textOf(entries: Map<string, Uint8Array>, name: string): string {
  const data = entries.get(name);
  return data ? decodeUtf8(data) : '';
}

/** Assemble le résultat : texte visible, textes cachés, alt texts, parties lues. */
function assemble(
  kind: OoxmlKind,
  visible: string[],
  concealed: string[],
  white: string[],
  altTexts: string[],
  parts: string[],
  truncated: boolean,
): OoxmlExtraction {
  return {
    kind,
    visible: visible.join('\n').slice(0, MAX_OOXML_TEXT),
    concealed: concealed.slice(0, 500),
    whiteOnWhite: white.slice(0, 500),
    altTexts: altTexts.slice(0, 200),
    parts: parts.slice(0, MAX_OOXML_ENTRIES),
    truncated,
  };
}

/**
 * Extrait le texte d'une pièce Office. Rend `null` si ce n'est pas une pièce
 * OOXML lisible (l'appelant marquera alors « non analysé »).
 */
export function extractOoxml(bytes: Uint8Array, inflate?: Inflate): OoxmlExtraction | null {
  const entries = readZip(bytes, inflate);
  const kind = kindOf(entries);
  if (kind === null) return null;
  if (kind === 'docx') return extractDocx(entries);
  if (kind === 'xlsx') return extractXlsx(entries);
  return extractPptx(entries);
}

/** DOCX : corps, en-têtes, pieds de page, commentaires, notes. */
function extractDocx(entries: Map<string, Uint8Array>): OoxmlExtraction {
  const names = namesMatching(entries, ['word/document.xml', 'word/header', 'word/footer', 'word/comments.xml', 'word/footnotes.xml', 'word/endnotes.xml']);
  const visible: string[] = [];
  const concealed: string[] = [];
  const white: string[] = [];
  const altTexts: string[] = [];
  for (const name of names) {
    const xml = textOf(entries, name);
    const doc = docxText(xml);
    if (doc.visible.trim() !== '') visible.push(doc.visible);
    concealed.push(...doc.concealed);
    white.push(...doc.white);
    altTexts.push(...altTextsOf(xml));
  }
  return assemble('docx', visible, concealed, white, altTexts, names, names.length >= MAX_OOXML_ENTRIES);
}

/** XLSX : chaînes partagées, cellules, feuilles cachées. */
function extractXlsx(entries: Map<string, Uint8Array>): OoxmlExtraction {
  const strings = sharedStrings(textOf(entries, 'xl/sharedStrings.xml'));
  const names = namesMatching(entries, ['xl/worksheets/sheet', 'xl/workbook.xml']);
  const visible: string[] = [];
  const concealed: string[] = [];
  const white: string[] = [];
  const altTexts: string[] = [];
  for (const name of names) {
    const xml = textOf(entries, name);
    const sheet = xlsxText(xml, strings);
    if (sheet.visible.trim() !== '') visible.push(sheet.visible);
    concealed.push(...sheet.concealed);
    white.push(...sheet.white);
    altTexts.push(...altTextsOf(xml));
  }
  return assemble('xlsx', visible, concealed, white, altTexts, names, names.length >= MAX_OOXML_ENTRIES);
}

/** PPTX : diapositives et notes. */
function extractPptx(entries: Map<string, Uint8Array>): OoxmlExtraction {
  const names = namesMatching(entries, ['ppt/slides/slide', 'ppt/notesSlides/notesSlide']);
  const visible: string[] = [];
  const concealed: string[] = [];
  const white: string[] = [];
  const altTexts: string[] = [];
  for (const name of names) {
    const xml = textOf(entries, name);
    const slide = slideRuns(xml);
    if (slide.visible.trim() !== '') visible.push(slide.visible);
    white.push(...slide.white);
    altTexts.push(...altTextsOf(xml));
  }
  return assemble('pptx', visible, concealed, white, altTexts, names, names.length >= MAX_OOXML_ENTRIES);
}
