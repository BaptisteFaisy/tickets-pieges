/**
 * Petits helpers du glue — lot Jobs (§18).
 *
 * Ce fichier reste **pur** : aucun import `@forge/*`, pour que le pipeline et
 * le consumer soient testables sans produit Atlassian (même règle que
 * `src/platform/llm.ts`). Les modules qui parlent à Forge (`triggers.ts`,
 * `consumer.ts`) assemblent ici leurs dépendances via `resolveDeps`.
 *
 * État du dépôt à ce lot : `src/platform/db.ts` (Forge SQL) et
 * `src/platform/jira.ts` (REST) ne sont pas encore sur `main` (lot Plateforme).
 * Le magasin par défaut est donc `createMemoryStore()` et le port Jira par
 * défaut lève une erreur explicite — la couture `configureRuntime` permet de
 * brancher les vrais adaptateurs dès leur fusion, sans retoucher les triggers.
 */

import type {
  AccountType,
  Language,
  ProjectSettings,
  SegmentField,
  SegmentSource,
  UnanalyzedReason,
} from '../core/types';
import { defaultSettings } from '../core/trust-rules';
import { createCache, type C3Cache } from '../core/c3-model';
import { createMemoryStore } from '../platform/memory';
import type {
  Clock,
  JiraAttachmentView,
  JiraCommentView,
  JiraIssueView,
  JiraPort,
  ModelPort,
  SegmentRow,
  Store,
} from '../platform/schema';
import { contentHash } from '../core/hashing';

// ------------------------------------------------------------------- contrats

/** Message de la file `pieges-c3` : ce qu'il faut pour retrouver le segment. */
export type C3Message = {
  issueId: string;
  segmentId: string;
  attempt?: number;
};

/** Tout ce dont un point d'entrée (§18) a besoin pour travailler. */
export interface JobsDeps {
  store: Store;
  jira: JiraPort;
  model: ModelPort;
  clock: Clock;
  /** Mise en file de la couche C3 — jamais d'appel modèle en ligne (§6). */
  enqueue(message: C3Message): Promise<void>;
}

// ------------------------------------------------------------- événements AVI

