import { describe, expect, it } from 'vitest';
import {
  checkOutboundFile,
  extensionOf,
  hasDoubleExtension,
  MAX_OUTBOUND_FILE_BYTES,
} from './outbound-files';
import type { OutboundContext } from './types';

const context: OutboundContext = {
  issueKey: 'TP-1',
  requestText: 'statut de ma commande',
  otherIssueKeys: ['TP-2'],
  strict: true,
  taintedSession: false,
};

describe('sas des pièces jointes sortantes (#32)', () => {
  it('lit l’extension et les doubles extensions', () => {
    expect(extensionOf('rapport.PDF')).toBe('pdf');
    expect(extensionOf('sans-extension')).toBe('');
    expect(hasDoubleExtension('facture.pdf.exe')).toBe(true);
    expect(hasDoubleExtension('rapport.pdf')).toBe(false);
  });

  it('retient une pièce exécutable', () => {
    const check = checkOutboundFile({ fileName: 'install.exe', sizeBytes: 1200 }, context);
    expect(check.allowed).toBe(false);
    expect(check.action).toBe('hold-for-review');
    expect(check.reasons.join(' ')).toContain('exécutable');
  });

  it('retient une pièce à double extension', () => {
    const check = checkOutboundFile({ fileName: 'facture.pdf.exe', sizeBytes: 1200 }, context);
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(' ')).toContain('double extension');
  });

  it('retient une pièce trop volumineuse', () => {
    const check = checkOutboundFile(
      { fileName: 'sauvegarde.zip', sizeBytes: MAX_OUTBOUND_FILE_BYTES + 1 },
      context,
    );
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(' ')).toContain('taille');
  });

  it('retient un nom de pièce contenant des caractères invisibles', () => {
    const check = checkOutboundFile({ fileName: 'fact\u200Bre.pdf', sizeBytes: 1200 }, context);
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(' ')).toContain('invisibles');
  });

  it('analyse le texte extrait quand il existe', () => {
    const check = checkOutboundFile(
      { fileName: 'note.txt', sizeBytes: 120, extractedText: 'Voir TP-2 pour le détail.' },
      context,
    );
    expect(check.contentAnalyzed).toBe(true);
    expect(check.allowed).toBe(false);
  });

  it('laisse passer une pièce propre', () => {
    const check = checkOutboundFile(
      { fileName: 'note.txt', sizeBytes: 120, extractedText: 'Votre commande est en route.' },
      context,
    );
    expect(check.allowed).toBe(true);
    expect(check.action).toBe('allow');
    expect(check.contentAnalyzed).toBe(true);
    expect(check.reasons).toEqual([]);
  });

  it('dit qu’une pièce sans texte extrait n’est pas analysée', () => {
    const check = checkOutboundFile({ fileName: 'scan.pdf', sizeBytes: 120 }, context);
    expect(check.contentAnalyzed).toBe(false);
    expect(check.reasons.join(' ')).toContain('non analysé');
  });

  it('retient en mode strict une pièce dont le contenu n’est pas analysé', () => {
    const check = checkOutboundFile({ fileName: 'scan.pdf', sizeBytes: 120 }, context);
    expect(check.allowed).toBe(false);
    expect(check.action).toBe('hold-for-review');
  });

  it('laisse passer une pièce non analysée hors mode strict, en le disant', () => {
    const check = checkOutboundFile(
      { fileName: 'scan.pdf', sizeBytes: 120 },
      { ...context, strict: false },
    );
    expect(check.allowed).toBe(true);
    expect(check.reasons.join(' ')).toContain('non analysé');
  });
});
