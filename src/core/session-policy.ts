/**
 * Politique de session contaminée étendue (§9, §11) — budget (#26),
 * quarantaine (#27), extinction (#24) et capacités produit-agnostiques (#21).
 *
 * `session.ts` répondait à une question : « ce geste exige-t-il une
 * confirmation ? ». Ce fichier répond à « **que peut encore faire cette
 * session ?** », en trois verrous cumulatifs :
 *  1. **TTL** (#24) — une session inactive s'éteint seule : plus rien n'est
 *     refusé, mais une nouvelle lecture de contenu T0/T1 re-marque (l'extinction
 *     n'est pas un blanchiment) ;
 *  2. **budget** (#26) — N réponses publiques, puis validation humaine
 *     obligatoire : un agent en boucle ne peut pas publier indéfiniment ;
 *  3. **quarantaine** (#27) — au-delà d'un seuil de signaux, la session ne peut
 *     plus que **lire** ; seul un humain l'en fait sortir.
 *
 * Le rendu `capabilityPolicy` (#21) exprime tout cela comme une liste de
 * capacités à refuser / à confirmer, **sans nom de produit Atlassian** : c'est
 * ce que lira le hook (§11) comme un agent externe.
 *
 * Domaine pur : aucune E/S, aucune heure lue (`now` en paramètre), aucun import
 * `@forge/*`. Les motifs des trois gestes gardés du §9 viennent de
 * `requiresConfirmation` (`session.ts`) : une seule implémentation.
 */

import type { Language } from './types';
import type { GuardedAction } from './session';
import { requiresConfirmation } from './session';
import { t } from './i18n';
import {
  DEFAULT_SESSION_TTL_MS,
  expiresAt,
  isExpired,
  type SessionClaims,
} from './session-token';

/** Geste soumis à la politique : les trois du §9, la lecture, et deux sorties. */
export type PolicyAction = GuardedAction | 'read' | 'write-internal' | 'export-data';

/** Capacité produit-agnostique (#21) — nom stable, aucun produit cité. */
export type SessionCapability =
  | 'read'
  | 'search.broad'
  | 'reply.public'
  | 'net.fetch'
  | 'write.internal'
  | 'export.data';

/** Toutes les capacités, dans l'ordre du rendu (la lecture d'abord). */
export const SESSION_CAPABILITIES: readonly SessionCapability[] = [
  'read',
  'search.broad',
  'reply.public',
  'net.fetch',
  'write.internal',
  'export.data',
];

/** Une seule table dans chaque sens : geste ↔ capacité. */
const CAPABILITY_BY_ACTION: Record<PolicyAction, SessionCapability> = {
  'read': 'read',
  'broad-search': 'search.broad',
  'public-reply': 'reply.public',
  'fetch-url': 'net.fetch',
  'write-internal': 'write.internal',
  'export-data': 'export.data',
};

const ACTION_BY_CAPABILITY: Record<SessionCapability, PolicyAction> = {
  'read': 'read',
  'search.broad': 'broad-search',
  'reply.public': 'public-reply',
  'net.fetch': 'fetch-url',
  'write.internal': 'write-internal',
  'export.data': 'export-data',
};

/** Capacité d'un geste (§9) ; libellé lisible via `session.capability.*`. */
export function capabilityOf(action: PolicyAction): SessionCapability {
  return CAPABILITY_BY_ACTION[action];
}

/** Geste correspondant à une capacité — ce que le hook rejoue. */
export function actionOf(capability: SessionCapability): PolicyAction {
  return ACTION_BY_CAPABILITY[capability];
}

/** État de la politique : les affirmations du jeton (#23) plus les signaux. */
export interface SessionPolicyState extends SessionClaims {
  /** Signaux cumulés : refus humains, gestes sur ticket piégé, boucle (#30). */
  signals: number;
}

/** Réglages — tous écrits ici, aucun chiffre magique dans les décisions. */
export interface SessionPolicySettings {
  /** Inactivité avant extinction (#24). */
  ttlMs: number;
  /** Réponses publiques avant validation humaine obligatoire (#26). */
  publicReplyBudget: number;
  /** Signaux au-delà desquels la session ne peut plus que lire (#27). */
  quarantineThreshold: number;
}

/** Réglages par défaut : 30 min d'inactivité, 3 réponses publiques, 2 signaux. */
export const DEFAULT_SESSION_POLICY: SessionPolicySettings = {
  ttlMs: DEFAULT_SESSION_TTL_MS,
  publicReplyBudget: 3,
  quarantineThreshold: 2,
};

export type PolicyVerdict = 'allow' | 'ask' | 'deny';

