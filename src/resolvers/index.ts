/**
 * Résolveur des écrans (§17) — lot UI.
 *
 * Une clé par fonction appelée par l'interface ; les clés sont exactement celles
 * de `src/ui/api.ts` (le contrat, et il n'y en a pas d'autre). Aucune ne jette :
 * un écran affiche une phrase, jamais une pile d'appels.
 */

import Resolver, { type ResolverFunction } from '@forge/resolver';
import { createMemoryStore } from '../platform/memory';
import type { Clock, Store } from '../platform/schema';
import type { ResolverDeps, UiHandler } from '../ui/api';
import { exposureResolvers } from './exposure';
import { originalsResolvers } from './originals';
import { panelResolvers } from './panel';
import { playgroundResolvers } from './playground';
import { queueResolvers } from './queue';
import { reviewResolvers } from './review';
import { settingsResolvers } from './settings';

const ping: UiHandler = async () => ({ ok: true, data: 'pong' });

/** Registre complet : les clés appelées par `src/ui/api.ts`, et rien d'autre. */
export function createResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  return {
    ping,
    ...panelResolvers(deps),
    ...queueResolvers(deps),
    ...reviewResolvers(deps),
    ...settingsResolvers(deps),
    ...exposureResolvers(deps),
    ...originalsResolvers(deps),
    ...playgroundResolvers(deps),
  };
}

/**
 * Dépendances de production.
 *
 * Limites assumées (voir PR) : `src/platform/db.ts` (Forge SQL) n'existe pas
 * encore dans cette base — le stockage provisoire est celui en mémoire — et
 * aucun référentiel de comptes « rôle sécurité » n'est branché : tant qu'il est
 * vide, les originaux conservés restent fermés pour tout le monde (§21).
 */
export function productionDeps(): ResolverDeps {
  const store: Store = createMemoryStore();
  const clock: Clock = { now: () => new Date().toISOString() };
  return { store, clock, securityAccounts: [] };
}

/** Clés exposées aux écrans. */
export const RESOLVERS: Record<string, UiHandler> = createResolvers(productionDeps());

const instance = new Resolver();
for (const [key, handler] of Object.entries(RESOLVERS)) {
  const wrapped: ResolverFunction = async (request) => handler(request.payload ?? {}, request.context);
  instance.define(key, wrapped);
}

/** `handler: index.resolver` dans le manifeste. */
export const resolver = instance.getDefinitions();

export default resolver;
