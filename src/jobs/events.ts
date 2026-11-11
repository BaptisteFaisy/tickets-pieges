/**
 * Lecture des événements de la plateforme — **pur** (testable sans Forge).
 *
 * Les payloads AVI varient selon l'événement et la version : clé du ticket tantôt
 * `issue.key`, tantôt `issueKey`, tantôt dans `context`. Plutôt que de deviner,
 * on cherche dans un ordre connu et on rend `null` quand rien n'est sûr — un
 * événement illisible ne doit jamais déclencher une écriture.
 */

/** Un objet JSON quelconque, tel qu'arrive un payload d'événement. */
export type Payload = Record<string, unknown> | undefined | null;

function asRecord(value: unknown): Payload {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Première chaîne non vide parmi les chemins donnés. */
function firstString(payload: Payload, paths: string[]): string | null {
  for (const path of paths) {
    let current: unknown = payload;
    for (const key of path.split('.')) current = asRecord(current)?.[key];
    if (typeof current === 'string' && current.trim().length > 0) return current.trim();
    if (typeof current === 'number') return String(current);
  }
  return null;
}

/** Clé du ticket concerné (`SUP-482`). */
export function eventIssueKey(payload: unknown): string | null {
  return firstString(asRecord(payload), ['issue.key', 'issueKey', 'context.issueKey', 'issue.fieldValues.key']);
}

/** Identifiant interne du ticket. */
export function eventIssueId(payload: unknown): string | null {
  return firstString(asRecord(payload), ['issue.id', 'issueId', 'context.issueId']);
}

/** Identifiant du commentaire, pour un événement de commentaire. */
export function eventCommentId(payload: unknown): string | null {
  return firstString(asRecord(payload), ['comment.id', 'commentId', 'context.commentId']);
}

/** Clé du ticket **lié** (hérédité, §12) : la cible, pas la source. */
export function eventLinkedIssueKey(payload: unknown): string | null {
  return firstString(asRecord(payload), ['issueLink.targetIssue.key', 'targetIssue.key', 'linkedIssue.key']);
}

/** Clé du ticket source d'un lien. */
export function eventSourceIssueKey(payload: unknown): string | null {
  return firstString(asRecord(payload), ['issueLink.sourceIssue.key', 'sourceIssue.key', 'issue.key']);
}

/** Type de lien (`clone`, `relates`…) : l'hérédité ne se déclenche que sur ce qui existe. */
export function eventLinkType(payload: unknown): string | null {
  return firstString(asRecord(payload), ['issueLink.type.name', 'linkType', 'issueLink.type']);
}

/**
 * Corps d'un message de la file d'analyse. `@forge/events` livre un
 * `AsyncEvent { body, jobId }` : c'est `body` qui porte le message
 * (`docs/FORGE.md` §3).
 */
export function queueBody(payload: unknown): { issueId: string; segmentId: string } | null {
  const record = asRecord(payload);
  const body = asRecord(record?.body) ?? record;
  const issueId = firstString(body, ['issueId']);
  const segmentId = firstString(body, ['segmentId']);
  return issueId && segmentId ? { issueId, segmentId } : null;
}
