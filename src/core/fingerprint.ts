/**
 * Empremintes de passages et détection d'une recopie (§12, lot S).
 *
 * Un texte externe (T0/T1) collé ailleurs par un compte interne reste externe :
 * l'origine suit le texte. Comme la plateforme ne fournit aucun vecteur de
 * similarité (§20), la détection est déterministe : empreintes glissantes de
 * `hashing.ts` (`shingles`) et recouvrement (`shingleOverlap`).
 *
 * Seuil retenu : 0,6 de groupes communs (partagés / plus grand des deux jeux).
 * Justification — les groupes font 5 mots normalisés consécutifs :
 *  - une recopie brute donne 1,0 ; une recopie entourée de quelques mots
 *    (« Bonjour, voici le courriel du client : … ») reste bien au-dessus de 0,6
 *    tant que la charge domine le texte ;
 *  - un texte proche mais réécrit (même sujet, autres phrases) ne partage
 *    presque aucun groupe de 5 mots et tombe sous 0,2.
 * Le seuil sépare donc nettement les deux populations ; il est exporté et
 * paramétrable pour que la revue humaine (§14) puisse le durcir ou l'assouplir.
 *
 * Domaine pur : aucune E/S, aucune heure lue, aucun import `@forge/*`.
 */

import type { TextFingerprint } from './types';
import { contentHash, shingles, shingleOverlap } from './hashing';

/** Taille des groupes de mots des empreintes glissantes (§12). */
export const SHINGLE_SIZE = 5;

/**
 * Recouvrement minimal pour conclure à une recopie. À 0,6 : pas de faux
 * positif sur un texte simplement voisin (mesuré < 0,2), recopie entourée
 * toujours détectée (voir justification en tête de fichier).
 */
export const COPY_OVERLAP_THRESHOLD = 0.6;

/** Un passage déjà connu, dont l'empreinte a été relevée ailleurs. */
export interface KnownSegment {
  /** Identifiant stable du segment connu (celui des constats, §6). */
  id: string;
  issueKey?: string;
  fingerprint: TextFingerprint;
}

/** Une recopie repérée : quel passage connu, avec quel recouvrement. */
export interface CopyMatch {
  segmentId: string;
  issueKey?: string;
  overlap: number;
}

/** Empreinte d'un texte : hachage du contenu normalisé + groupes glissants. */
export function fingerprint(text: string): TextFingerprint {
  return { hash: contentHash(text), shingles: shingles(text, SHINGLE_SIZE) };
}

/** Recouvrement de deux empreintes, de 0 à 1 (via `shingleOverlap`). */
export function overlapOf(a: TextFingerprint, b: TextFingerprint): number {
  return shingleOverlap(a.shingles, b.shingles);
}

/**
 * Deux empreintes désignent-elles le même texte ? Égalité exacte (hachage du
 * texte normalisé) ou recouvrement au moins égal au seuil.
 */
export function isCopy(
  a: TextFingerprint,
  b: TextFingerprint,
  threshold: number = COPY_OVERLAP_THRESHOLD,
): boolean {
  if (a.hash === b.hash) return true;
  return overlapOf(a, b) >= threshold;
}

/**
 * Repère un texte externe collé ailleurs : tous les passages connus dont
 * l'empreinte recouvre celle du candidat au moins au seuil, du plus proche au
 * moins proche. Un candidat vide (aucun groupe) ne correspond à rien.
 */
export function findCopies(
  candidate: TextFingerprint,
  knownSegments: KnownSegment[],
  threshold: number = COPY_OVERLAP_THRESHOLD,
): CopyMatch[] {
  if (candidate.shingles.length === 0) return [];
  const matches: CopyMatch[] = [];
  for (const known of knownSegments) {
    if (!isCopy(candidate, known.fingerprint, threshold)) continue;
    matches.push({
      segmentId: known.id,
      issueKey: known.issueKey,
      overlap: overlapOf(candidate, known.fingerprint),
    });
  }
  return matches.sort((a, b) => {
    const diff = b.overlap - a.overlap;
    return diff !== 0 ? diff : a.segmentId.localeCompare(b.segmentId);
  });
}
