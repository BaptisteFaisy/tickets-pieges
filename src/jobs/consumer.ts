/**
 * File d'analyse — couche C3 hors du chemin de l'événement (§6, §18).
 *
 * Le manifeste déclare `consumer: { queue: pieges-c3, resolver: { function:
 * c3-consumer, method: consume } }`. Le message arrive dans un `AsyncEvent`
 * dont le contenu utile est `body` (`docs/FORGE.md` §3) : `queueBody` le lit,
 * et ne rend `null` que si le message est illisible — auquel cas on journalise
 * et on passe, sans faire échouer la file.
 */

import Resolver from '@forge/resolver';
import { queueBody } from './events';
import { runC3OnSegment } from './c3';
import { createForgeDeps } from './support';

const resolver = new Resolver();

resolver.define('consume', async ({ payload }: { payload: unknown }) => {
  const message = queueBody(payload);
  const deps = await createForgeDeps();
  if (!message) {
    await deps.store.events.append('c3-message-illisible', null, { payload: String(payload).slice(0, 200) });
    return { ok: false, reason: 'message illisible' };
  }
  const outcome = await runC3OnSegment(deps, message.issueId, message.segmentId);
  return { ok: true, ...outcome };
});

/** `handler: index.c3Consumer` dans le manifeste. */
export const c3Consumer = resolver.getDefinitions();
