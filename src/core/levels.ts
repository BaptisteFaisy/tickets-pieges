/**
 * Comparaisons de niveaux — les seules règles d'ordre du produit.
 *
 * Séparées de `types.ts` pour que le contrat reste lisible : ces fonctions sont
 * utilisées par l'origine (§5), l'hérédité (§12), les modes (§8.1) et la file des
 * suspects (§17.2).
 */

import { SUSPICION_RANK, TRUST_LEVELS, type SuspicionLevel, type TrustLevel } from './types';

/** Le niveau de confiance le plus bas gagne (§12 : hérédité). */
export function lowerTrust(a: TrustLevel, b: TrustLevel): TrustLevel {
  return TRUST_LEVELS.indexOf(a) <= TRUST_LEVELS.indexOf(b) ? a : b;
}

/** Le niveau de confiance le plus haut d'une liste (vide → T0). */
export function lowestOf(levels: TrustLevel[]): TrustLevel {
  return levels.reduce<TrustLevel>((lowest, level) => lowerTrust(lowest, level), 'T3');
}

/** Un texte est externe s'il n'est pas prouvé interne (§5 : externe par défaut). */
export function isExternal(trust: TrustLevel): boolean {
  return trust === 'T0' || trust === 'T1';
}

/** Le niveau de suspicion le plus élevé gagne. */
export function higherSuspicion(a: SuspicionLevel, b: SuspicionLevel): SuspicionLevel {
  return SUSPICION_RANK[a] >= SUSPICION_RANK[b] ? a : b;
}

/** true si `level` atteint ou dépasse `threshold` (réglage « à partir de »). */
export function atLeast(level: SuspicionLevel, threshold: SuspicionLevel): boolean {
  return SUSPICION_RANK[level] >= SUSPICION_RANK[threshold];
}

/** Tri d'une file : la suspicion la plus haute d'abord, puis la clé (§17.2). */
export function bySuspicionDesc<T extends { suspicionLevel: SuspicionLevel; issueKey: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const diff = SUSPICION_RANK[b.suspicionLevel] - SUSPICION_RANK[a.suspicionLevel];
    return diff !== 0 ? diff : a.issueKey.localeCompare(b.issueKey);
  });
}
