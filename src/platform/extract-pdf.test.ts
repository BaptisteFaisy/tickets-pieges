import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import { contentText, decodeLiteral, extractPdf, pdfMetadataText } from './extract-pdf';
import type { Inflate } from './extract-ooxml';

/** Décompresseur de test : les flux PDF utilisent l'enveloppe zlib. */
const inflate: Inflate = (data) => new Uint8Array(inflateSync(data));

function pdfBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../../data/samples/pdf-minimal.txt', import.meta.url)));
}

/** PDF dont le seul flux de contenu est compressé en Flate. */
function flatePdf(): Uint8Array {
  const compressed = deflateSync(Buffer.from('BT (Texte compresse) Tj ET'));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  return new Uint8Array(Buffer.concat([head, compressed, tail]));
}

describe('extractPdf', () => {
  it('extrait le texte d’un PDF minimal à flux non compressé', () => {
    const pdf = extractPdf(pdfBytes());
    expect(pdf?.text).toContain('Bonjour, demande de remboursement pour la commande 4711.');
    expect(pdf?.pages).toBe(1);
    expect(pdf?.streamsRead).toBe(1);
    expect(pdf?.lowConfidence).toBe(false);
  });

  it('rend les métadonnées du document', () => {
    expect(pdfMetadataText(pdfBytes())).toEqual(['Facture 4711', 'Remboursement']);
  });

  it('rend null si ce n’est pas un PDF', () => {
    expect(extractPdf(new Uint8Array(Buffer.from('bonjour, pas un pdf')))).toBeNull();
  });

  it('ne jette jamais sur un PDF tronqué', () => {
    expect(() => extractPdf(new Uint8Array(Buffer.from('%PDF-1.4\nstream\n garbage')))).not.toThrow();
  });

  it('dit ce qu’il n’a pas su ouvrir : flux compressé sans décompresseur', () => {
    const pdf = extractPdf(flatePdf());
    expect(pdf?.streamsSkipped).toBe(1);
    expect(pdf?.streamsRead).toBe(0);
    expect(pdf?.text.trim()).toBe('');
    expect(pdf?.lowConfidence).toBe(true);
  });

  it('lit le flux compressé quand un décompresseur est fourni', () => {
    const pdf = extractPdf(flatePdf(), inflate);
    expect(pdf?.text).toContain('Texte compresse');
    expect(pdf?.streamsSkipped).toBe(0);
    expect(pdf?.lowConfidence).toBe(false);
  });
});

describe('contentText — opérateurs d’affichage', () => {
  it('lit une chaîne suivie de Tj', () => {
    expect(contentText('BT (Bonjour) Tj ET').trim()).toBe('Bonjour');
  });

  it('insère un espace sur un crénage large dans un tableau TJ', () => {
    expect(contentText('[(Mot) -200 (suivant)] TJ').trim()).toBe('Mot suivant');
  });

  it('colle les chaînes d’un TJ sans crénage large', () => {
    expect(contentText('[(Mo) -20 (t)] TJ').trim()).toBe('Mot');
  });

  it('pose une ligne par déplacement de texte', () => {
    expect(contentText('BT (Ligne une) Td (Ligne deux) Td ET')).toContain('Ligne une\nLigne deux');
  });

  it('lit les chaînes hexadécimales', () => {
    expect(contentText('<48656C6C6F> Tj').trim()).toBe('Hello');
  });

  it('ignore un flux sans opérateur de texte', () => {
    expect(contentText('q 1 0 0 1 0 0 cm Q').trim()).toBe('');
  });
});

describe('decodeLiteral', () => {
  it('déséchappe les séquences usuelles', () => {
    expect(decodeLiteral('(ligne1\\nligne2)')).toBe('ligne1\nligne2');
    expect(decodeLiteral('(a\\(b\\)c)')).toBe('a(b)c');
    expect(decodeLiteral('(tab\\there)')).toBe('tab\there');
  });

  it('lit les échappements octaux', () => {
    expect(decodeLiteral('(\\101\\102)')).toBe('AB');
  });

  it('ignore une fin de ligne échappée (continuation)', () => {
    expect(decodeLiteral('(mot\\\n suite)')).toBe('mot suite');
  });

  it('décode une chaîne UTF-16BE avec BOM', () => {
    expect(decodeLiteral('(\u00fe\u00ff\u0000A\u0000B)')).toBe('AB');
  });
});
