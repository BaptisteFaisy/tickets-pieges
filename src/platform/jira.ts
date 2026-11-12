/**
 * `JiraPort` sur l'API REST Forge (`@forge/api`) — lectures et écritures Jira.
 *
 * Règles du lot (§21, exigence 4) :
 *   - aucun appel hors Atlassian : uniquement `requestJira` (l'app est
 *     authentifiée par la plateforme, aucune clé ici) ;
 *   - les lectures n'écrivent rien ;
 *   - les écritures sensibles (commentaire public, remplacement du texte d'un
 *     client, visibilité) sont journalisées via `events.append` — sans jamais
 *     copier le texte lui-même dans le journal (§8.3 : l'original vit dans la
 *     table `original`, pas dans les événements).
 *
 * Ce fichier importe Forge : il n'est jamais importé par un test. Les
 * conversions pures (ADF, canal, visibilité) vivent dans `src/platform/jsm.ts`.
 */

import api, { assumeTrustedRoute } from '@forge/api';
import type { CommentVisibility, SegmentField } from '../core/types';
import type {
  EventRepo,
  JiraAttachmentView,
  JiraCommentView,
  JiraIssueView,
  JiraPort,
} from './schema';
import {
  adfToText,
  JSM_FIELDS,
  organizationNamesOf,
  textToAdf,
  toAccountSnapshot,
  toRequestChannel,
  visibilityOfComment,
  visibilityPropertyBody,
  VISIBILITY_PROPERTY,
} from './jsm';

const ISSUE_FIELDS = [
  'summary',
  'description',
  'reporter',
  'labels',
  'created',
  'issuelinks',
  'attachment',
  JSM_FIELDS.requestChannelType,
  JSM_FIELDS.organizations,
].join(',');

export interface JiraPortDeps {
  /** Journal des écritures sensibles ; absent = aucune journalisation. */
  events?: EventRepo;
}

type Json = Record<string, unknown>;

/** Écriture au journal : best effort, jamais d'échec remonté à l'appelant. */
export type Journal = (kind: string, issueKey: string, payload: Json) => void;

function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null ? (value as Json) : {};
}

async function requestJson(path: string, init?: { method?: string; body?: string }): Promise<unknown> {
  // `Content-Type: application/json` est **obligatoire** : sans lui, Forge
  // envoie le corps en `text/plain` et Jira répond 415 « Unsupported Media Type »
  // (mesuré sur site réel le 12 novembre 2026, à l'écriture de la propriété
  // indexée). Le type est aussi dans le type de `init` pour que les appels
  // futureurs n'oublient pas l'en-tête.
  const withHeaders = init?.body
    ? { ...init, headers: { 'Content-Type': 'application/json' } }
    : init;
  const response = await api.asApp().requestJira(assumeTrustedRoute(path), withHeaders);
  if (!response.ok) {
    throw new Error(`Jira REST ${response.status} sur ${path}`);
  }
  if (response.status === 204) return null;
  // Un corps vide (204 ou 200 sans corps) n'est pas une erreur : l'écriture de
  // la propriété indexée répond 204, et `response.json()` levait alors
  // « Unexpected end of JSON input » (mesuré sur site le 12 novembre 2026).
  const raw = await response.text();
  return raw.trim().length > 0 ? JSON.parse(raw) : null;
}

function issuePath(issueIdOrKey: string): string {
  return `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}`;
}

async function putIssue(issueKey: string, body: Json): Promise<void> {
  await requestJson(issuePath(issueKey), { method: 'PUT', body: JSON.stringify(body) });
}

async function issueFields(issueIdOrKey: string, fields: string): Promise<Json> {
  const data = asRecord(await requestJson(`${issuePath(issueIdOrKey)}?fields=${encodeURIComponent(fields)}`));
  return asRecord(data.fields);
}

// ------------------------------------------------------------------- lectures

