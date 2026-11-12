/**
 * Dispatch d'extraction du texte des pièces jointes — §8, §21.
 *
 * Une pièce jointe est un texte comme un autre pour l'analyseur : ce module
 * choisit le lecteur (PDF, OOXML, texte brut) à partir du mime et du nom,
 * compose le texte à analyser **y compris ce qui était caché** (texte masqué,
 * blanc sur blanc, texte alternatif d'image), et dit ce qu'il n'a pas su lire.
 *
 * Rien n'est exécuté, rien ne sort d'Atlassian : les octets sont fournis par
 * l'appelant (la plateforme lit la pièce sur Jira), le décompresseur Flate est
 * injecté, et toute taille est bornée. Une erreur de lecture ne remonte
 * jamais : elle vaut « non analysé », jamais « vide » (§21).
 */

import type { UnanalyzedReason } from '../core/types';
import type { UnanalyzedFormat, UnanalyzedPart } from '../core/unanalyzed';
import { MAX_ANALYZED_BYTES, isImageMime, type TextExtractor } from './attachments';
import type { JiraAttachmentView } from './schema';
import { decodeUtf8, extractOoxml, type Inflate, type OoxmlExtraction } from './extract-ooxml';
import { extractPdf, pdfMetadataText, type PdfExtraction } from './extract-pdf';

/** Mimes Office ouverts (OOXML). */
export const OOXML_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
];

const OOXML_EXTENSIONS = ['.docx', '.xlsx', '.pptx', '.docm', '.xlsm', '.pptm'];
const TEXT_EXTENSIONS = ['.txt', '.csv', '.md', '.json', '.xml', '.log', '.yaml', '.yml'];

/** Marqueurs posés sur ce qui était caché : codes stables, pas des phrases. */
export const MARK_HIDDEN = '[c1-hidden]';
export const MARK_WHITE = '[c1-white]';
export const MARK_ALT = '[img-alt]';

/** Ce qu'on a tiré d'une pièce. */
export interface AttachmentExtraction {
  /** Texte à analyser : visible + ce qui était caché, marqué. */
  text: string;
  format: UnanalyzedFormat;
  bytes: number;
  /** Textes cachés retrouvés (déjà inclus dans `text`). */
  concealed: string[];
  /** Textes alternatifs d'images (déjà inclus dans `text`). */
  altTexts: string[];
  /** Flux ou parties qu'on n'a pas pu ouvrir. */
  skippedParts: number;
  truncated: boolean;
  /** Raison de non-analyse ; absente si un texte est disponible. */
  reason?: UnanalyzedReason;
}

/** Lecture des octets : fournie par la plateforme (jamais de réseau ici). */
export type BytesFetcher = (view: JiraAttachmentView) => Promise<Uint8Array | null>;

export interface ExtractDeps {
  fetchBytes: BytesFetcher;
  /** Décompresseur Flate brut, si le runtime en fournit un. */
  inflate?: Inflate;
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index < 0 ? '' : fileName.slice(index).toLowerCase();
}

export function isOoxml(view: JiraAttachmentView): boolean {
  return OOXML_MIMES.includes(view.mimeType.toLowerCase()) || OOXML_EXTENSIONS.includes(extensionOf(view.fileName));
}

export function isPdf(view: JiraAttachmentView): boolean {
  return view.mimeType.toLowerCase() === 'application/pdf' || extensionOf(view.fileName) === '.pdf';
}

export function isPlainText(view: JiraAttachmentView): boolean {
  const mime = view.mimeType.toLowerCase();
  return mime.startsWith('text/') || ['application/json', 'application/xml', 'text/xml'].includes(mime) || TEXT_EXTENSIONS.includes(extensionOf(view.fileName));
}

/** Format déclaré pour l'indicateur de couverture (§21). */
export function formatOf(view: JiraAttachmentView): UnanalyzedFormat {
  if (isImageMime(view.mimeType)) return 'image';
  if (isPdf(view)) return 'pdf';
  if (isOoxml(view)) return 'ooxml';
  if (isPlainText(view)) return 'text';
  return 'binary-attachment';
}

/**
 *Compose le texte analysable : le visible d'abord, puis ce qui était caché,
 * chaque ligne marquée par un code stable. Les marqueurs ne sont pas des
 * phrases : rien à traduire, rien qui puisse être confondu avec une consigne.
 */
