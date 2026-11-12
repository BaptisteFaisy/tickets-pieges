/**
 * Jeu de démonstration de la section « Exposition » — des lignes construites
 * ici, jamais lues d'un vrai ticket.
 *
 * Le rapport d'exposition (§13, §14) agrège des compteurs : constats par couche,
 * verdicts humains, exercices d'alerte et leurs coups, actions du sas, campagnes.
 * Deux périodes sont fournies — **avant** et **après** l'activation des
 * protections — pour rejouer l'avant/après du §14 sans inventer un chiffre de
 * terrain : ce sont des données de démonstration, et la section le dit.
 *
 * Trois garanties : déterminisme (les dates dérivent de `ctx.now`, jamais de
 * l'horloge du système), aucun texte de ticket (`excerpt` et `askSummary` sont
 * vides : le rapport n'en a pas besoin), aucune identité (les comptes sont des
 * libellés fictifs, les exercices se lisent par type d'acteur).
 */

import type {
  Canary,
  CanaryActorType,
  CanaryHit,
  DetectionLayer,
  Finding,
  FindingKind,
  OutboundAction,
  Verdict,
  VerdictDecision,
} from '../../core/types';
import type { ExposureInput } from '../../core/exposure';
import type { AssistantLaunch } from '../../core/assistants';

/** Les deux périodes du jeu de démonstration. */
export type PeriodId = 'before' | 'after';

export interface DemoPeriod {
  id: PeriodId;
  /** Libellé de la période, dans les deux langues. */
  titles: { fr: string; en: string };
  /** Ce que `buildExposureReport` attend (§13). */
  input: ExposureInput;
  /** Exercices attribués à un assistant (#42) : nom d'intégration, jamais une personne. */
  launches: AssistantLaunch[];
  /** Coups d'exercice, pour la répartition par type d'acteur. */
  hits: CanaryHit[];
}

const PROJECT_KEY = 'DEMO';
const DAY_MS = 86_400_000;

