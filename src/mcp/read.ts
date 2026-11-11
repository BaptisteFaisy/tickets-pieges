/**
 * Les huit outils de lecture du §16 — lot MCP.
 *
 * Verbe `GET` dans le manifeste : un agent lancé par une règle d'automatisation
 * peut les appeler, et ils ne modifient **rien** — ni ticket, ni stockage, ni
 * journal (§16). Chaque outil rend l'enveloppe `{ ok, data | error, warnings }`
 * de `src/mcp/result.ts` et ne jette jamais ; les avertissements portent ce qui
 * n'a pas été analysé (§21 : jamais de fausse assurance).
 */

import { detectAddressing } from '../core/c2-addressing';
import { contextHits, contextScore, guessLanguage } from '../core/context';
import { buildExposureReport } from '../core/exposure';
import { sortFindings, toFindings } from '../core/findings';
import { frameRequest, renderFramedRequest } from '../core/framing';
import { computeOrigin, issueTrustLevel } from '../core/origin';
import { checkOutbound as gateCheck, outboundCaveats } from '../core/outbound';
import { computePrecision, reviewQueue, statsByRule, type ReviewItem } from '../core/precision';
import { atLeast } from '../core/levels';
import { computeSuspicion, lastVerdicts } from '../core/suspicion';
import type {
  Canary,
  CanaryHit,
  Finding,
  Language,
  OutboundAction,
  SegmentSource,
  ToolResult,
  Verdict,
} from '../core/types';
import type { CanaryHitRow, CanaryRow, IssueStateRow } from '../platform/schema';
import {
  optionalNumber,
  optionalText,
  requireText,
  run,
  type JsonPayload,
  type Tool,
} from './result';
import {
  allStates,
  collectVerdicts,
  findingView,
  framingSegments,
  layerWarnings,
  loadBundle,
  loadSettings,
  nowIso,
  originLabelOf,
  outboundContextOf,
  segmentSourceOf,
  serviceWarnings,
  services,
  trustLevelOf,
  verdictOf,
  type IssueBundle,
} from './service';

/** Segment fictif de `check-text` : rien n'est écrit, rien n'est stocké (§17.7). */
const AD_HOC_SEGMENT = 'mcp-check-text';

// ------------------------------------------------------- get-request-safe (§8.2)

/** Contenu encadré, origine et suspicion par segment — identifiant neuf à chaque appel. */
export const getRequestSafe: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const bundle = await loadBundle(issueKey);
    warnings.push(...layerWarnings(bundle.language));
    const framed = frameRequest({
      issueKey: bundle.issue.key,
      segments: await framingSegments(bundle),
      language: bundle.language,
      notAnalyzed: bundle.state?.unanalyzed ?? [],
    });
    warnings.push(...framed.warnings);
    if (framed.blocks.length === 0) warnings.push(noSegmentWarning(bundle.language));
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
      stored: false,
    };
  }, warnings);
};

function noSegmentWarning(language: Language): string {
  return language === 'fr'
    ? 'aucun segment enregistré pour cette demande : le texte rendu ne prouve rien'
    : 'no stored segment for this request: the rendered text proves nothing';
}

// ------------------------------------------------------------ get-origin (§5)

/** Auteur, canal et niveau de confiance de chaque segment. */
export const getOrigin: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const bundle = await loadBundle(issueKey);
    const origins = bundle.segments.map((row) =>
      computeOrigin(segmentSourceOf(row, bundle.issue), bundle.settings),
    );
    if (origins.length === 0) warnings.push(noSegmentWarning(bundle.language));
    return {
      issueKey: bundle.issue.key,
      trustLevel: issueTrustLevel(origins),
      segmentCount: origins.length,
      segments: origins.map((origin) => ({
        field: origin.field,
        refId: origin.refId ?? null,
        authorAccountId: origin.authorAccountId,
        accountType: origin.accountType,
        organizationId: origin.organizationId ?? null,
        channel: origin.channel,
        visibility: origin.visibility ?? null,
        trustLevel: origin.trustLevel,
        label: originLabelOf(origin, bundle.language),
        reasons: origin.reasons,
      })),
    };
  }, warnings);
};

