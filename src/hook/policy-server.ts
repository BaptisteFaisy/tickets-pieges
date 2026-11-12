/**
 * Serveur de politique (#29) — le droit applicable, en lecture seule.
 *
 * Un agent **externe** (Claude Code, Cursor, Copilot, Cline, ZeroClaw…) peut
 * demander à l'app ce qu'il a le droit de faire sur un ticket **avant** d'agir,
 * au lieu de découvrir le refus après coup. L'outil est une action MCP en
 * lecture (verbe `GET`, §16) : il n'écrit rien, ne change aucun état, et ne
 * rend aucun texte de ticket.
 *
 * Trois règles tiennent l'ensemble :
 *  - **la politique ne se déclare pas elle-même** : l'appelant donne des
 *    identifiants (`issueKey`, `sessionRef`), jamais son niveau de confiance ni
 *    son mode — tout ce qu'il déclare sur ces champs est ignoré et signalé en
 *    avertissement, sinon un agent s'auto-attribuerait `T3` ;
 *  - **une seule source de vérité** : la décision sur la réponse publique est
 *    celle du hook d'écriture (`src/hook/outbound.ts`), réutilisé, pas recopié ;
 *  - **aucun jeton rendu** : seule son empreinte SHA-256 figure dans la
 *    réponse, pour que l'appelant vérifie qu'il parle au bon serveur.
 *
 * Domaine pur : aucune E/S ici, l'accès aux données passe par le port
 * `PolicyReader` injecté par l'appelant (le handler, ou un double en test).
 */

import type {
  Language,
  ProtectionMode,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
} from '../core/types';
import { isExternal } from '../core/levels';
import { t } from '../core/i18n';
import type { JsonPayload, Tool } from '../mcp/result';
import { optionalText, requireText, run } from '../mcp/result';
import { tokenFingerprint } from './token';
import { buildOutboundResponse } from './outbound';
import type { OutboundTicketData } from './outbound';

/** Un geste qu'un agent peut demander. Vocabulaire propre à ce fichier (#21). */
export type PolicyCapability =
  | 'read-ticket'
  | 'public-reply'
  | 'internal-note'
  | 'attachment'
  | 'field-write'
  | 'external-link'
  | 'bulk-action';

export const POLICY_CAPABILITIES: readonly PolicyCapability[] = [
  'read-ticket',
  'public-reply',
  'internal-note',
  'attachment',
  'field-write',
  'external-link',
  'bulk-action',
];

/** `allow` : libre. `human` : un humain relit. `deny` : rien ne part. */
export type PolicyDecision = 'allow' | 'human' | 'deny';

/** Ce que l'app sait du ticket et de la session — jamais déclaré par l'agent. */
export interface PolicyFacts {
  issueKey: string;
  language: Language;
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  modeApplied: ProtectionMode;
  strictOutbound: boolean;
  sessionTainted: boolean;
  unanalyzed: UnanalyzedReason[];
}

/** Port de lecture injecté : une seule méthode, donc structurellement en lecture. */
export interface PolicyReader {
  facts(issueKey: string, sessionRef: string | null): Promise<PolicyFacts | null>;
}

/** Une ligne de la politique : un geste et son sort. */
export interface PolicyRule {
  capability: PolicyCapability;
  decision: PolicyDecision;
  /** Motif lisible, quand une source en produit un (réponse publique). */
  reason: string | null;
}

/** La politique rendue : ce qui est permis, ce qui exige un humain, ce qui est interdit. */
export interface PolicyStatement {
  version: 1;
  issueKey: string;
  sessionRef: string | null;
  known: boolean;
  trustLevel: TrustLevel | null;
  suspicionLevel: SuspicionLevel | null;
  modeApplied: ProtectionMode | null;
  sessionTainted: boolean;
  rules: PolicyRule[];
  allowed: PolicyCapability[];
  requiresHuman: PolicyCapability[];
  denied: PolicyCapability[];
  unanalyzed: UnanalyzedReason[];
  notes: string[];
  tokenFingerprint: string | null;
}

