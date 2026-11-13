/**
 * Tests du chiffrement au repos : aller-retour exact, rejet des clés fausses,
 * rejet de toute altération, versionnement du format.
 */

import { describe, expect, it } from 'vitest';
import {
  CRYPTO_FORMAT_VERSION,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretVersion,
} from './crypto';

const KEY = 'cle-operateur-de-test';

describe('aller-retour', () => {
  const samples = [
    '',
    'mot de passe client',
    'texte avec accents é è ê et apostrophes l\'original',
    'charge longue\nmultiligne avec "guillemets" et <balises>',
    'ｕｎｉｃｏｄｅ　全角 et emoji 🚀',
  ];

  for (const plaintext of samples) {
    it('chiffre puis déchiffre exactement', () => {
      expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
    });
  }

  it('deux chiffrements du même texte diffèrent (IV aléatoire) mais se relisent pareil', () => {
    const text = 'le même contenu';
    const a = encryptSecret(text, KEY);
    const b = encryptSecret(text, KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(text);
    expect(decryptSecret(b, KEY)).toBe(text);
  });

  it('ne laisse jamais le clair ni la clé dans le chiffré', () => {
    const ciphertext = encryptSecret('secret-ultra-sensible', KEY);
    expect(ciphertext).not.toContain('secret-ultra-sensible');
    expect(ciphertext).not.toContain(KEY);
  });
});

describe('rejets', () => {
  it('refuse une mauvaise clé', () => {
    const ciphertext = encryptSecret('contenu', KEY);
    expect(() => decryptSecret(ciphertext, 'autre-cle')).toThrow();
  });

  it('refuse toute altération du chiffré (tag GCM)', () => {
    const ciphertext = encryptSecret('contenu', KEY);
    // Le dernier caractère de l'enveloppe base64url ne porte que 2 bits de
    // padding : l'altérer peut laisser les octets inchangés (mesuré ~25 % des
    // cas) et rendre le test muet. On altère le premier caractère du tag,
    // toujours significatif, donc la falsification est réelle à chaque fois.
    const [version, iv, tag, body] = ciphertext.split('.');
    const flipped = tag![0] === 'a' ? 'b' : 'a';
    const tampered = [version, iv, flipped + tag!.slice(1), body].join('.');
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('refuse une version inconnue et une enveloppe mal formée', () => {
    expect(() => decryptSecret('v9.xxx.yyy.zzz', KEY)).toThrow(/non reconnu/);
    expect(() => decryptSecret('v1.a.b', KEY)).toThrow(/mal formée/);
  });
});

describe('format', () => {
  it('expose la version de l\'enveloppe et détecte le chiffré', () => {
    const ciphertext = encryptSecret('x', KEY);
    expect(secretVersion(ciphertext)).toBe('v1');
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(isEncrypted('du clair')).toBe(false);
    expect(CRYPTO_FORMAT_VERSION).toBe(1);
  });
});