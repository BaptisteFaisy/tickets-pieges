/**
 * Le pipeline d'analyse (§18) — les cinq étapes, dans l'ordre, une seule fois.
 *
 * 1. l'origine est calculée aussitôt, sans modèle, et écrite dans la propriété ;
 * 2. les couches C1, C2 (et la pondération C4) passent dans la foulée ;
 * 3. la couche C3 est mise en file — jamais en ligne sur le chemin de l'événement ;
 * 4. le niveau de suspicion est fixé, le mode du projet s'applique ;
 * 5. tout est journalisé.
 *
 * Ce fichier est du glue : il ne contient aucune règle du domaine. Tout est
 * injecté (`PipelineDeps`), donc testable avec le `Store` en mémoire et des
 * doubles de `JiraPort` / `ModelPort`, sans réseau ni site Atlassian.
 */

import type {
  AttachmentMeta,
  Finding,
  IssueState,
  Language,
  LayerHit,
  ProjectSettings,
  SegmentSource,
  SuspicionLevel,
} from '../core/types';
import { computeOrigin } from '../core/origin';
import { defaultSettings } from '../core/trust-rules';
import { detectConcealment } from '../core/c1-concealment';
import { detectAddressing } from '../core/c2-addressing';
import { contextHits, contextScore, type IssueContext } from '../core/context';
import { toFindings } from '../core/findings';
import { computeSuspicion, toIssueState } from '../core/suspicion';
import { decideMode, prependBanner, type ModeDecision } from '../core/modes';
import { neutralizeText, type JournalEntry } from '../core/neutralize';
import { isExternal } from '../core/levels';
import { contentHash, randomToken } from '../core/hashing';
import type { Clock, JiraPort, ModelPort, SegmentRow, Store } from '../platform/schema';

/** Ce dont le pipeline a besoin : rien n'est construit ici. */
export interface PipelineDeps {
  store: Store;
  jira: JiraPort;
  clock: Clock;
  /** Port du modèle hébergé, utilisé seulement par la couche C3 (§6). */
  model?: ModelPort;
  /** Mise en file de la couche C3 (`pieges-c3`) — absente en test. */
  enqueueC3?: (message: { issueId: string; segmentId: string }) => Promise<void>;
  settings?: ProjectSettings;
}

/** Résultat d'une analyse : ce qui a été écrit, et ce qui reste à faire. */
export interface ScanResult {
  issueKey: string;
  state: IssueState;
  mode: ModeDecision;
  findings: Finding[];
  journal: JournalEntry[];
  queuedForC3: number;
  unanalyzed: number;
}

/** Identifiant stable d'un segment : même ticket, même champ, même segment. */
export function segmentId(issueId: string, field: SegmentSource['field'], refId?: string): string {
  return `${issueId}:${field}:${refId ?? '-'}`;
}

/**
 * Les segments d'une demande (§4) : résumé, description, chaque commentaire,
 * chaque nom de pièce jointe, le nom affiché du demandeur. Tous sont des
 * segments comme les autres (§22).
 */
export function segmentsOf(
  issue: Awaited<ReturnType<JiraPort['getIssue']>>,
  comments: Awaited<ReturnType<JiraPort['listComments']>>,
  attachments: Awaited<ReturnType<JiraPort['listAttachments']>>,
): SegmentSource[] {
  const base = {
    issueId: issue.id,
    issueKey: issue.key,
    projectKey: issue.projectKey,
    channel: issue.channel,
    createdAt: issue.createdAt,
  };
  const segments: SegmentSource[] = [
    { ...base, field: 'summary', text: issue.summary, author: issue.reporter },
    { ...base, field: 'description', text: issue.description, author: issue.reporter },
    { ...base, field: 'reporterName', text: issue.reporter.displayName ?? '', author: issue.reporter },
  ];
  for (const comment of comments) {
    segments.push({
      ...base,
      field: 'comment',
      refId: comment.id,
      text: comment.body,
      author: comment.author,
      visibility: comment.visibility,
      createdAt: comment.createdAt,
    });
  }
  segments.push(...attachmentSegments(base, attachments));
  return segments.filter((segment) => segment.text.length > 0);
}


type SegmentBase = Pick<SegmentSource, 'issueId' | 'issueKey' | 'projectKey' | 'channel' | 'createdAt'>;

