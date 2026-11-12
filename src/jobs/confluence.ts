/**
 * Jobs Confluence (#61, TP-26) — pages et commentaires d'invités.
 *
 * Le moteur est celui de Jira : `scanIssue` (pipeline des cinq étapes, §18)
 * tourne sur une page via un adaptateur `JiraPort` adossé au port REST
 * Confluence. Origine, C1/C2/C4, encadrement (§8.2), mode, neutralisation,
 * propriété et journal sont exactement les mêmes — zéro duplication.
 *
 * Ce que Confluence ne sait pas exprimer (note interne, visibilité par
 * commentaire, champs libres, liens, CQL) est sauté **et journalisé** (§21),
 * jamais tu en silence. La neutralisation réécrit le corps en texte brut remis
 * en storage : la mise en forme d'origine est perdue côté page, mais
 * l'original complet reste dans le stockage de l'app (§8.3) et est restaurable.
 *
 * Les quatre déclencheurs Confluence (page créée/mise à jour, commentaire
 * créé/mis à jour) pointent vers un seul handler : `confluenceContentEvent`.
 */

import api, { assumeTrustedRoute } from '@forge/api';
import { frameRequest, renderFramedRequest } from '../core/framing';
import type { FramingInput } from '../core/framing';
import { checkOutbound } from '../core/outbound';
import type { OutboundDlpResult } from '../core/outbound';
import { defaultSettings } from '../core/trust-rules';
import type { ProjectSettings, SegmentField, SuspicionLevel, TrustLevel } from '../core/types';
import { framingSegments, outboundContextOf, verdictOf, type IssueBundle } from '../mcp/service';
import {
  createConfluencePort,
  pageIssueId,
  pageIssueKey,
  pageVisibility,
  textToStorage,
  type ConfluenceInvoker,
  type ConfluencePageView,
  type ConfluencePort,
} from '../platform/confluence';
import { createSqlStore, ensureSchema } from '../platform/db';
import { forgeModelPort } from '../platform/llm';
import type { Clock, JiraIssueView, JiraPort, ModelPort, Store } from '../platform/schema';
import { isSelfEcho, SELF_WRITE_LOOKBACK } from '../core/self-write';
import { scanIssue, type ScanResult } from './pipeline';
import { enqueueC3, systemClock } from './support';

// ------------------------------------------------------- adaptateur JiraPort

/** Journal de ce que Confluence ne sait pas faire — jamais tu en silence (§21). */
export type AdapterLog = (kind: string, pageId: string, detail: string) => void;

function toIssueView(page: ConfluencePageView): JiraIssueView {
  return {
    id: pageIssueId(page.id),
    key: pageIssueKey(page),
    projectKey: page.spaceKey,
    summary: page.title,
    description: page.body,
    reporter: page.author,
    channel: 'unknown',
    createdAt: page.createdAt,
    labels: [],
  };
}

type ReaderMethods = Pick<JiraPort, 'getIssue' | 'listComments' | 'listAttachments' | 'listLinked' | 'searchByJql'>;

function adapterReaders(port: ConfluencePort): ReaderMethods {
  return {
    async getIssue(pageId) {
      return toIssueView(await port.getPage(pageId));
    },
    async listComments(pageId) {
      const [page, comments] = await Promise.all([port.getPage(pageId), port.listComments(pageId)]);
      const visibility = pageVisibility(page.restricted) ?? 'public';
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        visibility,
        author: comment.author,
        createdAt: comment.createdAt,
      }));
    },
    async listAttachments(pageId) {
      return port.listAttachments(pageId);
    },
    async listLinked() {
      return [];
    },
    async searchByJql() {
      return [];
    },
  };
}

