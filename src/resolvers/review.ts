/**
 * Résolveur de la revue d'un constat (§17.3) — lot UI.
 *
 * `getFinding` : extrait dans son contexte (rendu inerte), règle déclenchée et
 * sa précision, verdicts précédents. `restoreFinding` : restauration d'une
 * neutralisation — l'original est marqué restauré, le constat passe à
 * « restored », tout est journalisé (§8.3, §21 réversibilité).
 * Aucune exception ne remonte : `{ ok: false, error }`.
 */
import { t } from '../core/i18n';
import { inertDisplay, restoreText } from '../core/neutralize';
import type { Finding } from '../core/types';
import type { Store } from '../platform/schema';
import { fail, ok, payloadText, type FindingReview, type ResolverDeps, type UiHandler } from '../ui/api';

const CONTEXT_MARGIN = 120;

/** Extrait du segment autour du constat, rendu inerte (jamais du markup). */
export function contextAround(text: string, startPos: number, endPos: number): string {
  const from = Math.max(0, startPos - CONTEXT_MARGIN);
  const to = Math.min(text.length, endPos + CONTEXT_MARGIN);
  return inertDisplay(text.slice(from, to), 600);
}

async function buildReview(store: Store, finding: Finding): Promise<FindingReview> {
  const state = await store.states.get(finding.issueId);
  const segment = await store.segments.byId(finding.segmentId);
  const original = await store.originals.bySegment(finding.segmentId);
  const patterns = await store.patterns.list();
  const rule = patterns.find((row) => row.id === finding.ruleId) ?? null;
  const verdictRows = await store.verdicts.byFinding(finding.id);
  return {
    findingId: finding.id,
    issueKey: state?.issueKey ?? finding.issueId,
    layer: finding.layer,
    kind: finding.kind,
    ruleId: finding.ruleId,
    excerpt: inertDisplay(finding.excerpt),
    askSummary: finding.askSummary,
    confidence: finding.confidence,
    status: finding.status,
    context: segment ? contextAround(segment.text, finding.startPos, finding.endPos) : null,
    rulePrecision: rule?.precision ?? null,
    ruleDemoted: rule?.demoted ?? false,
    verdicts: verdictRows
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((row) => ({ decision: row.decision, reason: row.reason, at: row.at })),
    originalId: original?.id ?? null,
  };
}

/** Fabrique les gestionnaires de la revue d'un constat. */
export function reviewResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  const { store, clock } = deps;

  const getFinding: UiHandler = async (payload) => {
    const findingId = payloadText(payload, 'findingId');
    if (!findingId) return fail(t('fr', 'ui.error.missing', { name: 'findingId' }));
    try {
      const finding = await store.findings.byId(findingId);
      if (!finding) return fail(t('fr', 'ui.error.notFound', { name: findingId }));
      return ok(await buildReview(store, finding));
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  const restoreFinding: UiHandler = async (payload) => {
    const findingId = payloadText(payload, 'findingId');
    if (!findingId) return fail(t('fr', 'ui.error.missing', { name: 'findingId' }));
    try {
      const finding = await store.findings.byId(findingId);
      if (!finding) return fail(t('fr', 'ui.error.notFound', { name: findingId }));
      const original = await store.originals.bySegment(finding.segmentId);
      if (!original) return fail(t('fr', 'ui.review.noOriginal'));
      const now = clock.now();
      const { journal } = restoreText(original.content, {
        issueKey: (await store.states.get(finding.issueId))?.issueKey ?? finding.issueId,
        segmentId: finding.segmentId,
        originalId: original.id,
        reason: payloadText(payload, 'reason') ?? 'ui',
        at: now,
        by: payloadText(payload, 'by') ?? 'security',
      });
      await store.originals.markRestored(original.id, now);
      await store.findings.setStatus(findingId, 'restored');
      for (const entry of journal) {
        await store.events.append(entry.kind, finding.issueId, entry.detail);
      }
      return ok({ findingId });
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };

  return { getFinding, restoreFinding };
}