/** Décision rendue au hook ou à l'outil (§11 : `permissionDecision`). */
export interface PolicyDecision {
  action: PolicyAction;
  capability: SessionCapability;
  decision: PolicyVerdict;
  /** Un humain doit trancher dans l'app : budget épuisé ou quarantaine. */
  humanReview: boolean;
  /** Motif lisible (`permissionDecisionReason`) ; vide si rien à dire. */
  reason: string;
  /** La session était éteinte au moment de la décision (#24). */
  expired: boolean;
}

/** Ce qu'il faut pour ouvrir une session marquée (dates injectées). */
export interface SessionStart {
  sessionRef: string;
  accountId: string;
  issueId: string;
  now: string;
}

/** Ouvre une session contaminée : budget vierge, aucun signal, non quarantaine. */
export function startSession(input: SessionStart): SessionPolicyState {
  return {
    sessionRef: input.sessionRef,
    accountId: input.accountId,
    issueId: input.issueId,
    taintedSince: input.now,
    lastActivityAt: input.now,
    publicRepliesUsed: 0,
    quarantine: false,
    signals: 0,
  };
}

/** Les affirmations signables (#23) : l'état moins les signaux, non signés. */
export function claimsOf(state: SessionPolicyState): SessionClaims {
  return {
    sessionRef: state.sessionRef,
    accountId: state.accountId,
    issueId: state.issueId,
    taintedSince: state.taintedSince,
    lastActivityAt: state.lastActivityAt,
    publicRepliesUsed: state.publicRepliesUsed,
    quarantine: state.quarantine,
  };
}

/** Reconstruit un état depuis des affirmations vérifiées (jeton #23). */
export function stateFrom(claims: SessionClaims, signals = 0): SessionPolicyState {
  return { ...claims, signals };
}

/** La session est-elle éteinte par inactivité (#24) ? */
export function isSessionExpired(
  state: SessionPolicyState,
  now: string,
  settings: SessionPolicySettings = DEFAULT_SESSION_POLICY,
): boolean {
  return isExpired(state, now, settings.ttlMs);
}

/** Réponses publiques encore libres avant validation humaine (#26), ≥ 0. */
export function remainingBudget(
  state: SessionPolicyState,
  settings: SessionPolicySettings = DEFAULT_SESSION_POLICY,
): number {
  const left = settings.publicReplyBudget - state.publicRepliesUsed;
  return left > 0 ? left : 0;
}

/** Minutes d'inactivité tolérées, pour le motif lisible de l'extinction. */
function ttlMinutes(settings: SessionPolicySettings): number {
  return Math.max(1, Math.round(settings.ttlMs / 60000));
}

/** Motif de confirmation d'un geste de sortie hors §9 (clé du catalogue). */
function extraAskReason(action: PolicyAction, state: SessionPolicyState, language: Language): string {
  const key = action === 'write-internal'
    ? 'session.decision.ask.write-internal'
    : 'session.decision.ask.export-data';
  return t(language, key, { issueId: state.issueId });
}

/**
 * Décide d'un geste. Ordre des verrous : extinction (#24) → quarantaine (#27) →
 * budget (#26) → confirmation du §9. La lecture n'est jamais refusée : c'est le
 * sens même de la quarantaine (« ne peut plus que lire »).
 */
export function decide(
  state: SessionPolicyState,
  action: PolicyAction,
  now: string,
  settings: SessionPolicySettings = DEFAULT_SESSION_POLICY,
  language: Language = 'fr',
): PolicyDecision {
  const capability = capabilityOf(action);
  const base = { action, capability, humanReview: false, expired: false };
  if (isSessionExpired(state, now, settings)) {
    const reason = action === 'read'
      ? ''
      : t(language, 'session.decision.expired', {
        minutes: ttlMinutes(settings),
        issueId: state.issueId,
      });
    return { ...base, decision: 'allow', reason, expired: true };
  }
  if (state.quarantine && action !== 'read') {
    return {
      ...base,
      decision: 'deny',
      humanReview: true,
      reason: t(language, 'session.decision.quarantine', {
        issueId: state.issueId,
        signals: state.signals,
      }),
    };
  }
  if (action === 'public-reply' && remainingBudget(state, settings) === 0) {
    return {
      ...base,
      decision: 'deny',
      humanReview: true,
      reason: t(language, 'session.decision.budget', {
        issueId: state.issueId,
        budget: settings.publicReplyBudget,
      }),
    };
  }
  if (action === 'read') return { ...base, decision: 'allow', reason: '' };
  return confirmDecision(base, state, action, language);
}

