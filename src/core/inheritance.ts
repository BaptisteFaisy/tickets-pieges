/**
 * Hérédité (§12, §22, lot S) — l'origine suit le texte.
 *
 * Un bug créé à partir d'une demande (ticket cloné ou lié) hérite du niveau de
 * confiance **le plus bas** de la source et de ses constats : le développeur
 * qui reprend le clone voit la même protection que le support, avec une note
 * lisible (« description issue d'une demande externe »). Un ticket déplacé
 * dans un autre projet garde aussi origine et constats (§22).
 *
 * Le domaine rend les décisions et ne stocke rien : c'est la couche plateforme
 * qui persiste l'état et les constats recopiés.
 *
 * Domaine pur : aucune E/S, aucune heure lue, aucun import `@forge/*`.
 *
 * Note texts live here (fr/en) because the visible-text catalogs are owned by
 * other lots and closed to this one; the PR flags them for the trunk catalog.
 */

import type { Finding, InheritanceInput, InheritanceResult, Language, TrustLevel } from './types';
import { lowestOf } from './levels';

/** Note destinée au développeur, par langue (§12 : « description issue… »). */
const INHERITED_NOTE: Record<Language, string> = {
  fr: 'description issue d’une demande externe ({source}, {relation}) — '
    + 'niveau de confiance et constats hérités',
  en: 'description from an external request ({source}, {relation}) — '
    + 'trust level and findings inherited',
};

/** Libellé de relation, par langue. */
const RELATION_LABEL: Record<Language, Record<InheritanceInput['relation'], string>> = {
  fr: { clone: 'clone', link: 'ticket lié' },
  en: { clone: 'clone', link: 'linked ticket' },
};

/** Note de déplacement (§22) : l'origine et les constats suivent le ticket. */
const MOVED_NOTE: Record<Language, string> = {
  fr: 'ticket déplacé — origine et constats conservés',
  en: 'issue moved — origin and findings preserved',
};

/** Ce qui entre dans un déplacement de ticket (§22). */
export interface MoveInput {
  issueKey: string;
  fromProjectKey: string;
  toProjectKey: string;
  trustLevel: TrustLevel;
  findings: Finding[];
}

/** Résultat étendu d'un déplacement : le niveau et les constats suivent. */
export interface MoveResult extends InheritanceResult {
  fromProjectKey: string;
  toProjectKey: string;
}

/**
 * Héritage d'un ticket lié ou cloné (§12) : le niveau de confiance le plus bas
 * gagne (`lowestOf` de `levels.ts`, la seule règle d'ordre du produit) et tous
 * les constats de la source sont recopiés tels quels — l'origine suit le texte,
 * pas le ticket.
 */
export function inherit(
  input: InheritanceInput,
  language: Language = 'fr',
): InheritanceResult {
  const note = INHERITED_NOTE[language]
    .replace('{source}', input.sourceIssueKey)
    .replace('{relation}', RELATION_LABEL[language][input.relation]);
  return {
    targetIssueKey: input.targetIssueKey,
    trustLevel: lowestOf([input.sourceTrustLevel, 'T3']),
    carriedFindings: input.findings.length,
    note,
  };
}

/**
 * Constats à recopier vers la cible : tous les constats de la source, avec
 * leur identifiant d'origine conservé dans `excerpt` inchangé — seul le ticket
 * change. La liste est triée par date puis identifiant pour un rendu stable.
 */
export function carryFindings(findings: Finding[], targetIssueId: string): Finding[] {
  return [...findings]
    .sort((a, b) => (a.createdAt !== b.createdAt
      ? a.createdAt.localeCompare(b.createdAt)
      : a.id.localeCompare(b.id)))
    .map((finding) => ({ ...finding, issueId: targetIssueId }));
}

/**
 * Ticket déplacé dans un autre projet (§22) : origine et constats le suivent.
 * Le niveau de confiance ne remonte jamais — un déplacement n'est pas une
 * réécriture de l'origine.
 */
export function inheritOnMove(input: MoveInput, language: Language = 'fr'): MoveResult {
  return {
    targetIssueKey: input.issueKey,
    trustLevel: lowestOf([input.trustLevel, 'T3']),
    carriedFindings: input.findings.length,
    note: MOVED_NOTE[language],
    fromProjectKey: input.fromProjectKey,
    toProjectKey: input.toProjectKey,
  };
}
