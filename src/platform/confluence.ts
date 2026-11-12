/**
 * Confluence — conversions pures vers les types du domaine (TP-26 : pages et
 * commentaires rédigés par des invités).
 *
 * Même séparation que `src/platform/jsm.ts` : ce fichier ne fait aucun appel
 * réseau par lui-même. Le port REST (`createConfluencePort`) reçoit un invoker
 * injecté ; en production, `src/jobs/confluence.ts` le branche sur `@forge/api`
 * (`requestConfluence`), en test sur un faux. Aucune donnée ne sort
 * d'Atlassian (§21).
 *
 * Faits portés ici :
 *   - une page Confluence devient une « demande » du domaine : `issueId`
 *     préfixé `confluence:`, `issueKey` lisible `CONF-<espace>-<pageId>`,
 *     `projectKey` = clé d'espace (les réglages du §7 sont par espace) ;
 *   - un auteur invité (compte `guest`, ou anonyme sans `accountId`) est
 *     `unknown` pour le domaine : l'origine (§5) le classe T0 — externe par
 *     défaut, jamais T3 ;
 *   - une page restreinte (restrictions de lecture) porte ses segments en
 *     visibilité `internal` : l'origine le journalise dans ses raisons ;
 *   - Confluence n'est pas dans le catalogue `RequestChannel` de `types.ts`
 *     (non modifiable par ce lot) : le canal est `unknown`, ce qui n'élève
 *     jamais la confiance.
 */

import type { CommentVisibility, RequestChannel, SegmentSource } from '../core/types';
import type { AccountSnapshot } from './schema';
import { accountTypeOf, emailDomainOf } from './jsm';

// ------------------------------------------------------------------- vues REST

/** Auteur brut d'une page ou d'un commentaire Confluence. */
export interface ConfluenceUserView {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  /** Type déclaré par la plateforme : `atlassian`, `customer`, `app`, `guest`. */
  accountType?: string;
  /** Drapeau invité posé par l'API (comptes invités Confluence, TP-26). */
  isGuest?: boolean;
}

/** Page Confluence, convertie en vue stable du domaine. */
export interface ConfluencePageView {
  id: string;
  spaceKey: string;
  title: string;
  body: string;
  author: AccountSnapshot;
  createdAt: string;
  version: number;
  restricted: boolean;
}

/** Commentaire de page Confluence. */
export interface ConfluenceCommentView {
  id: string;
  body: string;
  author: AccountSnapshot;
  createdAt: string;
}

/** Pièce jointe d'une page : son texte n'est pas extrait ici (lot fichiers). */
export interface ConfluenceAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  author: AccountSnapshot;
  createdAt: string;
}

/** Ce dont les jobs ont besoin côté Confluence — implémenté par le port REST. */
export interface ConfluencePort {
  getPage(pageId: string): Promise<ConfluencePageView>;
  listComments(pageId: string): Promise<ConfluenceCommentView[]>;
  listAttachments(pageId: string): Promise<ConfluenceAttachmentView[]>;
  addComment(pageId: string, body: string): Promise<string>;
  updateComment(commentId: string, body: string): Promise<void>;
  updatePageBody(pageId: string, title: string, body: string, version: number): Promise<void>;
  setProperty(pageId: string, key: string, value: unknown): Promise<void>;
  addLabel(pageId: string, name: string): Promise<void>;
}

// ------------------------------------------------------------- identité (TP-26)

/** Identifiant interne d'une page, dans le même espace de noms que les tickets. */
export function pageIssueId(pageId: string): string {
  return `confluence:${pageId}`;
}

/** Clé lisible d'une page : l'équivalent du `SUP-482` de Jira. */
export function pageIssueKey(page: { spaceKey: string; id: string }): string {
  return `CONF-${page.spaceKey}-${page.id}`;
}

// ----------------------------------------------------------------- auteur invité

/** Un auteur est invité s'il est anonyme ou marqué `guest` par la plateforme. */
export function isGuestUser(user: ConfluenceUserView): boolean {
  if (user.isGuest === true) return true;
  const declared = (user.accountType ?? '').toLowerCase();
  if (declared === 'guest' || declared === 'anonymous') return true;
  return (user.accountId ?? '').trim().length === 0;
}

/**
 * Instantané de compte d'un auteur Confluence. Réutilise la heuristique
 * d'`accountId` de `jsm.ts` (un seul algorithme) ; un invité devient
 * `unknown` sans identifiant : l'origine le classe T0 (§5).
 */
