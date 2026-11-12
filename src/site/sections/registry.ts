/**
 * Registre des sections du site.
 *
 * Une section = un fichier de `src/site/sections/`, propriétaire exclusif, testé
 * dans `src/site/sections/*.test.ts`. C'est **le seul fichier** que l'intégration
 * touche : ajouter une feature au site, c'est écrire sa section puis ajouter une
 * ligne ici.
 */

import type { Section } from './types';
import { detectorSection } from './detector';

/** Ordre d'affichage : la détection d'abord, puis les verrous, puis la mesure. */
export const SECTIONS: Section[] = [
  detectorSection,
];
