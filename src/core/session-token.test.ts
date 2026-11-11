/**
 * Tests — jeton de session signé (#23) et TTL d'inactivité (#24).
 *
 * Couvre : signature vérifiable, toute altération refusée, clé faible refusée,
 * extinction par inactivité (échec fermé sur une date illisible) et
 * renouvellement glissant qui n'efface pas les compteurs.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_TOKEN_VERSION,
  expiresAt,
  isExpired,
  remainingMs,
  renewSessionToken,
  signSessionToken,
  verifySessionToken,
  type SessionClaims,
} from './session-token';

const KEY = 'cle-de-signature-fournie-par-l-appelant';
const OTHER_KEY = 'une-autre-cle-de-signature-valide';
const WEAK_KEY = 'trop-courte';
const NOW = '2026-11-12T10:00:00.000Z';
const BEFORE = '2026-11-12T09:00:00.000Z';

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    sessionRef: 'sess-1',
    accountId: 'acc-agent',
    issueId: '10001',
    taintedSince: BEFORE,
    lastActivityAt: NOW,
    publicRepliesUsed: 1,
    quarantine: false,
    ...overrides,
  };
}

/** Fabrique un jeton signé avec une charge arbitraire (pour les cas tordus). */
function forged(payload: unknown, key = KEY): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const head = `${SESSION_TOKEN_VERSION}.${encoded}`;
  const signature = createHmac('sha256', key).update(head, 'utf8').digest('hex');
  return `${head}.${signature}`;
}

describe('jeton de session signé (#23)', () => {
  it('un jeton signé se vérifie et rend ses affirmations', () => {
    const token = signSessionToken(claims(), KEY);
    expect(token).not.toBeNull();
    const checked = verifySessionToken(token, KEY, NOW);
    expect(checked.ok).toBe(true);
    expect(checked.reason).toBe('ok');
    expect(checked.claims).toEqual(claims());
  });

  it('le jeton ne contient ni la clé ni de texte de ticket', () => {
    const token = signSessionToken(claims(), KEY) ?? '';
    expect(token).not.toContain(KEY);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith(`${SESSION_TOKEN_VERSION}.`)).toBe(true);
  });

  it('une charge altérée puis recodée ne signe plus : refus', () => {
    const token = signSessionToken(claims(), KEY) ?? '';
    const [version, payload, signature] = [
      token.split('.')[0] ?? '',
      Buffer.from(JSON.stringify(claims({ quarantine: false, publicRepliesUsed: 99 })), 'utf8')
        .toString('base64url'),
      token.split('.')[2] ?? '',
    ];
    const tampered = `${version}.${payload}.${signature}`;
    expect(verifySessionToken(tampered, KEY, NOW).reason).toBe('bad-signature');
  });

  it('une signature retouchée d’un caractère est refusée', () => {
    const token = signSessionToken(claims(), KEY) ?? '';
    const parts = token.split('.');
    const head = parts.slice(0, 2).join('.');
    const flipped = (parts[2] ?? 'a').replace(/^./, (parts[2] ?? 'a').startsWith('0') ? '1' : '0');
    expect(verifySessionToken(`${head}.${flipped}`, KEY, NOW).reason).toBe('bad-signature');
  });

  it('une autre clé ne vérifie pas le jeton', () => {
    const token = signSessionToken(claims(), KEY);
    expect(verifySessionToken(token, OTHER_KEY, NOW).reason).toBe('bad-signature');
  });

  it('sans clé utilisable : rien n’est signé, rien n’est vérifié', () => {
    expect(signSessionToken(claims(), WEAK_KEY)).toBeNull();
    expect(signSessionToken(claims(), '')).toBeNull();
    expect(verifySessionToken('v1.aa.bb', WEAK_KEY, NOW).reason).toBe('no-key');
  });

  it('format inconnu, version inconnue, charge illisible : refus distincts', () => {
    expect(verifySessionToken(null, KEY, NOW).reason).toBe('malformed');
    expect(verifySessionToken('pas-un-jeton', KEY, NOW).reason).toBe('malformed');
    expect(verifySessionToken('v2.aa.bb', KEY, NOW).reason).toBe('unsupported-version');
    const junk = `${SESSION_TOKEN_VERSION}.${Buffer.from('{').toString('base64url')}`;
    const signed = forged({ sessionRef: 'a' }, KEY).split('.');
    expect(verifySessionToken(`${junk}.${signed[2]}`, KEY, NOW).reason).toBe('bad-signature');
    expect(verifySessionToken(forged({ sessionRef: 'a' }, KEY), KEY, NOW).reason)
      .toBe('malformed');
  });

  it('une charge complète mais aux dates illisibles est refusée', () => {
    const token = forged(claims({ lastActivityAt: 'hier-matin' }), KEY);
    expect(verifySessionToken(token, KEY, NOW).reason).toBe('malformed');
  });
});

describe('extinction par inactivité (#24)', () => {
  const TTL = 30 * 60 * 1000;
  const LATE = '2026-11-12T10:31:00.000Z';

  it('l’échéance est bien lastActivityAt + TTL', () => {
    expect(expiresAt(claims(), TTL)).toBe('2026-11-12T10:30:00.000Z');
    expect(DEFAULT_SESSION_TTL_MS).toBe(TTL);
  });

  it('avant l’échéance le jeton vit, après il est éteint', () => {
    const token = signSessionToken(claims(), KEY);
    expect(verifySessionToken(token, KEY, '2026-11-12T10:29:59.000Z').ok).toBe(true);
    const late = verifySessionToken(token, KEY, LATE);
    expect(late.ok).toBe(false);
    expect(late.reason).toBe('expired');
    expect(late.claims).not.toBeNull();
    expect(late.expiresAt).toBe('2026-11-12T10:30:00.000Z');
  });

  it('le temps restant décroît et passe négatif', () => {
    expect(remainingMs(claims(), NOW, TTL)).toBe(TTL);
    expect(remainingMs(claims(), LATE, TTL)).toBeLessThan(0);
    expect(isExpired(claims(), LATE, TTL)).toBe(true);
    expect(isExpired(claims(), NOW, TTL)).toBe(false);
  });

  it('échec fermé : une date illisible vaut extinction', () => {
    expect(isExpired(claims({ lastActivityAt: 'pas-une-date' }), NOW, TTL)).toBe(true);
    expect(Number.isNaN(remainingMs(claims({ lastActivityAt: 'x' }), NOW, TTL))).toBe(true);
    expect(expiresAt(claims({ lastActivityAt: 'x' }), TTL)).toBeNull();
  });

  it('renouveler fait glisser le TTL sans effacer les compteurs', () => {
    const renewed = renewSessionToken(claims({ publicRepliesUsed: 2, quarantine: true }), KEY, LATE);
    const checked = verifySessionToken(renewed, KEY, '2026-11-12T10:45:00.000Z', TTL);
    expect(checked.ok).toBe(true);
    expect(checked.claims?.lastActivityAt).toBe(LATE);
    expect(checked.claims?.publicRepliesUsed).toBe(2);
    expect(checked.claims?.quarantine).toBe(true);
    expect(checked.claims?.taintedSince).toBe(BEFORE);
  });

  it('un TTL nul éteint immédiatement : la borne est respectée', () => {
    const token = signSessionToken(claims(), KEY);
    expect(verifySessionToken(token, KEY, NOW, 0).reason).toBe('expired');
  });
});
