/**
 * Journal des événements (§18 étape 5 « tout est journalisé », §8.3).
 *
 * Le journal est la trace opposable de ce que l'app a fait sur un ticket :
 * ce qui a été neutralisé, ce qui a été restauré, ce qui a été dit au client.
 *
 * Deux garde-fous :
 *   - le journal ne porte **jamais** le texte d'un client (§21) : les charges
 *     `text`, `body`, `content`, `excerpt`, `original` sont retirées avant
 *     écriture (l'original vit dans la table `original`, hors du journal) ;
 *   - les écritures sensibles de `src/platform/jira.ts` passent par les mêmes
 *     genres (`public-comment`, `internal-note`, `segment-text-replaced`).
 *
 * Aucune dépendance Forge : le journal se branche sur un `EventRepo`.
 */

import type { EventRepo, EventRow } from './schema';

type Json = Record<string, unknown>;

/** Genres stables du journal — kebab-case anglais, jamais de texte libre. */
export const EVENT_KINDS = {
  analyzed: 'analyzed',
  neutralized: 'neutralized',
  restored: 'restored',
  labeled: 'labeled',
  publicComment: 'public-comment',
  internalNote: 'internal-note',
  segmentTextReplaced: 'segment-text-replaced',
  commentVisibility: 'comment-visibility',
  verdict: 'verdict',
  statePublished: 'state-published',
} as const;

/** Champs dont la valeur ne doit jamais atteindre le journal (§21). */
const FORBIDDEN_KEYS = ['text', 'body', 'content', 'excerpt', 'original', 'description', 'summary'];

/** Retire les charges textuelles : le journal garde des faits, pas du texte. */
export function sanitize(payload: unknown): Json {
  if (typeof payload !== 'object' || payload === null) return {};
  const clean: Json = {};
  for (const [key, value] of Object.entries(payload as Json)) {
    if (FORBIDDEN_KEYS.includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

export interface Journal {
  append(kind: string, issueId: string | null, payload?: unknown): Promise<void>;
  analyzed(issueId: string, payload: Json): Promise<void>;
  neutralized(issueId: string, payload: Json): Promise<void>;
  restored(issueId: string, payload: Json): Promise<void>;
  publicComment(issueKey: string, commentId: string): Promise<void>;
  internalNote(issueKey: string, commentId: string): Promise<void>;
  segmentTextReplaced(issueKey: string, payload: Json): Promise<void>;
  labeled(issueId: string, label: string): Promise<void>;
  verdict(issueId: string, findingId: string, decision: string, reviewerAccountId: string): Promise<void>;
  statePublished(issueKey: string, payload: Json): Promise<void>;
  recent(issueId: string | null, limit: number): Promise<EventRow[]>;
}

/** Journal adossé au tiroir `events` du `Store`. */
export function createJournal(events: EventRepo): Journal {
  const append = (kind: string, issueId: string | null, payload?: unknown): Promise<void> =>
    events.append(kind, issueId, sanitize(payload));

  return {
    append,
    analyzed: (issueId, payload) => append(EVENT_KINDS.analyzed, issueId, payload),
    neutralized: (issueId, payload) => append(EVENT_KINDS.neutralized, issueId, payload),
    restored: (issueId, payload) => append(EVENT_KINDS.restored, issueId, payload),
    publicComment: (issueKey, commentId) =>
      append(EVENT_KINDS.publicComment, issueKey, { commentId }),
    internalNote: (issueKey, commentId) => append(EVENT_KINDS.internalNote, issueKey, { commentId }),
    segmentTextReplaced: (issueKey, payload) =>
      append(EVENT_KINDS.segmentTextReplaced, issueKey, payload),
    labeled: (issueId, label) => append(EVENT_KINDS.labeled, issueId, { label }),
    verdict: (issueId, findingId, decision, reviewerAccountId) =>
      append(EVENT_KINDS.verdict, issueId, { findingId, decision, reviewerAccountId }),
    statePublished: (issueKey, payload) => append(EVENT_KINDS.statePublished, issueKey, payload),
    recent: (issueId, limit) => events.list(issueId, limit),
  };
}
