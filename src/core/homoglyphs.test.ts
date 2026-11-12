import { describe, expect, it } from 'vitest';
import {
  CONFUSABLE_COUNT,
  decodePunycode,
  findLookalikes,
  foldConfusables,
  hasConfusable,
} from './homoglyphs';

/** `а` cyrillique (U+0430) devant `cme.fr` : ressemblant à `acme.fr`. */
const CYRILLIC_ACME = '\u0430cme.fr';

describe('confusables — pliage cyrillique/grec vers ASCII', () => {
  it('un homoglyphe cyrillique se plie vers son équivalent latin', () => {
    expect(foldConfusables(CYRILLIC_ACME)).toBe('acme.fr');
  });

  it('un domaine purement ASCII reste inchangé', () => {
    expect(foldConfusables('acme.fr')).toBe('acme.fr');
  });

  it('distingue l’homoglyphe de l’ASCII', () => {
    expect(hasConfusable(CYRILLIC_ACME)).toBe(true);
    expect(hasConfusable('acme.fr')).toBe(false);
    // deux chaînes d’apparence identique ne sont pas égales
    expect(CYRILLIC_ACME).not.toBe('acme.fr');
    expect(foldConfusables(CYRILLIC_ACME)).toBe(foldConfusables('acme.fr'));
  });

  it('le référentiel est réduit et documenté', () => {
    expect(CONFUSABLE_COUNT).toBeGreaterThan(10);
    expect(CONFUSABLE_COUNT).toBeLessThan(60);
  });
});

describe('domaines lookalike', () => {
  it('repère un domaine cyrillique dans un texte', () => {
    const found = findLookalikes(`contactez ${CYRILLIC_ACME} pour plus de details`);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('confusable');
    expect(found[0]?.normalized).toBe('acme.fr');
  });

  it('ignore un domaine ASCII banal', () => {
    expect(findLookalikes('contactez acme.fr pour plus de details')).toHaveLength(0);
  });
});

describe('punycode', () => {
  it('déplie un hôte IDN vers sa forme visible', () => {
    expect(decodePunycode('xn--caf-dma.fr')).toBe('café.fr');
  });

  it('rend un hôte ASCII tel quel', () => {
    expect(decodePunycode('acme.fr')).toBe('acme.fr');
  });

  it('rend null sur un flux punycode invalide', () => {
    expect(decodePunycode('xn--!invalid!.fr')).toBeNull();
  });

  it('repère un domaine punycode comme lookalike', () => {
    const found = findLookalikes('visitez xn--caf-dma.fr maintenant');
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('punycode');
    expect(found[0]?.normalized).toBe('café.fr');
  });
});