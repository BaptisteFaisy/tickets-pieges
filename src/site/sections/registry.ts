/**
 * Registre des sections du site.
 *
 * Une section = un fichier de `src/site/sections/`, propriétaire exclusif, testé
 * dans `src/site/sections/*.test.ts`. C'est **le seul fichier** que l'intégration
 * touche : ajouter une feature au site, c'est écrire sa section puis ajouter une
 * ligne ici.
 *
 * Ordre d'affichage : la détection d'abord (ce qui entre), puis ce que le texte
 * cache, puis les trois verrous dans l'ordre du cahier (entrée → portée → sortie),
 * puis la mesure (exercice, exposition) et le réglage.
 */

import type { Section } from './types';
import { detectorSection } from './detector';
import { contentSection } from './content';
import { campaignsSection } from './campaigns';
import { outboundSection } from './outbound';
import { canarySection } from './canary';
import { exposureSection } from './exposure';
import { tuningSection } from './tuning';

export const SECTIONS: Section[] = [
  detectorSection,
  contentSection,
  campaignsSection,
  outboundSection,
  canarySection,
  exposureSection,
  tuningSection,
];
