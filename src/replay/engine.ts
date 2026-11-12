/**
 * Moteur du banc d'essai (§17.7, TP-18) — les cinq étapes du §18 sur un
 * `SampleRequest`, hors ligne : origine sans modèle ; C1 (si fusionné) et C2 ;
 * C3 non jouée (aucun modèle appelé, le rapport le dit) ; suspicion et mode ;
 * encadrement et journal. Domaine pur : aucune E/S, aucune heure lue.
 */

import { detectAddressing } from '../core/c2-addressing';
import { contextHits, contextScore, guessLanguage, type IssueContext } from '../core/context';
import { sortFindings, toFindings } from '../core/findings';
import { frameRequest, renderFramedRequest } from '../core/framing';
import { contentHash } from '../core/hashing';
import { t } from '../core/i18n';
import { decideMode, type ModeDecision } from '../core/modes';
import { computeOrigins, issueTrustLevel } from '../core/origin';
import { detectText } from '../core/detect';
import { computeSuspicion, toIssueState } from '../core/suspicion';
import type {
  AuthorContext,
  Finding,
  FindingKind,
  FramedRequest,
  IssueState,
  Language,
  LayerHit,
  ProjectSettings,
  SampleRequest,
  SegmentOrigin,
  SegmentSource,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
} from '../core/types';
import { fixedClock, type MemoryStore } from '../platform/memory';
import type { Store } from '../platform/schema';
import { detectConcealment } from '../core/c1-concealment';
import { benchSettings, BENCH_NOW, BENCH_PROJECT } from './fixtures';

/** Détecteur C1 s'il existe — chargé dynamiquement, absent = couche non jouée. */
type C1Detector = (text: string, language?: Language) => LayerHit[];

/** Une étape du §18 : ce que le banc a fait, et ce qu'il en est sorti. */
export interface StepReport {
  step: number;
  code: string;
  title: string;
  outputs: string[];
}

/** Couche non jouée pendant le rejet : code stable + raison (§21). */
export interface LayerGap {
  layer: 'C1' | 'C3';
  code: 'c1-not-merged' | 'c3-not-played';
  reason: string;
}

/** Ce que le banc sait d'une demande avant de la rejouer. */
export interface ReplayOptions {
  /** Réglages du projet (défaut : ceux du banc, `fixtures.ts`). */
  settings?: ProjectSettings;
  /** Langue des libellés du rapport (défaut : celle de la demande). */
  language?: Language;
  /** Instant fixe injecté — le banc ne lit jamais l'heure. */
  now?: string;
  /** Horloge fixe (défaut : `fixedClock(now)`), pour la journalisation. */
  clock?: { now(): string };
  /** `Store` en mémoire : écrit segments, constats, état et journal (§18.5). */
  store?: Store;
  /** Générateur d'identifiants de blocs (§23.7 : différent à chaque appel). */
  blockId?: () => string;
  /** Injecté par les tests : disponibilité du détecteur C1. */
  c1Detector?: C1Detector | null;
}

/** Rapport structuré d'une demande rejouée — le contrat du banc. */
export interface ReplayReport {
  sampleId: string;
  issueId: string;
  issueKey: string;
  projectKey: string;
  language: Language;
  now: string;
  steps: StepReport[];
  segments: SegmentSource[];
  origins: SegmentOrigin[];
  trustLevel: TrustLevel;
  findings: Finding[];
  contextScore: number;
  suspicion: SuspicionLevel;
  state: IssueState;
  modeDecision: ModeDecision;
  framed: FramedRequest;
  framedText: string;
  unanalyzed: UnanalyzedReason[];
  gaps: LayerGap[];
  kinds: FindingKind[];
}

/** Ce que rend un banc complet. */
export interface BenchResult {
  reports: ReplayReport[];
  total: number;
  played: number;
  now: string;
  dataset: 'sample' | 'local';
  settings: ProjectSettings;
}

/**
 * Détecteur C1 réel (§6). L'import est **statique** : le bundler Forge ne résout
 * pas un import dynamique à spécificateur variable (`docs/FORGE.md` §1), et le lot
 * C1 est dans l'arbre — le banc joue donc la couche au lieu de la déclarer absente.
 * Les tests peuvent toujours injecter `null` pour vérifier le repli.
 */