// --------------------------------------------------------- list-findings (§6)

/** Constats d'une demande : couche, extrait, demande résumée, verdict. */
export const listFindings: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const bundle = await loadBundle(issueKey);
    const last = lastVerdicts(bundle.verdicts);
    const findings = sortFindings(bundle.findings);
    if (findings.length === 0) warnings.push(noFindingWarning(bundle.language));
    return {
      issueKey: bundle.issue.key,
      suspicionLevel: bundle.state?.suspicionLevel ?? null,
      count: findings.length,
      findings: findings.map((finding) => findingView(finding, last.get(finding.id) ?? null)),
    };
  }, warnings);
};

function noFindingWarning(language: Language): string {
  return language === 'fr'
    ? 'aucun constat enregistré : absence de preuve, pas preuve d’absence'
    : 'no stored finding: absence of evidence, not evidence of absence';
}

// ------------------------------------------------------- explain-finding (§14)

/** Règle déclenchée, raison et précision de la règle. */
export const explainFinding: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const findingId = requireText(payload, 'findingId');
    const store = services().store;
    const finding = await store.findings.byId(findingId);
    if (!finding) throw new Error(`constat « ${findingId} » introuvable`);
    const language = await languageOfIssue(finding.issueId);
    const verdicts = await collectVerdicts([findingId]);
    const rule = await ruleOf(finding, verdicts, warnings, language);
    return {
      ...findingView(finding, verdicts.at(-1) ?? null),
      reason: finding.askSummary,
      rule,
      verdicts: verdicts.map((verdict) => ({
        decision: verdict.decision,
        reviewerAccountId: verdict.reviewerAccountId,
        reason: verdict.reason ?? null,
        at: verdict.at,
      })),
    };
  }, warnings);
};

/** Langue d'un ticket retrouvé par son identifiant (repli : français). */
async function languageOfIssue(issueId: string): Promise<Language> {
  const state = await services().store.states.get(issueId);
  if (!state) return 'fr';
  const settings = await loadSettings(state.projectKey);
  return settings.language;
}

/** Précision d'une règle : le catalogue stocké d'abord, les verdicts sinon (§14). */
async function ruleOf(
  finding: Finding,
  verdicts: Verdict[],
  warnings: string[],
  language: Language,
) {
  const patterns = await services().store.patterns.list();
  const pattern =
    patterns.find((row) => row.id === finding.ruleId) ??
    patterns.find((row) => row.layer === finding.layer && row.kind === finding.kind) ??
    null;
  const stats = statsByRule([finding], verdicts)[0] ?? null;
  const measured = stats !== null && verdicts.length > 0 ? computePrecision(stats) : null;
  if (verdicts.length === 0) warnings.push(noVerdictWarning(language));
  if (pattern === null) warnings.push(noPatternWarning(language));
  return {
    ruleId: finding.ruleId,
    layer: finding.layer,
    kind: finding.kind,
    expression: pattern?.expression ?? null,
    precision: pattern?.precision ?? measured?.precision ?? null,
    measuredPrecision: measured?.precision ?? null,
    enabled: pattern?.enabled ?? true,
    demoted: pattern?.demoted ?? measured?.demoted ?? false,
    samples: verdicts.length,
  };
}

function noVerdictWarning(language: Language): string {
  return language === 'fr'
    ? 'précision non mesurée : aucun verdict humain sur ce constat'
    : 'precision not measured: no human verdict on this finding';
}

function noPatternWarning(language: Language): string {
  return language === 'fr'
    ? 'règle absente du catalogue stocké : la précision vient des verdicts, pas d’une mesure de référence'
    : 'rule missing from the stored catalogue: precision comes from verdicts, not a reference measure';
}

// --------------------------------------------- list-suspect-requests (§17.2)