export function composeText(visible: string, concealed: string[], altTexts: string[], white: string[] = []): string {
  const lines: string[] = [];
  if (visible.trim() !== '') lines.push(visible.trim());
  for (const item of white) lines.push(`${MARK_WHITE} ${item}`);
  for (const item of concealed) lines.push(`${MARK_HIDDEN} ${item}`);
  for (const item of altTexts) lines.push(`${MARK_ALT} ${item}`);
  return lines.join('\n');
}

function emptyExtraction(view: JiraAttachmentView, format: UnanalyzedFormat, reason: UnanalyzedReason): AttachmentExtraction {
  return {
    text: '',
    format,
    bytes: view.sizeBytes,
    concealed: [],
    altTexts: [],
    skippedParts: 0,
    truncated: false,
    reason,
  };
}

function fromPdf(view: JiraAttachmentView, bytes: Uint8Array, pdf: PdfExtraction | null): AttachmentExtraction {
  if (pdf === null) return emptyExtraction(view, 'pdf', 'binary-attachment');
  const meta = pdfMetadataText(bytes);
  const text = composeText([pdf.text, ...meta].filter((part) => part.trim() !== '').join('\n'), [], []);
  return {
    text,
    format: 'pdf',
    bytes: view.sizeBytes,
    concealed: [],
    altTexts: [],
    skippedParts: pdf.streamsSkipped,
    truncated: pdf.truncated,
    reason: text.trim() === '' || pdf.lowConfidence ? 'unsupported-format' : undefined,
  };
}

function fromOoxml(view: JiraAttachmentView, ooxml: OoxmlExtraction | null): AttachmentExtraction {
  if (ooxml === null) return emptyExtraction(view, 'ooxml', 'unsupported-format');
  const text = composeText(ooxml.visible, ooxml.concealed, ooxml.altTexts, ooxml.whiteOnWhite);
  return {
    text,
    format: 'ooxml',
    bytes: view.sizeBytes,
    concealed: ooxml.concealed,
    altTexts: ooxml.altTexts,
    skippedParts: ooxml.truncated ? 1 : 0,
    truncated: ooxml.truncated,
    reason: text.trim() === '' ? 'unsupported-format' : undefined,
  };
}

function fromText(view: JiraAttachmentView, bytes: Uint8Array): AttachmentExtraction {
  const text = decodeUtf8(bytes).slice(0, MAX_ANALYZED_BYTES);
  return {
    text,
    format: 'text',
    bytes: view.sizeBytes,
    concealed: [],
    altTexts: [],
    skippedParts: 0,
    truncated: bytes.length > MAX_ANALYZED_BYTES,
    reason: text.trim() === '' ? 'unsupported-format' : undefined,
  };
}

/**
 * Lit une pièce et rend le texte à analyser. Une pièce trop grosse, une image
 * ou un binaire ne sont jamais « vides » : ils portent leur raison de
 * non-analyse, que le ticket affiche (§21).
 */
export async function extractAttachment(view: JiraAttachmentView, deps: ExtractDeps): Promise<AttachmentExtraction> {
  const format = formatOf(view);
  if (view.sizeBytes > MAX_ANALYZED_BYTES) return emptyExtraction(view, format, 'oversize');
  if (format === 'image') return emptyExtraction(view, 'image', 'image');
  if (format === 'binary-attachment') return emptyExtraction(view, 'binary-attachment', 'binary-attachment');
  let bytes: Uint8Array | null = null;
  try {
    bytes = await deps.fetchBytes(view);
  } catch {
    bytes = null;
  }
  if (bytes === null || bytes.length === 0) return emptyExtraction(view, format, 'unsupported-format');
  if (format === 'pdf') return fromPdf(view, bytes, extractPdf(bytes, deps.inflate));
  if (format === 'ooxml') return fromOoxml(view, extractOoxml(bytes, deps.inflate));
  return fromText(view, bytes);
}

/** Traduit un échec de lecture en part non analysée pour l'indicateur §21. */
export function toUnanalyzedPart(view: JiraAttachmentView, extraction: AttachmentExtraction): UnanalyzedPart | null {
  if (!extraction.reason) return null;
  return {
    id: view.fileName || view.id,
    format: extraction.format,
    bytes: Math.max(0, view.sizeBytes),
    reason: extraction.reason,
  };
}

/**
 * Adaptateur pour `analyzeAttachment()` : l'extracteur attendu par la
 * plateforme existante, branché sur les lecteurs PDF et OOXML.
 */
export function createTextExtractor(deps: ExtractDeps): TextExtractor {
  return async (view) => {
    const extraction = await extractAttachment(view, deps);
    return extraction.text.trim() === '' ? null : extraction.text;
  };
}
