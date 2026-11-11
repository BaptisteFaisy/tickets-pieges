/**
 * Résolveur du bandeau et du panneau du ticket (§17.1) — lot UI.
 *
 * `getIssuePanel` : origine de chaque segment, niveau de suspicion, constats
 * (extrait borné + résumé neutre), mode appliqué, brouillons en attente. Le
 * bandeau n'apparaît que s'il y a quelque chose à dire (§21) et dit ce qui n'a
 * pas été analysé. Aucune exception ne remonte : `{ ok: false, error }`.
 */
import { pendingDrafts } from '../core/drafts';
import { boundedExcerpt, sortFindings } from '../core/findings';
import { t } from '../core/i18n';
import { labelBanner } from '../core/modes';
import { needsBanner } from '../core/suspicion';
import { defaultSettings } from '../core/trust-rules';
import type { Finding, IssueState, Language } from '../core/types';
import type { DraftRow, IssueStateRow, SegmentRow } from '../platform/schema';
import {
  fail,
  ok,
  payloadText,
  type FindingView,
  type PanelDraft,
  type PanelSegment,
  type PanelView,
  type ResolverDeps,
  type UiHandler,
} from '../ui/api';

function emptyPanel(issueKey: string, language: Language): PanelView {
  return {
    issueKey,
    language,
    banner: null,
    trustLevel: 'T0',
    suspicionLevel: 'clean',
    modeApplied: 'report',
    unanalyzed: ['model-pending'],
    analyzedShare: 0,
    segments: [],
    findings: [],
    drafts: [],
    updatedAt: '',
  };
}

function segmentView(row: SegmentRow): PanelSegment {
  return {
    segmentId: row.id,
    field: row.field,
    trustLevel: row.trustLevel,
    accountType: row.accountType,
    channel: row.channel,
    scannedAt: row.scannedAt,
  };
}

function findingView(finding: Finding): FindingView {
  return {
    id: finding.id,
    layer: finding.layer,
    kind: finding.kind,
    ruleId: finding.ruleId,
    excerpt: boundedExcerpt(finding.excerpt),
    askSummary: finding.askSummary,
    confidence: finding.confidence,
    status: finding.status,
  };
}

function draftView(row: DraftRow): PanelDraft {
  return { id: row.id, text: row.text, createdAt: row.createdAt };
}

function toPanelView(
  state: IssueStateRow,
  segments: SegmentRow[],
  findings: Finding[],
  drafts: DraftRow[],
  language: Language,
): PanelView {
  const issueState: IssueState = {
    issueId: state.issueId,
    issueKey: state.issueKey,
    projectKey: state.projectKey,
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: state.modeApplied,
    analyzedSegments: segments.length,
    unanalyzed: state.unanalyzed,
    inheritedFrom: state.inheritedFrom ?? undefined,
    updatedAt: state.updatedAt,
  };
  const total = segments.length + state.unanalyzed.length;
  return {
    issueKey: state.issueKey,
    language,
    banner: needsBanner(issueState) ? labelBanner(issueState, language) : null,
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: state.modeApplied,
    unanalyzed: state.unanalyzed,
    analyzedShare: total === 0 ? 0 : Math.min(1, Number((segments.length / total).toFixed(2))),
    segments: segments.map(segmentView),
    findings: sortFindings(findings).map(findingView),
    drafts: drafts.map(draftView),
    updatedAt: state.updatedAt,
  };
}

/** Fabrique les gestionnaires du panneau du ticket. */
export function panelResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  const { store } = deps;

  const getIssuePanel: UiHandler = async (payload) => {
    const issueId = payloadText(payload, 'issueId');
    const issueKey = payloadText(payload, 'issueKey') ?? '';
    if (!issueId) return fail(t('fr', 'ui.error.missing', { name: 'issueId' }));
    try {
      const state = await store.states.get(issueId);
      if (!state) return ok(emptyPanel(issueKey, 'fr'));
      const settings = (await store.settings.get(state.projectKey)) ?? defaultSettings(state.projectKey);
      const segments = await store.segments.byIssue(issueId);
      const findings = await store.findings.byIssue(issueId);
      const drafts = pendingDrafts(await store.drafts.byIssue(issueId));
      return ok(toPanelView(state, segments, findings, drafts, settings.language));
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  return { getIssuePanel };
}
