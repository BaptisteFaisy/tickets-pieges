/**
 * Jeton du hook (§11) — empreinte, comparaison à temps constant, rotation.
 *
 * Le jeton `$PIEGE_TOKEN` authentifie les appels du hook client vers les
 * webtriggers de l'app. Trois règles le protègent :
 *  - **jamais stocké en clair** : seule l'empreinte SHA-256 vit dans la table
 *    `hook_token` (§19) ; un vol de la base ne donne aucun jeton utilisable ;
 *  - **comparaison à temps constant** : la vérification ne s'arrête pas au
 *    premier caractère différent, pour ne rien révéler par le délai ;
 *  - **refus silencieux et journalisé** : absent ou faux rendent exactement le
 *    même verdict public (401, même corps) ; seul le journal distingue les cas.
 *
 * Domaine pur : aucune E/S, aucune heure lue (dates injectées), aucun
 * import `@forge/*`. La persistance passe par `HookTokenRepo`
 * (`src/platform/schema.ts`), hors de ce fichier.
 */

import { randomToken, sha256 } from '../core/hashing';
import type { HookTokenRow } from '../platform/schema';

/** Empreinte stockée d'un jeton : SHA-256 hexadécimal, jamais le clair. */
export function tokenFingerprint(token: string): string {
  return sha256(token);
}

/**
 * Comparaison à temps constant de deux empreintes hexadécimales : la boucle va
 * toujours au bout, le résultat s'accumule sans court-circuit.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Pourquoi un jeton est refusé — pour le journal, jamais pour la réponse. */
export type TokenRefusal = 'absent' | 'unknown-account' | 'mismatch';

/** Verdict de vérification : `reason` ne sort pas de l'app (§11 : 401 identique). */
export interface TokenCheck {
  ok: boolean;
  reason: 'ok' | TokenRefusal;
}

/**
 * Vérifie le jeton présenté (`Authorization: Bearer …`) contre la ligne
 * stockée. Un jeton absent, un compte inconnu et une empreinte fausse rendent
 * tous `ok: false` — la réponse publique sera la même (401), seul `reason`
 * part au journal.
 */
export function verifyToken(presented: string | null, row: HookTokenRow | null): TokenCheck {
  if (!presented) return { ok: false, reason: 'absent' };
  if (!row) return { ok: false, reason: 'unknown-account' };
  const candidate = tokenFingerprint(presented);
  if (!timingSafeEqual(candidate, row.tokenHash)) return { ok: false, reason: 'mismatch' };
  return { ok: true, reason: 'ok' };
}

/** Un jeton émis : le clair n'existe qu'ici, une seule fois, jamais stocké. */
export interface IssuedToken {
  token: string;
  row: HookTokenRow;
}

/**
 * Émet (ou réémet) le jeton d'un compte : le clair est rendu à l'appelant pour
 * un affichage unique, la ligne ne porte que l'empreinte. `generate` est
 * injectable pour les tests ; par défaut 24 octets d'aléa lisible.
 */
export function issueToken(
  accountId: string,
  now: string,
  generate: () => string = () => randomToken(24),
): IssuedToken {
  const token = generate();
  return {
    token,
    row: {
      accountId,
      tokenHash: tokenFingerprint(token),
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

/**
 * Rotation (§11) : nouveau jeton, nouvelle empreinte, `createdAt` repart de
 * `now`. L'ancien jeton cesse de vérifier dès que la ligne est écrite — la
 * rotation est le seul moyen de révoquer.
 */
export function rotateToken(
  previous: HookTokenRow,
  now: string,
  generate: () => string = () => randomToken(24),
): IssuedToken {
  return issueToken(previous.accountId, now, generate);
}
