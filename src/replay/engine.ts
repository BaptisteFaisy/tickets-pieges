/**
 * Moteur du banc d'essai (§17.7, TP-18) — la chaîne complète, hors ligne.
 *
 * Un `SampleRequest` du jeu d'essai traverse les cinq étapes du §18, dans
 * l'ordre, sans réseau ni plateforme :
 *
 *   1. origine calculée sans modèle (`src/core/origin.ts`) ;
 *   2. couches C1 et C2 dans la foulée (C1 si le lot est fusionné, C2 toujours) ;
 *   3. couche C3 **non jouée** : aucun modèle n'est appelé, le rapport le dit ;
 *   4. niveau de suspicion fixé, mode du projet appliqué (`suspicion`, `modes`) ;
 *   5. encadrement produit et tout est journalisé (`framing`, `Store` en mémoire).
 *
 * Contrat dur : domaine pur — aucun import `@forge/*`, aucune entrée-sortie,
 * aucune heure lue (l'instant est injecté). Le rendu texte et JSON vit dans
 * `report.ts`, la comparaison à l'attendu dans `compare.ts`.
 */

import { detectAddressing } from '../core/c2-addressing';
import { contextHits, contextScore, guessLanguage, type IssueContext } from '../core/context';
import { sortFindings, toFindings } from '../core/findings';
import { frameRequest, renderFramedRequest } from '../core/framing';
import { contentHash } from '../core/hashing';
import { t } from '../core/i18n';
import { decideMode, type ModeDecision } from '../core/modes';
import { computeOrigins, issueTrustLevel } from '../core/origin';
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

/** Constats d'un segment, tels que le banc les rend. */
export interface SegmentFindings {
  segmentId: string;
  field: string;
  refId?: string;
  findings: Finding[];
}

