/**
 * File d'analyse — couche C3 hors du chemin de l'événement (§6, §18).
 *
 * Le manifeste déclare `consumer: { queue: pieges-c3, resolver: { function:
 * c3-consumer, method: consume } }` : le résolveur exporté ici porte donc une
 * méthode `consume`. Squelette remplacé par le lot Jobs.
 */

import Resolver from '@forge/resolver';

/** Un message de la file : ce qu'il faut pour retrouver le segment. */
export interface C3Message {
  issueId: string;
  segmentId: string;
  attempt?: number;
}

const resolver = new Resolver();

resolver.define('consume', async ({ payload }: { payload: C3Message }) => {
  void payload;
  return { ok: true };
});

/** `handler: index.c3Consumer` dans le manifeste. */
export const c3Consumer = resolver.getDefinitions();
