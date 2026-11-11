/**
 * Webtriggers : le hook (§11) et le diagnostic de bout en bout (§17.7) — lot Hook.
 *
 * `inbound-hook`  : `PostToolUse` — l'app remplace la sortie de l'outil MCP par
 *                   le contenu encadré (`updatedToolOutput`) et ajoute le contexte.
 * `outbound-hook` : `PreToolUse` — une écriture publique sur une demande externe
 *                   demande confirmation (`permissionDecision: ask`).
 * `smoke-test`    : rejoue le jeu d'essai sans navigateur et rend son rapport.
 * `ops`           : pilotage (jeton, fichier de hooks, export des originaux).
 *
 * Authentification des quatre : `Authorization: Bearer $PIEGE_TOKEN` (§11),
 * vérifié sur empreinte, à temps constant (`src/hook/token.ts`). Absent ou
 * faux ⇒ même 401, sans dire lequel ; le motif réel part au journal.
 *
 * Les deux limites du §11 valent ici comme ailleurs : l'outil a déjà été
 * exécuté quand `inbound-hook` intervient, et rien de tout cela n'existe sur
 * les clients sans hooks.
 *
 * Seul fichier du lot à importer Forge ; tout le reste (`src/hook/*`) est pur.
 */

import { requestJira, route } from '@forge/api';
import {
  bearerToken,
  headerValue,
  jsonBody,
  jsonResponse,
  queryParam,
  type WebTriggerRequest,
  type WebTriggerResponse,
} from '../platform/http';
import { createMemoryStore } from '../platform/memory';
import type { Store } from '../platform/schema';
import type { HookInboundRequest, HookOutboundRequest, Language } from '../core/types';
import { isExternal } from '../core/levels';
import { issueToken, verifyToken } from '../hook/token';
import { extractIssueKey, buildInboundResponse, type InboundTicketData } from '../hook/inbound';
import { buildOutboundResponse, issueKeyOf, type OutboundTicketData } from '../hook/outbound';
import { generateHookFile, hookLimits, resolveHookConfig } from '../hook/config';
import { loadDataset, describeDataset, datasetProblems } from '../sample/dataset';
import { replayBench } from '../replay/engine';

// ------------------------------------------------------------------ stockage

/** `src/platform/db.ts` (lot Plateforme) n'est pas encore fusionné : chemin
 * opaque pour que le bundling passe, exactement comme le lot C1 du banc. */
const DB_MODULE = ['..', 'platform', 'db'].join('/');

let storePromise: Promise<Store> | null = null;

/** Le `Store` de production s'il existe, sinon la mémoire (limité, dit au smoke). */
function loadStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const mod = (await import(`./${DB_MODULE}`)) as {
          createStore?: () => Store | Promise<Store>;
          createSqlStore?: () => Store | Promise<Store>;
        };
        const create = mod.createStore ?? mod.createSqlStore;
        if (create) return await create();
      } catch {
        // db.ts absent : la mémoire prend le relais
      }
      return createMemoryStore();
    })();
  }
  return storePromise;
}

// ------------------------------------------------------------------ auth jeton

/** Compte appelé : dans le corps du hook, sinon en-tête ou paramètre. */
function accountIdOf(request: WebTriggerRequest, body: Record<string, unknown> | null): string | null {
  const inBody = body?.accountId;
  if (typeof inBody === 'string' && inBody !== '') return inBody;
  return headerValue(request, 'x-account-id') ?? queryParam(request, 'accountId');
}

interface Auth {
  accountId: string;
}

/**
 * Vérifie le jeton (§11). Échec : refus **silencieux** côté réponse (le 401 ne
 * distingue pas absent/faux/compte inconnu) et **journalisé** côté app.
 */
async function authenticate(
  request: WebTriggerRequest,
  body: Record<string, unknown> | null,
  store: Store,
  now: string,
): Promise<Auth | null> {
  const accountId = accountIdOf(request, body);
  const row = accountId ? await store.hookTokens.byAccount(accountId) : null;
  const check = verifyToken(bearerToken(request), row);
  if (!check.ok || !accountId) {
    await store.events.append('hook.auth.refused', null, { reason: check.reason, at: now });
    return null;
  }
  await store.hookTokens.touch(accountId, now);
  return { accountId };
}

const UNAUTHORIZED = { ok: false, error: 'unauthorized' } as const;

// ------------------------------------------------------------------ corps hook

