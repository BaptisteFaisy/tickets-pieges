/**
 * Section « Hook et clients d'agents » (§11) — assemblage des blocs :
 *  - `hook-config.ts` : le fichier de hooks généré pour les cinq clients,
 *    réglable et copiable (aucun réseau) ;
 *  - `hook-flows.ts` : les réponses réelles PostToolUse et PreToolUse sur des
 *    appels d'outils MCP simulés ;
 *  - `hook-token.ts` : le cycle de vie du jeton (empreinte, vérifications,
 *    rotation, 401 identique) ;
 *  - `hook-policy.ts` : la politique en lecture seule rendue à un agent
 *    externe par l'action MCP `get-policy` (#29) ;
 *  - les deux limites du §11, rappelées en fin de section (§21 : pas de
 *    fausse assurance).
 *
 * Une seule exportation de section (`hookSection`) ; le découpage en fichiers
 * `hook-*.ts` suit la règle des 500 lignes du dépôt. Aucune logique métier
 * recopiée : chaque bloc appelle les modules de `src/hook/*` et affiche.
 */

import { hookLimits } from '../../hook/config';
import { esc, list } from '../dom';
import type { Section, SectionContext } from './types';
import { label } from './hook-copy';
import { mountConfig, renderConfig } from './hook-config';
import { mountFlows, renderInbound, renderOutbound } from './hook-flows';
import { mountToken, renderToken } from './hook-token';
import { mountPolicy, renderPolicyBlock } from './hook-policy';

/** Les deux limites du §11 : l'outil déjà exécuté, les clients sans hooks. */
function renderLimits(ctx: SectionContext): string {
  return `<div class="block"><h4>${esc(label(ctx, 'limitsTitle'))}</h4>${list(hookLimits(ctx.lang))}</div>`;
}

function render(ctx: SectionContext): string {
  return (
    renderConfig(ctx) +
    renderInbound(ctx) +
    renderOutbound(ctx) +
    renderToken(ctx) +
    renderPolicyBlock(ctx) +
    renderLimits(ctx)
  );
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  mountConfig(root, ctx);
  mountFlows(root, ctx);
  mountToken(root, ctx);
  mountPolicy(root, ctx);
}

export const hookSection: Section = {
  id: 'hook',
  titles: { fr: 'Hook et clients d’agents', en: 'Hook & agent clients' },
  render,
  mount,
};