/** Champs que l'appelant n'a pas à déclarer : l'app les connaît, eux non. */
const SELF_DECLARED: readonly string[] = [
  'trustLevel',
  'suspicionLevel',
  'modeApplied',
  'strictOutbound',
  'sessionTainted',
  'token',
];

/** Décision sur la réponse publique : exactement celle du hook d'écriture. */
function publicReplyDecision(facts: PolicyFacts): PolicyRule {
  const data: OutboundTicketData = {
    issueKey: facts.issueKey,
    language: facts.language,
    trustLevel: facts.trustLevel,
    suspicionLevel: facts.suspicionLevel,
    strictOutbound: facts.strictOutbound,
    sessionTainted: facts.sessionTainted,
  };
  const request = { toolName: 'policy', toolInput: { issueKey: facts.issueKey } };
  const output = buildOutboundResponse(request, data).hookSpecificOutput;
  const decision = output.permissionDecision;
  const mapped: PolicyDecision = decision === 'allow' ? 'allow' : decision === 'ask' ? 'human' : 'deny';
  return {
    capability: 'public-reply',
    decision: mapped,
    reason: decision === 'allow' ? null : output.permissionDecisionReason,
  };
}

/** Écriture de champ : une demande externe piégée ou une session contaminée interdit. */
function fieldWriteDecision(facts: PolicyFacts): PolicyDecision {
  if (!isExternal(facts.trustLevel)) return 'allow';
  return facts.suspicionLevel === 'trapped' || facts.sessionTainted ? 'deny' : 'human';
}

/** Lien sortant : la liste de domaines vit dans le sas, ici on dit qui décide. */
function externalLinkDecision(facts: PolicyFacts): PolicyDecision {
  if (facts.suspicionLevel === 'trapped') return 'deny';
  return isExternal(facts.trustLevel) ? 'human' : 'allow';
}

/** Geste en masse : une fuite de masse est bruyante, jamais automatique. */
function bulkActionDecision(facts: PolicyFacts): PolicyDecision {
  if (facts.suspicionLevel === 'trapped' || facts.sessionTainted) return 'deny';
  return isExternal(facts.trustLevel) ? 'human' : 'allow';
}

/** Décide d'un geste, hors réponse publique (traitée par le hook). */
export function decide(capability: PolicyCapability, facts: PolicyFacts): PolicyDecision {
  switch (capability) {
    case 'read-ticket':
      return 'allow'; // lire un contenu encadré est le but du produit (§8.2)
    case 'internal-note':
      return facts.suspicionLevel === 'trapped' ? 'human' : 'allow';
    case 'attachment':
      return isExternal(facts.trustLevel) ? 'human' : 'allow';
    case 'field-write':
      return fieldWriteDecision(facts);
    case 'external-link':
      return externalLinkDecision(facts);
    case 'bulk-action':
      return bulkActionDecision(facts);
    default:
      return 'human';
  }
}

/** Ticket inconnu de l'app : rien n'est automatique (§21, pas de fausse assurance). */
function unknownRules(): PolicyRule[] {
  return POLICY_CAPABILITIES.map((capability) => ({
    capability,
    decision: capability === 'bulk-action' ? ('deny' as PolicyDecision) : ('human' as PolicyDecision),
    reason: null,
  }));
}

/** Construit l'énoncé de politique : pur, déterministe, sans texte de ticket. */
export function describePolicy(
  facts: PolicyFacts | null,
  input: { sessionRef: string | null; language: Language; token?: string },
): PolicyStatement {
  // La langue du ticket (réglage du projet, §14) l'emporte ; à défaut — ticket
  // inconnu de l'app — c'est celle demandée par l'appelant.
  const language = facts?.language ?? input.language;
  const rules = facts
    ? POLICY_CAPABILITIES.map((capability) =>
        capability === 'public-reply'
          ? publicReplyDecision(facts)
          : { capability, decision: decide(capability, facts), reason: null },
      )
    : unknownRules();
  return assemble(rules, facts, input.sessionRef, language, input.token);
}