/** Les segments d'une pièce jointe : son nom toujours, son texte s'il est lisible (§22). */
function attachmentSegments(
  base: SegmentBase,
  attachments: Awaited<ReturnType<JiraPort['listAttachments']>>,
): SegmentSource[] {
  const out: SegmentSource[] = [];
  for (const file of attachments) {
    const attachment = attachmentMeta(file);
    out.push({
      ...base,
      field: 'attachmentName',
      refId: file.id,
      text: file.fileName,
      author: file.author,
      createdAt: file.createdAt,
      attachment,
    });
    if (file.text) {
      out.push({
        ...base,
        field: 'attachmentText',
        refId: file.id,
        text: file.text,
        author: file.author,
        createdAt: file.createdAt,
        attachment,
      });
    }
  }
  return out;
}

/** Métadonnées d'une pièce jointe : ce qui n'est pas lisible est marqué (§22). */
function attachmentMeta(file: { fileName: string; mimeType: string; sizeBytes: number; text?: string }): AttachmentMeta {
  const textual = file.mimeType.startsWith('text/') || file.mimeType === 'application/pdf';
  return {
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    parseable: Boolean(file.text) || (textual && file.sizeBytes < 2_000_000),
  };
}

/** Ce qui n'a pas pu être analysé, dit au lieu d'être tu (§21). */
export function unanalyzedOf(segments: SegmentSource[]): IssueState['unanalyzed'] {
  const reasons = new Set<IssueState['unanalyzed'][number]>();
  for (const segment of segments) {
    const file = segment.attachment;
    if (!file || file.parseable) continue;
    if (file.mimeType.startsWith('image/')) reasons.add('image');
    else if (file.sizeBytes >= 2_000_000) reasons.add('oversize');
    else reasons.add(file.mimeType === 'application/pdf' ? 'unsupported-format' : 'binary-attachment');
  }
  return [...reasons];
}

/** Étapes 1 et 2 : origine de chaque segment, puis couches C1, C2 et C4. */
async function scanSegments(
  deps: PipelineDeps,
  segments: SegmentSource[],
  settings: ProjectSettings,
  context: IssueContext,
  now: string,
): Promise<{ origins: Awaited<ReturnType<typeof computeOrigin>>[]; findings: Finding[]; queued: number }> {
  const origins = segments.map((segment) => computeOrigin(segment, settings));
  const findings: Finding[] = [];
  let queued = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as SegmentSource;
    const id = segmentId(segment.issueId, segment.field, segment.refId);
    const origin = origins[index]!;
    await deps.store.segments.put(segmentRow(id, segment, origin.trustLevel, now));

    const hits: LayerHit[] = [
      ...detectConcealment({ text: segment.text, language: settings.language }),
      ...detectAddressing(segment.text, { language: settings.language, ignoredPhrases: settings.ignoredPhrases }),
      ...contextHits(segment, context, { now, language: settings.language }),
    ];
    const produced = toFindings({ hits, segment, segmentId: id, language: settings.language, now });
    for (const finding of produced) {
      if (!(await deps.store.findings.byId(finding.id))) await deps.store.findings.put(finding);
    }
    findings.push(...produced);

    if (settings.c3Enabled && isExternal(origin.trustLevel)) {
      queued += 1;
      await deps.enqueueC3?.({ issueId: segment.issueId, segmentId: id });
    }
  }
  return { origins, findings, queued };
}

/** La ligne `segment` du §19. */
function segmentRow(
  id: string,
  segment: SegmentSource,
  trustLevel: SegmentRow['trustLevel'],
  now: string,
): SegmentRow {
  return {
    id,
    issueId: segment.issueId,
    field: segment.field,
    refId: segment.refId ?? null,
    authorAccountId: segment.author.accountId,
    accountType: segment.author.accountType,
    orgId: segment.author.organizationId ?? null,
    channel: segment.channel,
    visibility: segment.visibility ?? null,
    trustLevel,
    contentHash: contentHash(segment.text),
    text: segment.text,
    scannedAt: now,
  };
}

/** Étape 4 bis : appliquer le mode décidé (§8.1), en journalisant chaque geste. */
async function applyMode(
  deps: PipelineDeps,
  issueKey: string,
  state: IssueState,
  decision: ModeDecision,
  segments: SegmentSource[],
  findings: Finding[],
  settings: ProjectSettings,
  now: string,
): Promise<JournalEntry[]> {
  if (decision.mode === 'label' && decision.banner) {
    const current = await readDescription(deps, issueKey);
    await deps.jira.prependToField(issueKey, 'description', prependBanner(current, decision.banner));
    await deps.store.events.append('label-applied', state.issueId, { issueKey, mode: 'label' });
  }
  if (!decision.neutralize) return [];

  const journal: JournalEntry[] = [];
  for (const segment of segments) {
    const entries = await neutralizeSegment(deps, issueKey, segment, findings, settings, now);
    journal.push(...entries);
  }
  return journal;
}


