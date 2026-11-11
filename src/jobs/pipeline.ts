/**
 * Le pipeline du §18 — une seule implémentation, réutilisée par les triggers
 * (`triggers.ts`) et par le consumer de la file C3 (`consumer.ts`).
 *
 * Les cinq étapes du cahier, dans l'ordre :
 *   1. l'origine de chaque segment est calculée sans modèle, l'état et la
 *      propriété indexée `pieges` sont écrits ;
 *   2. les couches déterministes passent dans la foulée (C2, C4 ; la C1 du lot
 *      C1 n'est pas encore sur `main` — son absence est journalisée, jamais
 *      compensée par une recopie) ;
 *   3. la couche C3 est mise en file `pieges-c3` — jamais en ligne (§6) ;
 *   4. le niveau de suspicion est fixé, le mode du projet s'applique ;
 *   5. chaque étape est journalisée (`store.events`).
 *
 * Ce fichier n'importe aucun `@forge/*` : les dépendances arrivent par
 * `JobsDeps` (voir `support.ts`), ce qui le rend testable sans réseau.
 */

import type {
  Finding,
  IssueState,
  LayerHit,
  ProjectSettings,
  SegmentOrigin,
  SegmentSource,
  UnanalyzedReason,
  Verdict,
} from '../core/types';
import { computeOrigins, issueTrustLevel } from '../core/origin';
import { detectAddressing } from '../core/c2-addressing';
import { contextHits, contextScore } from '../core/context';
import { toFindings } from '../core/findings';
import { toIssueState } from '../core/suspicion';
import { decideMode, type ModeDecision } from '../core/modes';
import { neutralizeText } from '../core/neutralize';
import { classifyPassage } from '../core/c3-model';
import type { IssueStateRow, JiraIssueView } from '../platform/schema';
import {
  c3Cache,
  collectSegments,
  loadSettings,
  makeSegmentId,
  segmentHash,
  sourceFromRow,
  type C3Message,
  type JobsDeps,
} from './support';

// --------------------------------------------------------------------- types

/** Options d'un passage du pipeline : pourquoi il tourne (journal). */
export interface AnalyzeOptions {
  reason: string;
}

/** Ce que rend un passage du pipeline. */
export interface PipelineResult {
  issueKey: string;
  state: IssueState;
  decision: ModeDecision;
  findings: Finding[];
  queuedSegments: number;
  unanalyzed: UnanalyzedReason[];
}

/** Un segment et les coups des couches déterministes. */
interface ScannedSegment {
  source: SegmentSource;
  segmentId: string;
  hits: LayerHit[];
}

// ------------------------------------------------------------------ étape 1-2

async function persistSegments(
  deps: JobsDeps,
  scanned: ScannedSegment[],
  origins: SegmentOrigin[],
  now: string,
): Promise<void> {
  for (let i = 0; i < scanned.length; i += 1) {
    const { source, segmentId } = scanned[i] as ScannedSegment;
    const origin = origins[i] as SegmentOrigin;
    await deps.store.segments.put({
      id: segmentId,
      issueId: source.issueId,
      field: source.field,
      refId: source.refId ?? null,
      authorAccountId: source.author.accountId,
      accountType: source.author.accountType,
      orgId: source.author.organizationId ?? null,
      channel: source.channel,
      visibility: source.visibility ?? null,
      trustLevel: origin.trustLevel,
      contentHash: segmentHash(source.text),
      text: source.text,
      scannedAt: now,
    });
  }
}

function medianLength(sources: SegmentSource[]): number {
  const lengths = sources.map((s) => s.text.length).sort((a, b) => a - b);
  if (lengths.length === 0) return 0;
  return lengths[Math.floor(lengths.length / 2)] ?? 0;
}

/** Couche C2 (adresse à une IA) + couche C4 (contexte), par segment. */
function scanDeterministic(
  sources: SegmentSource[],
  settings: ProjectSettings,
  now: string,
  unparseableAttachment: boolean,
): ScannedSegment[] {
  const context = { medianLength: medianLength(sources), unparseableAttachment };
  return sources.map((source) => {
    const c2 = detectAddressing(source.text, {
      language: settings.language,
      ignoredPhrases: settings.ignoredPhrases,
    });
    const c4 = contextHits(source, context, { now, language: settings.language });
    return { source, segmentId: makeSegmentId(source.issueId, source.field, source.refId), hits: [...c2, ...c4] };
  });
}

// ------------------------------------------------------------------ constats

/** Écrit des constats à identifiant stable : un verdict humain survit au rejeu. */
async function putFindings(deps: JobsDeps, created: Finding[], issueKey: string, now: string): Promise<void> {
  for (const finding of created) {
    const existing = await deps.store.findings.byId(finding.id);
    await deps.store.findings.put({ ...finding, status: existing?.status ?? 'open' });
    if (finding.campaignHash) await deps.store.campaigns.bump(finding.campaignHash, issueKey, now);
  }
}