async function fetchIssue(issueIdOrKey: string): Promise<JiraIssueView> {
  const data = asRecord(await requestJson(`${issuePath(issueIdOrKey)}?fields=${ISSUE_FIELDS}`));
  const fields = asRecord(data.fields);
  const key = String(data.key ?? '');
  const view: JiraIssueView = {
    id: String(data.id ?? ''),
    key,
    projectKey: key.split('-')[0] ?? '',
    summary: String(fields.summary ?? ''),
    description: adfToText(fields.description),
    reporter: toAccountSnapshot(fields.reporter),
    channel: toRequestChannel(fields[JSM_FIELDS.requestChannelType]),
    createdAt: String(fields.created ?? ''),
    labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
  };
  const organizations = organizationNamesOf(fields);
  if (organizations[0] !== undefined) view.organizationName = organizations[0];
  return view;
}

async function fetchComments(issueIdOrKey: string): Promise<JiraCommentView[]> {
  const data = asRecord(await requestJson(`${issuePath(issueIdOrKey)}/comment?limit=100`));
  const comments = Array.isArray(data.comments) ? (data.comments as Json[]) : [];
  return comments.map(toCommentView);
}

async function fetchAttachments(issueIdOrKey: string): Promise<JiraAttachmentView[]> {
  const fields = await issueFields(issueIdOrKey, 'attachment');
  const attachments = Array.isArray(fields.attachment) ? (fields.attachment as Json[]) : [];
  return attachments.map(toAttachmentView);
}

async function fetchLinked(issueKey: string): Promise<{ issueKey: string; relation: 'clone' | 'link' }[]> {
  const fields = await issueFields(issueKey, 'issuelinks');
  const links = Array.isArray(fields.issuelinks) ? (fields.issuelinks as Json[]) : [];
  const views = links.map(toLinkedView);
  return views.filter((link): link is { issueKey: string; relation: 'clone' | 'link' } => link !== null);
}

async function fetchByJql(jql: string, limit: number): Promise<string[]> {
  const data = asRecord(
    await requestJson('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults: Math.max(1, limit | 0), fields: [] }),
    }),
  );
  const issues = Array.isArray(data.issues) ? (data.issues as Json[]) : [];
  return issues.map((issue) => String(issue.key ?? '')).filter((key) => key !== '');
}

// ------------------------------------------------------------------- écritures

async function postComment(issueKey: string, body: string, internal: boolean): Promise<string> {
  const payload: Json = { body: textToAdf(body) };
  if (internal) payload.properties = [visibilityPropertyBody('internal')];
  const created = asRecord(
    await requestJson(`${issuePath(issueKey)}/comment`, { method: 'POST', body: JSON.stringify(payload) }),
  );
  return String(created.id ?? '');
}

async function putVisibility(commentId: string, visibility: CommentVisibility): Promise<void> {
  const property = visibilityPropertyBody(visibility);
  await requestJson(`/rest/api/3/comment/${encodeURIComponent(commentId)}/properties/${VISIBILITY_PROPERTY}`, {
    method: 'PUT',
    body: JSON.stringify(property.value),
  });
}

async function putFieldBanner(issueKey: string, field: string, banner: string): Promise<void> {
  const fields = await issueFields(issueKey, field);
  const prefix = `${banner}\n\n`;
  if (field === 'description') {
    await putIssue(issueKey, { fields: { description: textToAdf(prefix + adfToText(fields.description)) } });
    return;
  }
  await putIssue(issueKey, { fields: { [field]: prefix + String(fields[field] ?? '') } });
}

