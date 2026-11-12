/**
 * Déclencheurs Jira (§18) — le glue le plus mince possible.
 *
 * Chaque handler fait trois choses : lire la clé du ticket dans l'événement,
 * appeler `scanIssue` (le pipeline en cinq étapes), journaliser. Aucune règle du
 * domaine ne vit ici : un handler qui calcule est un handler qu'on ne peut pas
 * tester.
 *
 * Ces fonctions importent le câblage Forge (`./support`) : elles ne sont donc pas
 * couvertes par les tests unitaires. Ce qu'elles font est testé via
 * `src/jobs/pipeline.test.ts` et `src/jobs/events.test.ts`.
 */

import { inherit } from '../core/inheritance';
import { isSelfEcho } from '../core/self-write';
import { eventIssueKey, eventLinkedIssueKey, eventLinkType, eventSourceIssueKey } from './events';
import { scanIssue } from './pipeline';
import { createForgeDeps } from './support';

/** Clé du ticket lue dans l'événement, ou `null` — et alors on ne fait rien. */
function keyOf(event: unknown): string | null {
  return eventIssueKey(event);
}


/**
 * Fenêtre pendant laquelle un événement est considéré comme l'écho de nos
 * propres écritures (propriété indexée, bandeau, neutralisation).
 *
 * Écrire la propriété `pieges` **déclenche** `avi:jira:updated:issue`. Sans
 * garde, l'app réanalyse son propre écrit, réécrit la propriété, et
 * recommence : la couche C3 devient intermittente et le quota Forge SQL part en
 * écritures inutiles. Mesuré le 12 novembre 2026.
 */
const SELF_ECHO_WINDOW_MS = 20_000;

/** Analyse le ticket, sauf si l'événement est l'écho de notre propre écriture. */
async function analyseUnlessEcho(
  deps: Awaited<ReturnType<typeof createForgeDeps>>,
  issueKey: string,
): Promise<void> {
  const issue = await deps.jira.getIssue(issueKey);
  const marks = (await deps.store.events.list(issue.id, 20)).map((entry) => ({
    kind: entry.kind,
    at: entry.at,
  }));
  if (isSelfEcho(marks, deps.clock.now(), SELF_ECHO_WINDOW_MS)) {
    await deps.store.events.append('self-echo-ignored', issue.id, { issueKey });
    return;
  }
  await scanIssue(deps, issueKey);
}

/** `avi:jira:created:issue` — origine immédiate, puis C1/C2, puis file C3 (§18). */
export async function issueCreated(event: unknown): Promise<void> {
  const issueKey = keyOf(event);
  if (!issueKey) return;
  const deps = await createForgeDeps();
  await analyseUnlessEcho(deps, issueKey);
}

/**
 * `avi:jira:updated:issue` — pièces jointes ajoutées, champs texte modifiés,
 * déplacement de projet. Le fil entier est réexaminé (§22) : `scanIssue` est
 * idempotent, les identifiants de constat sont stables.
 */
export async function issueUpdated(event: unknown): Promise<void> {
  const issueKey = keyOf(event);
  if (!issueKey) return;
  const deps = await createForgeDeps();
  await analyseUnlessEcho(deps, issueKey);
}

/** `avi:jira:created:comment` — un commentaire peut porter la moitié d'une charge. */
export async function commentCreated(event: unknown): Promise<void> {
  const issueKey = keyOf(event);
  if (!issueKey) return;
  const deps = await createForgeDeps();
  await analyseUnlessEcho(deps, issueKey);
}

/** `avi:jira:updated:comment` — visibilité modifiée ou texte édité. */
export async function commentUpdated(event: unknown): Promise<void> {
  const issueKey = keyOf(event);
  if (!issueKey) return;
  const deps = await createForgeDeps();
  await analyseUnlessEcho(deps, issueKey);
}

/**
 * `avi:jira:created:issuelink` — l'origine suit le texte (§12) : un bug créé à
 * partir d'une demande hérite de son niveau le plus bas et de ses constats.
 * Le développeur voit d'où vient la description.
 */
export async function issueLinkCreated(event: unknown): Promise<void> {
  const source = eventSourceIssueKey(event);
  const target = eventLinkedIssueKey(event);
  if (!source || !target) return;
  const deps = await createForgeDeps();
  const now = deps.clock.now();

  const sourceState = await stateOf(deps, source);
  if (!sourceState) return;
  const findings = (await deps.store.findings.byIssue(sourceState.issueId)).filter((f) => f.status === 'open');
  const relation = (eventLinkType(event) ?? '').toLowerCase().includes('clone') ? 'clone' : 'link';
  const result = inherit({
    sourceIssueKey: source,
    sourceTrustLevel: sourceState.trustLevel,
    targetIssueKey: target,
    relation,
    findings,
  });

  const targetState = await stateOf(deps, target);
  if (targetState) {
    await deps.store.states.put({
      ...targetState,
      trustLevel: result.trustLevel,
      inheritedFrom: source,
      updatedAt: now,
    });
  }
  await deps.store.events.append('inherit', targetState?.issueId ?? null, {
    source,
    target,
    relation,
    trust: result.trustLevel,
    carried: result.carriedFindings,
  });
  if (result.carriedFindings > 0) {
    await deps.jira.addInternalNote(target, result.note);
  }
}

/** État d'un ticket par sa clé : la table est indexée par identifiant interne. */
async function stateOf(deps: Awaited<ReturnType<typeof createForgeDeps>>, issueKey: string) {
  const issue = await deps.jira.getIssue(issueKey);
  return deps.store.states.get(issue.id);
}
