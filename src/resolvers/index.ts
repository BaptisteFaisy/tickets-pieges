/**
 * Résolveur des écrans (§17) — lot UI.
 *
 * Une clé par fonction appelée par l'interface ; les clés sont exactement celles
 * de `src/ui/api.ts` (le contrat, et il n'y en a pas d'autre). Aucune ne jette :
 * un écran affiche une phrase, jamais une pile d'appels.
 *
 * Squelette : le lot UI ajoute ses clés dans `RESOLVERS`.
 */

import Resolver, { type ResolverFunction } from '@forge/resolver';

const ping: ResolverFunction = async () => ({ ok: true, data: 'pong' });

/** Clés exposées aux écrans. */
export const RESOLVERS: Record<string, ResolverFunction> = {
  ping,
};

const instance = new Resolver();
for (const [key, handler] of Object.entries(RESOLVERS)) {
  instance.define(key, handler);
}

/** `handler: index.resolver` dans le manifeste. */
export const resolver = instance.getDefinitions();

export default resolver;