/** Bandeau en tête de page (§8.1) : le corps extrait est remis en storage. */
async function prependBanner(port: ConfluencePort, log: AdapterLog | undefined, pageId: string, field: string, banner: string): Promise<void> {
  if (field !== 'description') {
    if (log) log('confluence-prepend-ignore', pageId, field);
    return;
  }
  const page = await port.getPage(pageId);
  await port.updatePageBody(pageId, page.title, textToStorage(`${banner}\n${page.body}`), page.version);
}

/** Remplacement neutralisé (§8.3) : commentaire, titre ou corps de la page. */
async function replaceSegment(
  port: ConfluencePort,
  log: AdapterLog | undefined,
  pageId: string,
  field: SegmentField,
  refId: string | null,
  text: string,
): Promise<void> {
  if (field === 'comment' && refId) {
    await port.updateComment(refId, textToStorage(text));
    return;
  }
  if (field === 'summary' || field === 'description') {
    const page = await port.getPage(pageId);
    const title = field === 'summary' ? text : page.title;
    const body = field === 'description' ? text : page.body;
    await port.updatePageBody(pageId, title, textToStorage(body), page.version);
    return;
  }
  if (log) log('confluence-segment-non-remplacable', pageId, field);
}

type WriterMethods = Pick<
  JiraPort,
  | 'addInternalNote'
  | 'addPublicComment'
  | 'setCommentVisibility'
  | 'updateField'
  | 'prependToField'
  | 'replaceSegmentText'
  | 'setEntityProperty'
  | 'addLabel'
>;

function adapterWriters(port: ConfluencePort, log?: AdapterLog): WriterMethods {
  const skip = (kind: string, pageId: string, detail: string): void => {
    if (log) log(kind, pageId, detail);
  };
  return {
    async addInternalNote(pageId) {
      skip('confluence-sans-note-interne', pageId, 'Confluence n’a pas de commentaire interne');
      return '';
    },
    async addPublicComment(pageId, body) {
      return port.addComment(pageId, textToStorage(body));
    },
    async setCommentVisibility(commentId, visibility) {
      skip('confluence-visibilite-ignoree', commentId, visibility);
    },
    async updateField(pageId, field) {
      skip('confluence-sans-champs', pageId, field);
    },
    async prependToField(pageId, field, banner) {
      await prependBanner(port, log, pageId, field, banner);
    },
    async replaceSegmentText(pageId, field, refId, text) {
      await replaceSegment(port, log, pageId, field, refId, text);
    },
    async setEntityProperty(pageId, key, value) {
      await port.setProperty(pageId, key, value);
    },
    async addLabel(pageId, name) {
      await port.addLabel(pageId, name);
    },
  };
}

/** Le port Confluence vu comme un `JiraPort` : le pipeline §18 tourne inchangé. */
export function confluenceAsJiraPort(port: ConfluencePort, log?: AdapterLog): JiraPort {
  return { ...adapterReaders(port), ...adapterWriters(port, log) };
}

// ------------------------------------------------------------------ dépendances

/** Ce dont les fonctions Confluence ont besoin — injecté, jamais construit ici en test. */
export interface ConfluenceDeps {
  store: Store;
  confluence: ConfluencePort;
  clock: Clock;
  model?: ModelPort;
  enqueueC3?: (message: { issueId: string; segmentId: string }) => Promise<void>;
  settings?: ProjectSettings;
}

/** Les gestes impossibles sont journalisés dans la table `events` (§19). */
function journalLog(store: Store): AdapterLog {
  return (kind, pageId, detail) => {
    void store.events.append(kind, pageIssueId(pageId), { pageId, detail }).catch(() => undefined);
  };
}

function adapterOf(deps: ConfluenceDeps): JiraPort {
  return confluenceAsJiraPort(deps.confluence, journalLog(deps.store));
}

/**
 * Analyse complète d'une page : LA fonction appelée par les déclencheurs et le
 * banc d'essai. Même pipeline que Jira (`scanIssue`), mêmes garanties.
 */
