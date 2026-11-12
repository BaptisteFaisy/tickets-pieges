import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  MARK_ALT,
  MARK_HIDDEN,
  MARK_WHITE,
  composeText,
  createTextExtractor,
  extractAttachment,
  formatOf,
  toUnanalyzedPart,
  type ExtractDeps,
} from './extract';
import type { AccountSnapshot, JiraAttachmentView } from './schema';

const author: AccountSnapshot = { accountId: 'a1', accountType: 'customer', displayName: 'A' };

function view(fileName: string, mimeType: string, sizeBytes = 1000): JiraAttachmentView {
  return { id: 'att-1', fileName, mimeType, sizeBytes, author, createdAt: '2026-01-01T00:00:00Z' };
}

function pdfSample(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../../data/samples/pdf-minimal.txt', import.meta.url)));
}

function deps(bytes: Uint8Array | null | (() => Promise<Uint8Array | null>)): ExtractDeps {
  const fetchBytes = typeof bytes === 'function' ? bytes : async () => bytes;
  return { fetchBytes };
}

describe('formatOf', () => {
  it('classe par mime puis par extension', () => {
    expect(formatOf(view('a.png', 'image/png'))).toBe('image');
    expect(formatOf(view('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(formatOf(view('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe('ooxml');
    expect(formatOf(view('rapport.docx', 'application/octet-stream'))).toBe('ooxml');
    expect(formatOf(view('notes.txt', 'text/plain'))).toBe('text');
    expect(formatOf(view('donnees', 'application/octet-stream'))).toBe('binary-attachment');
  });
});

describe('extractAttachment', () => {
  it('marque une image « non analysée » sans tenter de lecture', async () => {
    const extraction = await extractAttachment(view('photo.png', 'image/png'), deps(null));
    expect(extraction.format).toBe('image');
    expect(extraction.reason).toBe('image');
    expect(extraction.text).toBe('');
  });

  it('marque un binaire inconnu « non analysé »', async () => {
    const extraction = await extractAttachment(view('archive.bin', 'application/octet-stream'), deps(null));
    expect(extraction.format).toBe('binary-attachment');
    expect(extraction.reason).toBe('binary-attachment');
  });

  it('marque une pièce trop grosse « non analysée » sans la lire', async () => {
    let called = false;
    const extraction = await extractAttachment(view('huge.pdf', 'application/pdf', 5_000_000), deps(async () => {
      called = true;
      return null;
    }));
    expect(extraction.reason).toBe('oversize');
    expect(called).toBe(false);
  });

  it('extrait le texte d’un PDF minimal', async () => {
    const extraction = await extractAttachment(view('facture.pdf', 'application/pdf'), deps(pdfSample()));
    expect(extraction.format).toBe('pdf');
    expect(extraction.reason).toBeUndefined();
    expect(extraction.text).toContain('demande de remboursement pour la commande 4711');
    expect(extraction.text).toContain('Facture 4711');
  });

  it('lit un texte brut en UTF-8', async () => {
    const extraction = await extractAttachment(view('notes.txt', 'text/plain'), deps(new Uint8Array(Buffer.from('café résumé', 'utf8'))));
    expect(extraction.text).toBe('café résumé');
    expect(extraction.reason).toBeUndefined();
  });

  it('dit « non analysé » quand la lecture échoue, jamais « vide »', async () => {
    const failed = await extractAttachment(view('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), deps(new Uint8Array([1, 2, 3])));
    expect(failed.reason).toBe('unsupported-format');
    expect(failed.text).toBe('');
  });

  it('ne laisse jamais remonter une erreur du lecteur d’octets', async () => {
    const extraction = await extractAttachment(view('notes.txt', 'text/plain'), deps(async () => {
      throw new Error('reseau indisponible');
    }));
    expect(extraction.reason).toBe('unsupported-format');
  });
});

describe('composeText', () => {
  it('marque ce qui était caché avec des codes stables', () => {
    const text = composeText('Visible', ['masqué ici'], ['alt ici'], ['blanc ici']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Visible');
    expect(lines[1]).toBe(`${MARK_WHITE} blanc ici`);
    expect(lines[2]).toBe(`${MARK_HIDDEN} masqué ici`);
    expect(lines[3]).toBe(`${MARK_ALT} alt ici`);
  });

  it('omet les lignes vides', () => {
    expect(composeText('  ', [], ['alt'])).toBe(`${MARK_ALT} alt`);
  });
});

describe('toUnanalyzedPart', () => {
  it('rend une part non analysée chiffrée pour l’indicateur §21', async () => {
    const image = view('photo.png', 'image/png', 2048);
    const extraction = await extractAttachment(image, deps(null));
    expect(toUnanalyzedPart(image, extraction)).toEqual({
      id: 'photo.png',
      format: 'image',
      bytes: 2048,
      reason: 'image',
    });
  });

  it('rend null quand un texte a pu être analysé', async () => {
    const pdf = view('facture.pdf', 'application/pdf', 900);
    const extraction = await extractAttachment(pdf, deps(pdfSample()));
    expect(toUnanalyzedPart(pdf, extraction)).toBeNull();
  });
});

describe('createTextExtractor', () => {
  it('s’adapte à analyzeAttachment : du texte ou null', async () => {
    const extract = createTextExtractor(deps(pdfSample()));
    const text = await extract(view('facture.pdf', 'application/pdf'));
    expect(text).toContain('commande 4711');
    expect(await extract(view('photo.png', 'image/png'))).toBeNull();
  });
});
