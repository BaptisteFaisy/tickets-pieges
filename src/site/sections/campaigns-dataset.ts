/**
 * Adaptateurs du jeu d'essai pour la section « Campagnes et hérédité ».
 *
 * Aucune logique métier : ces fonctions mettent en forme les demandes de
 * `src/sample/dataset.ts` pour les blocs de démonstration (lignes à coller,
 * textes de recopie, options de liste). Le calcul reste au domaine.
 */

import { byId, byLanguage, loadDataset, type SampleRequestEntry } from '../../sample/dataset';
import type { Language } from '../../core/types';

/** Texte ramené sur une ligne : le regroupement ignore la mise en forme. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Première demande externe du jeu (client ou anonyme) dans une langue. */
export function firstExternal(lang: Language): SampleRequestEntry | undefined {
  return byLanguage(lang)
    .find((entry) => entry.accountType === 'customer' || entry.accountType === 'unknown');
}

/** Une entrée du jeu par identifiant, avec repli sur la première externe. */
export function sampleById(id: string, lang: Language): SampleRequestEntry | undefined {
  return byId(id) ?? firstExternal(lang);
}

/** Toutes les demandes en options `[valeur, libellé]` pour une liste déroulante. */
export function sampleOptions(): [string, string][] {
  return loadDataset().map((entry) => [entry.id, `${entry.id} — ${oneLine(entry.summary).slice(0, 40)}`]);
}

/**
 * Lignes « campagnes » tirées du jeu : la demande n°2 en trois exemplaires
 * (une campagne, trois tickets) et les demandes n°1 et n°3 en simple.
 */
export function datasetLines(lang: Language): string {
  const entries = byLanguage(lang);
  const at = (index: number): string => (entries[index] ? oneLine(entries[index]!.description) : '');
  return [at(1), at(0), at(1), at(2), at(1)].filter((line) => line.length > 0).join('\n');
}

/** Textes « recopie » tirés du jeu : un texte externe et sa copie interne. */
export function datasetCopyTexts(lang: Language): { known: string; candidate: string } {
  const external = firstExternal(lang);
  const known = external ? external.description : '';
  const wrap = lang === 'fr'
    ? { before: 'Courriel du client :', after: 'À traiter.' }
    : { before: 'Client email:', after: 'Handle with care.' };
  return { known, candidate: `${wrap.before}\n\n${known}\n\n${wrap.after}` };
}
