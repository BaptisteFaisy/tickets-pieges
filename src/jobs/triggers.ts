/**
 * Événements Jira (§18 : déroulement à l'arrivée d'une demande) — lot Jobs.
 *
 * Les cinq triggers du manifeste. Aucun ne recopie le déroulement : tous
 * passent par `analyzeIssue` (`pipeline.ts`), la fonction unique du §18.
 *
 * Ordre imposé par le cahier (tenu par le pipeline) :
 *   1. l'origine est calculée aussitôt, sans modèle, et écrite dans la propriété ;
 *   2. les couches C1 et C2 passent dans la foulée ;
 *   3. la couche C3 est mise en file (`pieges-c3`) ;
 *   4. le niveau de suspicion est fixé, le mode du projet s'applique ;
 *   5. tout est journalisé.
 *
 * Un commentaire réexamine le **fil entier** (§22) : `analyzeIssue` recollecte
 * tous les commentaires à chaque passage. Un lien créé propage l'origine (§12)
 * via `src/core/inheritance.ts`.
 */

import { Queue } from '@forge/events';
import type { TrustLevel } from '../core/types';
import { inherit, carryFindings } from '../core/inheritance';
import { lowestOf } from '../core/levels';
import { loadSettings, readEventRef, resolveDeps, type C3Message, type JobsDeps } from './support';
import { analyzeIssue } from './pipeline';
import type { JiraIssueView } from '../platform/schema';

/** File d'analyse : la couche C3 tourne hors du chemin de l'événement (§6). */
const c3Queue = new Queue({ key: 'pieges-c3' });

async function enqueueC3(message: C3Message): Promise<void> {
  await c3Queue.push({ body: message });
}

/** Dépendances des triggers : le modèle n'est jamais appelé en ligne (§6). */
function triggerDeps(): JobsDeps {
  return resolveDeps({ enqueue: enqueueC3 });
}

/** Un événement sans ticket identifiable est journalisé, pas rejoué. */
async function runOnEvent(event: unknown, kind: string, reason: string): Promise<void> {
  const deps = triggerDeps();
  const ref = readEventRef(event);
  const target = ref.issueId ?? ref.issueKey;
  if (!target) {
    await deps.store.events.append('evenement.illisible', null, { kind, ref });
    return;
  }
  await deps.store.events.append('evenement.recu', ref.issueId ?? null, { kind, ref });
  await analyzeIssue(deps, target, { reason });
}

/** `avi:jira:created:issue` — origine + C1/C2 + mise en file de C3. */
export async function issueCreated(event: unknown): Promise<void> {
  await runOnEvent(event, 'avi:jira:created:issue', 'evenement:issue-created');
}

/** `avi:jira:updated:issue` — pièces jointes, champs texte, déplacement de projet. */
export async function issueUpdated(event: unknown): Promise<void> {
  await runOnEvent(event, 'avi:jira:updated:issue', 'evenement:issue-updated');
}

/** `avi:jira:created:comment` — le fil entier est réexaminé (§22). */
export async function commentCreated(event: unknown): Promise<void> {
  await runOnEvent(event, 'avi:jira:created:comment', 'evenement:comment-created');
}

/** `avi:jira:updated:comment` — visibilité modifiée, texte édité. */
export async function commentUpdated(event: unknown): Promise<void> {
  await runOnEvent(event, 'avi:jira:updated:comment', 'evenement:comment-updated');
}

// ------------------------------------------------------------- hérédité (§12)

/** Abaisse l'état du ticket cible : le niveau le plus bas gagne, jamais l'inverse. */
async function lowerTargetState(
  deps: JobsDeps,
  target: JiraIssueView,
  sourceKey: string,
  inheritedTrust: TrustLevel,
  now: string,
): Promise<void> {
  const row = await deps.store.states.get(target.id);
  if (!row) return;
  const trustLevel = lowestOf([row.trustLevel, inheritedTrust]);
  await deps.store.states.put({ ...row, trustLevel, inheritedFrom: sourceKey, updatedAt: now });
  await deps.jira.setEntityProperty(target.key, 'pieges', {
    trustLevel,
    suspicionLevel: row.suspicionLevel,
    modeApplied: row.modeApplied,
    analyzedAt: now,
    unanalyzed: row.unanalyzed.length,
  });
}

/** Propage l'origine et les constats d'un lien vers le ticket lié ou cloné. */
async function propagateInheritance(deps: JobsDeps, sourceKey: string, link: { issueKey: string; relation: 'clone' | 'link' }): Promise<void> {
  const now = deps.clock.now();
  const source = await deps.jira.getIssue(sourceKey);
  const target = await deps.jira.getIssue(link.issueKey);
  const settings = await loadSettings(deps.store, target.projectKey);
  const sourceState = await deps.store.states.get(source.id);
  const findings = await deps.store.findings.byIssue(source.id);
  const result = inherit(
    {
      sourceIssueKey: source.key,
      sourceTrustLevel: sourceState?.trustLevel ?? 'T0',
      targetIssueKey: target.key,
      relation: link.relation,
      findings,
    },
    settings.language,
  );
  for (const carried of carryFindings(findings, target.id)) {
    await deps.store.findings.put(carried);
  }
  await analyzeIssue(deps, target.key, { reason: `heritage:${link.relation}:${source.key}` });
  await lowerTargetState(deps, target, source.key, result.trustLevel, now);
  await deps.store.events.append('heritage.propagee', target.id, {
    source: source.key, relation: link.relation, note: result.note, constats: result.carriedFindings,
  });
}

/** `avi:jira:created:issuelink` — hérédité vers le ticket lié ou cloné (§12). */
export async function issueLinkCreated(event: unknown): Promise<void> {
  const deps = triggerDeps();
  const ref = readEventRef(event);
  const target = ref.issueId ?? ref.issueKey;
  if (!target) {
    await deps.store.events.append('evenement.illisible', null, { kind: 'avi:jira:created:issuelink' });
    return;
  }
  await analyzeIssue(deps, target, { reason: 'evenement:issuelink-created' });
  const source = await deps.jira.getIssue(target);
  for (const link of await deps.jira.listLinked(source.key)) {
    await propagateInheritance(deps, source.key, link);
  }
}