/** Confirmation du §9 : motifs existants pour les trois gestes gardés. */
function confirmDecision(
  base: Omit<PolicyDecision, 'decision' | 'reason'>,
  state: SessionPolicyState,
  action: PolicyAction,
  language: Language,
): PolicyDecision {
  if (action !== 'broad-search' && action !== 'public-reply' && action !== 'fetch-url') {
    return { ...base, decision: 'ask', reason: extraAskReason(action, state, language) };
  }
  const guarded = requiresConfirmation(
    {
      sessionRef: state.sessionRef,
      accountId: state.accountId,
      issueId: state.issueId,
      since: state.taintedSince,
    },
    action,
    language,
  );
  return {
    ...base,
    decision: guarded.required ? 'ask' : 'allow',
    reason: guarded.reason,
  };
}

/**
 * Consomme un geste autorisé : le TTL glissant repart de `now` (#24) et une
 * réponse publique entame le budget (#26). Un geste refusé ne consomme rien.
 */
export function applyGesture(
  state: SessionPolicyState,
  action: PolicyAction,
  now: string,
): SessionPolicyState {
  const used = action === 'public-reply' ? state.publicRepliesUsed + 1 : state.publicRepliesUsed;
  return { ...state, publicRepliesUsed: used, lastActivityAt: now };
}

/**
 * Ajoute un signal (refus humain, geste sur ticket piégé, boucle #30). Au seuil
 * (#27) la session passe en lecture seule ; la quarantaine est **collante** :
 * seul `releaseQuarantine` (revue humaine) l'en fait sortir.
 */
export function recordSignal(
  state: SessionPolicyState,
  now: string,
  settings: SessionPolicySettings = DEFAULT_SESSION_POLICY,
): SessionPolicyState {
  const signals = state.signals + 1;
  return {
    ...state,
    signals,
    quarantine: state.quarantine || signals >= settings.quarantineThreshold,
    lastActivityAt: now,
  };
}

/** Sortie de quarantaine : revue humaine, les signaux retombent à zéro. */
export function releaseQuarantine(state: SessionPolicyState, now: string): SessionPolicyState {
  return { ...state, quarantine: false, signals: 0, lastActivityAt: now };
}

/** Rend la liste des capacités, sans nom de produit : ce que lira le hook. */
function bucket(
  state: SessionPolicyState,
  now: string,
  settings: SessionPolicySettings,
  language: Language,
): Record<PolicyVerdict, SessionCapability[]> {
  const out: Record<PolicyVerdict, SessionCapability[]> = { allow: [], ask: [], deny: [] };
  for (const capability of SESSION_CAPABILITIES) {
    const verdict = decide(state, actionOf(capability), now, settings, language);
    out[verdict.decision].push(capability);
  }
  return out;
}

/** Rendu de la politique, indépendant du produit (#21). */
export interface CapabilityPolicy {
  /** Version du rendu : un hook qui ne la connaît pas doit refuser. */
  version: 1;
  sessionRef: string;
  accountId: string;
  issuedAt: string;
  /** Échéance du TTL (#24) ; `null` si la date est illisible. */
  expiresAt: string | null;
  quarantine: boolean;
  /** Capacités à refuser net. */
  denied: readonly SessionCapability[];
  /** Capacités soumises à confirmation humaine. */
  confirmation: readonly SessionCapability[];
  /** Capacités libres. */
  allowed: readonly SessionCapability[];
  /** Réponses publiques restantes avant validation humaine (#26). */
  publicRepliesLeft: number;
  /** Limites dites franchement (§21) — jamais une promesse. */
  limits: readonly string[];
}

/**
 * Politique complète d'une session, telle que le hook ou un agent externe la
 * lit : capacités refusées / à confirmer / libres, échéance, budget restant et
 * limites. Aucune donnée de ticket n'y figure — que des identifiants.
 */
export function capabilityPolicy(
  state: SessionPolicyState,
  now: string,
  settings: SessionPolicySettings = DEFAULT_SESSION_POLICY,
  language: Language = 'fr',
): CapabilityPolicy {
  const buckets = bucket(state, now, settings, language);
  return {
    version: 1,
    sessionRef: state.sessionRef,
    accountId: state.accountId,
    issuedAt: now,
    expiresAt: expiresAt(state, settings.ttlMs),
    quarantine: state.quarantine && !isSessionExpired(state, now, settings),
    denied: buckets.deny,
    confirmation: buckets.ask,
    allowed: buckets.allow,
    publicRepliesLeft: remainingBudget(state, settings),
    limits: [
      t(language, 'session.honesty.token'),
      t(language, 'session.honesty.policy'),
    ],
  };
}
