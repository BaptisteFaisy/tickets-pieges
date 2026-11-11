/**
 * Origine d'un segment (§5, TP-01) — déterministe, sans aucun modèle.
 *
 * « Chaque segment reçoit un niveau de confiance, calculé sans aucun modèle, à
 * partir de faits que Jira connaît. » Les trois règles du cahier sont appliquées
 * dans cet ordre :
 *
 *  1. **Externe par défaut** — tout ce qui n'est pas prouvé interne est externe ;
 *  2. **Une intégration n'est pas une personne de confiance** — un compte d'app
 *     vaut T0 sauf inscription sur la liste des intégrations de confiance ;
 *  3. **L'origine est celle de l'auteur, pas celle des mots** — un agent interne
 *     qui colle le courriel d'un client produit un texte T3 (la détection, elle,
 *     s'applique à tous les textes : c'est le rôle des couches C1 à C4).
 *
 * Chaque décision rend ses raisons (codes stables = clés i18n) : l'interface les
 * traduit, le journal les conserve, et un réglage se discute preuve à l'appui.
 */

import type {
  AccountType,
  AuthorContext,
  OriginReason,
  ProjectSettings,
  RequestChannel,
  SegmentOrigin,
  SegmentSource,
  TrustLevel,
} from './types';
import { lowestOf } from './levels';
import { isTrustedDomain, isTrustedIntegration, isTrustedOrganization } from './trust-rules';

/** Une raison : code stable + détail brut (jamais traduit ici). */
function reason(code: string, detail?: string): OriginReason {
  return detail === undefined ? { code } : { code, detail };
}

interface Decision {
  level: TrustLevel;
  reasons: OriginReason[];
}

/**
 * Niveau de confiance d'un segment. C'est la seule fonction de décision : tout
 * le reste du produit la consulte (bandeau, modes, sas, hook, rapports).
 */
export function decideTrust(source: SegmentSource, settings: ProjectSettings): Decision {
  const { author, channel } = source;
  if (author.accountType === 'app') return decideApp(author, settings);
  if (channel === 'anonymousportal') {
    return { level: 'T0', reasons: [reason('origin.anonymous-portal', channel)] };
  }
  if (author.accountType === 'atlassian') return decideInternal(author);
  if (author.accountType === 'customer') return decideCustomer(author, channel, settings);
  return decideUnknown(author, channel);
}

/** Règle 2 du §5 : un compte d'app est une machine, sauf liste de confiance. */
function decideApp(author: AuthorContext, settings: ProjectSettings): Decision {
  if (isTrustedIntegration(author.accountId, author.displayName, settings)) {
    return {
      level: 'T2',
      reasons: [reason('origin.trusted-integration', author.displayName ?? author.accountId)],
    };
  }
  return {
    level: 'T0',
    reasons: [reason('origin.app-account', author.displayName ?? author.accountId)],
  };
}

/** T3 : compte de l'organisation, agent de support, collègue (§5). */
function decideInternal(author: AuthorContext): Decision {
  const code = author.supportAgent ? 'origin.support-agent' : 'origin.internal-account';
  return { level: 'T3', reasons: [reason(code, author.accountId)] };
}

/** Compte client du portail : T2 si partenaire connu, T1 sinon, T0 par courriel inconnu. */
function decideCustomer(
  author: AuthorContext,
  channel: RequestChannel,
  settings: ProjectSettings,
): Decision {
  if (author.organizationTrusted || isTrustedOrganization(author.organizationId, author.organizationName, settings)) {
    return {
      level: 'T2',
      reasons: [reason('origin.trusted-organization', author.organizationName ?? author.organizationId)],
    };
  }
  if (author.emailDomain && isTrustedDomain(author.emailDomain, settings)) {
    return { level: 'T2', reasons: [reason('origin.trusted-domain', author.emailDomain)] };
  }
  if (channel === 'email') {
    return { level: 'T0', reasons: [reason('origin.unknown-email', author.emailDomain ?? 'domaine inconnu')] };
  }
  return { level: 'T1', reasons: [reason('origin.customer-portal', channel)] };
}

/** Règle 1 du §5 : type de compte inconnu ⇒ externe, et machine si rien ne prouve une personne. */
function decideUnknown(author: AuthorContext, channel: RequestChannel): Decision {
  if (channel === 'email' || channel === 'deployment') {
    return { level: 'T0', reasons: [reason('origin.machine-channel', channel)] };
  }
  if (author.accountId) {
    return { level: 'T1', reasons: [reason('origin.unknown-account', author.accountId)] };
  }
  return { level: 'T0', reasons: [reason('origin.unidentified-author')] };
}

/**
 * Origine complète d'un segment : niveau, raisons, et les faits bruts qui
 * permettent de rejouer la décision (audit, écran, journal).
 */
export function computeOrigin(source: SegmentSource, settings: ProjectSettings): SegmentOrigin {
  const decision = decideTrust(source, settings);
  const reasons = [...decision.reasons, reason('origin.channel', source.channel)];
  if (source.visibility) reasons.push(reason('origin.visibility', source.visibility));
  return {
    field: source.field,
    refId: source.refId,
    authorAccountId: source.author.accountId,
    accountType: source.author.accountType,
    organizationId: source.author.organizationId,
    channel: source.channel,
    visibility: source.visibility,
    trustLevel: decision.level,
    reasons,
  };
}

/** Origine de chaque segment d'une demande (TP-01 : création et chaque commentaire). */
export function computeOrigins(
  sources: SegmentSource[],
  settings: ProjectSettings,
): SegmentOrigin[] {
  return sources.map((source) => computeOrigin(source, settings));
}

/** Niveau de confiance d'un ticket : le plus bas de ses segments (§12). */
export function issueTrustLevel(origins: SegmentOrigin[]): TrustLevel {
  if (origins.length === 0) return 'T0';
  return lowestOf(origins.map((origin) => origin.trustLevel));
}

/** Le type de compte, tel que la plateforme le donne (§20) — jamais deviné ici. */
export function accountTypeOf(raw: string | undefined): AccountType {
  switch (raw) {
    case 'atlassian':
    case 'app':
    case 'customer':
      return raw;
    default:
      return 'unknown';
  }
}

/** Le canal de la demande, tel que la propriété `request-channel-type` le donne (§20). */
export function channelOf(raw: string | undefined): RequestChannel {
  switch ((raw ?? '').toLowerCase()) {
    case 'jira':
    case 'portal':
    case 'anonymousportal':
    case 'email':
    case 'api':
    case 'deployment':
      return raw?.toLowerCase() === 'api' ? 'API' : (raw?.toLowerCase() as RequestChannel);
    default:
      return 'unknown';
  }
}
