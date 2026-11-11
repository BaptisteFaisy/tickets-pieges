/**
 * Câblage Forge des jobs — le seul fichier du lot qui importe la plateforme.
 *
 * Il n'est **jamais** importé par un test : les tests passent par
 * `createMemoryStore()` et des doubles de ports (`src/jobs/pipeline.test.ts`).
 * C'est la même séparation que `src/platform/llm.ts` (`docs/FORGE.md`).
 */

import { Queue } from '@forge/events';
import { createSqlStore, ensureSchema } from '../platform/db';
import { createJiraPort } from '../platform/jira';
import { forgeModelPort } from '../platform/llm';
import type { Clock, JiraPort, ModelPort, Store } from '../platform/schema';
import type { PipelineDeps } from './pipeline';

/** Nom de la file d'analyse de la couche C3 (§6, §18) — celui du manifeste. */
export const C3_QUEUE = 'pieges-c3';

/** Corps d'un message de la file. */
export interface C3Message {
  issueId: string;
  segmentId: string;
}

/** Horloge du runtime : le domaine, lui, reçoit toujours l'heure en paramètre. */
export function systemClock(): Clock {
  return { now: () => new Date().toISOString() };
}

/** Mise en file de la couche C3, hors du chemin de l'événement (§18, étape 3). */
export async function enqueueC3(message: C3Message): Promise<void> {
  const queue = new Queue<Record<string, unknown>>({ key: C3_QUEUE });
  await queue.push({ body: { issueId: message.issueId, segmentId: message.segmentId } });
}

/**
 * Les ports de production. Le schéma SQL est créé explicitement : un schéma
 * jamais créé laisse les tables absentes et tout échoue en silence
 * (`docs/FORGE.md` §2).
 */
export async function createForgeDeps(): Promise<PipelineDeps> {
  await ensureSchema();
  const store: Store = createSqlStore();
  const jira: JiraPort = createJiraPort();
  const model: ModelPort = forgeModelPort();
  return { store, jira, model, clock: systemClock(), enqueueC3 };
}
