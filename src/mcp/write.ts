/**
 * Les deux outils d'écriture du §16 — lot MCP.
 *
 * Verbe `CREATE` dans le manifeste : un agent lancé par une règle
 * d'automatisation ne peut pas les appeler (§16). Ils écrivent peu et toujours
 * tracé : un brouillon en note interne pour `propose-public-reply` (§10, §23.10),
 * un constat de couche C4 pour `report-suspicion` (§16 : un agent qui remarque
 * une charge est un capteur, pas un exécutant). Jamais de commentaire public,
 * jamais d'exception : l'enveloppe de `src/mcp/result.ts` dit tout.
 */

import { createDraft, decidePublication } from '../core/drafts';
import { contentHash, randomToken } from '../core/hashing';
import { toFindings } from '../core/findings';
import { checkOutbound as gateCheck, outboundCaveats } from '../core/outbound';
import type { LayerHit, Language, OutboundVerdict, SegmentSource } from '../core/types';
import type { DraftRow } from '../platform/schema';
import { optionalText, requireText, run, type Tool } from './result';
import {
  findingView,
  journal,
  loadBundle,
  outboundContextOf,
  segmentSourceOf,
  serviceWarnings,
  services,
  type IssueBundle,
} from './service';

/** Règle du constat ouvert par un agent : stable, distincte des couches C1 à C4. */
export const AGENT_RULE_ID = 'C4-AGENT';

/** Confiance d'un signalement d'agent : assez pour « à vérifier », pas pour trancher. */
export const AGENT_CONFIDENCE = 0.5;

/** Compte par défaut d'un agent Rovo qui n'annonce pas son identifiant. */
const AGENT_ACCOUNT = 'rovo-agent';

// -------------------------------------------------- propose-public-reply (§10)

/** Brouillon en note interne, en attente de publication par un humain. */
export const proposePublicReply: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const text = requireText(payload, 'text');
    const authorAccountId = optionalText(payload, 'authorAccountId') ?? AGENT_ACCOUNT;
    const bundle = await loadBundle(issueKey);
    const context = outboundContextOf(bundle);
    warnings.push(...outboundCaveats(context, bundle.language));
    const verdict = gateCheck(text, context, {
      language: bundle.language,
      now: bundle.now,
      stage: 'before',
    });
    const draft = createDraft({
      id: `draft-${randomToken(6)}`,
      issueId: bundle.issue.id,
      issueKey: bundle.issue.key,
      text,
      authorAccountId,
      now: bundle.now,
    });
    // Aucune relecture humaine à ce stade : la décision reste « interne » (§10).
    const decision = decidePublication(draft, verdict, false, {
      language: bundle.language,
      now: bundle.now,
      reviewerAccountId: authorAccountId,
    });
    await storeDraft(bundle, draft, verdict, authorAccountId);
    const internalNoteId = await services().jira.addInternalNote(
      bundle.issue.key,
      noteBody(draft, decision.reason, verdict, bundle.language),
    );
    await journalizeDraft(bundle, draft, decision.journal.map((entry) => entry.kind), verdict, authorAccountId);
    if (!verdict.allowed) warnings.push(heldWarning(bundle.language, verdict.action));
    return {
      draftId: draft.id,
      issueKey: bundle.issue.key,
      visibility: decision.visibility,
      published: false,
      pending: true,
      reason: decision.reason,
      internalNoteId,
      gate: { allowed: verdict.allowed, action: verdict.action, hits: verdict.hits },
    };
  }, warnings);
};

/** Brouillon + contrôle du sas en stock : la publication relira les deux (§10). */
async function storeDraft(
  bundle: IssueBundle,
  draft: DraftRow,
  verdict: OutboundVerdict,
  actorAccountId: string,
): Promise<void> {
  const store = services().store;
  await store.drafts.put(draft);
  await store.outbound.put({
    id: `outbound-${randomToken(6)}`,
    issueId: bundle.issue.id,
    commentId: null,
    actorAccountId,
    actorType: 'ai-agent',
    action: verdict.action,
    hits: JSON.stringify(verdict.hits),
    at: bundle.now,
  });
}

/** Journal d'un brouillon : ce que l'app a fait, et pourquoi (§8.3). */
async function journalizeDraft(
  bundle: IssueBundle,
  draft: DraftRow,
  kinds: string[],
  verdict: OutboundVerdict,
  actorAccountId: string,
): Promise<void> {
  for (const kind of kinds) {
    await journal(kind, bundle.issue.id, { draftId: draft.id, action: verdict.action });
  }
  await journal('draft-proposed', bundle.issue.id, {
    draftId: draft.id,
    issueKey: bundle.issue.key,
    visibility: 'internal',
    action: verdict.action,
    by: actorAccountId,
  });
}

