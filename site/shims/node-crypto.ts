/**
 * Empreintes et identifiants pour le **navigateur** (site de démonstration).
 *
 * `src/core/hashing.ts` utilise `node:crypto`, qui n'existe pas dans un
 * navigateur. Ce module fournit exactement les deux gestes dont le domaine a
 * besoin — `createHash('sha256').update(text, 'utf8').digest('hex')` et
 * `randomBytes(n).toString('hex')` — en TypeScript pur, et esbuild l'injecte à la
 * place de `node:crypto` quand il construit le site (`tools/build-site.mjs`).
 *
 * Non-régression : `src/site/crypto-shim.test.ts` vérifie que les empreintes sont
 * **identiques** à celles de `node:crypto`. Une empreinte qui diffère casserait
 * les campagnes (§14) et la stabilité des identifiants de constat (§6).
 */

/** Constantes SHA-256 (FIPS 180-4). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Message complété selon FIPS 180-4 : bit 1, zéros, longueur sur 64 bits. */
function pad(data: Uint8Array): Uint8Array {
  const withOne = data.length + 1;
  const blocks = Math.ceil((withOne + 8) / 64);
  const out = new Uint8Array(blocks * 64);
  out.set(data);
  out[data.length] = 0x80;
  const bits = BigInt(data.length) * 8n;
  const view = new DataView(out.buffer);
  view.setBigUint64(out.length - 8, bits);
  return out;
}

/** Un tour de compression sur un bloc de 64 octets. */
function compress(state: Uint32Array, block: Uint8Array, offset: number): void {
  const w = new Uint32Array(64);
  const view = new DataView(block.buffer, block.byteOffset + offset, 64);
  for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(i * 4);
  for (let i = 16; i < 64; i += 1) {
    const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
    const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = 0; i < 64; i += 1) {
    const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
    const ch = (e! & f!) ^ (~e! & g!);
    const temp1 = (h! + S1 + ch + K[i]! + w[i]!) >>> 0;
    const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
    const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
    const temp2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e;
    e = (d! + temp1) >>> 0;
    d = c; c = b; b = a;
    a = (temp1 + temp2) >>> 0;
  }
  const next = [a, b, c, d, e, f, g, h];
  for (let i = 0; i < 8; i += 1) state[i] = (state[i]! + next[i]!) >>> 0;
}

/** Empreinte SHA-256 d'un tableau d'octets, en hexadécimal. */
export function sha256Hex(data: Uint8Array): string {
  const padded = pad(data);
  const state = Uint32Array.from(H0);
  for (let offset = 0; offset < padded.length; offset += 64) compress(state, padded, offset);
  return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** Chaînes en octets UTF-8 (comme `update(text, 'utf8')` de Node). */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Octets aléatoires du navigateur, avec le `toString('hex')` attendu. */
export interface RandomBytes extends Uint8Array {
  toString(encoding?: string): string;
}

export function randomBytes(length: number): RandomBytes {
  const bytes = new Uint8Array(length);
  const web = (globalThis as { crypto?: Crypto }).crypto;
  if (web?.getRandomValues) web.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const wrapper = bytes as RandomBytes;
  wrapper.toString = (encoding?: string) =>
    encoding === 'hex' || encoding === undefined
      ? [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      : new TextDecoder().decode(bytes);
  return wrapper;
}

/** Compatible avec l'appel du domaine : `createHash('sha256').update(t,'utf8').digest('hex')`. */
export function createHash(algorithm: string): {
  update(text: string, encoding?: string): { digest(format: string): string };
} {
  if (algorithm !== 'sha256') throw new Error(`algorithme non pris en charge : ${algorithm}`);
  return {
    update(text: string) {
      const hex = sha256Hex(utf8(text));
      return {
        digest(format: string) {
          if (format !== 'hex') throw new Error(`format non pris en charge : ${format}`);
          return hex;
        },
      };
    },
  };
}
