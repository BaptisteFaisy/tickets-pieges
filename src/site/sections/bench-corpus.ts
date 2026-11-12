/**
 * Adaptateur local du corpus pour la section « Banc de détection ».
 *
 * `src/bench/corpus.ts` est un domaine pur qui ne fait **aucune E/S** : il
 * décrit, valide et manipule le corpus, mais ne le charge pas. Il manque donc
 * un chargeur côté navigateur — cet adaptateur joue ce rôle, exactement comme
 * `src/sample/dataset.ts` le fait pour le jeu d'essai : les fichiers
 * `data/corpus/*.json` sont importés **statiquement** (`resolveJsonModule`),
 * aucune entrée-sortie au runtime, puis fusionnés avec `mergeCorpus` du
 * domaine. Aucune logique métier n'est recopiée ici.
 */

import attacksEn from '../../../data/corpus/attacks-en.json';
import attacksFr from '../../../data/corpus/attacks-fr.json';
import legitimateEn from '../../../data/corpus/legitimate-en.json';
import legitimateFr from '../../../data/corpus/legitimate-fr.json';
import scenarioCato from '../../../data/corpus/scenario-cato-2025.json';
import {
  byLanguage,
  corpusStats,
  groupByFamily,
  mergeCorpus,
  sampleCorpus,
  type CorpusEntry,
  type CorpusFile,
} from '../../bench/corpus';
import type { HumanVerdict } from '../../bench/shadow';

const FILES = [attacksFr, attacksEn, legitimateFr, legitimateEn, scenarioCato] as unknown as CorpusFile[];

const CORPUS: CorpusEntry[] = mergeCorpus(FILES);

/** Plafond d'entrées jouées dans la page : le banc reste rapide (brief). */
export const PLAYED_CAP = 60;

/** Graine fixe du tirage : mêmes entrées jouées à chaque run (reproductible). */
export const PLAYED_SEED = 1;

/** Tout le corpus fusionné, trié par identifiant (reproductible). */
export function fullCorpus(): readonly CorpusEntry[] {
  return CORPUS;
}

/** Familles présentes dans le corpus, triées (`none` = textes légitimes). */
export function familyKeys(): string[] {
  return Object.keys(corpusStats(CORPUS).byFamily);
}

/** Entrées filtrées par langue et famille ; `'all'` ne filtre pas. */
export function filterEntries(lang: string, family: string): CorpusEntry[] {
  let entries: readonly CorpusEntry[] = CORPUS;
  if (lang === 'fr' || lang === 'en') entries = byLanguage(entries, lang);
  if (family !== 'all') entries = groupByFamily(entries)[family] ?? [];
  return entries.slice();
}

/** Ce que le banc joue dans la page : le filtre, borné à `PLAYED_CAP` entrées. */
export function playedEntries(lang: string, family: string): CorpusEntry[] {
  return sampleCorpus(filterEntries(lang, family), PLAYED_CAP, PLAYED_SEED);
}

/**
 * Référence humaine hors ligne : les étiquettes du corpus, **dites comme
 * telles** (même convention que `tools/bench.mjs`) — aucun verdict humain
 * réel n'existe dans le navigateur, et la vue le déclare (§21).
 */
export function humanReference(entries: readonly CorpusEntry[]): Record<string, HumanVerdict> {
  const verdicts: Record<string, HumanVerdict> = {};
  for (const entry of entries) {
    verdicts[entry.id] = entry.label === 'attack' ? 'trapped' : 'false-positive';
  }
  return verdicts;
}
