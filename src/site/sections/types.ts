/**
 * Contrat des sections du site de démonstration.
 *
 * Le site n'a **aucune logique propre** : chaque section appelle le domaine
 * fusionné (`src/core/`, `src/bench/`, `src/hook/`, `src/replay/`) et affiche son
 * résultat. Une section = un fichier = un propriétaire, ce qui permet d'ajouter
 * une feature sans toucher aux autres.
 *
 * Deux règles non négociables :
 *  - **tout texte dynamique est échappé** (`esc` de `src/site/dom.ts`) : une page
 *    qui parle d'injection ne doit pas être injectable ;
 *  - **aucun appel réseau, aucun import `@forge/*`** : la page calcule localement
 *    (§21 du cahier — rien ne sort).
 */

import type { Language } from '../../core/types';
import type { MemoryStore } from '../../platform/memory';

/** Ce que l'ossature fournit à chaque section. */
export interface SectionContext {
  /** Langue courante de la page : `'fr'` ou `'en'`. */
  lang: Language;
  /** Traduction d'une clé du produit (`src/core/i18n.ts`). */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Stockage en mémoire partagé par la session du visiteur (jamais persisté). */
  store: MemoryStore;
  /** Instant fixe : le site ne lit jamais l'heure du système dans le domaine. */
  now: string;
  /** Signale un message court au visiteur (toast de l'ossature). */
  notify: (message: string) => void;
}

/** Une section du site : un titre, un rendu, un câblage facultatif. */
export interface Section {
  /** Identifiant stable, utilisé pour l'ancre et la navigation. */
  id: string;
  /** Titre de l'onglet, dans les deux langues. */
  titles: Record<Language, string>;
  /**
   * HTML de la section. Peut être asynchrone (le domaine l'est parfois).
   * Tout texte venant d'une donnée doit passer par `esc`.
   */
  render(ctx: SectionContext): string | Promise<string>;
  /**
   * Câblage des interactions, appelé **après** insertion du HTML. Facultatif :
   * une section purement informative n'en a pas besoin.
   */
  mount?(root: HTMLElement, ctx: SectionContext): void;
}

/** Ce que rend une section informative : aucune interaction. */
export function staticSection(
  id: string,
  titles: Record<Language, string>,
  render: (ctx: SectionContext) => string | Promise<string>,
): Section {
  return { id, titles, render };
}