/** Corps de la note interne : le brouillon, son état, et ce que le sas en dit. */
function noteBody(
  draft: DraftRow,
  reason: string,
  verdict: OutboundVerdict,
  language: Language,
): string {
  const fr = language === 'fr';
  const title = fr
    ? 'Brouillon de réponse — en attente de publication par un humain'
    : 'Draft reply — waiting for a human to publish';
  const gate = fr
    ? `Sas de sortie : ${verdict.action} (${verdict.hits.length} élément(s) en cause).`
    : `Outbound gate: ${verdict.action} (${verdict.hits.length} item(s) flagged).`;
  const hits = verdict.hits.map((hit) => `- ${hit.kind} : ${hit.excerpt}`);
  const footer = fr
    ? 'Rien n’est visible du client tant qu’un humain n’a pas relu et publié (§10).'
    : 'Nothing is visible to the customer until a human reviews and publishes it (§10).';
  return [title, reason, gate, ...hits, '', draft.text, '', footer].join('\n');
}

function heldWarning(language: Language, action: string): string {
  return language === 'fr'
    ? `le sas retient ce texte (décision « ${action} ») : le brouillon reste interne`
    : `the outbound gate holds this text (decision “${action}”): the draft stays internal`;
}

// ----------------------------------------------------- report-suspicion (§16)

/** Constat ouvert par un agent qui remarque une consigne dans une donnée. */
export const reportSuspicion: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const excerpt = requireText(payload, 'excerpt');
    const reason = requireText(payload, 'reason');
    const reporterAccountId = optionalText(payload, 'reporterAccountId') ?? AGENT_ACCOUNT;
    const bundle = await loadBundle(issueKey);
    const source = reportedSource(bundle);
    const hit = agentHit(excerpt, reason, source.text);
    const findings = toFindings({
      hits: [hit],
      segment: source,
      segmentId: reportedSegmentId(bundle),
      language: bundle.language,
      now: bundle.now,
    });
    const finding = findings[0];
    if (!finding) throw new Error('le signalement n’a produit aucun constat');
    const campaign = await services().store.campaigns.bump(
      finding.campaignHash ?? contentHash(excerpt),
      bundle.issue.key,
      bundle.now,
    );
    await services().store.findings.put(finding);
    await journal('agent-report', bundle.issue.id, {
      findingId: finding.id,
      issueKey: bundle.issue.key,
      ruleId: finding.ruleId,
      layer: finding.layer,
      by: reporterAccountId,
      reason: finding.askSummary,
    });
    warnings.push(sensorWarning(bundle.language));
    return { ...findingView(finding, null), reportedBy: reporterAccountId, journaled: true, campaign };
  }, warnings);
};

/**
 * Segment porteur du signalement : le premier segment stocké du ticket, sinon la
 * description de la demande. Rien n'est inventé sur l'auteur (§5).
 */
function reportedSource(bundle: IssueBundle): SegmentSource {
  const first = bundle.segments[0];
  if (first) return segmentSourceOf(first, bundle.issue);
  return {
    issueId: bundle.issue.id,
    issueKey: bundle.issue.key,
    projectKey: bundle.issue.projectKey,
    field: 'description',
    text: bundle.issue.description,
    author: {
      accountId: bundle.issue.reporter.accountId,
      accountType: bundle.issue.reporter.accountType,
      organizationId: bundle.issue.organizationId,
    },
    channel: bundle.issue.channel,
    createdAt: bundle.issue.createdAt,
  };
}

/** Segment porteur du signalement : celui stocké s'il existe, sinon la demande. */
function reportedSegmentId(bundle: IssueBundle): string {
  return bundle.segments[0]?.id ?? `${bundle.issue.id}:description`;
}

/** Coup de couche C4 : motif « signalé par un agent », résumé = ce qu'il décrit. */
function agentHit(excerpt: string, reason: string, text: string): LayerHit {
  const start = text.indexOf(excerpt);
  const startPos = start >= 0 ? start : 0;
  return {
    layer: 'C4',
    kind: 'model-verdict',
    ruleId: AGENT_RULE_ID,
    startPos,
    endPos: startPos + excerpt.length,
    excerpt,
    askSummary: reason,
    confidence: AGENT_CONFIDENCE,
  };
}

function sensorWarning(language: Language): string {
  return language === 'fr'
    ? 'constat ouvert par un agent : il reste à trancher par un humain, rien n’a été neutralisé'
    : 'finding opened by an agent: a human still has to decide, nothing was neutralised';
}
