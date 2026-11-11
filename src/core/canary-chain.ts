/**
 * Journal à hash chaîné (#50) — une chaîne vérifiable pour l'auditeur.
 *
 * Chaque entrée porte l'empreinte de la précédente : retirer une entrée,
 * altérer un champ ou réordonner casse aussitôt la chaîne, ce qu'un auditeur
 * détecte en recomposant les hash de bout en bout. Daté par paramètre (jamais
 * d'horloge en domaine pur) ; le contenu (`payload`) reste une chaîne opaque :
 * c'est l'auditeur qui décide ce qu'il y met.
 */

import { sha256 } from './hashing';

/** Une entrée du journal chaîné. */
export interface ChainEntry {
  seq: number;
  /** hash de l'entrée précédente ; chaîne vide pour la première. */
  prevHash: string;
  payload: string;
  at: string;
  hash: string;
}

/** Ce que l'on confie au journal : un contenu opaque et sa date. */
export interface ChainItem {
  payload: string;
  at: string;
}

/** Empreinte d'une entrée : la concaténation stable de ses champs. */
export function entryHash(seq: number, prevHash: string, payload: string, at: string): string {
  return sha256([seq, prevHash, payload, at].join('\n'));
}

/** Ajoute une entrée chaînée après `prev` (ou la première si `prev` est nul). */
export function appendEntry(prev: ChainEntry | null, payload: string, at: string): ChainEntry {
  const seq = prev === null ? 1 : prev.seq + 1;
  const prevHash = prev === null ? '' : prev.hash;
  return { seq, prevHash, payload, at, hash: entryHash(seq, prevHash, payload, at) };
}

/** Construit une chaîne complète depuis une liste de contenus et de dates. */
export function buildChain(items: readonly ChainItem[]): ChainEntry[] {
  const chain: ChainEntry[] = [];
  let prev: ChainEntry | null = null;
  for (const item of items) {
    prev = appendEntry(prev, item.payload, item.at);
    chain.push(prev);
  }
  return chain;
}

/** Vérifie la chaîne entière : séquence, liaison et empreintes. */
export function verifyChain(chain: readonly ChainEntry[]): boolean {
  let prevHash = '';
  let seq = 0;
  for (const entry of chain) {
    seq += 1;
    if (entry.seq !== seq) return false;
    if (entry.prevHash !== prevHash) return false;
    if (entry.hash !== entryHash(entry.seq, entry.prevHash, entry.payload, entry.at)) return false;
    prevHash = entry.hash;
  }
  return true;
}