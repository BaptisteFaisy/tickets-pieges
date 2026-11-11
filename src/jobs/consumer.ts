/**
 * File d'analyse — couche C3 hors du chemin de l'événement (§6, §18).
 *
 * Le manifeste déclare `consumer: { queue: pieges-c3, resolver: { function:
 * c3-consumer, method: consume } }` : le résolveur exporté ici porte donc une
 * méthode `consume`.
 *
 * Le consumer reçoit un **`AsyncEvent { body, jobId, … }`** et non le message
 * nu (`docs/FORGE.md` §3) : la lecture passe par `payload.body`, avec repli sur
 * `payload` lui-même pour les versions qui aplatissent le corps.
 *
 * Tout le traitement vit dans `processC3Message` (`pipeline.ts`) : ce fichier
 * n'est que le branchement Forge — résolveur, file, port modèle. Il est le seul
 * à importer `@forge/resolver` et `src/platform/llm.ts` ; les tests n'y touchent
 * donc jamais.
 */

import Resolver from '@forge/resolver';
import { forgeModelPort } from '../platform/llm';
import { resolveDeps, type C3Message } from './support';
import { processC3Message } from './pipeline';

/** Lecture tolérante de l'`AsyncEvent` : le corps est dans `body` (§FORGE 3). */
export function readMessage(payload: unknown): C3Message | null {
  const root = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  if (!root) return null;
  const body = root['body'];
  const source = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : root;
  const issueId = source['issueId'];
  const segmentId = source['segmentId'];
  if (typeof issueId !== 'string' || typeof segmentId !== 'string') return null;
  const attempt = source['attempt'];
  return { issueId, segmentId, attempt: typeof attempt === 'number' ? attempt : undefined };
}

const resolver = new Resolver();

resolver.define('consume', async ({ payload }: { payload: unknown }) => {
  const message = readMessage(payload);
  if (!message) return { ok: false, reason: 'message-illisible' };
  const deps = resolveDeps({ model: forgeModelPort() });
  return processC3Message(deps, message);
});

/** `handler: index.c3Consumer` dans le manifeste. */
export const c3Consumer = resolver.getDefinitions();