export function toConfluenceSnapshot(user: ConfluenceUserView): AccountSnapshot {
  const displayName = user.displayName;
  if (isGuestUser(user)) {
    const snapshot: AccountSnapshot = { accountId: '', accountType: 'unknown' };
    if (displayName !== undefined) snapshot.displayName = displayName;
    return snapshot;
  }
  const accountId = user.accountId ?? '';
  const declared = (user.accountType ?? '').toLowerCase();
  const snapshot: AccountSnapshot = {
    accountId,
    accountType: declared === 'atlassian' ? 'atlassian' : accountTypeOf(accountId),
  };
  if (displayName !== undefined) snapshot.displayName = displayName;
  const domain = emailDomainOf(user.emailAddress);
  if (domain !== undefined) snapshot.emailDomain = domain;
  return snapshot;
}

/** Visibilité des segments d'une page : restreinte = interne, sinon publique. */
export function pageVisibility(restricted: boolean): CommentVisibility | undefined {
  return restricted ? 'internal' : undefined;
}

// ---------------------------------------------------------------- texte storage

/** Plafond de texte extrait d'une page : le domaine est borné (§22). */
export const MAX_STORAGE_CHARS = 20_000;

const NBSP = String.fromCharCode(160);

/**
 * Extrait le texte lisible du `storage format` (XHTML) d'une page ou d'un
 * commentaire. Aucune exécution : les balises sont retirées, les entités
 * courantes décodées, le texte borné. Ce qui n'est pas convertible est perdu —
 * et le job le déclare dans `unanalyzed` (§21), jamais tu en silence.
 */
export function storageToText(storage: unknown): string {
  if (typeof storage !== 'string') return '';
  const withoutTags = storage.replace(/<[^>]*>/g, ' ');
  const decoded = withoutTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, NBSP)
    .replace(/&amp;/g, '&');
  return decoded.replace(/\s+/g, ' ').trim().slice(0, MAX_STORAGE_CHARS);
}

// ------------------------------------------------------------------- segments

/**
 * Les segments d'une page (§4) : titre, corps, chaque commentaire. Même forme
 * que `segmentsOf` pour Jira — le moteur en aval (origine, C1/C2/C4, encadrement)
 * est exactement le même.
 */