/** Demandes au niveau « à vérifier » ou plus, par niveau et par campagne. */
export const listSuspectRequests: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const jql = optionalText(payload, 'jql');
    const limit = optionalNumber(payload, 'limit', 50, 200);
    const states = await suspectStates(jql, limit, warnings);
    const items = reviewQueue(await reviewItems(states)).slice(0, limit);
    if (items.length === 0) warnings.push(noFindingWarning('fr'));
    return {
      count: items.length,
      jql,
      items: items.map((item) => ({
        issueKey: item.issueKey,
        suspicionLevel: item.suspicion,
        campaignHash: item.campaignHash ?? null,
        verdict: item.verdict ?? null,
        finding: findingView(item.finding, null),
      })),
    };
  }, warnings);
};

/** États retenus : ceux du filtre JQL, sinon les plus suspects du stockage. */
async function suspectStates(
  jql: string | null,
  limit: number,
  warnings: string[],
): Promise<IssueStateRow[]> {
  if (jql === null) return services().store.states.bySuspicion('review', limit);
  const keys = await services().jira.searchByJql(jql, limit);
  const states = (await allStates(500)).filter((state) => keys.includes(state.issueKey));
  warnings.push(
    'filtre JQL exécuté par Jira : seules les demandes déjà indexées par l’app ont un niveau',
  );
  return states;
}

/** Une ligne de file par constat, campagnes regroupées (§14). */
async function reviewItems(states: IssueStateRow[]): Promise<ReviewItem[]> {
  const store = services().store;
  const kept = states.filter((state) => atLeast(state.suspicionLevel, 'review'));
  const findings = await Promise.all(kept.map((state) => store.findings.byIssue(state.issueId)));
  const items: ReviewItem[] = [];
  for (const [index, state] of kept.entries()) {
    const rows = findings[index] ?? [];
    const last = lastVerdicts(await collectVerdicts(rows.map((finding) => finding.id)));
    for (const finding of rows) {
      items.push({
        finding,
        issueKey: state.issueKey,
        suspicion: state.suspicionLevel,
        campaignHash: finding.campaignHash,
        verdict: last.get(finding.id)?.decision,
      });
    }
  }
  return items;
}

// ----------------------------------------------------------- check-text (§17.7)

/** Verdict de détection sur un texte quelconque, sans rien écrire. */
export const checkText: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const text = requireText(payload, 'text');
    const trustLevel = trustLevelOf(payload);
    const language: Language = guessLanguage(text) === 'en' ? 'en' : 'fr';
    const now = nowIso();
    const source = adHocSource(text, trustLevel, now);
    warnings.push(...layerWarnings(language), adHocWarning(language));
    const hits = [...detectAddressing(text), ...contextHits(source, {}, { now, language })];
    const findings = toFindings({ hits, segment: source, segmentId: AD_HOC_SEGMENT, language, now });
    return {
      trustLevel,
      language,
      suspicionLevel: computeSuspicion({ findings, contextScore: contextScore(hits) }),
      layersRun: ['C2', 'C4'],
      layersNotRun: ['C1', 'C3'],
      count: findings.length,
      findings: findings.map((finding) => findingView(finding, null)),
      stored: false,
    };
  }, warnings);
};

function adHocSource(text: string, trustLevel: string, now: string): SegmentSource {
  return {
    issueId: AD_HOC_SEGMENT,
    issueKey: 'MCP-0',
    projectKey: 'MCP',
    field: 'description',
    text,
    author: {
      accountId: 'mcp-check-text',
      accountType: trustLevel === 'T3' ? 'atlassian' : 'customer',
    },
    channel: 'unknown',
    createdAt: now,
  };
}

function adHocWarning(language: Language): string {
  return language === 'fr'
    ? 'texte examiné à la volée : rien n’est enregistré, aucun ticket n’est modifié'
    : 'text checked on the fly: nothing is stored, no issue is changed';
}

// ------------------------------------------------------- check-outbound (§10)

