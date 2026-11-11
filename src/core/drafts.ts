/**
 * Brouillon de réponse en note interne (§10, TP-12).
 *
 * « `propose-public-reply` écrit un brouillon en note interne. Un humain le relit
 * et le publie depuis le panneau. » — c'est le seul chemin par lequel l'app fait
 * sortir un texte : rien n'est visible du client avant un geste humain.
 *
 * Le domaine ne publie rien : il rend la ligne à écrire et la décision. La
 * plateforme exécute (lot Plateforme), l'écran affiche le bouton (lot UI).
 */

import type { DraftRow } from '../platform/schema';
import type { OutboundVerdict } from './types';
import type { JournalEntry } from './neutralize';
import { t } from './i18n';
import type { Language } from './types';

/** Ce qu'il faut pour ouvrir un brouillon. */
export interface DraftInput {
  id: string;
  issueId: string;
  issueKey: string;
  text: string;
  authorAccountId: string;
  now: string;
}

/** Crée la ligne de brouillon : toujours en attente, jamais publiée d'emblée. */
export function createDraft(input: DraftInput): DraftRow {
  return {
    id: input.id,
    issueId: input.issueId,
    issueKey: input.issueKey,
    text: input.text,
    authorAccountId: input.authorAccountId,
    createdAt: input.now,
    publishedAt: null,
  };
}

/** Un brouillon est en attente tant qu'aucune date de publication n'est posée. */
export function isPending(draft: DraftRow): boolean {
  return draft.publishedAt === null;
}

/** Brouillons en attente d'un ticket, du plus ancien au plus récent. */
export function pendingDrafts(drafts: DraftRow[]): DraftRow[] {
  return drafts.filter(isPending).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Décision de publication : ce qui part, sous quelle forme, et pourquoi. */
export interface PublishDecision {
  allowed: boolean;
  /** `internal` : note interne ; `public` : commentaire visible du client. */
  visibility: 'internal' | 'public';
  reason: string;
  journal: JournalEntry[];
}

/**
 * Un brouillon ne devient public qu'avec une relecture humaine **et** un sas
 * favorable. Sans relecture, il reste interne — c'est la garantie du §10
 * (« empêche ») et ce que la recette §23.10 vérifie.
 */
export function decidePublication(
  draft: DraftRow,
  verdict: OutboundVerdict,
  humanReviewed: boolean,
  options: { language?: Language; now: string; reviewerAccountId?: string } = { now: new Date(0).toISOString() },
): PublishDecision {
  const language = options.language ?? 'fr';
  const base = { issueKey: draft.issueKey, draftId: draft.id, action: verdict.action };

  if (!humanReviewed) {
    return {
      allowed: false,
      visibility: 'internal',
      reason: t(language, 'draft.needs-review'),
      journal: [{ kind: 'draft-held', at: options.now, detail: { ...base, why: 'no-human-review' } }],
    };
  }

  if (!verdict.allowed) {
    return {
      allowed: false,
      visibility: 'internal',
      reason: t(language, 'draft.blocked-by-gate'),
      journal: [{ kind: 'draft-blocked', at: options.now, detail: { ...base, why: 'outbound-gate' } }],
    };
  }

  return {
    allowed: true,
    visibility: 'public',
    reason: t(language, 'draft.published'),
    journal: [
      {
        kind: 'draft-published',
        at: options.now,
        detail: { ...base, by: options.reviewerAccountId ?? 'unknown' },
      },
    ],
  };
}

/** Marque un brouillon publié, avec son journal (§8.3 : tout geste est tracé). */
export function markPublished(draft: DraftRow, at: string, by: string): { row: DraftRow; journal: JournalEntry[] } {
  return {
    row: { ...draft, publishedAt: at },
    journal: [
      {
        kind: 'draft-published',
        at,
        detail: { issueKey: draft.issueKey, draftId: draft.id, by },
      },
    ],
  };
}
