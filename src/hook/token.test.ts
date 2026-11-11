/**
 * Tests — jeton du hook (§11).
 *
 * Couvre : empreinte jamais en clair, comparaison à temps constant, refus
 * indistinguables (absent / faux / compte inconnu), émission et rotation.
 * Aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '../core/hashing';
import type { HookTokenRow } from '../platform/schema';
import {
  issueToken,
  rotateToken,
  timingSafeEqual,
  tokenFingerprint,
  verifyToken,
} from './token';

const NOW = '2026-11-11T10:00:00.000Z';

function row(tokenHash: string): HookTokenRow {
  return { accountId: 'acc-1', tokenHash, createdAt: NOW, lastUsedAt: null };
}

describe('tokenFingerprint', () => {
  it('empreinte SHA-256 hexadécimale, jamais le clair', () => {
    const fingerprint = tokenFingerprint('ptk_secret');
    expect(fingerprint).toBe(sha256('ptk_secret'));
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain('ptk_secret');
  });

  it('déterministe : même jeton, même empreinte', () => {
    expect(tokenFingerprint('abc')).toBe(tokenFingerprint('abc'));
  });
});

describe('timingSafeEqual', () => {
  it('empreintes égales : vrai', () => {
    expect(timingSafeEqual(sha256('x'), sha256('x'))).toBe(true);
  });

  it('empreintes différentes : faux', () => {
    expect(timingSafeEqual(sha256('x'), sha256('y'))).toBe(false);
  });

  it('longueurs différentes : faux, sans planter', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });
});

describe('verifyToken', () => {
  const issued = issueToken('acc-1', NOW, () => 'ptk_fixe');

  it('jeton valide : accepté', () => {
    expect(verifyToken('ptk_fixe', issued.row)).toEqual({ ok: true, reason: 'ok' });
  });

  it('jeton absent : refus « absent »', () => {
    expect(verifyToken(null, issued.row)).toEqual({ ok: false, reason: 'absent' });
  });

  it('compte inconnu (aucune ligne) : refus « unknown-account »', () => {
    expect(verifyToken('ptk_fixe', null)).toEqual({ ok: false, reason: 'unknown-account' });
  });

  it('jeton faux : refus « mismatch »', () => {
    expect(verifyToken('ptk_autre', issued.row)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('absent et faux sont indiscernables de l’extérieur : ok=false dans les deux cas', () => {
    const absent = verifyToken(null, issued.row);
    const faux = verifyToken('ptk_autre', issued.row);
    expect(absent.ok).toBe(false);
    expect(faux.ok).toBe(false);
  });
});

describe('issueToken / rotateToken', () => {
  it('émission : le clair n’existe que dans le rendu, la ligne ne porte que l’empreinte', () => {
    const fresh = issueToken('acc-9', NOW, () => 'ptk_neuf');
    expect(fresh.token).toBe('ptk_neuf');
    expect(fresh.row.tokenHash).toBe(tokenFingerprint('ptk_neuf'));
    expect(fresh.row.accountId).toBe('acc-9');
    expect(fresh.row.createdAt).toBe(NOW);
    expect(fresh.row.lastUsedAt).toBeNull();
    expect(JSON.stringify(fresh.row)).not.toContain('ptk_neuf');
  });

  it('rotation : nouveau jeton, même compte, ancien jeton refusé', () => {
    const first = issueToken('acc-1', NOW, () => 'ptk_v1');
    const second = rotateToken(first.row, '2026-11-12T08:00:00.000Z', () => 'ptk_v2');
    expect(second.row.accountId).toBe('acc-1');
    expect(second.row.createdAt).toBe('2026-11-12T08:00:00.000Z');
    expect(verifyToken('ptk_v2', second.row).ok).toBe(true);
    expect(verifyToken('ptk_v1', second.row).ok).toBe(false);
  });

  it('le générateur par défaut produit des jetons distincts et longs', () => {
    const a = issueToken('acc-1', NOW);
    const b = issueToken('acc-1', NOW);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });
});