async function loadVerdicts(deps: JobsDeps, findings: Finding[]): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const finding of findings) {
    for (const row of await deps.store.verdicts.byFinding(finding.id)) {
      verdicts.push({
        findingId: row.findingId,
        reviewerAccountId: row.reviewerAccountId,
        decision: row.decision,
        reason: row.reason ?? undefined,
        at: row.at,
      });
    }
  }
  return verdicts;
}

// ------------------------------------------------------------------ étape 3

/** Mise en file de la couche C3 : un échec de file est journalisé, pas perdu. */
async function queueC3(deps: JobsDeps, scanned: ScannedSegment[], settings: ProjectSettings): Promise<number> {
  if (!settings.c3Enabled) {
    const first = scanned[0];
    if (first) await deps.store.events.append('c3.desactivee', first.source.issueId, { project: settings.projectKey });
    return 0;
  }
  let queued = 0;
  for (const { source, segmentId } of scanned) {
    const message: C3Message = { issueId: source.issueId, segmentId };
    try {
      await deps.enqueue(message);
      queued += 1;
    } catch {
      await deps.store.events.append('c3.echec-file', source.issueId, { segmentId });
    }
  }
  return queued;
}

// ------------------------------------------------------------------ étape 4

async function neutralizeSegments(
  deps: JobsDeps,
  scanned: ScannedSegment[],
  settings: ProjectSettings,
  now: string,
): Promise<void> {
  for (const { source, segmentId } of scanned) {
    const findings = (await deps.store.findings.bySegment(segmentId)).filter((f) => f.status === 'open');
    if (findings.length === 0) continue;
    const originalId = `original:${segmentId}`;
    const outcome = neutralizeText({
      segmentId, issueId: source.issueId, issueKey: source.issueKey, text: source.text,
      findings, language: settings.language, now, originalId,
    });
    if (outcome.noop) continue;
    await deps.store.originals.put({
      id: originalId, segmentId, issueId: source.issueId, content: outcome.original,
      findingIds: findings.map((f) => f.id), storedAt: now, restoredAt: null,
    });
    await deps.jira.replaceSegmentText(source.issueKey, source.field, source.refId ?? null, outcome.result.replacedText);
    await deps.store.events.append('mode.neutralisation', source.issueId, { segmentId, originalId });
  }
}

async function publishState(
  deps: JobsDeps,
  view: JiraIssueView,
  state: IssueState,
  decision: ModeDecision,
  now: string,
): Promise<void> {
  const row: IssueStateRow = {
    issueId: view.id,
    issueKey: view.key,
    projectKey: view.projectKey,
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: decision.mode,
    unanalyzed: state.unanalyzed,
    inheritedFrom: null,
    updatedAt: now,
  };
  await deps.store.states.put(row);
  await deps.jira.setEntityProperty(view.key, 'pieges', {
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: decision.mode,
    analyzedAt: now,
    unanalyzed: state.unanalyzed.length,
  });
  if (decision.banner && !view.description.includes(decision.banner)) {
    await deps.jira.prependToField(view.key, 'description', decision.banner);
  }
}

/** Étape 4 + 5 : suspicion fixée, mode appliqué, propriété écrite, journal. */
async function applyStateAndMode(
  deps: JobsDeps,
  view: JiraIssueView,
  scanned: ScannedSegment[],
  origins: SegmentOrigin[],
  unanalyzed: UnanalyzedReason[],
  settings: ProjectSettings,
  scoreContexte: number,
  now: string,
): Promise<{ state: IssueState; decision: ModeDecision; findings: Finding[] }> {
  const findings = await deps.store.findings.byIssue(view.id);
  const verdicts = await loadVerdicts(deps, findings);
  const state = toIssueState({
    issue: { issueId: view.id, issueKey: view.key, projectKey: view.projectKey },
    origins, findings, mode: settings.mode, unanalyzed, verdicts, contextScore: scoreContexte, now,
  });
  const decision = decideMode(state, settings, settings.language);
  await publishState(deps, view, state, decision, now);
  if (decision.neutralize) await neutralizeSegments(deps, scanned, settings, now);
  await deps.store.events.append('pipeline.suspicion', view.id, {
    niveau: state.suspicionLevel, confiance: state.trustLevel, mode: decision.mode, raisons: decision.reasons,
  });
  return { state: { ...state, modeApplied: decision.mode }, decision, findings };
}

// ---------------------------------------------------------------- le pipeline

/**
 * Le déroulement complet du §18 sur un ticket. C'est **la** fonction unique :
 * les cinq triggers et le consumer C3 l'appellent, personne ne la recopie.
 */