/** Fuite probable et éléments en cause — contrôle seul, aucune écriture. */
export const checkOutbound: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const issueKey = requireText(payload, 'issueKey');
    const text = requireText(payload, 'text');
    const bundle = await loadBundle(issueKey);
    const context = outboundContextOf(bundle);
    const stage = optionalText(payload, 'stage') === 'after' ? 'after' : 'before';
    warnings.push(...outboundCaveats(context, bundle.language), sessionWarning(bundle.language));
    const verdict = gateCheck(text, context, { language: bundle.language, now: bundle.now, stage });
    return { ...verdict, stage, checked: false, stored: false };
  }, warnings);
};

function sessionWarning(language: Language): string {
  return language === 'fr'
    ? 'session de l’auteur non vérifiée : aucune référence de session n’est fournie à l’outil'
    : 'author session not checked: the tool receives no session reference';
}

// ------------------------------------------------- get-exposure-report (§14/§16)

/** Constats, verdicts, exercices et réponses retenues d'une fenêtre. */
export const getExposureReport: Tool = (payload) => {
  const warnings = serviceWarnings();
  return run(async () => {
    const projectKey = requireText(payload, 'projectKey');
    const days = optionalNumber(payload, 'days', 30, 365);
    const now = nowIso();
    const from = new Date(Date.parse(now) - days * 86_400_000).toISOString();
    const states = (await allStates(1000)).filter((state) => state.projectKey === projectKey);
    const report = await buildReport(projectKey, states, from, now);
    warnings.push(canaryWarning(), indexWarning());
    return { days, generatedAt: now, report };
  }, warnings);
};

/** Rapport d'une fenêtre : tout vient du stockage, rien n'est estimé (§14). */
async function buildReport(
  projectKey: string,
  states: IssueStateRow[],
  from: string,
  to: string,
) {
  const store = services().store;
  const issueIds = new Set(states.map((state) => state.issueId));
  const findings = (await store.findings.since(from)).filter((row) => issueIds.has(row.issueId));
  const verdictRows = (await store.verdicts.since(from)).filter((row) =>
    findings.some((finding) => finding.id === row.findingId),
  );
  const outboundRows = (await store.outbound.since(from)).filter((row) => issueIds.has(row.issueId));
  const canaries = (await store.canaries.open()).filter(
    (row) => row.issueKey.startsWith(`${projectKey}-`) && row.createdAt >= from,
  );
  const hits = (await store.canaries.allHits()).filter(
    (row) => canaries.some((canary) => canary.id === row.canaryId) && row.at >= from,
  );
  const campaigns = (await store.campaigns.list()).filter(
    (row) => row.lastSeen >= from && row.issueKeys.some((key) => states.some((s) => s.issueKey === key)),
  );
  return buildExposureReport({
    projectKey,
    from,
    to,
    requestsExamined: states.length,
    requestsFullyAnalyzed: states.filter((state) => state.unanalyzed.length === 0).length,
    findings,
    verdicts: verdictRows.map(verdictOf),
    canaries: canaries.map(toCanary),
    canaryHits: hits.map(toCanaryHit),
    outboundActions: outboundRows.map((row) => row.action as OutboundAction),
    campaigns: campaigns.length,
  });
}

function toCanary(row: CanaryRow): Canary {
  return {
    id: row.id,
    issueId: row.issueId,
    issueKey: row.issueKey,
    token: row.token,
    instruction: row.instruction,
    labelName: row.labelName,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    closedAt: row.closedAt ?? undefined,
    status: row.closedAt === null ? 'open' : 'closed',
  };
}

function toCanaryHit(row: CanaryHitRow): CanaryHit {
  return {
    canaryId: row.canaryId,
    actorAccountId: row.actorAccountId,
    actorType: row.actorType,
    action: row.action,
    at: row.at,
  };
}

function canaryWarning(): string {
  return 'le stockage ne liste que les exercices ouverts : les exercices clos de la fenêtre ne sont pas comptés';
}

function indexWarning(): string {
  return 'seules les demandes déjà indexées par l’app entrent dans le rapport';
}

/** Type public d'un outil de lecture : pratique pour `actions.ts` et les tests. */
export type ReadToolResult = ToolResult<unknown>;
