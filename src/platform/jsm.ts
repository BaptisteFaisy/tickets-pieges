/**
 * Ce que JSM ajoute à Jira — conversions pures vers les types du domaine.
 *
 * Aucune dépendance Forge : ce fichier est importé par les tests et par
 * `src/platform/jira.ts`. Il porte les faits vérifiés du §20 :
 *   - le canal de la demande vient du champ `request-channel-type`
 *     (sur un site JSM : `customfield_10030`) ; une valeur inconnue devient
 *     `unknown`, jamais une exception ;
 *   - la visibilité d'un commentaire JSM vient de la propriété
 *     `sd.public.comment` (`{ internal: true }` = interne) ;
 *   - le type de compte se lit dans l'`accountId` : les identifiants contenant
 *     `:` sont des apps, ceux commençant par `5d` des comptes clients JSM,
 *     ceux commençant par `5b` des comptes Atlassian du site.
 */

import type { AccountType, CommentVisibility, RequestChannel } from '../core/types';
import type { AccountSnapshot } from './schema';

// --------------------------------------------------------------- champs JSM

/** Identifiants de champs JSM usuels (varient peu d'un site à l'autre). */
export const JSM_FIELDS = {
  requestChannelType: 'customfield_10030',
  requestParticipants: 'customfield_10010',
  organizations: 'customfield_10014',
} as const;

// -------------------------------------------------------------------- canal

const CANONICAL_CHANNELS: Record<string, RequestChannel> = {
  jira: 'jira',
  portal: 'portal',
  anonymousportal: 'anonymousportal',
  email: 'email',
  api: 'API',
  deployment: 'deployment',
  unknown: 'unknown',
};

/**
 * Convertit la valeur brute de `request-channel-type` en `RequestChannel`.
 * Insensible à la casse ; toute valeur hors catalogue devient `unknown`
 * (exigence 5 du lot : jamais d'exception).
 */
export function toRequestChannel(value: unknown): RequestChannel {
  if (typeof value !== 'string') return 'unknown';
  const canonical = CANONICAL_CHANNELS[value.trim().toLowerCase()];
  return canonical ?? 'unknown';
}

// ---------------------------------------------------------------- visibilité

/** Propriété JSM qui porte la visibilité d'un commentaire (§20). */
export const VISIBILITY_PROPERTY = 'sd.public.comment';

/** Un commentaire est interne si `sd.public.comment.internal` est vrai. */
export function visibilityOfComment(properties: unknown): CommentVisibility {
  if (!Array.isArray(properties)) return 'public';
  for (const property of properties) {
    const entry = property as { key?: unknown; value?: unknown };
    if (entry.key !== VISIBILITY_PROPERTY) continue;
    const value = entry.value as { internal?: unknown } | null;
    if (value !== null && typeof value === 'object' && value.internal === true) return 'internal';
  }
  return 'public';
}

/** Corps de propriété à écrire pour régler la visibilité d'un commentaire. */
export function visibilityPropertyBody(visibility: CommentVisibility): { key: string; value: { internal: boolean } } {
  return { key: VISIBILITY_PROPERTY, value: { internal: visibility === 'internal' } };
}

// ------------------------------------------------------------- type de compte

/**
 * Type de compte d'après l'`accountId` (fait vérifié §20). `supportAgent`
 * (présence dans le rôle « Service Desk Team ») force `atlassian`.
 */
export function accountTypeOf(accountId: string, supportAgent = false): AccountType {
  if (accountId === '') return 'unknown';
  if (supportAgent) return 'atlassian';
  if (accountId.includes(':')) return 'app';
  if (accountId.startsWith('5d')) return 'customer';
  if (accountId.startsWith('5b')) return 'atlassian';
  return 'unknown';
}

/** Domaine de messagerie d'un compte, si renseigné — jamais l'adresse entière. */
export function emailDomainOf(email: unknown): string | undefined {
  if (typeof email !== 'string' || !email.includes('@')) return undefined;
  return email.slice(email.indexOf('@') + 1).toLowerCase();
}

/** Convertit un utilisateur brut REST en `AccountSnapshot` du domaine. */
export function toAccountSnapshot(raw: unknown, supportAgent = false): AccountSnapshot {
  const user = (raw ?? {}) as Record<string, unknown>;
  const accountId = typeof user.accountId === 'string' ? user.accountId : '';
  const snapshot: AccountSnapshot = {
    accountId,
    accountType: accountTypeOf(accountId, supportAgent),
  };
  if (typeof user.displayName === 'string') snapshot.displayName = user.displayName;
  const domain = emailDomainOf(user.emailAddress);
  if (domain !== undefined) snapshot.emailDomain = domain;
  if (typeof user.created === 'string') snapshot.accountCreatedAt = user.created;
  if (supportAgent) snapshot.supportAgent = true;
  return snapshot;
}

// ------------------------------------------------------- organisation, équipe

/** Noms d'organisation du ticket (champ `Organizations`, chaînes brutes). */
export function organizationNamesOf(fields: Record<string, unknown>, fieldId = JSM_FIELDS.organizations): string[] {
  const value = fields[fieldId];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter((name) => name !== '');
}

/** Participants de la demande (champ `Request participants`, utilisateurs). */
export function participantsOf(fields: Record<string, unknown>, fieldId = JSM_FIELDS.requestParticipants): AccountSnapshot[] {
  const value = fields[fieldId];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toAccountSnapshot(entry));
}

// ---------------------------------------------------------------- texte ADF

/**
 * Extrait le texte d'un document Atlassian (ADF) : les commentaires et la
 * description arrivent en blocs, jamais en chaîne nue (`docs/FORGE.md` §4).
 * Toute structure inconnue rend `''` — jamais d'exception.
 */
export function adfToText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!isRecord(node)) return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return '\n';
  if (!Array.isArray(node.content)) return '';
  const parts = node.content.map(adfToText).join('');
  return node.type === 'paragraph' || node.type === 'heading' ? `${parts}\n` : parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Construit le paragraphe ADF minimal qui porte un texte (écriture REST). */
export function textToAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}
