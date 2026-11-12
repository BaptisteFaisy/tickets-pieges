/**
 * `Buffer` minimal pour le navigateur — injecté par esbuild (`tools/build-site.mjs`).
 *
 * Pourquoi : `src/core/session-token.ts` (jeton de session signé, #23) encode sa
 * charge en `base64url` avec `Buffer`, qui n'existe pas dans une page. Plutôt que
 * de modifier le domaine — dont les tests et le runtime Forge dépendent — on
 * fournit un équivalent exact pour les quatre encodages réellement utilisés :
 * `utf8`, `hex`, `base64`, `base64url`.
 *
 * Non-régression : `src/site/crypto-shim.test.ts` compare les allers-retours et
 * les empreintes à ceux du vrai `Buffer` de Node.
 */

const LOOKS_BASE64 = /^[A-Za-z0-9+/=_-]+$/;

/** Décode base64 / base64url en octets. */
function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const binary = atob(normalized.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode des octets en base64url (sans rembourrage), comme Node. */
function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode des octets en base64 standard. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Décode une chaîne hexadécimale en octets. */
function fromHex(value: string): Uint8Array {
  const clean = value.replace(/^0x/i, '');
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Encode des octets en hexadécimal. */
function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type BufferEncoding = 'utf8' | 'utf-8' | 'hex' | 'base64' | 'base64url' | 'binary' | 'ascii';

function decodeToBytes(value: string, encoding: BufferEncoding): Uint8Array {
  switch (encoding) {
    case 'hex':
      return fromHex(value);
    case 'base64':
    case 'base64url':
      return fromBase64(value);
    case 'binary':
    case 'ascii': {
      const bytes = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
      return bytes;
    }
    default:
      return new TextEncoder().encode(value);
  }
}

function encodeBytes(bytes: Uint8Array, encoding: BufferEncoding): string {
  switch (encoding) {
    case 'hex':
      return toHex(bytes);
    case 'base64':
      return toBase64(bytes);
    case 'base64url':
      return toBase64Url(bytes);
    case 'binary':
    case 'ascii': {
      let out = '';
      for (const byte of bytes) out += String.fromCharCode(byte);
      return out;
    }
    default:
      return new TextDecoder().decode(bytes);
  }
}

/**
 * Sous-classe de `Uint8Array` : les appelants qui attendent un tableau d'octets
 * (longueur, accès indexé, `timingSafeEqual`) y retrouvent leurs marques.
 */
export class SiteBuffer extends Uint8Array {
  /**
   * Signature volontairement large : `Buffer.from` de Node accepte une chaîne
   * (avec encodage), un tableau d'octets ou un autre buffer. Les types exacts de
   * `Uint8Array.from` imposeraient des surcharges incompatibles avec l'encodage.
   */
  static override from(value: unknown, encoding?: unknown): SiteBuffer {
    const enc = (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding;
    if (typeof value === 'string') {
      const needsDecoding = enc !== 'utf8' && enc !== 'utf-8' && LOOKS_BASE64.test(value);
      return new SiteBuffer(needsDecoding ? decodeToBytes(value, enc) : decodeToBytes(value, 'utf8'));
    }
    if (value instanceof Uint8Array) return new SiteBuffer(value);
    if (Array.isArray(value)) return new SiteBuffer(Uint8Array.from(value as number[]));
    throw new TypeError('Buffer.from : entrée non prise en charge');
  }

  static alloc(size: number): SiteBuffer {
    return new SiteBuffer(new Uint8Array(Math.max(0, size)));
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof Uint8Array;
  }

  override toString(encoding?: unknown): string {
    const enc = (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding;
    return encodeBytes(this, enc);
  }
}

/** Nom injecté par esbuild : le domaine écrit `Buffer`, la page fournit celui-ci. */
export const Buffer = SiteBuffer;
