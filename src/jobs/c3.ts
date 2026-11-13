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
import { contentHash, randomBlockId } from '../core/hashing';
import { readableRemainder, withoutIgnoredPhrases } from '../core/ignored-phrases';
import type {
  Finding, IssueState, Language, LayerHit, ProjectSettings, SegmentSource, SuspicionLevel,
} from '../core/types';
import type { SegmentRow, Store } from '../platform/schema';
import { writeProperty, type PipelineDeps } from './pipeline';

/** Segment synthétique qui porte le constat du fil entier (§22). */
const THREAD_ID_SUFFIX = 'thread';

/** Événement qui note qu'un texte de fil a déjà été lu par le modèle. */
const THREAD_SCANNED = 'c3-thread';

/** Combien d'événements on relit pour savoir si ce fil a déjà été lu. */
const THREAD_LOOKBACK = 80;

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
 * Le texte réellement soumis au modèle : les formules à ignorer du projet
 * (§14) en sont retirées. Le modèle n'a pas de liste d'exceptions — sans ce
 * retrait, une mention légale pleine d'impératifs (« veuillez supprimer »,
 * « ne pas imprimer ») passait pour une consigne et faisait monter un ticket
 * sain en `review` (mesuré en production le 13 novembre 2026, `fr-13`).
 *
 * `null` : il ne reste rien à juger — le passage entier est une formule
 * ignorée, on ne dérange pas le modèle (et on n'écrit aucun constat).
 */
function passageToRead(text: string, settings: ProjectSettings): string | null {
  if (readableRemainder(text, settings.ignoredPhrases).length === 0) return null;
  return withoutIgnoredPhrases(text, settings.ignoredPhrases);
}

/** Fait lire un passage par le modèle ; `null` = modèle indisponible (§20). */
async function modelReading(
  deps: PipelineDeps,
  passage: string,
  language: Language,
): Promise<LayerHit | null> {
  return classifyPassage(deps.model ?? { classify: async () => '' }, passage, {
    language,
    blockId: randomBlockId(),
  });
}

/** Conserve les constats absents ; rend ceux qui ont été écrits. Un rejeu ne duplique rien. */
async function storeFindings(deps: PipelineDeps, produced: Finding[]): Promise<Finding[]> {
  const stored: Finding[] = [];
  for (const finding of produced) {
    if (await deps.store.findings.byId(finding.id)) continue;
    await deps.store.findings.put(finding);
    stored.push(finding);
  }
  return stored;
}

/**
 * Texte du fil entier, segments étiquetés dans l'ordre (§22 : « le fil entier est
 * réexaminé à chaque ajout »). Le modèle ne reçoit qu'un passage : le découpage
 * reste visible pour qu'il puisse recoller une charge répartie sur plusieurs
 * commentaires, alors qu'aucun fragment ne suffit seul.
 */
export function threadPassage(rows: readonly SegmentRow[]): string {
  return rows
    .map((row) => `[${row.refId ? `commentaire ${row.refId}` : row.field}] ${row.text}`)
    .join('\n\n');
}

/** Ce texte de fil a-t-il déjà été lu par le modèle pour ce ticket ? */
async function threadAlreadyScanned(
  deps: PipelineDeps,
  issueId: string,
  hash: string,
): Promise<boolean> {
  const recent = await deps.store.events.list(issueId, THREAD_LOOKBACK);
  return recent.some((event) => {
    if (event.kind !== THREAD_SCANNED) return false;
    try {
      return (JSON.parse(event.payload) as { hash?: string }).hash === hash;
    } catch {
      return false;
    }
  });
}

/** Ce que le réexamen du fil a produit. */
interface ThreadOutcome {
  findings: number;
  malformed: boolean;
}

/**
 * Réexamine le fil quand la charge est **répartie sur plusieurs commentaires**
 * (§22). Un fil déjà lu n'est pas repassé devant le modèle (empreinte du
 * texte), donc `scanIssue` qui met N segments en file ne déclenche qu'une
 * lecture de fil par version du texte. Le constat porte sur un segment
 * synthétique stable (`<issue>:thread`) : il ne se duplique pas et ne dépend
 * pas du commentaire qui a déclenché la lecture.
 *
 * Le seuil est « deux commentaires », pas « deux segments » : un résumé et une
 * description forment **un seul message**, les relire ensemble n'apporte rien
 * et élargit la surface de faux positifs (mesuré en production le 13 novembre
 * 2026 : `fr-13`, mention légale de confidentialité pleine d'impératifs, est
 * passé de `clean` à `review` parce que le résumé était collé à la
 * description). La charge fragmentée du §22, elle, est dans les commentaires.
 */
async function threadPass(
  deps: PipelineDeps,
  issueId: string,
  trigger: SegmentRow,
  settings: ProjectSettings,
  now: string,
): Promise<ThreadOutcome> {
  const language = settings.language;
  const rows = await deps.store.segments.byIssue(issueId);
  // Un commentaire entièrement couvert par une formule à ignorer ne fait pas
  // partie du fil qu'on juge : signature, mention légale recopiée, etc.
  const comments = rows
    .filter((row) => row.field === 'comment')
    .flatMap((row) => {
      const text = passageToRead(row.text, settings);
      return text === null ? [] : [{ ...row, text }];
    });
  if (comments.length < 2) return { findings: 0, malformed: false };
  const passage = threadPassage(comments);
  const hash = contentHash(passage);
  if (await threadAlreadyScanned(deps, issueId, hash)) return { findings: 0, malformed: false };
  const hit = await modelReading(deps, passage, language);
  if (!hit) return { findings: 0, malformed: false };
  await deps.store.events.append(THREAD_SCANNED, issueId, { hash });
  const produced = toFindings({
    hits: [hit],
    segment: segmentOf(trigger),
    segmentId: `${issueId}:${THREAD_ID_SUFFIX}`,
    language,
    now,
  });
  return { findings: (await storeFindings(deps, produced)).length, malformed: hit.kind === 'model-malformed' };
}

/**
 * Fait classer un segment par le modèle, **puis réexamine le fil entier** (§22),
 * conserve les constats obtenus et met à jour l'état du ticket. Un modèle
 * indisponible ne casse rien : les couches C1 et C2 restent valides (§20).
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

  const passage = passageToRead(row.text, settings);
  const hit = passage === null ? null : await modelReading(deps, passage, language);
  const produced = hit
    ? toFindings({ hits: [hit], segment: segmentOf(row), segmentId, language, now })
    : [];
  const single = await storeFindings(deps, produced);
  const thread = await threadPass(deps, issueId, row, settings, now);

  const findings = single.length + thread.findings;
  const suspicion = await persistAfterC3(deps, issueId, existing, now);
  await deps.store.events.append('c3', issueId, { segmentId, findings, suspicion });

  if (!hit && findings === 0) {
    const reason = passage === null ? 'passage-ignore' : 'modele-indisponible';
    return { segmentId, findings: 0, malformed: false, reason };
  }
  return {
    segmentId,
    findings,
    malformed: hit?.kind === 'model-malformed' || thread.malformed,
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