export function scanConfluencePage(deps: ConfluenceDeps, pageId: string): Promise<ScanResult> {
  return scanIssue(
    {
      store: deps.store,
      jira: adapterOf(deps),
      clock: deps.clock,
      model: deps.model,
      enqueueC3: deps.enqueueC3,
      settings: deps.settings,
    },
    pageId,
  );
}

// ------------------------------------------------- encadrement servi aux agents

/** Le faisceau d'une page : mêmes éléments que `loadBundle`, lus avec nos deps. */
export async function confluenceBundle(deps: ConfluenceDeps, pageId: string): Promise<IssueBundle> {
  const issue = await adapterOf(deps).getIssue(pageId);
  const settings = deps.settings ?? (await deps.store.settings.get(issue.projectKey)) ?? defaultSettings(issue.projectKey);
  const segments = await deps.store.segments.byIssue(issue.id);
  const findings = await deps.store.findings.byIssue(issue.id);
  const verdictRows = [];
  for (const finding of findings) verdictRows.push(...(await deps.store.verdicts.byFinding(finding.id)));
  const state = await deps.store.states.get(issue.id);
  return {
    issue,
    settings,
    language: settings.language,
    segments,
    findings,
    verdicts: verdictRows.map(verdictOf),
    state,
    now: deps.clock.now(),
  };
}

/** Un bloc encadré, tel que rendu à un agent (§8.2). */
export interface FramedBlockView {
  blockId: string;
  field: SegmentField;
  refId: string | null;
  trustLevel: TrustLevel;
  suspicion: SuspicionLevel;
  originLabel: string;
  findings: number;
}

export interface FramedPage {
  issueKey: string;
  text: string;
  blocks: FramedBlockView[];
  notAnalyzed: string[];
  warnings: string[];
}

/**
 * Contenu encadré d'une page : ce qu'un agent (Rovo, MCP, automatisation)
 * reçoit à la place du texte brut — balises à identifiant aléatoire, origine
 * par segment, parties non analysées déclarées. Identique au rendu Jira.
 * `blockId` injectable pour les tests (valeurs stables).
 */
export async function framedConfluencePage(deps: ConfluenceDeps, pageId: string, blockId?: () => string): Promise<FramedPage> {
  const bundle = await confluenceBundle(deps, pageId);
  const input: FramingInput = {
    issueKey: bundle.issue.key,
    segments: await framingSegments(bundle),
    language: bundle.language,
    notAnalyzed: bundle.state?.unanalyzed ?? [],
  };
  if (blockId) input.blockId = blockId;
  const framed = frameRequest(input);
  return {
    issueKey: bundle.issue.key,
    text: renderFramedRequest(framed, bundle.language),
    blocks: framed.blocks.map((block) => ({
      blockId: block.blockId,
      field: block.field,
      refId: block.refId ?? null,
      trustLevel: block.trustLevel,
      suspicion: block.suspicion,
      originLabel: block.originLabel,
      findings: block.findings.length,
    })),
    notAnalyzed: framed.notAnalyzed,
    warnings: framed.warnings,
  };
}

// ------------------------------------------------------- sas des commentaires

/** Résultat du sas sur un commentaire public Confluence (#33-#37 appliqués). */
export interface PublicCommentOutcome {
  published: boolean;
  commentId: string | null;
  verdict: OutboundDlpResult;
  doubleReview: boolean;
}

/**
 * Publie un commentaire public sur une page **seulement si le sas le permet**.
 * Retenu → rien n'est publié, un événement est journalisé, la décision dit si
 * deux relectures humaines sont exigées (#37). Limite dite : la session
 * contaminée (§9) ne s'applique pas encore aux pages (pas de session
 * Confluence suivie) — le contexte du sas le déclare `taintedSession: false`.
 */