const realC1: C1Detector = (text, language) => detectConcealment({ text, language });

async function loadC1Detector(): Promise<C1Detector | null> {
  return realC1;
}

/** Segments d'une demande d'exemple : résumé, description, chaque commentaire. */
export function toSegments(sample: SampleRequest, now: string): SegmentSource[] {
  const issueId = `sample-${sample.id}`;
  const issueKey = `BANC-${sample.id.toUpperCase()}`;
  const author: AuthorContext = {
    accountId: `sample-author-${sample.id}`,
    accountType: sample.accountType,
    displayName: `Auteur d’exemple ${sample.id}`,
    organizationId: sample.organizationId,
  };
  const base = { issueId, issueKey, projectKey: BENCH_PROJECT, author, channel: sample.channel, createdAt: now };
  const segments: SegmentSource[] = [
    { ...base, field: 'summary', text: sample.summary },
    { ...base, field: 'description', text: sample.description },
  ];
  sample.comments.forEach((comment, index) => {
    segments.push({
      ...base,
      field: 'comment',
      refId: `comment-${index + 1}`,
      text: comment.body,
      visibility: comment.visibility,
      author: { ...author, accountType: comment.authorType },
    });
  });
  return segments;
}

/** Identifiant stable d'un segment : même demande, même identifiant au rejeu. */
function segmentIdOf(segment: SegmentSource): string {
  return `${segment.issueId}:${segment.field}${segment.refId ? `:${segment.refId}` : ''}`;
}

/** Constats C2 d'un segment (couche déterministe, toujours jouée hors ligne). */
function c2HitsOf(segment: SegmentSource, language: Language, settings: ProjectSettings): LayerHit[] {
  return detectAddressing(segment.text, {
    languages: [language],
    ignoredPhrases: settings.ignoredPhrases,
  });
}

/** Constats C1 d'un segment si le lot C1 est fusionné ; sinon rien, et c'est dit. */
function c1HitsOf(segment: SegmentSource, language: Language, detector: C1Detector | null): LayerHit[] {
  if (!detector) return [];
  try {
    return detector(segment.text, language) ?? [];
  } catch {
    return [];
  }
}

/** Signaux C4 d'un segment ; la langue dominante n'est comparée que si mesurée. */
function c4HitsOf(
  segment: SegmentSource,
  language: Language,
  dominant: 'fr' | 'en' | 'other' | null,
  now: string,
): LayerHit[] {
  const context: IssueContext = dominant ? { dominantLanguage: dominant } : {};
  return contextHits(segment, context, { now, language });
}

/** Constats d'un segment, toutes couches déterministes jouées confondues. */
function findingsOfSegment(prepared: PreparedReplay, segment: SegmentSource, segmentId: string): SegmentAnalysis {
  const { language, settings, dominant, now, c1 } = prepared;
  // Même détection que la production (`src/core/detect.ts`) : le banc joue
  // exactement ce que joue le ticket. Un C1 injecté par un test remplace la
  // seule famille C1.
  const shared = detectText(segment.text, {
    language,
    ignoredPhrases: settings.ignoredPhrases,
  });
  const hits = c1 === null || c1 === realC1 ? shared : [...c1HitsOf(segment, language, c1), ...shared.filter((hit) => hit.layer !== 'C1')];
  const c4 = c4HitsOf(segment, language, dominant, now);
  return { findings: toFindings({ hits: [...hits, ...c4], segment, segmentId, language, now }), c4 };
}

/** Lignes de raison d'origine, traduites — le rapport les cite telles quelles. */
function reasonLines(origin: SegmentOrigin, language: Language): string[] {
  return origin.reasons.map((item) => t(language, item.code, { detail: item.detail ?? '' }));
}

/** Libellé d'origine d'un bloc encadré : « customer · portal » (§8.2). */
function originLabelOf(origin: SegmentOrigin): string {
  return `${origin.accountType} · ${origin.channel}`;
}