/** Couche non jouée pendant le rejet : pourquoi, honnêtement (§21). */
export interface LayerGap {
  layer: 'C1' | 'C3';
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

/** Le lot C1 n'est pas fusionné : chemin opaque pour le résolveur de bundling. */
const C1_MODULE = ['..', 'core', 'c1-concealment.ts'].join('/');
let c1Cache: C1Detector | null | undefined;

/** Cherche le détecteur C1 ; `null` s'il n'est pas (encore) dans l'arbre. */
async function loadC1Detector(): Promise<C1Detector | null> {
  if (c1Cache !== undefined) return c1Cache;
  try {
    const module = (await import(`./${C1_MODULE}`)) as Record<string, unknown>;
    const fn = module.detectConcealment ?? module.scanConcealment ?? module.detectC1;
    c1Cache = typeof fn === 'function' ? (fn as C1Detector) : null;
  } catch {
    c1Cache = null;
  }
  return c1Cache;
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
async function c1HitsOf(segment: SegmentSource, language: Language, detector: C1Detector | null): Promise<LayerHit[]> {
  if (!detector) return [];
  try {
    return detector(segment.text, language) ?? [];
  } catch {
    return [];
  }
}

/**
 * Signaux C4 d'un segment. La langue dominante n'est comparée que si la
 * description a permis de la mesurer : pas de devinette sur un texte court.
 */
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
async function findingsOfSegment(
  segment: SegmentSource,
  segmentId: string,
  language: Language,
  settings: ProjectSettings,
  dominant: 'fr' | 'en' | 'other' | null,
  now: string,
  c1: C1Detector | null,
): Promise<{ findings: Finding[]; c4: LayerHit[] }> {
  const c1Hits = await c1HitsOf(segment, language, c1);
  const c2Hits = c2HitsOf(segment, language, settings);
  const c4 = c4HitsOf(segment, language, dominant, now);
  const findings = toFindings({ hits: [...c1Hits, ...c2Hits, ...c4], segment, segmentId, language, now });
  return { findings, c4 };
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
  const gaps: LayerGap[] = [];
  const unanalyzed: UnanalyzedReason[] = [];
  if (!c1) {
    gaps.push({ layer: 'C1', reason: language === 'fr'
      ? 'lot C1 (dissimulation) non fusionné — couche non jouée'
      : 'C1 (concealment) not merged yet — layer not played' });
    unanalyzed.push('unsupported-format');
  }
  gaps.push({ layer: 'C3', reason: language === 'fr'
    ? 'aucun modèle appelé hors ligne — couche non jouée'
    : 'no model call offline — layer not played' });
  unanalyzed.push('model-pending');
  return { gaps, unanalyzed };
}

/** Les cinq étapes du §18, une ligne par production — le rapport les montre. */
function buildSteps(input: {
  report: Omit<ReplayReport, 'steps'>;
  language: Language;
  c4Total: number;
}): StepReport[] {
  const { report, language, c4Total } = input;
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
    {
      step: 4,
      code: 'step-decision',
      title: fr ? 'Suspicion fixée, mode appliqué' : 'Suspicion set, mode applied',
      outputs: [
        fr
          ? `suspicion ${report.suspicion} · confiance ${report.trustLevel} · score C4 ${c4Total}`
          : `suspicion ${report.suspicion} · trust ${report.trustLevel} · C4 score ${c4Total}`,
        fr
          ? `mode ${report.modeDecision.mode} (${report.modeDecision.reasons.join(', ')})`
          : `mode ${report.modeDecision.mode} (${report.modeDecision.reasons.join(', ')})`,
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
  for (const item of segmentsById) {
    await store.segments.put({
      id: item.id,
      issueId: item.source.issueId,
      field: item.source.field,
      refId: item.source.refId ?? null,
      authorAccountId: item.source.author.accountId,
      accountType: item.source.author.accountType,
      orgId: item.source.author.organizationId ?? null,
      channel: item.source.channel,
      visibility: item.source.visibility ?? null,
      trustLevel: item.origin.trustLevel,
      contentHash: contentHash(item.source.text),
      text: item.source.text,
      scannedAt: now,
    });
  }
  for (const finding of report.findings) await store.findings.put(finding);
  await store.states.put({
    issueId: report.issueId,
    issueKey: report.issueKey,
    projectKey: report.projectKey,
    trustLevel: report.trustLevel,
    suspicionLevel: report.suspicion,
    modeApplied: report.modeDecision.mode,
    unanalyzed: report.unanalyzed,
    inheritedFrom: null,
    updatedAt: now,
  });
  await store.events.append('banc.replay', report.issueId, {
    sampleId: report.sampleId,
    suspicion: report.suspicion,
    trust: report.trustLevel,
    mode: report.modeDecision.mode,
  });
}

/** Rejoue une demande d'exemple : la chaîne complète du §18, sans réseau. */
export async function replaySample(sample: SampleRequest, options: ReplayOptions = {}): Promise<ReplayReport> {
  const language = options.language ?? sample.language;
  const settings = options.settings ?? benchSettings();
  const now = options.now ?? BENCH_NOW;
  const segments = toSegments(sample, now);
  const ids = segments.map(segmentIdOf);
  const origins = computeOrigins(segments, settings);
  const trustLevel = issueTrustLevel(origins);
  const dominant = guessLanguage(sample.description);
  const c1 = options.c1Detector !== undefined ? options.c1Detector : await loadC1Detector();

  const perSegment = await Promise.all(
    segments.map((segment, index) =>
      findingsOfSegment(segment, ids[index] ?? `${segment.issueId}:${index}`, language, settings, dominant, now, c1)),
  );
  const findings = sortFindings(perSegment.flatMap((item) => item.findings));
  const c4Total = contextScore(perSegment.flatMap((item) => item.c4));
  const { gaps, unanalyzed } = gapsOf(c1, language);
  const suspicion = computeSuspicion({ findings, contextScore: c4Total, usedModel: false });
  const state = toIssueState({
    issue: { issueId: segments[0]?.issueId ?? sample.id, issueKey: `BANC-${sample.id.toUpperCase()}`, projectKey: BENCH_PROJECT },
    origins,
    findings,
    mode: settings.mode,
    unanalyzed,
    contextScore: c4Total,
    now,
  });
  const modeDecision = decideMode(state, settings, language);
  const framed = frameRequest({
    issueKey: state.issueKey,
    language,
    notAnalyzed: unanalyzed,
    blockId: options.blockId,
    segments: segments.map((segment, index) => ({
      segmentId: ids[index] ?? `${segment.issueId}:${index}`,
      field: segment.field,
      refId: segment.refId,
      body: segment.text,
      trustLevel: origins[index]?.trustLevel ?? trustLevel,
      suspicion,
      originLabel: originLabelOf(origins[index] ?? origins[0]!),
      findings: perSegment[index]?.findings ?? [],
    })),
  });

  const base: Omit<ReplayReport, 'steps'> = {
    sampleId: sample.id,
    issueId: state.issueId,
    issueKey: state.issueKey,
    projectKey: state.projectKey,
    language,
    now,
    segments,
    origins,
    trustLevel,
    findings,
    contextScore: c4Total,
    suspicion,
    state,
    modeDecision,
    framed,
    framedText: renderFramedRequest(framed, language),
    unanalyzed,
    gaps,
    kinds: [...new Set(findings.map((finding) => finding.kind))],
  };
  if (options.store) {
    await persist({
      store: options.store,
      report: base,
      settings,
      now,
      segmentsById: segments.map((source, index) => ({
        source,
        id: ids[index] ?? `${source.issueId}:${index}`,
        origin: origins[index] ?? origins[0]!,
      })),
    });
  }
  return { ...base, steps: buildSteps({ report: base, language, c4Total }) };
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