export async function postPublicComment(deps: ConfluenceDeps, pageId: string, text: string): Promise<PublicCommentOutcome> {
  const bundle = await confluenceBundle(deps, pageId);
  const verdict = checkOutbound(text, outboundContextOf(bundle), {
    language: bundle.language,
    now: deps.clock.now(),
    stage: 'before',
  });
  if (!verdict.allowed) {
    await deps.store.events.append('outbound-held', bundle.issue.id, {
      pageId,
      action: verdict.action,
      hits: verdict.hits.length,
      doubleReview: verdict.requiresDoubleReview,
    });
    return { published: false, commentId: null, verdict, doubleReview: verdict.requiresDoubleReview };
  }
  const commentId = await deps.confluence.addComment(pageId, textToStorage(text));
  await deps.store.events.append('outbound-published', bundle.issue.id, { pageId, commentId });
  return { published: true, commentId, verdict, doubleReview: verdict.requiresDoubleReview };
}

// ------------------------------------------------------------- événement → page

type Json = Record<string, unknown>;

function recordOf(value: unknown): Json {
  return typeof value === 'object' && value !== null ? (value as Json) : {};
}

/**
 * Identifiant de la page lu dans l'événement AVI, ou `null`. Les charges des
 * événements Confluence varient selon le déclencheur : on cherche `pageId`,
 * `contentId`, puis `content.id` / `page.id` — dans cet ordre.
 */
export function eventPageId(payload: unknown): string | null {
  const event = recordOf(payload);
  for (const key of ['pageId', 'contentId']) {
    const value = event[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const nested of ['content', 'page']) {
    const id = recordOf(event[nested]).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

// ---------------------------------------------------------------- câblage Forge

/** Invoker de production : `requestConfluence` en tant qu'app, route de confiance. */
export function createConfluenceInvoker(): ConfluenceInvoker {
  return async (path, init) => {
    // Même règle que sur Jira : sans `Content-Type: application/json`, Forge
    // envoie le corps en `text/plain` et Confluence répond 415 (mesuré sur site
    // réel le 12 novembre 2026).
    const withHeaders = init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init;
    const response = await api.asApp().requestConfluence(assumeTrustedRoute(path), withHeaders);
    if (!response.ok) {
      throw new Error(`Confluence REST ${response.status} sur ${path}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

/** Les ports de production Confluence — même socle que `createForgeDeps`. */
export async function createConfluenceForgeDeps(): Promise<ConfluenceDeps> {
  await ensureSchema();
  return {
    store: createSqlStore(),
    confluence: createConfluencePort(createConfluenceInvoker()),
    model: forgeModelPort(),
    clock: systemClock(),
    enqueueC3,
  };
}

/**
 * Handler unique des quatre déclencheurs Confluence (`avi:confluence:created:page`,
 * `updated:page`, `created:comment`, `updated:comment`) : lire l'identifiant de
 * la page, lancer le pipeline, rien d'autre — le glue le plus mince possible.
 */
/**
 * Une de nos écritures vient-elle de provoquer cet événement ?
 *
 * Confluence n'a pas de filtre `ignoreSelf` (réservé aux événements Jira, mesuré
 * par `forge lint`) : la garde est donc dans le code, et elle s'appuie sur le
 * journal que l'app tient déjà (§18, étape 5).
 */
export async function isSelfEchoEvent(deps: ConfluenceDeps, pageId: string): Promise<boolean> {
  const entries = await deps.store.events.list(pageIssueId(pageId), SELF_WRITE_LOOKBACK);
  return isSelfEcho(
    entries.map((entry) => ({ kind: entry.kind, at: entry.at })),
    deps.clock.now(),
  );
}

export async function confluenceContentEvent(event: unknown): Promise<void> {
  const pageId = eventPageId(event);
  if (!pageId) return;
  const deps = await createConfluenceForgeDeps();
  if (await isSelfEchoEvent(deps, pageId)) {
    await deps.store.events.append('self-echo-ignored', pageIssueId(pageId), { pageId });
    return;
  }
  await scanConfluencePage(deps, pageId);
}