function stringField(body: Record<string, unknown> | null, field: string): string | undefined {
  const value = body?.[field] ?? body?.[field.replace(/([A-Z])/g, '_$1').toLowerCase()];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function inputField(body: Record<string, unknown> | null): Record<string, unknown> {
  const value = body?.toolInput ?? body?.tool_input;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Corps `PostToolUse` → `HookInboundRequest` ; `null` s'il est illisible. */
export function parseInbound(body: Record<string, unknown> | null): HookInboundRequest | null {
  if (!body || typeof body.toolName !== 'string') return null;
  const raw = body.toolOutput ?? body.tool_output ?? body.toolResponse ?? '';
  return {
    toolName: body.toolName,
    toolInput: inputField(body),
    toolOutput: typeof raw === 'string' ? raw : JSON.stringify(raw),
    sessionRef: stringField(body, 'sessionRef') ?? stringField(body, 'sessionId'),
    accountId: stringField(body, 'accountId'),
  };
}

/** Corps `PreToolUse` → `HookOutboundRequest` ; `null` s'il est illisible. */
export function parseOutbound(body: Record<string, unknown> | null): HookOutboundRequest | null {
  if (!body || typeof body.toolName !== 'string') return null;
  return {
    toolName: body.toolName,
    toolInput: inputField(body),
    sessionRef: stringField(body, 'sessionRef') ?? stringField(body, 'sessionId'),
    accountId: stringField(body, 'accountId'),
  };
}

// ------------------------------------------------------------------- côté Jira

interface IssueRef {
  issueId: string;
  projectKey: string;
}

/** Retrouve le ticket par sa clé (REST, en tant qu'app) ; `null` si introuvable. */
async function jiraIssueRef(issueKey: string): Promise<IssueRef | null> {
  try {
    const res = await requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; key?: string; fields?: { project?: { key?: string } } };
    if (!data.id) return null;
    return { issueId: String(data.id), projectKey: data.fields?.project?.key ?? issueKey.split('-')[0]! };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- inbound

/** Rassemble les relevés de l'app pour reconstruire le contenu encadré. */
async function inboundData(
  store: Store,
  issueKey: string,
): Promise<{ data: InboundTicketData; issueId: string } | null> {
  const ref = await jiraIssueRef(issueKey);
  if (!ref) return null;
  const state = await store.states.get(ref.issueId);
  if (!state) return null; // ticket non suivi : rien à reconstruire
  const [segments, findings, settings] = await Promise.all([
    store.segments.byIssue(ref.issueId),
    store.findings.byIssue(ref.issueId),
    store.settings.get(ref.projectKey),
  ]);
  return {
    issueId: ref.issueId,
    data: {
      issueKey: state.issueKey,
      language: settings?.language ?? 'fr',
      trustLevel: state.trustLevel,
      segments,
      findings,
      notAnalyzed: state.unanalyzed,
    },
  };
}

/** §9 : lire un contenu externe contamine la session, jusqu'à sa fin. */
async function taintSession(
  store: Store,
  hookRequest: HookInboundRequest,
  auth: Auth,
  data: InboundTicketData,
  issueId: string,
  now: string,
): Promise<void> {
  if (!hookRequest.sessionRef || !isExternal(data.trustLevel)) return;
  await store.sessions.taint({
    sessionRef: hookRequest.sessionRef,
    accountId: hookRequest.accountId ?? auth.accountId,
    issueId,
    since: now,
  });
}

/** `webtrigger: pieges-inbound` — réécriture d'une lecture (§11). */
export async function inboundHook(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const body = jsonBody(request);
  const auth = await authenticate(request, body, store, now);
  if (!auth) return jsonResponse(401, UNAUTHORIZED);
  const hookRequest = parseInbound(body);
  if (!hookRequest) return jsonResponse(400, { ok: false, error: 'corps illisible' });
  const issueKey = extractIssueKey(hookRequest);
  const found = issueKey ? await inboundData(store, issueKey) : null;
  if (!found) return jsonResponse(200, {}); // non suivi : la sortie d'origine passe
  const { data, issueId } = found;
  await taintSession(store, hookRequest, auth, data, issueId, now);
  await store.events.append('hook.inbound', issueId, {
    toolName: hookRequest.toolName,
    issueKey: data.issueKey,
    at: now,
  });
  return jsonResponse(200, buildInboundResponse(data));
}

// ------------------------------------------------------------------- outbound

/** État du ticket visé + marque de session : ce que la décision doit connaître. */
async function outboundData(
  store: Store,
  request: HookOutboundRequest,
  issueKey: string,
): Promise<OutboundTicketData | null> {
  const ref = await jiraIssueRef(issueKey);
  if (!ref) return null;
  const state = await store.states.get(ref.issueId);
  if (!state) return null;
  const [settings, tainted] = await Promise.all([
    store.settings.get(ref.projectKey ?? state.projectKey),
    request.sessionRef ? store.sessions.isTainted(request.sessionRef) : Promise.resolve(false),
  ]);
  return {
    issueKey: state.issueKey,
    language: settings?.language ?? 'fr',
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    strictOutbound: settings?.strictOutbound ?? false,
    sessionTainted: tainted,
  };
}

/** `webtrigger: pieges-outbound` — confirmation d'une écriture publique (§11). */
export async function outboundHook(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const body = jsonBody(request);
  const auth = await authenticate(request, body, store, now);
  if (!auth) return jsonResponse(401, UNAUTHORIZED);
  const hookRequest = parseOutbound(body);
  if (!hookRequest) return jsonResponse(400, { ok: false, error: 'corps illisible' });
  const issueKey = issueKeyOf(hookRequest);
  const data = issueKey ? await outboundData(store, hookRequest, issueKey) : null;
  if (!data) {
    // Ticket non identifiable ou non suivi : l'app n'a pas de relevé, elle
    // laisse passer — sa protection porte sur les demandes qu'elle suit.
    return jsonResponse(200, buildOutboundResponse(hookRequest, {
      issueKey: issueKey ?? '?',
      language: 'fr',
      trustLevel: 'T3',
      suspicionLevel: 'clean',
      strictOutbound: false,
      sessionTainted: false,
    }));
  }
  await store.events.append('hook.outbound', null, {
    toolName: hookRequest.toolName,
    issueKey: data.issueKey,
    at: now,
  });
  return jsonResponse(200, buildOutboundResponse(hookRequest, data));
}

// ---------------------------------------------------------------------- smoke

interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

async function checkSql(store: Store): Promise<Check> {
  try {
    await store.events.append('smoke.ping', null, { at: new Date().toISOString() });
    const rows = await store.events.list(null, 1);
    return { name: 'sql', ok: Array.isArray(rows), detail: { readBack: rows.length } };
  } catch (error) {
    return { name: 'sql', ok: false, detail: String(error) };
  }
}

async function checkRest(): Promise<Check> {
  try {
    const res = await requestJira(route`/rest/api/3/myself`);
    return { name: 'rest', ok: res.ok, detail: { status: res.status } };
  } catch (error) {
    return { name: 'rest', ok: false, detail: String(error) };
  }
}

/** §17.7 : le jeu d'essai rejoué de bout en bout, sans navigateur. */
async function checkDomain(store: Store): Promise<Check> {
  try {
    const bench = await replayBench(loadDataset(), { store: store as never });
    const problems = datasetProblems();
    return {
      name: 'domain',
      ok: bench.played === bench.total && problems.length === 0,
      detail: { played: bench.played, total: bench.total, dataset: describeDataset(), problems },
    };
  } catch (error) {
    return { name: 'domain', ok: false, detail: String(error) };
  }
}

/** `webtrigger: pieges-smoke` — diagnostic de bout en bout. */
export async function smokeTrigger(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const body = jsonBody(request);
  const auth = await authenticate(request, body, store, now);
  if (!auth) return jsonResponse(401, UNAUTHORIZED);
  const checks = [await checkSql(store), await checkRest(), await checkDomain(store)];
  const ok = checks.every((check) => check.ok);
  return jsonResponse(200, { ok, checkedAt: now, checks });
}

// ------------------------------------------------------------------------ ops

async function opsHookConfig(body: Record<string, unknown> | null): Promise<WebTriggerResponse> {
  const baseUrl = stringField(body, 'baseUrl');
  if (!baseUrl) return jsonResponse(400, { ok: false, error: 'baseUrl requis' });
  const language = (stringField(body, 'language') ?? 'fr') as Language;
  const config = resolveHookConfig({
    baseUrl,
    serverName: stringField(body, 'serverName'),
    readTools: Array.isArray(body?.readTools) ? (body?.readTools as string[]) : undefined,
    writeTools: Array.isArray(body?.writeTools) ? (body?.writeTools as string[]) : undefined,
    tokenEnvVar: stringField(body, 'tokenEnvVar'),
    timeoutSeconds: typeof body?.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined,
  });
  return jsonResponse(200, { ok: true, file: generateHookFile(config), limits: hookLimits(language) });
}

/** `webtrigger: pieges-ops` — pilotage et export avant désinstallation (§22). */
export async function opsTrigger(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const body = jsonBody(request);
  const auth = await authenticate(request, body, store, now);
  if (!auth) return jsonResponse(401, UNAUTHORIZED);
  const action = queryParam(request, 'action') ?? stringField(body, 'action') ?? '';
  if (action === 'hook-config') return opsHookConfig(body);
  if (action === 'rotate-token') {
    const issued = issueToken(auth.accountId, now);
    await store.hookTokens.put(issued.row);
    await store.events.append('hook.token.rotated', null, { accountId: auth.accountId, at: now });
    // Le clair n'est rendu qu'ici, une seule fois (§11 : jamais stocké).
    return jsonResponse(200, { ok: true, token: issued.token });
  }
  if (action === 'export-originals') {
    const originals = await store.originals.pending();
    return jsonResponse(200, { ok: true, count: originals.length, originals });
  }
  return jsonResponse(400, { ok: false, error: `action inconnue : ${action || '(aucune)'}` });
}
