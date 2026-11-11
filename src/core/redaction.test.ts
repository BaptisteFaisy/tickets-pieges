import { describe, expect, it } from 'vitest';
import { detectDlp } from './dlp';
import { lookup, maskFor, redact, restore } from './redaction';

const IBAN = 'FR7630006000011234567890189';
const CARTE = '4970101234567893';
const EMAIL = 'jean.dupont@acme.fr';

describe('masquage réversible (§35)', () => {
  it('masque puis restaure le texte à l’identique', () => {
    const texte = `Virement vers ${IBAN}, carte ${CARTE}, contact ${EMAIL}.`;
    const result = redact(texte, detectDlp(texte));
    expect(result.text).toContain('[masqué:IBAN:1]');
    expect(result.text).toContain('[masqué:CARD:1]');
    expect(result.text).toContain('[masqué:EMAIL:1]');
    expect(restore(result.text, result.table)).toBe(texte);
  });

  it('le texte rendu ne contient jamais une valeur en clair', () => {
    const texte = `Compte ${IBAN} et carte ${CARTE}.`;
    const result = redact(texte, detectDlp(texte));
    expect(result.text).not.toContain(IBAN);
    expect(result.text).not.toContain(CARTE);
  });

  it('la table conserve la valeur hors du ticket, puis lookup la retrouve', () => {
    const texte = `Compte ${IBAN}.`;
    const result = redact(texte, detectDlp(texte));
    expect(result.table.entries).toHaveLength(1);
    const entry = result.table.entries[0];
    expect(() => lookup(result.table, entry?.token ?? '')).not.toThrow();
    expect(lookup(result.table, entry?.token ?? '')).toBe(IBAN);
    expect(entry?.value).toBe(IBAN);
  });

  it('un jeton inconnu ne restaure rien', () => {
    expect(lookup({ entries: [] }, '[masqué:IBAN:9]')).toBeUndefined();
  });
});

describe('libellé de masque', () => {
  it('associe chaque motif à un libellé stable', () => {
    expect(maskFor('iban')).toBe('IBAN');
    expect(maskFor('card')).toBe('CARD');
    expect(maskFor('github-token')).toBe('TOKEN');
    expect(maskFor('jwt')).toBe('JWT');
    expect(maskFor('email')).toBe('EMAIL');
  });
});