/** Applique le texte de remplacement selon le champ (jeté si non supporté). */
async function applySegmentText(issueKey: string, field: SegmentField, refId: string | null, text: string): Promise<void> {
  if (field === 'summary') return putIssue(issueKey, { fields: { summary: text } });
  if (field === 'description') return putIssue(issueKey, { fields: { description: textToAdf(text) } });
  if (field === 'comment' && refId !== null) {
    await requestJson(`${issuePath(issueKey)}/comment/${encodeURIComponent(refId)}`, {
      method: 'PUT',
      body: JSON.stringify({ body: textToAdf(text) }),
    });
    return;
  }
  if (field === 'customField' && refId !== null) return putIssue(issueKey, { fields: { [refId]: text } });
  throw new Error(`remplacement de texte non supporté : champ=${field} refId=${refId ?? 'nul'}`);
}

// ------------------------------------------------------------------ conversions

function toCommentView(comment: Json): JiraCommentView {
  return {
    id: String(comment.id ?? ''),
    body: adfToText(comment.body),
    visibility: visibilityOfComment(comment.properties),
    author: toAccountSnapshot(comment.author),
    createdAt: String(comment.created ?? ''),
  };
}

function toAttachmentView(attachment: Json): JiraAttachmentView {
  return {
    id: String(attachment.id ?? ''),
    fileName: String(attachment.filename ?? ''),
    mimeType: String(attachment.mimeType ?? ''),
    sizeBytes: Number(attachment.size ?? 0),
    author: toAccountSnapshot(attachment.author),
    createdAt: String(attachment.created ?? ''),
  };
}

function toLinkedView(link: Json): { issueKey: string; relation: 'clone' | 'link' } | null {
  const outward = asRecord(link.outwardIssue);
  const inward = asRecord(link.inwardIssue);
  const other = outward.key !== undefined ? outward : inward;
  const key = String(other.key ?? '');
  if (key === '') return null;
  const name = String(asRecord(link.type).name ?? '');
  return { issueKey: key, relation: name.toLowerCase() === 'clone' ? 'clone' : 'link' };
}

// ------------------------------------------------------------------ assemblage

/** Crée le port Jira ; les écritures sensibles passent au journal `events`. */
export function createJiraPort(deps: JiraPortDeps = {}): JiraPort {
  const journal: Journal = (kind, issueKey, payload) => {
    void deps.events?.append(kind, issueKey, payload).catch(() => undefined);
  };
  return {
    getIssue: fetchIssue,
    listComments: fetchComments,
    listAttachments: fetchAttachments,
    async addInternalNote(issueKey, body) {
      const commentId = await postComment(issueKey, body, true);
      journal('internal-note', issueKey, { commentId });
      return commentId;
    },
    async addPublicComment(issueKey, body) {
      // Écriture sensible : visible du client, journalisée (§20, exigence 4).
      const commentId = await postComment(issueKey, body, false);
      journal('public-comment', issueKey, { commentId });
      return commentId;
    },
    async setCommentVisibility(commentId, visibility) {
      await putVisibility(commentId, visibility);
      journal('comment-visibility', commentId, { visibility });
    },
    async updateField(issueKey, field, value) {
      await putIssue(issueKey, { fields: { [field]: value } });
    },
    prependToField: putFieldBanner,
    async replaceSegmentText(issueKey, field, refId, text) {
      // Écriture sensible : modifie le texte d'un client (§8.3), journalisée.
      await applySegmentText(issueKey, field, refId, text);
      journal('segment-text-replaced', issueKey, { field, refId });
    },
    async setEntityProperty(issueKey, key, value) {
      // Mesuré sur site le 12 novembre 2026 : Jira stocke le corps **tel quel**
      // comme valeur de la propriété. Envelopper dans `{ value }` produit donc
      // une double imbrication (`value.value`) que `parsePiegesProperty` ne sait
      // pas lire — c'est le corps nu qu'il faut envoyer.
      await requestJson(`${issuePath(issueKey)}/properties/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify(value),
      });
    },
    async addLabel(issueKey, label) {
      await putIssue(issueKey, { update: { labels: [{ add: label }] } });
    },
    listLinked: fetchLinked,
    searchByJql: fetchByJql,
  };
}
