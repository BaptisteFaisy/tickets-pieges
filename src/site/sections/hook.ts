/**
 * Section « Hook et clients d'agents » (§11) — assemblage des blocs :
 *  - `hook-config.ts` : le fichier de hooks généré pour les cinq clients,
 *    réglable et copiable (aucun réseau) ;
 *  - `hook-flows.ts` : les réponses réelles PostToolUse et PreToolUse sur des
 *    appels d'outils MCP simulés.
 *
 * Une seule exportation de section (`hookSection`) ; le découpage en fichiers
 * `hook-*.ts` suit la règle des 500 lignes du dépôt. Aucune logique métier
 * recopiée : chaque bloc appelle les modules de `src/hook/*` et affiche.
 */

import type { Section, SectionContext } from './types';
import { mountConfig, renderConfig } from './hook-config';
import { mountFlows, renderInbound, renderOutbound } from './hook-flows';

function render(ctx: SectionContext): string {
  return renderConfig(ctx) + renderInbound(ctx) + renderOutbound(ctx);
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  mountConfig(root, ctx);
  mountFlows(root, ctx);
}

export const hookSection: Section = {
  id: 'hook',
  titles: { fr: 'Hook et clients d’agents', en: 'Hook & agent clients' },
  render,
  mount,
};