/** Ce qui n'a pas été analysé, dit honnêtement (§21) — jamais deviné. */
function gapsOf(c1: C1Detector | null, language: Language): { gaps: LayerGap[]; unanalyzed: UnanalyzedReason[] } {
  const fr = language === 'fr';
  const gaps: LayerGap[] = [];
  const unanalyzed: UnanalyzedReason[] = ['model-pending'];
  if (!c1) {
    gaps.push({ layer: 'C1', code: 'c1-not-merged', reason: fr ? 'lot C1 non fusionné — couche non jouée' : 'C1 not merged yet — layer not played' });
    unanalyzed.unshift('unsupported-format');
  }
  gaps.push({ layer: 'C3', code: 'c3-not-played', reason: fr ? 'aucun modèle appelé hors ligne — couche non jouée' : 'no model call offline — layer not played' });
  return { gaps, unanalyzed };
}

/** Étapes 1 à 3 du §18 : origine, couches déterministes, modèle non joué. */
function earlySteps(report: Omit<ReplayReport, 'steps'>, language: Language): StepReport[] {
  const fr = language === 'fr';
  return [
    {
      step: 1,
      code: 'step-origin',
      title: fr ? 'Origine calculée, sans modèle' : 'Origin computed, no model',
      outputs: report.origins.map((origin, index) =>
        `${report.segments[index]?.field ?? '?'} → ${origin.trustLevel} (${reasonLines(origin, language).join(' ; ')})`),
    },
    {
      step: 2,
      code: 'step-c1-c2',
      title: fr ? 'Couches C1 et C2' : 'Layers C1 and C2',
      outputs: [
        ...report.findings
          .filter((finding) => finding.layer === 'C1' || finding.layer === 'C2')
          .map((finding) => `${finding.layer} ${finding.ruleId} · ${finding.kind} · « ${finding.excerpt} »`),
        ...report.gaps.filter((gap) => gap.layer === 'C1').map((gap) => `C1 — ${gap.reason}`),
      ],
    },
    {
      step: 3,
      code: 'step-c3',
      title: fr ? 'Couche C3 (modèle)' : 'Layer C3 (model)',
      outputs: report.gaps.filter((gap) => gap.layer === 'C3').map((gap) => `C3 — ${gap.reason}`),
    },
  ];
}

/** Étapes 4 et 5 du §18 : décision de mode, encadrement et journal. */
function lateSteps(report: Omit<ReplayReport, 'steps'>, language: Language, c4Total: number): StepReport[] {
  const fr = language === 'fr';
  return [
    {
      step: 4,
      code: 'step-decision',
      title: fr ? 'Suspicion fixée, mode appliqué' : 'Suspicion set, mode applied',
      outputs: [
        fr
          ? `suspicion ${report.suspicion} · confiance ${report.trustLevel} · score C4 ${c4Total}`
          : `suspicion ${report.suspicion} · trust ${report.trustLevel} · C4 score ${c4Total}`,
        `mode ${report.modeDecision.mode} (${report.modeDecision.reasons.join(', ')})`,
      ],
    },
    {
      step: 5,
      code: 'step-framing',
      title: fr ? 'Encadrement et journal' : 'Framing and journal',
      outputs: [
        fr
          ? `${report.framed.blocks.length} bloc(s) encadré(s), identifiant propre à chaque bloc`
          : `${report.framed.blocks.length} framed block(s), one id per block`,
        ...(report.unanalyzed.length > 0
          ? [fr ? `non analysé : ${report.unanalyzed.join(', ')}` : `not analyzed: ${report.unanalyzed.join(', ')}`]
          : []),
      ],
    },
  ];
}

/** Les cinq étapes du §18, une ligne par production — le rapport les montre. */
function buildSteps(input: {
  report: Omit<ReplayReport, 'steps'>;
  language: Language;
  c4Total: number;
}): StepReport[] {
  const { report, language, c4Total } = input;
  return [...earlySteps(report, language), ...lateSteps(report, language, c4Total)];
}

