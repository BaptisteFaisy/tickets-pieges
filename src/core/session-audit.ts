/**
 * Journal de session exportable (#28) et détection d'agent en boucle (#30).
 *
 * Deux usages, une seule source : la liste d'entrées `AuditEntry`.
 *
 * **#28 — exportable.** Qui a lu quoi, quels gestes ont été demandés, quelles
 * confirmations ont été données. L'export est **assaini par liste blanche** :
 * seuls des identifiants, des empreintes et des compteurs en sortent. Un champ
 * qui ne ressemble pas à un identifiant (espace, ponctuation libre) est vidé,
 * un `detail` qui n'est pas une clé de catalogue est omis. Un texte de ticket
 * entré par erreur dans le journal ne ressort donc jamais (§21 : aucune donnée
 * ne sort d'Atlassian, et le journal lui-même ne porte aucun texte).
 *
 * **#30 — boucle.** Un agent qui promène le même outil sur N tickets en peu de
 * temps ne cherche pas à aider : il ratisse. La détection est déterministe
 * (fenêtre glissante, aucun tirage), et rend une alerte avec gravité — c'est
 * aussi un signal au sens de `recordSignal` (quarantaine, #27).
 *
 * Domaine pur : aucune E/S, aucune heure lue (`now` en paramètre), aucun
 * import `@forge/*`.
 */

import type { Language } from './types';
import { t } from './i18n';
import type { PolicyDecision } from './session-policy';

/** Nature d'une entrée : ce que le journal sait dire, rien d'autre. */
export type AuditKind =
  | 'read'
  | 'gesture-requested'
  | 'confirmation'
  | 'denial'
  | 'budget-exhausted'
  | 'quarantine'
  | 'session-expired'
  | 'loop-alert'
  | 'token-issued'
  | 'token-rejected';

export const AUDIT_KINDS: readonly AuditKind[] = [
  'read',
  'gesture-requested',
  'confirmation',
  'denial',
  'budget-exhausted',
  'quarantine',
  'session-expired',
  'loop-alert',
  'token-issued',
  'token-rejected',
];

/** Une entrée : identifiants, empreintes, compteurs — jamais de texte. */
export interface AuditEntry {
  /** Date ISO (injectée par l'appelant). */
  at: string;
  sessionRef: string;
  accountId: string;
  kind: AuditKind;
  /** Capacité ou geste concerné, au nom produit-agnostique (#21). */
  action?: string;
  issueId?: string;
  /** Outil appelé — la clé de la détection de boucle (#30). */
  toolRef?: string;
  /** Empreinte du contenu lu (hash), jamais le contenu. */
  fingerprint?: string;
  /** Motif : une clé de catalogue ou un code court, jamais du texte libre. */
  detail?: string;
}

/** Entrée assainie : ce qui a le droit de sortir de l'app. */
export interface SanitizedEntry {
  at: string;
  sessionRef: string;
  accountId: string;
  kind: AuditKind;
  action: string;
  issueId: string;
  toolRef: string;
  fingerprint: string;
  detail: string;
}

/** Colonnes de l'export, dans l'ordre — format machine stable. */
export const AUDIT_COLUMNS: readonly (keyof SanitizedEntry)[] = [
  'at',
  'sessionRef',
  'accountId',
  'kind',
  'action',
  'issueId',
  'toolRef',
  'fingerprint',
  'detail',
];

/** Nombre d'entrées conservées : le journal est borné, la mémoire aussi. */
export const MAX_AUDIT_ENTRIES = 1000;

/** Un identifiant : lettres, chiffres et `._:-`, 64 caractères au plus. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Un motif : une clé de catalogue ou un code court, en minuscules. */
const DETAIL_KEY = /^[a-z0-9][a-z0-9._:-]{0,79}$/;

/** Une empreinte : un hachage hexadécimal, 6 à 64 caractères. */
const FINGERPRINT = /^[0-9a-f]{6,64}$/i;

/** Garde un identifiant, vide tout ce qui n'en est pas un. */
function safe(value: string | undefined): string {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : '';
}

/** Garde un motif lisible ; un texte libre est omis, pas recopié. */
function safeDetail(value: string | undefined): string {
  return typeof value === 'string' && DETAIL_KEY.test(value) ? value : '';
}

/**
 * Garde une empreinte. Une empreinte est un hachage hexadécimal : un IBAN, un
 * téléphone ou un courriel collé dans ce champ ne passe pas (§21).
 */
function safeFingerprint(value: string | undefined): string {
  return typeof value === 'string' && FINGERPRINT.test(value) ? value.toLowerCase() : '';
}

/** Une date ISO valable, sinon vide (le journal n'invente pas d'horodatage). */
function safeDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? value : '';
}