/** Ce qu'un événement Jira nous donne : de quoi retrouver le ticket. */
export interface EventRef {
  issueId?: string;
  issueKey?: string;
  commentId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Lecture tolérante d'un payload AVI : les formes varient selon l'événement
 * (`issue.id`, `comment.issue.key`, champs aplatis…). On prend ce qui existe,
 * sans jamais lever — un événement illisible est journalisé, pas rejoué.
 */
export function readEventRef(event: unknown): EventRef {
  const root = asRecord(event);
  const issue = asRecord(root?.['issue']) ?? root;
  const comment = asRecord(root?.['comment']);
  const commentIssue = asRecord(comment?.['issue']);
  return {
    issueId: readString(issue, 'id') ?? readString(commentIssue, 'id') ?? readString(root, 'issueId'),
    issueKey: readString(issue, 'key') ?? readString(commentIssue, 'key') ?? readString(root, 'issueKey'),
    commentId: readString(comment, 'id') ?? readString(root, 'commentId'),
  };
}

// ------------------------------------------------------------------ segments

/** Identifiant stable d'un segment : même texte rejoué, même identifiant (§22). */
export function makeSegmentId(issueId: string, field: SegmentField, refId?: string | null): string {
  return `${issueId}:${field}:${refId ?? '-'}`;
}

/** Empreinte de contenu d'un segment (ligne `segments.contentHash`). */
export function segmentHash(text: string): string {
  return contentHash(text);
}

/** Une pièce jointe est analysable si son texte a pu être extrait (§22). */
function attachmentReason(view: JiraAttachmentView): UnanalyzedReason | null {
  if (typeof view.text === 'string') return null;
  if (view.mimeType.startsWith('image/')) return 'image';
  return 'binary-attachment';
}

function authorOf(view: { accountId: string; accountType: AccountType; displayName?: string; emailDomain?: string; accountCreatedAt?: string; supportAgent?: boolean }, organizationId?: string, organizationName?: string): SegmentSource['author'] {
  return {
    accountId: view.accountId,
    accountType: view.accountType,
    displayName: view.displayName,
    emailDomain: view.emailDomain,
    accountCreatedAt: view.accountCreatedAt,
    supportAgent: view.supportAgent,
    organizationId,
    organizationName,
  };
}

function commentSource(view: JiraIssueView, comment: JiraCommentView): SegmentSource {
  return {
    issueId: view.id,
    issueKey: view.key,
    projectKey: view.projectKey,
    field: 'comment',
    refId: comment.id,
    text: comment.body,
    author: authorOf(comment.author, view.organizationId, view.organizationName),
    channel: view.channel,
    visibility: comment.visibility,
    createdAt: comment.createdAt,
  };
}

function attachmentSource(view: JiraIssueView, attachment: JiraAttachmentView): SegmentSource | null {
  if (typeof attachment.text !== 'string') return null;
  return {
    issueId: view.id,
    issueKey: view.key,
    projectKey: view.projectKey,
    field: 'attachmentText',
    refId: attachment.id,
    text: attachment.text,
    author: authorOf(attachment.author, view.organizationId, view.organizationName),
    channel: view.channel,
    createdAt: attachment.createdAt,
    attachment: {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      parseable: true,
    },
  };
}

/** Ce que produit la collecte : les segments à analyser et les manques (§21). */
export interface CollectedSegments {
  sources: SegmentSource[];
  unanalyzed: UnanalyzedReason[];
}

/**
 * Segments d'un ticket : résumé, description, **tous** les commentaires (le fil
 * entier est réexaminé, §22) et le texte des pièces jointes lisibles. Ce qui ne
 * l'est pas devient une raison `unanalyzed` — jamais passé sous silence (§21).
 */
export function collectSegments(
  view: JiraIssueView,
  comments: JiraCommentView[],
  attachments: JiraAttachmentView[],
): CollectedSegments {
  const sources: SegmentSource[] = [];
  const unanalyzed = new Set<UnanalyzedReason>();
  if (view.summary.trim().length > 0) {
    sources.push({
      issueId: view.id, issueKey: view.key, projectKey: view.projectKey, field: 'summary',
      text: view.summary, author: authorOf(view.reporter, view.organizationId, view.organizationName),
      channel: view.channel, createdAt: view.createdAt,
    });
  }
  if (view.description.trim().length > 0) {
    sources.push({
      issueId: view.id, issueKey: view.key, projectKey: view.projectKey, field: 'description',
      text: view.description, author: authorOf(view.reporter, view.organizationId, view.organizationName),
      channel: view.channel, createdAt: view.createdAt,
    });
  }
  for (const comment of comments) sources.push(commentSource(view, comment));
  for (const attachment of attachments) {
    const source = attachmentSource(view, attachment);
    if (source) sources.push(source);
    else unanalyzed.add(attachmentReason(attachment) ?? 'binary-attachment');
  }
  return { sources, unanalyzed: [...unanalyzed] };
}

/** SegmentSource reconstruit depuis la ligne stockée (consumer C3). */
export function sourceFromRow(row: SegmentRow, issueKey: string, projectKey: string): SegmentSource {
  return {
    issueId: row.issueId,
    issueKey,
    projectKey,
    field: row.field,
    refId: row.refId ?? undefined,
    text: row.text,
    author: {
      accountId: row.authorAccountId,
      accountType: row.accountType,
      organizationId: row.orgId ?? undefined,
    },
    channel: row.channel,
    visibility: row.visibility ?? undefined,
    createdAt: row.scannedAt,
  };
}

// ------------------------------------------------------------------ réglages

/** Réglages du projet, ou les réglages par défaut (§8.1 : mode « signaler »). */
export async function loadSettings(store: Store, projectKey: string): Promise<ProjectSettings> {
  const stored = await store.settings.get(projectKey);
  return stored ?? defaultSettings(projectKey);
}

/** Langue du projet (journal, bandeau, détection). */
export function languageOf(settings: ProjectSettings): Language {
  return settings.language;
}

// ---------------------------------------------------------------- dépendances

/** Horloge système : l'ISO du moment, comme `Date`. */
export function systemClock(): Clock {
  return { now: () => new Date().toISOString() };
}

function fail(name: string): never {
  throw new Error(`Tickets piégés : ${name} indisponible (adaptateur lot Plateforme non fusionné)`);
}

/** Port Jira par défaut tant que `src/platform/jira.ts` n'est pas sur `main`. */
export function unavailableJira(): JiraPort {
  return new Proxy({} as JiraPort, {
    get(_target, property: string) {
      return () => fail(`JiraPort.${property}`);
    },
  });
}

/** Port modèle inutilisé : le chemin de l'événement n'appelle jamais C3 (§6). */
export function unusedModel(): ModelPort {
  return { classify: () => Promise.reject(new Error('modèle appelé hors de la file C3')) };
}

let sharedStore: Store | null = null;
let configured: Partial<JobsDeps> = {};

/** Magasin partagé du processus (mémoire tant que `db.ts` n'est pas fusionné). */
export function runtimeStore(): Store {
  if (!sharedStore) sharedStore = createMemoryStore();
  return sharedStore;
}

/** Cache C3 partagé : même texte, même verdict, un seul appel modèle (§6). */
export const c3Cache: C3Cache = createCache();

/**
 * Couture de production : le lot Plateforme (ou un test) injecte ici le vrai
 * `Store` SQL et le vrai `JiraPort`. Les valeurs par défaut restent honnêtes :
 * rien n'est simulé en silence.
 */
export function configureRuntime(overrides: Partial<JobsDeps>): void {
  configured = { ...configured, ...overrides };
}

/** Dépendances complètes : explicites > configurées > défauts. */
export function resolveDeps(overrides: Partial<JobsDeps> = {}): JobsDeps {
  const merged = { ...configured, ...overrides };
  return {
    store: merged.store ?? runtimeStore(),
    jira: merged.jira ?? unavailableJira(),
    model: merged.model ?? unusedModel(),
    clock: merged.clock ?? systemClock(),
    enqueue: merged.enqueue ?? (() => Promise.reject(new Error('file pieges-c3 non branchée'))),
  };
}

// --------------------------------------------------------------------- dates

/** Instant ISO décalé de `days` jours (fenêtres des tâches planifiées). */
export function daysBefore(nowIso: string, days: number): string {
  return new Date(Date.parse(nowIso) - days * 86_400_000).toISOString();
}