/** Écrit le rejeu dans le `Store` en mémoire : segments, constats, état, journal. */
async function persist(input: {
  store: Store;
  report: Omit<ReplayReport, 'steps'>;
  segmentsById: { source: SegmentSource; id: string; origin: SegmentOrigin }[];
  settings: ProjectSettings;
  now: string;
}): Promise<void> {
  const { store, report, segmentsById, settings, now } = input;
  await store.settings.put(settings);
  for (const { source, id, origin } of segmentsById) {
    await store.segments.put({
      id, issueId: source.issueId, field: source.field, refId: source.refId ?? null,
      authorAccountId: source.author.accountId, accountType: source.author.accountType,
      orgId: source.author.organizationId ?? null, channel: source.channel,
      visibility: source.visibility ?? null, trustLevel: origin.trustLevel,
      contentHash: contentHash(source.text), text: source.text, scannedAt: now,
    });
  }
  for (const finding of report.findings) await store.findings.put(finding);
  await store.states.put({
    issueId: report.issueId, issueKey: report.issueKey, projectKey: report.projectKey,
    trustLevel: report.trustLevel, suspicionLevel: report.suspicion,
    modeApplied: report.modeDecision.mode, unanalyzed: report.unanalyzed,
    inheritedFrom: null, updatedAt: now,
  });
  await store.events.append('banc.replay', report.issueId, { sampleId: report.sampleId, suspicion: report.suspicion });
}

/** Entrée préparée : segments, identifiants, origines, contexte de langue. */
interface PreparedReplay {
  segments: SegmentSource[];
  ids: string[];
  origins: SegmentOrigin[];
  trustLevel: TrustLevel;
  dominant: 'fr' | 'en' | 'other';
  c1: C1Detector | null;
  language: Language;
  settings: ProjectSettings;
  now: string;
}

/** Étape 1 du §18 : découpe en segments, origines calculées sans modèle. */
async function prepareReplay(sample: SampleRequest, options: ReplayOptions): Promise<PreparedReplay> {
  const language = options.language ?? sample.language;
  const settings = options.settings ?? benchSettings();
  const now = options.now ?? BENCH_NOW;
  const segments = toSegments(sample, now);
  const ids = segments.map(segmentIdOf);
  const origins = computeOrigins(segments, settings);
  const c1 = options.c1Detector !== undefined ? options.c1Detector : await loadC1Detector();
  return {
    segments,
    ids,
    origins,
    trustLevel: issueTrustLevel(origins),
    dominant: guessLanguage(sample.description),
    c1,
    language,
    settings,
    now,
  };
}

/** Résultat des étapes 2 à 4 : constats, score C4, manques, suspicion, état, mode. */
interface AnalysisResult {
  findings: Finding[];
  c4Total: number;
  gaps: LayerGap[];
  unanalyzed: UnanalyzedReason[];
  suspicion: SuspicionLevel;
  state: IssueState;
  modeDecision: ModeDecision;
}

/** Étapes 2 à 4 du §18 : constats assemblés, suspicion fixée, mode décidé. */
function analyzeSync(prepared: PreparedReplay, sample: SampleRequest, perSegment: SegmentAnalysis[]): AnalysisResult {
  const findings = sortFindings(perSegment.flatMap((item) => item.findings));
  const c4Total = contextScore(perSegment.flatMap((item) => item.c4));
  const { gaps, unanalyzed } = gapsOf(prepared.c1, prepared.language);
  const suspicion = computeSuspicion({ findings, contextScore: c4Total, usedModel: false });
  const state = toIssueState({
    issue: {
      issueId: prepared.segments[0]?.issueId ?? sample.id,
      issueKey: `BANC-${sample.id.toUpperCase()}`,
      projectKey: BENCH_PROJECT,
    },
    origins: prepared.origins,
    findings,
    mode: prepared.settings.mode,
    unanalyzed,
    contextScore: c4Total,
    now: prepared.now,
  });
  return { findings, c4Total, gaps, unanalyzed, suspicion, state, modeDecision: decideMode(state, prepared.settings, prepared.language) };
}