/** Assainit une entrée : liste blanche stricte, champ par champ. */
export function sanitizeEntry(entry: AuditEntry): SanitizedEntry {
  return {
    at: safeDate(entry.at),
    sessionRef: safe(entry.sessionRef),
    accountId: safe(entry.accountId),
    kind: AUDIT_KINDS.includes(entry.kind) ? entry.kind : 'read',
    action: safe(entry.action),
    issueId: safe(entry.issueId),
    toolRef: safe(entry.toolRef),
    fingerprint: safeFingerprint(entry.fingerprint),
    detail: safeDetail(entry.detail),
  };
}

/**
 * Ajoute une entrée (immutable) et borne la liste : au-delà de
 * `MAX_AUDIT_ENTRIES`, les plus anciennes tombent — un journal qui déborde ne
 * doit jamais faire tomber l'app.
 */
export function recordAudit(entries: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  const next = [...entries, entry];
  return next.length > MAX_AUDIT_ENTRIES ? next.slice(next.length - MAX_AUDIT_ENTRIES) : next;
}

/** Nature journalisée d'une décision : un seul tableau de correspondance. */
export function kindOfDecision(decision: PolicyDecision): AuditKind {
  if (decision.expired) return 'session-expired';
  if (decision.decision === 'deny') {
    return decision.reason.includes('quarantaine') || decision.reason.includes('quarantine')
      ? 'quarantine'
      : 'denial';
  }
  return 'gesture-requested';
}

/**
 * Journalise une décision de la politique (#28) : le geste demandé, la capacité
 * produit-agnostique (#21) et le verdict. Le motif lisible n'est **pas** recopié
 * — il citerait le ticket ; seule sa nature est conservée.
 */
export function recordDecision(
  entries: AuditEntry[],
  decision: PolicyDecision,
  sessionRef: string,
  accountId: string,
  now: string,
  issueId?: string,
): AuditEntry[] {
  return recordAudit(entries, {
    at: now,
    sessionRef,
    accountId,
    kind: kindOfDecision(decision),
    action: decision.capability,
    issueId,
    detail: decision.humanReview ? 'session.decision.budget' : '',
  });
}

/** Export JSON : entrées assainies, clés dans l'ordre des colonnes. */
export function exportAuditJson(entries: AuditEntry[]): string {
  const rows = entries.map((entry) => sanitizeEntry(entry));
  return JSON.stringify({ version: 1, entries: rows }, null, 2);
}

/** Export CSV : en-tête stable, aucun texte de ticket possible. */
export function exportAuditCsv(entries: AuditEntry[]): string {
  const header = AUDIT_COLUMNS.join(',');
  const rows = entries.map((entry) => {
    const clean = sanitizeEntry(entry);
    return AUDIT_COLUMNS.map((column) => String(clean[column])).join(',');
  });
  return [header, ...rows].join('\n');
}

/** Combien de champs ont été vidés à l'assainissement (honnêteté, §21). */
export function withheldCount(entries: AuditEntry[]): number {
  let held = 0;
  for (const entry of entries) {
    const clean = sanitizeEntry(entry);
    if (entry.sessionRef && !clean.sessionRef) held += 1;
    if (entry.detail && !clean.detail) held += 1;
    if (entry.action && !clean.action) held += 1;
    if (entry.issueId && !clean.issueId) held += 1;
    if (entry.fingerprint && !clean.fingerprint) held += 1;
  }
  return held;
}

/** Résumé lisible du journal : ce qu'il contient, et ce qui a été retenu. */
export function auditSummary(entries: AuditEntry[], language: Language = 'fr'): string {
  if (entries.length === 0) return t(language, 'session.audit.empty');
  const dates = entries.map((entry) => entry.at).filter((at) => safeDate(at) !== '');
  const held = withheldCount(entries);
  const text = t(language, 'session.audit.count', {
    count: entries.length,
    from: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : '-',
    to: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : '-',
  });
  return held > 0 ? `${text} ${t(language, 'session.audit.redacted')} : ${held}` : text;
}

/** Réglages de la détection de boucle (#30) — écrits, jamais implicites. */
export interface LoopSettings {
  /** Fenêtre glissante observée. */
  windowMs: number;
  /** Nombre de tickets distincts à partir duquel c'est une boucle. */
  threshold: number;
}

/** Par défaut : 5 tickets distincts en 5 minutes avec le même outil. */
export const DEFAULT_LOOP_SETTINGS: LoopSettings = {
  windowMs: 5 * 60 * 1000,
  threshold: 5,
};

/** Gravité : `watch` au seuil, `alert` au double (un ratissage assumé). */
export type LoopSeverity = 'watch' | 'alert';

/** Une boucle repérée : même session, même outil, N tickets en peu de temps. */
export interface LoopAlert {
  sessionRef: string;
  toolRef: string;
  /** Appels dans la fenêtre. */
  calls: number;
  /** Tickets distincts dans la fenêtre — le chiffre qui déclenche. */
  issueCount: number;
  windowMs: number;
  from: string;
  to: string;
  issueIds: readonly string[];
  severity: LoopSeverity;
}

