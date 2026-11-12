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
import { mergeCorpus, type CorpusEntry, type CorpusFile } from '../../bench/corpus';

const FILES = [attacksFr, attacksEn, legitimateFr, legitimateEn, scenarioCato] as unknown as CorpusFile[];

const CORPUS: CorpusEntry[] = mergeCorpus(FILES);

/** Tout le corpus fusionné, trié par identifiant (reproductible). */
export function fullCorpus(): readonly CorpusEntry[] {
  return CORPUS;
}
