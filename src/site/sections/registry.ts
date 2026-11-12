/**
 * Registre des sections du site.
 *
 * Une section = un fichier de `src/site/sections/`, propriétaire exclusif, testé
 * dans `src/site/sections/*.test.ts`. C'est **le seul fichier** que l'intégration
 * touche : ajouter une feature au site, c'est écrire sa section puis ajouter une
 * ligne ici.
 *
 * Ordre d'affichage, calé sur le cahier des charges : ce qui **entre** (détection,
 * ce que le texte cache), les trois **verrous** dans l'ordre (entrée, portée,
 * sortie), les **surfaces** d'agent (outils MCP, hook et clients), puis ce qui
 * suit le texte (campagnes, hérédité), la **mesure** (exercice, exposition,
 * précision, banc, terrain).
 */

import type { Section } from './types';
import { detectorSection } from './detector';
import { contentSection } from './content';
import { sessionsSection } from './sessions';
import { outboundSection } from './outbound';
import { mcpSection } from './mcp';
import { hookSection } from './hook';
import { campaignsSection } from './campaigns';
import { canarySection } from './canary';
import { exposureSection } from './exposure';
import { tuningSection } from './tuning';
import { benchSection } from './bench';
import { timingSection } from './timing';

export const SECTIONS: Section[] = [
  detectorSection,
  contentSection,
  sessionsSection,
  outboundSection,
  mcpSection,
  hookSection,
  campaignsSection,
  canarySection,
  exposureSection,
  tuningSection,
  benchSection,
  timingSection,
];