/** Appel horodaté utilisable : outil, ticket et date lisibles. */
interface TimedCall {
  at: number;
  iso: string;
  sessionRef: string;
  toolRef: string;
  issueId: string;
}

/** Ne garde que ce qui peut prouver une boucle, trié par date croissante. */
function timedCalls(entries: AuditEntry[]): TimedCall[] {
  const calls: TimedCall[] = [];
  for (const entry of entries) {
    const toolRef = safe(entry.toolRef);
    const issueId = safe(entry.issueId);
    const sessionRef = safe(entry.sessionRef);
    if (!toolRef || !issueId || !sessionRef) continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) continue;
    calls.push({ at, iso: entry.at, sessionRef, toolRef, issueId });
  }
  return calls.sort((a, b) => a.at - b.at || a.iso.localeCompare(b.iso));
}

/** Regroupe par session et par outil : une boucle est toujours locale. */
function groupCalls(calls: TimedCall[]): Map<string, TimedCall[]> {
  const groups = new Map<string, TimedCall[]>();
  for (const call of calls) {
    const key = [call.sessionRef, call.toolRef].join('|');
    const group = groups.get(key);
    if (group) group.push(call);
    else groups.set(key, [call]);
  }
  return groups;
}

/** Construit l'alerte d'une fenêtre : tickets distincts, bornes, gravité. */
function toAlert(windowCalls: TimedCall[], settings: LoopSettings): LoopAlert | null {
  const first = windowCalls[0];
  const last = windowCalls[windowCalls.length - 1];
  if (!first || !last) return null;
  const issueIds = [...new Set(windowCalls.map((call) => call.issueId))].sort();
  if (issueIds.length < settings.threshold) return null;
  return {
    sessionRef: first.sessionRef,
    toolRef: first.toolRef,
    calls: windowCalls.length,
    issueCount: issueIds.length,
    windowMs: settings.windowMs,
    from: first.iso,
    to: last.iso,
    issueIds,
    severity: issueIds.length >= settings.threshold * 2 ? 'alert' : 'watch',
  };
}

/** Pire fenêtre d'un groupe : la plus riche en tickets distincts. */
function worstWindow(calls: TimedCall[], settings: LoopSettings): LoopAlert | null {
  let best: LoopAlert | null = null;
  for (let start = 0; start < calls.length; start += 1) {
    const from = calls[start]!.at;
    const slice: TimedCall[] = [];
    for (let index = start; index < calls.length; index += 1) {
      if (calls[index]!.at - from > settings.windowMs) break;
      slice.push(calls[index]!);
    }
    const alert = toAlert(slice, settings);
    if (!alert) continue;
    if (!best || alert.issueCount > best.issueCount
      || (alert.issueCount === best.issueCount && alert.calls > best.calls)) {
      best = alert;
    }
  }
  return best;
}

/**
 * Détecte les boucles d'agent (#30) : même outil promené sur au moins
 * `threshold` tickets distincts dans `windowMs`. Déterministe — mêmes entrées,
 * mêmes alertes — et borné par `MAX_AUDIT_ENTRIES`.
 */
export function detectAgentLoops(
  entries: AuditEntry[],
  settings: LoopSettings = DEFAULT_LOOP_SETTINGS,
): LoopAlert[] {
  if (settings.threshold < 2 || settings.windowMs <= 0) return [];
  const alerts: LoopAlert[] = [];
  for (const calls of groupCalls(timedCalls(entries)).values()) {
    const alert = worstWindow(calls, settings);
    if (alert) alerts.push(alert);
  }
  return alerts.sort((a, b) => b.issueCount - a.issueCount
    || b.calls - a.calls
    || a.toolRef.localeCompare(b.toolRef));
}

/** L'alerte la plus grave, ou `null` — ce que consomme la politique (#27). */
export function detectAgentLoop(
  entries: AuditEntry[],
  settings: LoopSettings = DEFAULT_LOOP_SETTINGS,
): LoopAlert | null {
  return detectAgentLoops(entries, settings)[0] ?? null;
}

/** Motif lisible d'une boucle, tel que le hook l'affichera (§11). */
export function loopMessage(alert: LoopAlert, language: Language = 'fr'): string {
  const seconds = Math.max(1, Math.round(alert.windowMs / 1000));
  return t(language, 'session.decision.loop', {
    tool: alert.toolRef,
    count: alert.issueCount,
    seconds,
  });
}

/** Journalise l'alerte (#28) : la boucle laisse une trace, sans texte. */
export function recordLoopAlert(
  entries: AuditEntry[],
  alert: LoopAlert,
  now: string,
): AuditEntry[] {
  return recordAudit(entries, {
    at: now,
    sessionRef: alert.sessionRef,
    accountId: '',
    kind: 'loop-alert',
    toolRef: alert.toolRef,
    detail: 'session.decision.loop',
  });
}
