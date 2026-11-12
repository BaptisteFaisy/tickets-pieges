/**
 * Bloc « extraction de texte » de la démo « Ce que le texte cache ».
 *
 * Un PDF minimal et un DOCX minimal sont **construits sur place** (octets
 * assemblés dans le navigateur, `content-files.ts`), puis passés aux
 * extracteurs du domaine (`src/platform/extract-pdf.ts`, `extract-ooxml.ts`).
 * La section montre ce qui est lu — y compris le texte caché (w:vanish,
 * blanc sur blanc, texte alternatif d'image) — et ce qu'elle n'a pas su ouvrir.
 */

import { composeText } from '../../platform/extract';
import { extractOoxml, type OoxmlExtraction } from '../../platform/extract-ooxml';
import { extractPdf, pdfMetadataText, type PdfExtraction } from '../../platform/extract-pdf';
import { badge, buttonHtml, heading, kv, note, panel, pre } from '../dom';
import { buildMinimalDocx, buildMinimalPdf } from './content-files';
import type { SectionContext } from './types';

/** Textes visibles du bloc extraction, dans les deux langues. */
const LABELS = {
  extract: { fr: 'Extraction de texte — pièces construites sur place', en: 'Text extraction — files built in place' },
  extractHint: {
    fr: 'Un PDF minimal et un DOCX minimal sont assemblés en mémoire, puis lus par les extracteurs du produit. Aucun fichier téléchargé, aucun réseau.',
    en: 'A minimal PDF and a minimal DOCX are assembled in memory, then read by the product extractors. No downloaded file, no network.',
  },
  extractEmpty: {
    fr: 'Construisez une pièce pour voir son texte — y compris ce qu’elle cache.',
    en: 'Build a file to see its text — including what it hides.',
  },
  buildPdf: { fr: 'Construire un PDF minimal', en: 'Build a minimal PDF' },
  buildDocx: { fr: 'Construire un DOCX minimal', en: 'Build a minimal DOCX' },
  pdfTitle: { fr: 'PDF minimal — texte reconstruit', en: 'Minimal PDF — reconstructed text' },
  docxTitle: { fr: 'DOCX minimal — visible et caché', en: 'Minimal DOCX — visible and hidden' },
  pdfFailed: { fr: 'Ce PDF n’a pas pu être lu : il serait marqué « non analysé ».', en: 'This PDF could not be read: it would be marked "not analysed".' },
  docxFailed: { fr: 'Ce DOCX n’a pas pu être lu : il serait marqué « non analysé ».', en: 'This DOCX could not be read: it would be marked "not analysed".' },
  analyzedText: { fr: 'Texte tel qu’analysé (marqueurs stables)', en: 'Text as analysed (stable markers)' },
} as const;

function label(ctx: SectionContext, key: keyof typeof LABELS): string {
  return LABELS[key][ctx.lang];
}

/** Ce que le PDF a rendu : texte, métadonnées, et ce qu'on n'a pas su ouvrir. */
export function pdfView(bytes: Uint8Array, extraction: PdfExtraction | null, ctx: SectionContext): string {
  if (extraction === null) return note(label(ctx, 'pdfFailed'));
  const fr = ctx.lang === 'fr';
  const stats = kv([
    [fr ? 'Octets' : 'Bytes', String(bytes.length)],
    [fr ? 'Pages déclarées' : 'Declared pages', String(extraction.pages)],
    [fr ? 'Flux lus' : 'Streams read', String(extraction.streamsRead)],
    [fr ? 'Flux non ouverts' : 'Streams skipped', String(extraction.streamsSkipped)],
    [fr ? 'Tronqué' : 'Truncated', String(extraction.truncated)],
    [fr ? 'Faible confiance' : 'Low confidence', String(extraction.lowConfidence)],
  ]);
  const meta = pdfMetadataText(bytes);
  return heading(label(ctx, 'pdfTitle')) + stats + pre(extraction.text) +
    (meta.length > 0 ? note(`${fr ? 'Métadonnées : ' : 'Metadata: '}${meta.join(' · ')}`) : '');
}

/** Ce que le DOCX a rendu : visible, masqué, blanc sur blanc, alt d'image. */
export function ooxmlView(bytes: Uint8Array, extraction: OoxmlExtraction | null, ctx: SectionContext): string {
  if (extraction === null) return note(label(ctx, 'docxFailed'));
  const fr = ctx.lang === 'fr';
  const badges = [
    badge(extraction.kind, 'ok'),
    badge(`${bytes.length} ${fr ? 'octets' : 'bytes'}`),
    badge(`${extraction.parts.length} ${fr ? 'parties lues' : 'parts read'}`),
    extraction.truncated ? badge(fr ? 'tronqué' : 'truncated', 'warn') : '',
  ].join(' ');
  const hidden = extraction.concealed.length > 0 ? extraction.concealed.join(' | ') : '—';
  const white = extraction.whiteOnWhite.length > 0 ? extraction.whiteOnWhite.join(' | ') : '—';
  const alt = extraction.altTexts.length > 0 ? extraction.altTexts.join(' | ') : '—';
  const analyzed = composeText(extraction.visible, extraction.concealed, extraction.altTexts, extraction.whiteOnWhite);
  return heading(label(ctx, 'docxTitle')) + `<div class="verdict">${badges}</div>` +
    kv([
      [fr ? 'Texte visible' : 'Visible text', extraction.visible],
      [fr ? 'Texte masqué trouvé' : 'Hidden text found', hidden],
      [fr ? 'Blanc sur blanc' : 'White on white', white],
      [fr ? 'Texte alternatif d’image' : 'Image alt text', alt],
    ]) +
    heading(label(ctx, 'analyzedText')) + pre(analyzed);
}

/** Construit le PDF minimal sur place et affiche son texte extrait. */
export function runPdf(root: HTMLElement, ctx: SectionContext): void {
  const target = root.querySelector<HTMLDivElement>('#c-extract-result');
  if (!target) return;
  const bytes = buildMinimalPdf();
  target.innerHTML = pdfView(bytes, extractPdf(bytes), ctx);
}

/** Construit le DOCX minimal sur place et affiche le texte caché trouvé. */
export function runDocx(root: HTMLElement, ctx: SectionContext): void {
  const target = root.querySelector<HTMLDivElement>('#c-extract-result');
  if (!target) return;
  const bytes = buildMinimalDocx();
  target.innerHTML = ooxmlView(bytes, extractOoxml(bytes), ctx);
}

/** Panneau « extraction de texte » : deux boutons, un résultat. */
export function extractPanel(ctx: SectionContext): string {
  return panel(
    heading(label(ctx, 'extract')) + note(label(ctx, 'extractHint')) +
      `<div class="row">${buttonHtml('c-pdf', label(ctx, 'buildPdf'))}${buttonHtml('c-docx', label(ctx, 'buildDocx'), 'ghost')}</div>` +
      `<div id="c-extract-result">${note(label(ctx, 'extractEmpty'))}</div>`,
  );
}