/** Une date ISO (jour) décalée de `offset` jours **depuis `ctx.now`**. */
export function dayFrom(now: string, offsetDays: number): string {
  return new Date(new Date(now).getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

interface RuleSpec {
  layer: DetectionLayer;
  kind: FindingKind;
  ruleId: string;
}

/**
 * Fabrique `count` constats d'une même règle. L'extrait et le résumé sont vides :
 * un rapport d'exposition compte des motifs, il ne montre jamais un texte (§21).
 */
export function demoFindings(spec: RuleSpec, count: number, at: string, campaignHash?: string): Finding[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${spec.ruleId}-${index + 1}`,
    segmentId: `${spec.ruleId}-seg-${index + 1}`,
    issueId: `demo-${(index % 40) + 1}`,
    layer: spec.layer,
    kind: spec.kind,
    ruleId: spec.ruleId,
    excerpt: '',
    startPos: 0,
    endPos: 0,
    askSummary: '',
    confidence: 0.9,
    status: 'open' as const,
    campaignHash,
    createdAt: at,
  }));
}

interface VerdictPlan {
  findings: Finding[];
  decision: VerdictDecision;
  count: number;
}

/** Pose des verdicts humains sur les `count` premiers constats de chaque plan. */
export function demoVerdicts(plans: readonly VerdictPlan[], at: string): Verdict[] {
  return plans.flatMap((plan) =>
    plan.findings.slice(0, plan.count).map((finding) => ({
      findingId: finding.id,
      reviewerAccountId: 'demo-reviewer',
      decision: plan.decision,
      at,
    })),
  );
}

/** Exercices d'alerte fictifs : seule leur existence compte dans le rapport. */
export function demoCanaries(count: number, at: string): Canary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `demo-canary-${index + 1}`,
    issueId: `demo-${index + 1}`,
    issueKey: `${PROJECT_KEY}-${index + 1}`,
    token: `demo-token-${index + 1}`,
    instruction: 'demo-exercise',
    labelName: `PIEGES-EXERCICE-${index + 1}`,
    createdBy: 'demo-security',
    createdAt: at,
    status: 'closed' as const,
  }));
}

/** Coups d'exercice : un type d'acteur par coup, jamais un compte nominatif. */
export function demoHits(canaries: Canary[], actorTypes: readonly CanaryActorType[], at: string): CanaryHit[] {
  return canaries.slice(0, actorTypes.length).map((canary, index) => ({
    canaryId: canary.id,
    actorAccountId: `demo-actor-${index + 1}`,
    actorType: actorTypes[index] ?? 'unknown',
    action: 'label-applied',
    at,
  }));
}

/** Actions du sas (§10) : `held` réponses retenues, `allowed` laissées passer. */
export function demoOutbound(held: number, allowed: number): OutboundAction[] {
  const heldKinds: OutboundAction[] = ['hold-for-review', 'convert-to-internal', 'alert'];
  return [
    ...Array.from({ length: allowed }, () => 'allow' as OutboundAction),
    ...Array.from({ length: held }, (_, index) => heldKinds[index % heldKinds.length] ?? 'hold-for-review'),
  ];
}

/** Un assistant, le nombre d'exercices lancés, ceux qui ont été suivis d'effet. */
type LaunchSpec = readonly [assistant: string, launched: number, obeyed: number];

/** Déplie les lancements par assistant en `AssistantLaunch` (#42). */
export function demoLaunches(specs: readonly LaunchSpec[]): AssistantLaunch[] {
  const launches: AssistantLaunch[] = [];
  for (const [assistant, launched, obeyed] of specs) {
    for (let index = 0; index < launched; index += 1) {
      launches.push({ assistant, canaryId: `${assistant}-${index + 1}`, obeyed: index < obeyed });
    }
  }
  return launches;
}

/** Période « avant » : peu de choses analysées, les assistants obéissent. */
function beforePeriod(now: string): DemoPeriod {
  const at = dayFrom(now, -45);
  const addressing = demoFindings({ layer: 'C2', kind: 'assistant-addressing', ruleId: 'c2.addressing' }, 5, at);
  const marker = demoFindings({ layer: 'C2', kind: 'fake-system-marker', ruleId: 'c2.system-marker' }, 2, at);
  const exfil = demoFindings({ layer: 'C2', kind: 'exfiltration-url', ruleId: 'c2.exfil' }, 2, at);
  const invisible = demoFindings({ layer: 'C1', kind: 'invisible-chars', ruleId: 'c1.invisible' }, 3, at);
  const encoded = demoFindings({ layer: 'C1', kind: 'encoded-block', ruleId: 'c1.encoded' }, 2, at);
  const model = demoFindings({ layer: 'C3', kind: 'model-verdict', ruleId: 'c3.model' }, 4, at);
  const length = demoFindings({ layer: 'C4', kind: 'unusual-length', ruleId: 'c4.length' }, 4, at);
  const fresh = demoFindings({ layer: 'C4', kind: 'fresh-account', ruleId: 'c4.fresh-account' }, 5, at);
  const anonymous = demoFindings({ layer: 'C4', kind: 'anonymous-channel', ruleId: 'c4.anonymous' }, 2, at);
  const canaries = demoCanaries(6, at);
  const hits = demoHits(canaries, ['ai-agent', 'ai-agent', 'automation', 'ai-agent'], at);
  return {
    id: 'before',
    titles: { fr: 'Avant les protections', en: 'Before the protections' },
    input: {
      projectKey: PROJECT_KEY,
      from: dayFrom(now, -60),
      to: dayFrom(now, -31),
      requestsExamined: 240,
      requestsFullyAnalyzed: 150,
      findings: [
        ...invisible, ...encoded, ...addressing, ...marker, ...exfil, ...model, ...length, ...fresh, ...anonymous,
      ],
      verdicts: demoVerdicts(
        [
          { findings: addressing, decision: 'trapped', count: 3 },
          { findings: marker, decision: 'trapped', count: 1 },
          { findings: length, decision: 'false-positive', count: 3 },
          { findings: model, decision: 'legitimate-risky', count: 2 },
        ],
        at,
      ),
      canaries,
      canaryHits: hits,
      outboundActions: demoOutbound(2, 120),
      campaigns: 4,
    },
    launches: demoLaunches([['rovo', 2, 2], ['claude', 2, 1], ['copilot', 1, 0], ['bot-maison', 1, 1]]),
    hits,
  };
}

/**
 * Période « après » : presque tout est analysé, le sas retient, les assistants
 * n'obéissent plus. Une règle bruyante (`c4.length`) accumule assez de faux
 * positifs pour être rétrogradée en simple pondération (§14).
 */
function afterPeriod(now: string): DemoPeriod {
  const at = dayFrom(now, -5);
  const addressing = demoFindings({ layer: 'C2', kind: 'assistant-addressing', ruleId: 'c2.addressing' }, 6, at);
  const roleSwitch = demoFindings({ layer: 'C2', kind: 'role-switch', ruleId: 'c2.role-switch' }, 2, at);
  const exfil = demoFindings({ layer: 'C2', kind: 'exfiltration-url', ruleId: 'c2.exfil' }, 2, at);
  const tool = demoFindings({ layer: 'C2', kind: 'tool-command', ruleId: 'c2.tool-command' }, 1, at);
  const invisible = demoFindings({ layer: 'C1', kind: 'invisible-chars', ruleId: 'c1.invisible' }, 4, at);
  const bidi = demoFindings({ layer: 'C1', kind: 'bidi-override', ruleId: 'c1.bidi' }, 1, at);
  const encoded = demoFindings({ layer: 'C1', kind: 'encoded-block', ruleId: 'c1.encoded' }, 2, at);
  const model = demoFindings({ layer: 'C3', kind: 'model-verdict', ruleId: 'c3.model' }, 5, at);
  const malformed = demoFindings({ layer: 'C3', kind: 'model-malformed', ruleId: 'c3.malformed' }, 1, at);
  const length = demoFindings({ layer: 'C4', kind: 'unusual-length', ruleId: 'c4.length' }, 7, at);
  const fresh = demoFindings({ layer: 'C4', kind: 'fresh-account', ruleId: 'c4.fresh-account' }, 6, at);
  const shift = demoFindings({ layer: 'C4', kind: 'language-shift', ruleId: 'c4.language-shift' }, 2, at);
  const canaries = demoCanaries(10, at);
  const hits = demoHits(canaries, ['ai-agent'], at);
  return {
    id: 'after',
    titles: { fr: 'Après les protections', en: 'After the protections' },
    input: {
      projectKey: PROJECT_KEY,
      from: dayFrom(now, -30),
      to: dayFrom(now, -1),
      requestsExamined: 300,
      requestsFullyAnalyzed: 285,
      findings: [
        ...invisible, ...bidi, ...encoded, ...addressing, ...roleSwitch, ...exfil, ...tool,
        ...model, ...malformed, ...length, ...fresh, ...shift,
      ],
      verdicts: demoVerdicts(
        [
          { findings: addressing, decision: 'trapped', count: 5 },
          { findings: exfil, decision: 'trapped', count: 1 },
          { findings: length, decision: 'false-positive', count: 6 },
          { findings: fresh, decision: 'trapped', count: 1 },
          { findings: model, decision: 'legitimate-risky', count: 2 },
          { findings: invisible, decision: 'false-positive', count: 1 },
        ],
        at,
      ),
      canaries,
      canaryHits: hits,
      outboundActions: demoOutbound(24, 276),
      campaigns: 2,
    },
    launches: demoLaunches([['rovo', 3, 0], ['claude', 3, 1], ['copilot', 2, 0], ['gemini', 1, 0], ['chatgpt', 1, 0]]),
    hits,
  };
}

/** Les deux périodes, dans l'ordre du rapport : avant puis après. */
export function demoPeriods(now: string): DemoPeriod[] {
  return [beforePeriod(now), afterPeriod(now)];
}

/** Retrouve une période par identifiant ; la première sinon. */
export function periodById(periods: readonly DemoPeriod[], id: string): DemoPeriod {
  return periods.find((period) => period.id === id) ?? periods[0]!;
}