/** Neutralise un segment : original conservé, constats marqués, texte remplacé (§8.3). */
async function neutralizeSegment(
  deps: PipelineDeps,
  issueKey: string,
  segment: SegmentSource,
  findings: Finding[],
  settings: ProjectSettings,
  now: string,
): Promise<JournalEntry[]> {
  const id = segmentId(segment.issueId, segment.field, segment.refId);
  const own = findings.filter((finding) => finding.segmentId === id && finding.status === 'open');
  if (own.length === 0) return [];
  const outcome = neutralizeText({
    segmentId: id,
    issueId: segment.issueId,
    issueKey,
    text: segment.text,
    findings: own,
    language: settings.language,
    now,
    originalId: `orig-${randomToken(6)}`,
  });
  if (outcome.noop) return [];
  await deps.store.originals.put({
    id: outcome.result.originalId,
    segmentId: id,
    issueId: segment.issueId,
    content: outcome.original,
    findingIds: outcome.result.mentionRefs,
    storedAt: now,
    restoredAt: null,
  });
  for (const finding of own) await deps.store.findings.setStatus(finding.id, 'neutralized');
  await deps.jira.replaceSegmentText(issueKey, segment.field, segment.refId ?? null, outcome.result.replacedText);
  return outcome.journal;
}

/** Description actuelle, pour un ajout seulement (§8.1). */
async function readDescription(deps: PipelineDeps, issueKey: string): Promise<string> {
  try {
    const issue = await deps.jira.getIssue(issueKey);
    return issue.description ?? '';
  } catch {
    return '';
  }
}

/** Écrit la propriété indexée (TP-07) : confiance et suspicion lisibles en JQL. */
async function writeProperty(deps: PipelineDeps, state: IssueState, language: Language): Promise<void> {
  void language;
  await deps.store.states.put({
    issueId: state.issueId,
    issueKey: state.issueKey,
    projectKey: state.projectKey,
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: state.modeApplied,
    unanalyzed: state.unanalyzed,
    inheritedFrom: state.inheritedFrom ?? null,
    updatedAt: state.updatedAt,
  });
  await deps.jira.setEntityProperty(state.issueKey, 'pieges', {
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: state.modeApplied,
    analyzedAt: state.updatedAt,
    unanalyzed: state.unanalyzed.length,
  });
}

/**
 * Analyse complète d'une demande. C'est LA fonction appelée par les triggers, le
 * consumer et le banc d'essai : une seule implémentation, zéro duplication.
 */
export async function scanIssue(deps: PipelineDeps, issueKey: string): Promise<ScanResult> {
  const now = deps.clock.now();
  const [issue, comments, attachments] = await Promise.all([
    deps.jira.getIssue(issueKey),
    deps.jira.listComments(issueKey),
    deps.jira.listAttachments(issueKey),
  ]);
  const settings = deps.settings ?? (await deps.store.settings.get(issue.projectKey)) ?? defaultSettings(issue.projectKey);
  const segments = segmentsOf(issue, comments, attachments);
  const unanalyzed = unanalyzedOf(segments);
  const context: IssueContext = { unparseableAttachment: unanalyzed.length > 0 };

  const scanned = await scanSegments(deps, segments, settings, context, now);
  const suspicion: SuspicionLevel = computeSuspicion({
    findings: scanned.findings,
    contextScore: contextScore(segments.flatMap((s) => contextHits(s, context, { now, language: settings.language }))),
  });
  const state = toIssueState({
    issue: { issueId: issue.id, issueKey: issue.key, projectKey: issue.projectKey },
    origins: scanned.origins,
    findings: scanned.findings,
    mode: settings.mode,
    unanalyzed,
    now,
  });
  const decision = decideMode(state, settings, settings.language);
  await writeProperty(deps, { ...state, suspicionLevel: suspicion, modeApplied: decision.mode }, settings.language);

  const journal = await applyMode(deps, issue.key, state, decision, segments, scanned.findings, settings, now);
  await deps.store.events.append('scan', issue.id, {
    issueKey: issue.key,
    trust: state.trustLevel,
    suspicion,
    findings: scanned.findings.length,
    mode: decision.mode,
    queued: scanned.queued,
  });

  return {
    issueKey: issue.key,
    state: { ...state, suspicionLevel: suspicion, modeApplied: decision.mode },
    mode: decision,
    findings: scanned.findings,
    journal,
    queuedForC3: scanned.queued,
    unanalyzed: unanalyzed.length,
  };
}
