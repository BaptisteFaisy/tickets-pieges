/**
 * Empremintes et identifiants — helpers partagés (aucune logique métier).
 *
 * Trois usages dans le produit :
 *  - `contentHash` : empreinte d'un segment (§19) et d'une charge (§14 campagnes) ;
 *  - `randomBlockId` : identifiant de balise d'encadrement, changé à chaque
 *    réponse (§8.2) — un attaquant ne peut pas refermer une balise qu'il ignore ;
 *  - `shingles` : empreintes de passages pour repérer une recopie (§12, lot S).
 *
 * `node:crypto` est disponible dans le runtime Forge (nodejs22.x) et en test.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Empreinte SHA-256 hexadécimale d'un texte. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Empreinte d'un segment : le texte normalisé (espaces et casse), pour qu'une
 * recopie à la virgule près soit reconnue sans être sensible à la mise en forme.
 */
export function contentHash(text: string): string {
  return sha256(normalize(text));
}

/** Normalisation minimale : Unicode NFKC, espaces pliés, casse ignorée. */
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Identifiant aléatoire court de balise d'encadrement (§8.2). */
export function randomBlockId(bytes = 3): string {
  return randomBytes(bytes).toString('hex');
}

/** Identifiant aléatoire de jeton d'exercice (§13) — lisible, sans ambiguïté. */
export function randomToken(bytes = 4): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Empreintes glissantes d'un texte (§12 : recopie d'un texte externe).
 *
 * Les mots sont normalisés, groupés par `size` consécutifs, et chaque groupe
 * est haché : deux textes qui partagent assez de groupes se ressemblent, même
 * recopiés avec d'autres mots autour. Aucun vecteur de similarité n'est fourni
 * par la plateforme (§20) : c'est volontairement déterministe.
 */
export function shingles(text: string, size = 5): string[] {
  const words = normalize(text).split(' ').filter((word) => word.length > 0);
  if (words.length < size) {
    return words.length > 0 ? [sha256(words.join(' ')).slice(0, 16)] : [];
  }
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) {
    out.push(sha256(words.slice(i, i + size).join(' ')).slice(0, 16));
  }
  return out;
}

/** Part de groupes communs entre deux jeux d'empreintes, de 0 à 1. */
export function shingleOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((item) => setB.has(item)).length;
  return shared / Math.max(a.length, b.length);
}
