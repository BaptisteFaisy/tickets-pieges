/**
 * Jeton de session signé (#23) et extinction par inactivité (#24) — domaine pur.
 *
 * La marque de session contaminée (§9) devait être stockée pour être prouvée.
 * Ce fichier la rend **auto-portée** : un jeton `v1.<charge>.<signature>` signé
 * HMAC-SHA-256 que n'importe quel vérificateur de l'app peut contrôler sans
 * lire la base. Trois règles :
 *  - **la clé vient de l'appelant**, jamais codée en dur (variable
 *    `SESSION_KEY_ENV_VAR` côté plateforme) ; sans clé, rien n'est signé ;
 *  - **comparaison à temps constant** (`node:crypto`), pour ne rien révéler par
 *    le délai ;
 *  - **échec fermé** : une charge illisible, une date invalide ou une signature
 *    fausse rendent tous `ok: false`. Le motif (`reason`) est destiné au
 *    journal, jamais à la réponse publique (§11 : refus identique).
 *
 * Le TTL (#24) est glissant : il court depuis `lastActivityAt`, donc une
 * session active ne s'éteint pas, une session abandonnée s'éteint seule.
 * Honnêteté (§21) : le jeton prouve l'intégrité de la marque, pas que la
 * session vit encore ailleurs ; la révocation passe par la rotation de la clé.
 *
 * Domaine pur : aucune E/S, aucune heure lue (`now` et `ttlMs` en paramètre),
 * aucun import `@forge/*`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Version du format — préfixe littéral du jeton. */
export const SESSION_TOKEN_VERSION = 'v1';

/** Nom de la variable d'environnement portant la clé (jamais la clé elle-même). */
export const SESSION_KEY_ENV_VAR = 'PIEGE_SESSION_KEY';

/** Inactivité par défaut avant extinction (#24) : 30 minutes. */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

/** Ce que le jeton affirme : qui, sur quel ticket, depuis quand, quel budget. */
export interface SessionClaims {
  sessionRef: string;
  accountId: string;
  issueId: string;
  /** Date (ISO) de la première lecture de contenu non vérifié. */
  taintedSince: string;
  /** Date (ISO) du dernier geste : point de départ du TTL glissant (#24). */
  lastActivityAt: string;
  /** Réponses publiques déjà consommées (#26). */
  publicRepliesUsed: number;
  /** Session passée en lecture seule (#27). */
  quarantine: boolean;
}

/** Pourquoi un jeton est refusé — pour le journal, pas pour la réponse. */
export type SessionTokenRefusal =
  | 'no-key'
  | 'malformed'
  | 'unsupported-version'
  | 'bad-signature'
  | 'expired';

/** Verdict de vérification : `reason` ne sort pas de l'app. */
export interface SessionTokenCheck {
  ok: boolean;
  claims: SessionClaims | null;
  reason: 'ok' | SessionTokenRefusal;
  /** Échéance calculée (TTL glissant), `null` si la date est illisible. */
  expiresAt: string | null;
}