export async function analyzeIssue(
  deps: JobsDeps,
  issueIdOrKey: string,
  options: AnalyzeOptions,
): Promise<PipelineResult> {
  const now = deps.clock.now();
  const view = await deps.jira.getIssue(issueIdOrKey);
  const comments = await deps.jira.listComments(view.key);
  const attachments = await deps.jira.listAttachments(view.key);
  const settings = await loadSettings(deps.store, view.projectKey);
  const collected = collectSegments(view, comments, attachments);
  const origins = computeOrigins(collected.sources, settings);
  const scanned = scanDeterministic(
    collected.sources, settings, now, collected.unanalyzed.length > 0,
  );
  await persistSegments(deps, scanned, origins, now);
  await deps.store.events.append('pipeline.origine', view.id, {
    raison: options.reason, segments: scanned.length, confiance: issueTrustLevel(origins),
  });
  await deps.store.events.append('pipeline.c1-absente', view.id, { module: 'src/core/c1-concealment.ts' });
  for (const { source, segmentId, hits } of scanned) {
    await putFindings(deps, toFindings({ hits, segment: source, segmentId, language: settings.language, now }), view.key, now);
  }
  const queued = await queueC3(deps, scanned, settings);
  await deps.store.events.append('pipeline.c3-filee', view.id, { segments: queued });
  const unanalyzed: UnanalyzedReason[] = queued > 0 ? [...collected.unanalyzed, 'model-pending'] : collected.unanalyzed;
  const score = contextScore(scanned.flatMap((s) => s.hits));
  const applied = await applyStateAndMode(deps, view, scanned, origins, unanalyzed, settings, score, now);
  return { issueKey: view.key, queuedSegments: queued, unanalyzed, ...applied };
}

// ------------------------------------------------------------- consumer (C3)

/** Ce que rend le traitement d'un message de la file `pieges-c3`. */
export interface C3Outcome {
  ok: boolean;
  reason?: string;
  issueKey?: string;
  finding?: Finding | null;
}

/** Segments déjà passés par C3, d'après le journal (honnêteté du §21). */
async function c3DoneSegments(deps: JobsDeps, issueId: string): Promise<Set<string>> {
  const done = new Set<string>();
  for (const row of await deps.store.events.list(issueId, 500)) {
    if (row.kind !== 'c3.terminee') continue;
    try {
      const payload = JSON.parse(row.payload) as { segmentId?: string };
      if (payload.segmentId) done.add(payload.segmentId);
    } catch {
      // une ligne de journal illisible ne bloque pas le recalcul
    }
  }
  return done;
}

async function originsFromRows(deps: JobsDeps, issueId: string): Promise<SegmentOrigin[]> {
  const rows = await deps.store.segments.byIssue(issueId);
  return rows.map((row) => ({
    field: row.field,
    refId: row.refId ?? undefined,
    authorAccountId: row.authorAccountId,
    accountType: row.accountType,
    organizationId: row.orgId ?? undefined,
    channel: row.channel,
    visibility: row.visibility ?? undefined,
    trustLevel: row.trustLevel,
    reasons: [],
  }));
}

/**
 * Traite un message C3 : reconstruit le contexte depuis les lignes stockées,
 * appelle le modèle via le domaine (`classifyPassage`), écrit le constat à
 * identifiant stable et recalcule l'état. Rejouer un message ne duplique rien.
 */
export async function processC3Message(deps: JobsDeps, message: C3Message): Promise<C3Outcome> {
  const segment = await deps.store.segments.byId(message.segmentId);
  if (!segment) {
    await deps.store.events.append('c3.segment-introuvable', message.issueId, { segmentId: message.segmentId });
    return { ok: false, reason: 'segment-introuvable' };
  }
  const stateRow = await deps.store.states.get(segment.issueId);
  const issueKey = stateRow?.issueKey ?? segment.issueId;
  const settings = await loadSettings(deps.store, stateRow?.projectKey ?? 'INCONNU');
  const now = deps.clock.now();
  const hit = await classifyPassage(deps.model, segment.text, { language: settings.language, cache: c3Cache });
  const source = sourceFromRow(segment, issueKey, settings.projectKey);
  const created = hit ? toFindings({ hits: [hit], segment: source, segmentId: segment.id, language: settings.language, now }) : [];
  await putFindings(deps, created, issueKey, now);
  await deps.store.events.append('c3.terminee', segment.issueId, { segmentId: segment.id, coup: hit ? hit.ruleId : null });
  await refreshAfterC3(deps, segment.issueId, settings, now);
  return { ok: true, issueKey, finding: created[0] ?? null };
}

/** Recalcule état, propriété et mode après un avis C3 (étapes 4 et 5). */
async function refreshAfterC3(deps: JobsDeps, issueId: string, settings: ProjectSettings, now: string): Promise<void> {
  const stateRow = await deps.store.states.get(issueId);
  if (!stateRow) return;
  const view = await deps.jira.getIssue(stateRow.issueKey);
  const rows = await deps.store.segments.byIssue(issueId);
  const done = await c3DoneSegments(deps, issueId);
  const pending = rows.some((row) => !done.has(row.id));
  const unanalyzed = [...stateRow.unanalyzed.filter((r) => r !== 'model-pending'), ...(pending ? ['model-pending' as const] : [])];
  const scanned: ScannedSegment[] = rows.map((row) => ({
    source: sourceFromRow(row, stateRow.issueKey, stateRow.projectKey),
    segmentId: row.id,
    hits: [],
  }));
  const origins = await originsFromRows(deps, issueId);
  await applyStateAndMode(deps, view, scanned, origins, unanalyzed, settings, 0, now);
}
