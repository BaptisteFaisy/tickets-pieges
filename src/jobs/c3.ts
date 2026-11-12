/**
 * Couche C3 hors du chemin de l'événement (§18, étape 3).
 *
 * Le message de la file porte l'identifiant d'un segment ; le travail consiste à
 * faire lire ce segment par le modèle, puis à conserver le constat et à mettre à
 * jour l'état du ticket. La lecture est **idempotente** : un message rejoué ne
 * duplique pas les constats (leurs identifiants sont stables, §6).
 */

import { classifyPassage } from '../core/c3-model';
import { toFindings } from '../core/findings';
import { computeSuspicion, toIssueState } from '../core/suspicion';
import { defaultSettings } from '../core/trust-rules';
import { randomBlockId } from '../core/hashing';
import type { Finding, SegmentSource, SuspicionLevel, IssueState } from '../core/types';
import type { SegmentRow, Store } from '../platform/schema';
import { writeProperty, type PipelineDeps } from './pipeline';

/** Ce que la couche C3 produit sur un segment. */
export interface C3Outcome {
  segmentId: string;
  findings: number;
  malformed: boolean;
  reason?: string;
}

/** Reconstruit un segment minimal depuis la ligne stockée (§19). */
function segmentOf(row: SegmentRow): SegmentSource {
  return {
    issueId: row.issueId,
    issueKey: '',
    projectKey: '',
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


/** Recalcule la suspicion après un avis du modèle et met à jour l'état (§18, étape 4). */
async function persistAfterC3(
  deps: PipelineDeps,
  issueId: string,
  existing: Awaited<ReturnType<Store['states']['get']>>,
  now: string,
): Promise<SuspicionLevel> {
  const findings = await deps.store.findings.byIssue(issueId);
  const suspicion = computeSuspicion({ findings });
  if (existing) {
    const next = { ...existing, suspicionLevel: suspicion, updatedAt: now };
    await deps.store.states.put(next);
    // La propriété indexée doit suivre : c'est elle que l'agent et le support
    // lisent (TP-07). Le mode appliqué est celui déjà décidé à l'étape 4.
    const state: IssueState = {
      issueId: next.issueId,
      issueKey: next.issueKey,
      projectKey: next.projectKey,
      trustLevel: next.trustLevel,
      suspicionLevel: next.suspicionLevel,
      modeApplied: next.modeApplied,
      analyzedSegments: 0,
      unanalyzed: next.unanalyzed,
      inheritedFrom: next.inheritedFrom ?? undefined,
      updatedAt: next.updatedAt,
    };
    await writeProperty(deps, state, deps.settings?.language ?? 'fr');
  }
  return suspicion;
}

/**
 * Fait classer un segment par le modèle, conserve le constat obtenu et met à
 * jour l'état du ticket. Un modèle indisponible ne casse rien : les couches C1
 * et C2 restent valides (§20, repli prévu).
 */
export async function runC3OnSegment(
  deps: PipelineDeps,
  issueId: string,
  segmentId: string,
): Promise<C3Outcome> {
  const row = await deps.store.segments.byId(segmentId);
  if (!row) return { segmentId, findings: 0, malformed: false, reason: 'segment-inconnu' };
  const now = deps.clock.now();
  const existing = await deps.store.states.get(issueId);
  const settings = deps.settings
    ?? (existing ? await deps.store.settings.get(existing.projectKey) : null)
    ?? defaultSettings(existing?.projectKey ?? '');
  const language = settings.language;

  const hit = await classifyPassage(deps.model ?? { classify: async () => '' }, row.text, {
    language,
    blockId: randomBlockId(),
  });
  if (!hit) return { segmentId, findings: 0, malformed: false, reason: 'modele-indisponible' };

  const segment = segmentOf(row);
  const produced = toFindings({
    hits: [hit],
    segment,
    segmentId,
    language,
    now,
  });
  const stored: Finding[] = [];
  for (const finding of produced) {
    if (await deps.store.findings.byId(finding.id)) continue;
    await deps.store.findings.put(finding);
    stored.push(finding);
  }

  const suspicion = await persistAfterC3(deps, issueId, existing, now);
  await deps.store.events.append('c3', issueId, { segmentId, findings: stored.length, suspicion });

  return {
    segmentId,
    findings: stored.length,
    malformed: hit.kind === 'model-malformed',
  };
}

/** Recalcule l'état d'un ticket à partir des constats déjà conservés. */
export async function refreshState(
  deps: PipelineDeps,
  issueId: string,
  issueKey: string,
  projectKey: string,
): Promise<void> {
  const now = deps.clock.now();
  const findings = await deps.store.findings.byIssue(issueId);
  const state = await deps.store.states.get(issueId);
  const next = toIssueState({
    issue: { issueId, issueKey, projectKey },
    origins: (await deps.store.segments.byIssue(issueId)).map((item) => ({
      field: item.field,
      refId: item.refId ?? undefined,
      authorAccountId: item.authorAccountId,
      accountType: item.accountType,
      organizationId: item.orgId ?? undefined,
      channel: item.channel,
      visibility: item.visibility ?? undefined,
      trustLevel: item.trustLevel,
      reasons: [],
    })),
    findings,
    mode: state?.modeApplied ?? 'report',
    unanalyzed: state?.unanalyzed ?? [],
    now,
  });
  await deps.store.states.put({
    issueId: next.issueId,
    issueKey: next.issueKey,
    projectKey: next.projectKey,
    trustLevel: next.trustLevel,
    suspicionLevel: next.suspicionLevel,
    modeApplied: next.modeApplied,
    unanalyzed: next.unanalyzed,
    inheritedFrom: next.inheritedFrom ?? null,
    updatedAt: next.updatedAt,
  });
}