/** Millisecondes d'une date ISO ; `Number.NaN` si elle est illisible. */
function ms(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Signature HMAC-SHA-256 hexadécimale d'un message, avec la clé de l'appelant. */
function hmac(message: string, key: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/** Une clé utilisable ? Vide ou blanche : non (rien n'est signé sans clé). */
function usableKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && key.trim().length >= 16;
}

/** Échéance d'une charge : `lastActivityAt + ttlMs`, ou `null` si illisible. */
export function expiresAt(claims: SessionClaims, ttlMs: number): string | null {
  const from = ms(claims.lastActivityAt);
  if (Number.isNaN(from) || !Number.isFinite(ttlMs) || ttlMs < 0) return null;
  return new Date(from + ttlMs).toISOString();
}

/** Millisecondes d'activité restantes ; négatif une fois l'échéance passée. */
export function remainingMs(claims: SessionClaims, now: string, ttlMs: number): number {
  const from = ms(claims.lastActivityAt);
  const at = ms(now);
  if (Number.isNaN(from) || Number.isNaN(at) || !Number.isFinite(ttlMs)) return Number.NaN;
  return from + ttlMs - at;
}

/**
 * Extinction par inactivité (#24). Échec fermé : une date illisible vaut
 * extinction, pour ne jamais laisser passer une marque invérifiable.
 */
export function isExpired(claims: SessionClaims, now: string, ttlMs = DEFAULT_SESSION_TTL_MS): boolean {
  const left = remainingMs(claims, now, ttlMs);
  return Number.isNaN(left) || left <= 0;
}

/**
 * Signe une charge : `v1.<charge base64url>.<signature hex>`. Rend `null` sans
 * clé utilisable — signer sans clé produirait une marque que chacun peut forger.
 */
export function signSessionToken(claims: SessionClaims, key: string): string | null {
  if (!usableKey(key)) return null;
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const head = `${SESSION_TOKEN_VERSION}.${payload}`;
  return `${head}.${hmac(head, key)}`;
}

/** Décode et valide une charge base64url ; `null` si elle est illisible. */
function decodeClaims(payload: string): SessionClaims | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const texts = ['sessionRef', 'accountId', 'issueId', 'taintedSince', 'lastActivityAt'];
  if (!texts.every((field) => typeof value[field] === 'string' && value[field].length > 0)) return null;
  if (Number.isNaN(ms(value.taintedSince as string))) return null;
  if (Number.isNaN(ms(value.lastActivityAt as string))) return null;
  const used = typeof value.publicRepliesUsed === 'number' ? value.publicRepliesUsed : 0;
  return {
    sessionRef: value.sessionRef as string,
    accountId: value.accountId as string,
    issueId: value.issueId as string,
    taintedSince: value.taintedSince as string,
    lastActivityAt: value.lastActivityAt as string,
    publicRepliesUsed: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
    quarantine: value.quarantine === true,
  };
}

/** Signature attendue ? Comparaison à temps constant, longueurs d'abord. */
function signatureMatches(head: string, presented: string, key: string): boolean {
  const expected = Buffer.from(hmac(head, key), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Vérifie un jeton présenté : format, version, signature, charge, puis TTL.
 * L'ordre compte — la signature est contrôlée **avant** la charge, pour ne
 * jamais interpréter un texte non signé.
 */
export function verifySessionToken(
  token: string | null | undefined,
  key: string,
  now: string,
  ttlMs = DEFAULT_SESSION_TTL_MS,
): SessionTokenCheck {
  const refused = (reason: SessionTokenRefusal): SessionTokenCheck =>
    ({ ok: false, claims: null, reason, expiresAt: null });
  if (!usableKey(key)) return refused('no-key');
  if (typeof token !== 'string') return refused('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) return refused('malformed');
  const [version, payload, signature] = parts;
  if (version !== SESSION_TOKEN_VERSION) return refused('unsupported-version');
  if (!signatureMatches(`${version}.${payload}`, signature, key)) return refused('bad-signature');
  const claims = decodeClaims(payload);
  if (!claims) return refused('malformed');
  if (isExpired(claims, now, ttlMs)) {
    return { ok: false, claims, reason: 'expired', expiresAt: expiresAt(claims, ttlMs) };
  }
  return { ok: true, claims, reason: 'ok', expiresAt: expiresAt(claims, ttlMs) };
}

/**
 * Renouvelle le jeton après un geste : `lastActivityAt` repart de `now`, le TTL
 * glissant (#24) suit. Les compteurs sont conservés — renouveler n'efface ni le
 * budget (#26) ni la quarantaine (#27).
 */
export function renewSessionToken(
  claims: SessionClaims,
  key: string,
  now: string,
): string | null {
  return signSessionToken({ ...claims, lastActivityAt: now }, key);
}
