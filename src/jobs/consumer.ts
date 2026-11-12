/**
 * File d'analyse — couche C3 hors du chemin de l'événement (§6, §18).
 *
 * Le manifeste déclare `consumer: { queue: pieges-c3, function: c3-consumer }`.
 * Le message arrive dans un `AsyncEvent`
 * dont le contenu utile est `body` (`docs/FORGE.md` §3) : `queueBody` le lit,
 * et ne rend `null` que si le message est illisible — auquel cas on journalise
 * et on passe, sans faire échouer la file.
 */

import { queueBody } from './events';
import { runC3OnSegment } from './c3';
import { createForgeDeps } from './support';

/**
 * Handler de la file. La forme « fonction simple » est celle qui fonctionne sur
 * le runtime mesuré le 12 novembre 2026 : avec la forme `resolver` + `method`,
 * `Queue.push` répondait 400 et la couche C3 ne tournait jamais.
 *
 * Le message arrive dans un `AsyncEvent` : le contenu utile est `body`
 * (`docs/FORGE.md` §3). Un message illisible est journalisé, pas rejeté — une
 * file qui boucle sur un message mort bloque les suivants.
 */
export async function c3Consumer(event: unknown): Promise<{ ok: boolean; reason?: string }> {
  const message = queueBody(event);
  const deps = await createForgeDeps();
  if (!message) {
    await deps.store.events.append('c3-message-illisible', null, { payload: String(event).slice(0, 200) });
    return { ok: false, reason: 'message illisible' };
  }
  const outcome = await runC3OnSegment(deps, message.issueId, message.segmentId);
  return { ok: true, ...outcome };
}