/** Encadrement (§8.2) des segments préparés, avec les constats de chacun. */
function framePrepared(
  prepared: PreparedReplay,
  input: { suspicion: SuspicionLevel; unanalyzed: UnanalyzedReason[]; issueKey: string; perSegment: SegmentAnalysis[] },
  options: ReplayOptions,
): FramedRequest {
  const { segments, ids, origins, trustLevel, language } = prepared;
  return frameRequest({
    issueKey: input.issueKey,
    language,
    notAnalyzed: input.unanalyzed,
    blockId: options.blockId,
    segments: segments.map((segment, index) => ({
      segmentId: ids[index] ?? `${segment.issueId}:${index}`,
      field: segment.field,
      refId: segment.refId,
      body: segment.text,
      trustLevel: origins[index]?.trustLevel ?? trustLevel,
      suspicion: input.suspicion,
      originLabel: originLabelOf(origins[index] ?? origins[0]!),
      findings: input.perSegment[index]?.findings ?? [],
    })),
  });
}

/** Constats d'un segment : ce que les couches déterministes ont levé. */
interface SegmentAnalysis {
  findings: Finding[];
  c4: LayerHit[];
}

/** Constats de chaque segment, dans l'ordre du §18 (C1 et C2, puis C4). */
function detectAll(prepared: PreparedReplay): SegmentAnalysis[] {
  return prepared.segments.map((segment, index) =>
    findingsOfSegment(prepared, segment, prepared.ids[index] ?? `${segment.issueId}:${index}`));
}

/** Le rapport sans les étapes : tout ce que la chaîne a produit. */
function buildBaseReport(
  sample: SampleRequest,
  prepared: PreparedReplay,
  analysis: ReturnType<typeof analyzeSync>,
  framed: FramedRequest,
): Omit<ReplayReport, 'steps'> {
  return {
    sampleId: sample.id,
    issueId: analysis.state.issueId,
    issueKey: analysis.state.issueKey,
    projectKey: analysis.state.projectKey,
    language: prepared.language,
    now: prepared.now,
    segments: prepared.segments,
    origins: prepared.origins,
    trustLevel: prepared.trustLevel,
    findings: analysis.findings,
    contextScore: analysis.c4Total,
    suspicion: analysis.suspicion,
    state: analysis.state,
    modeDecision: analysis.modeDecision,
    framed,
    framedText: renderFramedRequest(framed, prepared.language),
    unanalyzed: analysis.unanalyzed,
    gaps: analysis.gaps,
    kinds: [...new Set(analysis.findings.filter((f) => f.layer !== 'C4').map((f) => f.kind))],
  };
}

/** Rejoue une demande d'exemple : la chaîne complète du §18, sans réseau. */
export async function replaySample(sample: SampleRequest, options: ReplayOptions = {}): Promise<ReplayReport> {
  const prepared = await prepareReplay(sample, options);
  const perSegment = detectAll(prepared);
  const analysis = analyzeSync(prepared, sample, perSegment);
  const framed = framePrepared(prepared, { ...analysis, issueKey: analysis.state.issueKey, perSegment }, options);
  const base = buildBaseReport(sample, prepared, analysis, framed);
  if (options.store) {
    await persist({
      store: options.store,
      report: base,
      settings: prepared.settings,
      now: prepared.now,
      segmentsById: prepared.segments.map((source, index) => ({
        source,
        id: prepared.ids[index] ?? `${source.issueId}:${index}`,
        origin: prepared.origins[index] ?? prepared.origins[0]!,
      })),
    });
  }
  return { ...base, steps: buildSteps({ report: base, language: prepared.language, c4Total: analysis.c4Total }) };
}

/** Rejoue tout un jeu d'essai, dans l'ordre du fichier. */
export async function replayBench(
  samples: readonly SampleRequest[],
  options: ReplayOptions & { dataset?: 'sample' | 'local'; store?: MemoryStore } = {},
): Promise<BenchResult> {
  const settings = options.settings ?? benchSettings();
  const now = options.now ?? BENCH_NOW;
  const store = options.store ?? (await import('../platform/memory')).createMemoryStore();
  const reports: ReplayReport[] = [];
  for (const sample of samples) {
    reports.push(await replaySample(sample, { ...options, settings, now, store, clock: options.clock ?? fixedClock(now) }));
  }
  return { reports, total: samples.length, played: reports.length, now, dataset: options.dataset ?? 'local', settings };
}
