/**
 * Chiffrement au repos des éléments sensibles conservés (originaux neutralisés
 * §8.3, jetons de hook §11).
 *
 * AES-256-GCM via `node:crypto`. La clé est fournie par l'appelant à chaque
 * appel — elle n'est **jamais** écrite en dur, ni dérivée d'une constante, ni
 * stockée avec le chiffré. Le format est versionné : une version ultérieure du
 * format devra continuer à lire les enveloppes `v1` (règle « lire l'ancien »).
 *
 * Ce fichier vit dans `src/platform/` : c'est de l'entrée-sortie (aléa,
 * empreinte), pas du domaine pur.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Version du format d'enveloppe. À incrémenter seulement avec un chemin de lecture ancien. */
export const CRYPTO_FORMAT_VERSION = 1;

const PREFIX = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SEPARATOR = '.';

/** Dérive les 32 octets de clé AES-256 à partir du secret de l'exploitant. */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Enveloppe `v1.iv.tag.chiffre` — les trois blocs en base64url, séparés par des points. */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blocks = [iv, tag, body].map((block) => block.toString('base64url'));
  return [PREFIX, ...blocks].join(SEPARATOR);
}

/** Lit et déchiffre une enveloppe. Rejette une version inconnue et un tag invalide. */
export function decryptSecret(envelope: string, secret: string): string {
  const parts = envelope.split(SEPARATOR);
  if (parts.length !== 4) {
    throw new Error('enveloppe de chiffrement mal formée');
  }
  const version = parts[0]!;
  if (version !== PREFIX) {
    throw new Error('format de chiffrement non reconnu : ' + version);
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const body = Buffer.from(parts[3]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Version de l'enveloppe (pour savoir si le lecteur actuel sait la déchiffrer). */
export function secretVersion(envelope: string): string | null {
  const version = envelope.split(SEPARATOR)[0];
  if (version == null) return null;
  return version.startsWith('v') ? version : null;
}

/** Vrai si la chaîne ressemble déjà à une enveloppe (évite un double chiffrement). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX + SEPARATOR);
}