export function confluenceSegments(
  page: ConfluencePageView,
  comments: readonly ConfluenceCommentView[],
): SegmentSource[] {
  const base = {
    issueId: pageIssueId(page.id),
    issueKey: pageIssueKey(page),
    projectKey: page.spaceKey,
    channel: 'unknown' as RequestChannel,
    createdAt: page.createdAt,
  };
  const visibility = pageVisibility(page.restricted);
  const segments: SegmentSource[] = [
    { ...base, field: 'summary', text: page.title, author: page.author, visibility },
    { ...base, field: 'description', text: page.body, author: page.author, visibility },
  ];
  for (const comment of comments) {
    segments.push({
      ...base,
      field: 'comment',
      refId: comment.id,
      text: comment.body,
      author: comment.author,
      visibility: visibility ?? 'public',
      createdAt: comment.createdAt,
    });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** Rend du texte brut au format storage (XHTML) : écriture de bandeau, neutralisation. */
export function textToStorage(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${line}</p>`)
    .join('');
}

/** Pièce jointe REST v1 (`metadata.mediaType`, `extensions.size`). */
export function parseAttachment(raw: unknown): ConfluenceAttachmentView {
  const file = asRecord(raw);
  const metadata = asRecord(file.metadata);
  const extensions = asRecord(file.extensions);
  const version = asRecord(file.version);
  const history = asRecord(file.history);
  return {
    id: stringOf(file.id),
    fileName: stringOf(file.title),
    mimeType: stringOf(metadata.mediaType, 'application/octet-stream'),
    sizeBytes: typeof extensions.size === 'number' ? extensions.size : 0,
    author: toConfluenceSnapshot(userOf(version.by, file.author)),
    createdAt: stringOf(version.when, stringOf(history.createdDate)),
  };
}

// ------------------------------------------------------------- parsing REST brut

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function stringOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function storageBodyOf(raw: Json): string {
  return storageToText(asRecord(asRecord(raw.body).storage).value);
}

function userOf(...candidates: unknown[]): ConfluenceUserView {
  for (const candidate of candidates) {
    const user = asRecord(candidate);
    if (Object.keys(user).length > 0) return user as ConfluenceUserView;
  }
  return {};
}

/** Page REST v1 (`expand=body.storage,version,space,restrictions.read,history`). */
export function parsePage(raw: unknown): ConfluencePageView {
  const page = asRecord(raw);
  const version = asRecord(page.version);
  const history = asRecord(page.history);
  const restrictions = asRecord(asRecord(page.restrictions).read);
  const readRules = restrictions.results;
  return {
    id: stringOf(page.id),
    spaceKey: stringOf(asRecord(page.space).key),
    title: stringOf(page.title),
    body: storageBodyOf(page),
    author: toConfluenceSnapshot(userOf(version.by, page.author)),
    createdAt: stringOf(history.createdDate, stringOf(page.createdAt)),
    version: typeof version.number === 'number' ? version.number : 1,
    restricted: Array.isArray(readRules) && readRules.length > 0,
  };
}

/** Commentaire REST v1 (`expand=body.storage,version`). */
export function parseComment(raw: unknown): ConfluenceCommentView {
  const comment = asRecord(raw);
  const version = asRecord(comment.version);
  return {
    id: stringOf(comment.id),
    body: storageBodyOf(comment),
    author: toConfluenceSnapshot(userOf(version.by, comment.author)),
    createdAt: stringOf(version.when, stringOf(comment.createdAt)),
  };
}

/** Liste paginée Confluence : `results` absent ou invalide → liste vide. */
export function parseResults(raw: unknown): Json[] {
  const results = asRecord(raw).results;
  return Array.isArray(results) ? (results as Json[]) : [];
}

// -------------------------------------------------------------------- port REST

/** Invoker injecté : en production `requestConfluence`, en test un faux. */
export type ConfluenceInvoker = (path: string, init?: { method?: string; body?: string }) => Promise<unknown>;

const PAGE_EXPAND = 'body.storage,version,space,restrictions.read,history';
const COMMENT_EXPAND = 'body.storage,version';

function contentPath(pageId: string): string {
  return `/wiki/rest/api/content/${pageId}`;
}

function storagePayload(value: string): string {
  return JSON.stringify({ body: { storage: { value, representation: 'storage' } } });
}

/**
 * Le port Confluence sur un invoker : mêmes chemins REST que la documentation
 * Forge, réponses converties par les `parse*` ci-dessus. Une réponse invalide
 * devient une vue vide — jamais d'exception non maîtrisée dans un handler.
 */
export function createConfluencePort(invoker: ConfluenceInvoker): ConfluencePort {
  return { ...portReaders(invoker), ...portWriters(invoker) };
}

function portReaders(
  invoker: ConfluenceInvoker,
): Pick<ConfluencePort, 'getPage' | 'listComments' | 'listAttachments'> {
  return {
    async getPage(pageId) {
      const raw = await invoker(`${contentPath(pageId)}?expand=${PAGE_EXPAND}`);
      return parsePage(raw);
    },
    async listComments(pageId) {
      const raw = await invoker(`${contentPath(pageId)}/child/comment?expand=${COMMENT_EXPAND}`);
      return parseResults(raw).map((entry) => parseComment(entry));
    },
    async listAttachments(pageId) {
      const raw = await invoker(`${contentPath(pageId)}/child/attachment`);
      return parseResults(raw).map((entry) => parseAttachment(entry));
    },
  };
}

function portWriters(
  invoker: ConfluenceInvoker,
): Pick<ConfluencePort, 'addComment' | 'updateComment' | 'updatePageBody' | 'setProperty' | 'addLabel'> {
  return {
    async addComment(pageId, body) {
      const raw = await invoker(`${contentPath(pageId)}/child/comment`, {
        method: 'POST',
        body: storagePayload(body),
      });
      return stringOf(asRecord(raw).id);
    },
    async updateComment(commentId, body) {
      const current = await invoker(`${contentPath(commentId)}?expand=version`);
      await invoker(contentPath(commentId), {
        method: 'PUT',
        body: commentPayload(commentId, body, versionNumberOf(current) + 1),
      });
    },
    async updatePageBody(pageId, title, body, version) {
      const payload = JSON.stringify({
        id: pageId,
        type: 'page',
        title,
        version: { number: version + 1 },
        body: { storage: { value: body, representation: 'storage' } },
      });
      await invoker(contentPath(pageId), { method: 'PUT', body: payload });
    },
    async setProperty(pageId, key, value) {
      await invoker(propertyPath(pageId, key), { method: 'PUT', body: JSON.stringify(value) });
    },
    async addLabel(pageId, name) {
      await invoker(`${contentPath(pageId)}/label`, {
        method: 'POST',
        body: JSON.stringify({ prefix: 'global', name }),
      });
    },
  };
}

function versionNumberOf(raw: unknown): number {
  const number = asRecord(asRecord(raw).version).number;
  return typeof number === 'number' ? number : 1;
}

function commentPayload(commentId: string, body: string, version: number): string {
  return JSON.stringify({
    id: commentId,
    type: 'comment',
    version: { number: version },
    body: { storage: { value: body, representation: 'storage' } },
  });
}

function propertyPath(pageId: string, key: string): string {
  return `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`;
}
