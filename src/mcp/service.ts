/**
 * Résolution des dépendances des outils MCP (§16) — lot MCP.
 *
 * Les dix outils parlent au `Store` (§19) et au `JiraPort` (§8, §10). Ni l'un ni
 * l'autre ne sont devinés ici : le point d'entrée Forge les injecte par
 * `configureServices`, les tests injectent `createMemoryStore()` et des doubles.
 * Sans injection, un stockage en mémoire et un port Jira qui refuse poliment
 * prennent le relais — l'outil rend alors une enveloppe lisible et un
 * avertissement, jamais une pile (§16, §21 : pas de fausse assurance).
 */

import { defaultSettings } from '../core/trust-rules';
import { t } from '../core/i18n';
import type {
  Finding,
  Language,
  ProjectSettings,
  SegmentOrigin,
  SegmentSource,
  Verdict,
} from '../core/types';
import { createMemoryStore } from '../platform/memory';
import type { Clock, IssueStateRow, JiraIssueView, JiraPort, SegmentRow, Store } from '../platform/schema';

/** Ce dont un outil a besoin pour travailler. */
export interface Services {
  store: Store;
  jira: JiraPort;
  clock: Clock;
}

/** Ce qui a été injecté : sert à prévenir quand on tourne sur les replis. */
export interface ServiceFlags {
  store: boolean;
  jira: boolean;
}

const JIRA_METHODS = [
  'getIssue',
  'listComments',
  'listAttachments',
  'addInternalNote',
  'addPublicComment',
  'setCommentVisibility',
  'updateField',
  'prependToField',
  'replaceSegmentText',
  'setEntityProperty',
  'addLabel',
  'listLinked',
  'searchByJql',
] as const;

const systemClock: Clock = { now: () => new Date().toISOString() };

/** Port Jira non branché : chaque méthode échoue avec un message explicite. */
function unconfiguredJira(): JiraPort {
  const port: Record<string, unknown> = {};
  for (const method of JIRA_METHODS) {
    port[method] = () =>
      Promise.reject(new Error(`port Jira non configuré sur cette branche (méthode « ${method} »)`));
  }
  return port as unknown as JiraPort;
}

let current: Services | null = null;
let flags: ServiceFlags = { store: false, jira: false };

function defaults(): Services {
  return { store: createMemoryStore(), jira: unconfiguredJira(), clock: systemClock };
}

/** Dépendances courantes : celles injectées, ou les replis. */
export function services(): Services {
  if (current === null) current = defaults();
  return current;
}

/** Injection (point d'entrée Forge, tests). Rend les dépendances actives. */
export function configureServices(partial: Partial<Services>): Services {
  const base = services();
  current = {
    store: partial.store ?? base.store,
    jira: partial.jira ?? base.jira,
    clock: partial.clock ?? base.clock,
  };
  flags = {
    store: flags.store || partial.store !== undefined,
    jira: flags.jira || partial.jira !== undefined,
  };
  return current;
}

/** Retour aux replis : les tests repartent d'un stockage vierge. */
export function resetServices(): void {
  current = null;
  flags = { store: false, jira: false };
}

/** Heure courante, toujours injectée (les tests la fixent). */
export function nowIso(): string {
  return services().clock.now();
}

/**
 * Avertissements de service : ce que l'outil n'a pas pu consulter faute de
 * branchement. Un agent doit savoir qu'il lit une mémoire vide (§21).
 */
export function serviceWarnings(): string[] {
  const warnings: string[] = [];
  if (!flags.store) warnings.push('stockage non branché : lecture d’une mémoire vide');
  if (!flags.jira) warnings.push('port Jira non branché : les données du ticket ne sont pas accessibles');
  return warnings;
}

// --------------------------------------------------------------- chargements

/** Tout ce qu'un outil doit savoir d'une demande, en une seule lecture. */
export interface IssueBundle {
  issue: JiraIssueView;
  settings: ProjectSettings;
  language: Language;
  segments: SegmentRow[];
  findings: Finding[];
  verdicts: Verdict[];
  state: IssueStateRow | null;
  now: string;
}

/** Réglages d'un projet : ceux stockés, sinon les valeurs par défaut (§8.1). */
export async function loadSettings(projectKey: string, language: Language = 'fr'): Promise<ProjectSettings> {
  const stored = await services().store.settings.get(projectKey);
  return stored ?? defaultSettings(projectKey, language);
}

/** Une demande et son contexte. Jette une erreur lisible si la clé est inconnue. */
export async function loadBundle(issueKey: string): Promise<IssueBundle> {
  const { store, jira } = services();
  const issue = await jira.getIssue(issueKey);
  if (!issue || typeof issue.id !== 'string') throw new Error(`demande « ${issueKey} » introuvable`);
  const settings = await loadSettings(issue.projectKey);
  const segments = await store.segments.byIssue(issue.id);
  const findings = await store.findings.byIssue(issue.id);
  const verdicts = await collectVerdicts(findings.map((finding) => finding.id));
  const state = await store.states.get(issue.id);
  return { issue, settings, language: settings.language, segments, findings, verdicts, state, now: nowIso() };
}

/** Verdicts d'une liste de constats (§14). */
export async function collectVerdicts(findingIds: string[]): Promise<Verdict[]> {
  const { store } = services();
  const rows = await Promise.all(findingIds.map((id) => store.verdicts.byFinding(id)));
  return rows.flat().map((row) => ({
    findingId: row.findingId,
    reviewerAccountId: row.reviewerAccountId,
    decision: row.decision,
    reason: row.reason ?? undefined,
    at: row.at,
  }));
}

/** Tous les états de ticket connus, du plus suspect au moins suspect (§17.2). */
export async function allStates(limit = 500): Promise<IssueStateRow[]> {
  return services().store.states.bySuspicion('clean', limit);
}

/** Une écriture au journal : tout geste d'un outil est tracé (§8.3). */
export async function journal(kind: string, issueId: string | null, payload: unknown): Promise<void> {
  await services().store.events.append(kind, issueId, payload);
}

// ------------------------------------------------------------------- segments

/** Source d'un segment, telle que le domaine la veut (§5) — jamais inventée. */
export function segmentSourceOf(row: SegmentRow, issue: JiraIssueView): SegmentSource {
  return {
    issueId: row.issueId,
    issueKey: issue.key,
    projectKey: issue.projectKey,
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

/** Libellé d'origine lisible : la première raison traduite, avec son détail. */
export function originLabelOf(origin: SegmentOrigin, language: Language): string {
  const first = origin.reasons[0];
  if (!first) return t(language, 'trust.T0');
  const text = t(language, first.code, { detail: first.detail ?? '' });
  return text === first.code ? first.code : text;
}
