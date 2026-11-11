/**
 * Hook d'écriture (`PreToolUse`, §11) — confirmation avant une réponse publique.
 *
 * Une réponse publique sur une demande externe ne part pas sans relecture :
 * le hook rend `permissionDecision: 'ask'` avec un motif lisible qui cite la
 * clé du ticket, et le client demande à l'humain avant d'exécuter l'outil.
 * Dans une session contaminée (§9 : elle a lu du contenu non vérifié), le
 * motif le dit explicitement — c'est le cas le plus dangereux.
 *
 * Décisions rendues :
 *  - `deny` : demande externe piégée en mode strict — rien ne part (§8.1) ;
 *  - `ask`  : écriture publique sur une demande externe (T0/T1) ;
 *  - `allow` : note interne (rien ne sort), ou demande d'origine interne.
 *
 * Domaine pur : aucune E/S, aucune heure lue, aucun `@forge/*`. Le handler
 * apporte l'état du ticket et la marque de session ; ce fichier rend la réponse
 * exacte attendue par le client.
 */

import type {
  HookOutboundRequest,
  HookOutboundResponse,
  Language,
  SuspicionLevel,
  TrustLevel,
} from '../core/types';
import { isExternal } from '../core/levels';
import { t } from '../core/i18n';

/** Une clé de ticket Jira dans `toolInput` (mêmes champs usuels qu'en lecture). */
const KEY_FIELDS = ['issueKey', 'issue_key', 'issueId', 'issue_id', 'key'] as const;

/** Ce que le handler sait du ticket visé par l'écriture. */
export interface OutboundTicketData {
  issueKey: string;
  language: Language;
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  /** Mode strict du projet (§8.1) : une demande piégée ne répond plus. */
  strictOutbound: boolean;
  /** La session de l'agent a lu du contenu non vérifié (§9). */
  sessionTainted: boolean;
}

/** L'écriture visée est-elle publique ? Une note interne ne sort pas. */
export function isPublicWrite(toolInput: Record<string, unknown>): boolean {
  const visibility = toolInput.visibility ?? toolInput.commentVisibility;
  // `internal` : note visible des seuls agents ; `restricted-administer` :
  // visibilité restreinte côté Jira. Dans les deux cas, rien ne sort.
  return visibility !== 'internal' && visibility !== 'restricted-administer';
}

/** Clé du ticket visé par l'écriture, ou `null` si absente de `toolInput`. */
export function issueKeyOf(request: HookOutboundRequest): string | null {
  for (const field of KEY_FIELDS) {
    const value = request.toolInput?.[field];
    if (typeof value === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(value)) return value;
  }
  return null;
}

/** Motif lisible de la décision `ask` — cite la clé, dit la contamination. */
function askReason(data: OutboundTicketData): string {
  const key = data.sessionTainted ? 'hook.outbound.ask.tainted' : 'hook.outbound.ask';
  return t(data.language, key, { issueKey: data.issueKey });
}

/**
 * Décision `PreToolUse` : la forme exacte du §11 —
 * `hookSpecificOutput { hookEventName, permissionDecision, permissionDecisionReason }`.
 */
export function buildOutboundResponse(
  request: HookOutboundRequest,
  data: OutboundTicketData,
): HookOutboundResponse {
  let decision: 'allow' | 'ask' | 'deny' = 'allow';
  let reason = '';
  if (!isPublicWrite(request.toolInput ?? {})) {
    decision = 'allow'; // note interne : rien ne sort, pas de relecture due
  } else if (!isExternal(data.trustLevel)) {
    decision = 'allow'; // demande d'origine interne (T2/T3)
  } else if (data.suspicionLevel === 'trapped' && data.strictOutbound) {
    decision = 'deny';
    reason = t(data.language, 'hook.outbound.deny', { issueKey: data.issueKey });
  } else {
    decision = 'ask';
    reason = askReason(data);
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}