/** Regroupe les règles par sort et ajoute les mentions d'honnêteté (§21). */
function assemble(
  rules: PolicyRule[],
  facts: PolicyFacts | null,
  sessionRef: string | null,
  language: Language,
  token?: string,
): PolicyStatement {
  const by = (decision: PolicyDecision) =>
    rules.filter((rule) => rule.decision === decision).map((rule) => rule.capability);
  const notes: string[] = [
    t(language, 'hook.policy.heading', {
      sessionRef: sessionRef ?? '-',
      issueKey: facts?.issueKey ?? '-',
    }),
    t(language, 'hook.policy.allowed', { list: by('allow').join(', ') || '-' }),
    t(language, 'hook.policy.human', { list: by('human').join(', ') || '-' }),
    t(language, 'hook.policy.denied', { list: by('deny').join(', ') || '-' }),
    t(language, 'hook.policy.readonly'),
  ];
  if (!facts) notes.push(t(language, 'hook.policy.unknown'));
  if (facts && facts.unanalyzed.length > 0) {
    notes.push(t(language, 'hook.policy.unanalyzed', { list: facts.unanalyzed.join(', ') }));
  }
  if (token) notes.push(t(language, 'hook.policy.token', { fingerprint: tokenFingerprint(token) }));
  return {
    version: 1,
    issueKey: facts?.issueKey ?? '',
    sessionRef,
    known: facts !== null,
    trustLevel: facts?.trustLevel ?? null,
    suspicionLevel: facts?.suspicionLevel ?? null,
    modeApplied: facts?.modeApplied ?? null,
    sessionTainted: facts?.sessionTainted ?? false,
    rules,
    allowed: by('allow'),
    requiresHuman: by('human'),
    denied: by('deny'),
    unanalyzed: facts?.unanalyzed ?? [],
    notes,
    tokenFingerprint: token ? tokenFingerprint(token) : null,
  };
}

/** Rendu texte de la politique : JSON à deux espaces, ce que l'agent affiche. */
export function renderPolicy(statement: PolicyStatement): string {
  return JSON.stringify(statement, null, 2);
}

/** Avertissements pour tout ce que l'appelant a déclaré à tort (§16). */
export function declaredFieldWarnings(payload: JsonPayload): string[] {
  return SELF_DECLARED.filter((key) => payload[key] !== undefined).map(
    (key) => `le champ « ${key} » déclaré par l'appelant est ignoré`,
  );
}

export interface PolicyToolOptions {
  language?: Language;
  /** Jeton du poste : seule son empreinte est rendue, jamais sa valeur. */
  token?: string;
}

/** Enveloppe rendue par l'outil : l'énoncé et son rendu texte. */
export interface PolicyEnvelope {
  statement: PolicyStatement;
  rendered: string;
}

/**
 * Fabrique l'action MCP `get-policy` (verbe `GET`) : lecture seule, aucune
 * exception ne sort (§16). Le branchement au manifeste et à `MCP_TOOLS` reste à
 * faire dans le tronc — ce fichier fournit l'outil prêt à enregistrer.
 */
export function createPolicyTool(reader: PolicyReader, options: PolicyToolOptions = {}): Tool {
  return (payload: JsonPayload) =>
    run(async () => {
      const issueKey = requireText(payload, 'issueKey');
      const sessionRef = optionalText(payload, 'sessionRef');
      const facts = await reader.facts(issueKey, sessionRef);
      const statement = describePolicy(facts, {
        sessionRef,
        language: options.language ?? 'fr',
        token: options.token,
      });
      const envelope: PolicyEnvelope = { statement, rendered: renderPolicy(statement) };
      return envelope;
    }, declaredFieldWarnings(payload));
}
