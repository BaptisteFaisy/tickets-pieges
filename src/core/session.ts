/**
 * Session contaminée (§9, §11, lot S) — les gestes soumis à confirmation.
 *
 * Dès qu'une session d'agent a lu un contenu T0 ou T1 (non vérifié), elle est
 * marquée. Jusqu'à sa fin, les outils capables de faire sortir des données —
 * recherche étendue, réponse publique, consultation d'une adresse web —
 * demandent une confirmation humaine. La décision rend le motif lisible qui
 * sera affiché (`permissionDecisionReason` du hook, §11).
 *
 * Le domaine rend les décisions et n'écrit rien : la persistance de la marque
 * est le fait de `SessionRepo` (`src/platform/schema.ts`), hors de ce fichier.
 *
 * Domaine pur : aucune E/S, aucune heure lue (dates injectées), aucun
 * import `@forge/*`. Les motifs visibles sont locaux (fr/en) car les
 * catalogues appartiennent aux autres lots ; la PR le signale pour le tronc.
 */

import type { Language, TaintedSession, TrustLevel } from './types';
import { isExternal } from './levels';

/** Les trois gestes capables de faire sortir des données (§9). */
export type GuardedAction = 'broad-search' | 'public-reply' | 'fetch-url';

export const GUARDED_ACTIONS: readonly GuardedAction[] = ['broad-search', 'public-reply', 'fetch-url'];

/** Décision rendue au hook ou à l'outil : laisser passer ou demander. */
export interface SessionDecision {
  required: boolean;
  /** Verdict au format du hook (§11) : `ask` quand la confirmation est due. */
  decision: 'allow' | 'ask';
  /** Motif lisible affiché (`permissionDecisionReason`) ; vide si `allow`. */
  reason: string;
}

/** Ce qu'il faut pour marquer une session : qui, quoi, quand (date injectée). */
export interface TaintInput {
  sessionRef: string;
  accountId: string;
  issueId: string;
  /** Niveau du contenu que la session vient de lire. */
  trustLevel: TrustLevel;
  now: string;
}

/** Motifs de confirmation, par geste et par langue (§11 : texte lisible). */
const REASONS: Record<Language, Record<GuardedAction, string>> = {
  fr: {
    'broad-search': 'Recherche étendue dans une session qui a lu du contenu non vérifié '
      + '(ticket {issueId}). Confirme la portée avant de chercher.',
    'public-reply': 'Réponse publique dans une session qui a lu du contenu non vérifié '
      + '(ticket {issueId}). Relis le texte avant l’envoi.',
    'fetch-url': 'Consultation d’une adresse web dans une session qui a lu du contenu non '
      + 'vérifié (ticket {issueId}). Confirme l’adresse avant l’appel.',
  },
  en: {
    'broad-search': 'Broad search in a session that read unverified content (issue '
      + '{issueId}). Confirm the scope before searching.',
    'public-reply': 'Public reply in a session that read unverified content (issue '
      + '{issueId}). Review the text before sending.',
    'fetch-url': 'Fetching a web address in a session that read unverified content (issue '
      + '{issueId}). Confirm the address before the call.',
  },
};

/**
 * Marque une session qui vient de lire un contenu : contaminée si le niveau est
 * externe (T0 ou T1, via `isExternal` de `levels.ts`), sinon rien — un contenu
 * prouvé interne ne contamine pas.
 */
export function taint(input: TaintInput): TaintedSession | null {
  if (!isExternal(input.trustLevel)) return null;
  return {
    sessionRef: input.sessionRef,
    accountId: input.accountId,
    issueId: input.issueId,
    since: input.now,
  };
}

/**
 * Fusionne une nouvelle marque dans une liste : la première contamination
 * garde sa date (`since`), une session déjà marquée n'est pas rajeunie.
 */
export function mergeTaint(
  sessions: TaintedSession[],
  fresh: TaintedSession | null,
): TaintedSession[] {
  if (!fresh) return [...sessions];
  if (sessions.some((session) => session.sessionRef === fresh.sessionRef)) {
    return [...sessions];
  }
  return [...sessions, fresh];
}

/** La session est-elle encore marquée ? */
export function isSessionTainted(
  sessions: TaintedSession[],
  sessionRef: string,
): boolean {
  return sessions.some((session) => session.sessionRef === sessionRef);
}

/**
 * Un geste est-il soumis à confirmation ? Oui dès que la session a lu du
 * contenu T0/T1 et que le geste peut faire sortir des données (§9). Le motif
 * rendu est celui que le hook affichera (`permissionDecisionReason`, §11).
 */
export function requiresConfirmation(
  session: TaintedSession | null | undefined,
  action: GuardedAction,
  language: Language = 'fr',
): SessionDecision {
  if (!session) {
    return { required: false, decision: 'allow', reason: '' };
  }
  const reason = REASONS[language][action].replace('{issueId}', session.issueId);
  return { required: true, decision: 'ask', reason };
}

/**
 * Fin de session (§9 : la marque vaut « jusqu'à sa fin ») : la marque tombe,
 * les gestes redeviennent libres. Rend la liste sans la session terminée.
 */
export function endSession(
  sessions: TaintedSession[],
  sessionRef: string,
): TaintedSession[] {
  return sessions.filter((session) => session.sessionRef !== sessionRef);
}
