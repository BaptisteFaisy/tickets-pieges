/**
 * Section « Exercice d'alerte » — le ticket témoin (canari) de bout en bout.
 *
 * Aucune règle recopiée : la section appelle `src/core/canary.ts` (création,
 * rôle sécurité, consigne, coup, profondeur d'obéissance, clôture à échéance).
 */

import {
  CANARY_TTL_HOURS,
  closeCanary,
  createCanary,
  detectHit,
  isExpired,
  obedienceDepth,
  obedienceRate,
  summarizeCanary,
  type CanaryOutcome,
  type CanarySummary,
  type HitObservation,
} from '../../core/canary';
import type { Canary, CanaryActorType, CanaryHit } from '../../core/types';
import { badge, buttonHtml, field, grid, heading, kv, note, panel, pre, selectHtml, textareaHtml } from '../dom';
import { byId } from '../dom';
import type { Section, SectionContext } from './types';

const ACTORS: CanaryActorType[] = ['human', 'ai-agent', 'automation', 'unknown'];

/** Gestes demandés en plus du premier (§44 : mesure de la profondeur). */
const STEPS = {
  fr: ['Poser l’étiquette demandée', 'Transférer le ticket au service voisin'],
  en: ['Apply the requested label', 'Transfer the ticket to the next team'],
} as const;

const LABELS = {
  intro: {
    fr: 'Un ticket témoin (canari) est un faux ticket inoffensif : si quelqu’un obéit à sa consigne, une alerte mesure l’exposition réelle.',
    en: 'A canary ticket is a harmless fake ticket: if anyone obeys its instruction, an alert measures the real exposure.',
  },
  role: { fr: 'Rôle de l’acteur', en: 'Actor role' },
  roleAgent: { fr: 'Agent support', en: 'Support agent' },
  roleSecurity: { fr: 'Sécurité', en: 'Security' },
  issue: { fr: 'Ticket cible (clé)', en: 'Target ticket (key)' },
  launch: { fr: 'Lancer un exercice', en: 'Run an exercise' },
  actor: { fr: 'Type d’acteur observé', en: 'Observed actor type' },
  depth: { fr: 'Gestes observés (0 à 2)', en: 'Observed gestures (0 to 2)' },
  simulate: { fr: 'Simuler un coup (étiquette posée)', en: 'Simulate a hit (label applied)' },
  close: { fr: 'Avancer à l’échéance (clôture auto)', en: 'Jump to expiry (auto-close)' },
  result: { fr: 'Résultat de l’exercice', en: 'Exercise result' },
  empty: { fr: 'Choisissez un rôle, puis lancez un exercice.', en: 'Pick a role, then run an exercise.' },
  instruction: { fr: 'Consigne inoffensive déposée', en: 'Harmless instruction planted' },
  expected: { fr: 'Étiquette unique attendue', en: 'Expected unique label' },
  denied: { fr: 'Refusé', en: 'Denied' },
  created: { fr: 'Exercice créé', en: 'Exercise created' },
  needCanary: { fr: 'Lancez d’abord un exercice.', en: 'Run an exercise first.' },
  hitOk: { fr: 'Coup détecté', en: 'Hit detected' },
  hitNone: { fr: 'Aucun coup : l’étiquette n’est pas apparue.', en: 'No hit: the label never appeared.' },
  depthOf: { fr: 'Profondeur d’obéissance', en: 'Obedience depth' },
  rate: { fr: 'Taux d’obéissance (session)', en: 'Obedience rate (session)' },
  expired: { fr: 'Échéance dépassée → clôture automatique', en: 'Expiry passed → auto-close' },
  hint: {
    fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, rien ne quitte la page.',
    en: 'Everything runs in your browser: no network call, nothing leaves this page.',
  },
} as const;

function label(ctx: SectionContext, key: keyof typeof LABELS): string {
  return LABELS[key][ctx.lang];
}

/** Drapeaux de gestes pour `obedienceDepth` : `count` gestes observés sur 2. */
export function depthFlags(count: number): boolean[] {
  return [count >= 1, count >= 2];
}

/** Instant juste après l'échéance (§13), dérivé de `ctx.now` — jamais de l'horloge. */
export function expiryInstant(now: string): string {
  return new Date(Date.parse(now) + (CANARY_TTL_HOURS + 1) * 3_600_000).toISOString();
}

/** Fiche d'un canari : les champs qui comptent, en paires clés/valeurs. */
export function canaryCard(canary: Canary, ctx: SectionContext): string {
  return kv([
    ['id', canary.id],
    ['issue', canary.issueKey],
    ['token', canary.token],
    ['label', canary.labelName],
    ['createdBy', canary.createdBy],
    ['createdAt', canary.createdAt],
    [ctx.lang === 'fr' ? 'état' : 'status', canary.status],
  ]);
}

/** Résultat de `createCanary` : refus net (rôle) ou fiche + consigne + étiquette. */
export function outcomeHtml(outcome: CanaryOutcome, ctx: SectionContext): string {
  if (!outcome.ok) {
    return `${badge(label(ctx, 'denied'), 'bad')}${note(outcome.error)}`;
  }
  return [
    badge(label(ctx, 'created'), 'ok'),
    canaryCard(outcome.canary, ctx),
    heading(label(ctx, 'expected')),
    badge(outcome.labelName, 'warn'),
    heading(label(ctx, 'instruction')),
    pre(outcome.instruction),
  ].join('');
}

/** Un coup simulé : type d'acteur, profondeur d'obéissance, taux de session. */
export function hitHtml(summary: CanarySummary, depth: number, launched: number, ctx: SectionContext): string {
  if (!summary.obeyed) return note(label(ctx, 'hitNone'));
  const types = summary.actorTypes.map((actor) => badge(actor)).join(' ');
  return [
    badge(label(ctx, 'hitOk'), 'bad'),
    types,
    kv([
      [label(ctx, 'depthOf'), `${depth} / 2`],
      [label(ctx, 'rate'), String(obedienceRate(launched, summary.hits.length))],
    ]),
    pre(summary.hits.map((hit: CanaryHit) => `${hit.at} · ${hit.actorType} · ${hit.action}`).join('\n')),
  ].join('');
}

/** Formulaire de la section. */
function form(ctx: SectionContext): string {
  return panel(
    note(label(ctx, 'intro')) +
      field(label(ctx, 'role'), selectHtml('c-role', [
        ['agent', label(ctx, 'roleAgent')],
        ['security', label(ctx, 'roleSecurity')],
      ], 'security')) +
      field(label(ctx, 'issue'), textareaHtml('c-issue', 1, 'DEMO-42', 'DEMO-42')) +
      buttonHtml('c-launch', label(ctx, 'launch')) +
      field(label(ctx, 'actor'), selectHtml('c-actor', ACTORS.map((a) => [a, a]))) +
      field(label(ctx, 'depth'), selectHtml('c-depth', [['0', '0'], ['1', '1'], ['2', '2']], '2')) +
      buttonHtml('c-simulate', label(ctx, 'simulate'), 'ghost') +
      buttonHtml('c-close', label(ctx, 'close'), 'ghost') +
      note(label(ctx, 'hint')),
  );
}

/** État vivant de la session de démonstration (jamais persisté). */
interface Session {
  canary: Canary | null;
  hits: CanaryHit[];
  launched: number;
}

function readIssueKey(root: HTMLElement): string {
  const node = byId<HTMLTextAreaElement>(root, 'c-issue');
  return (node?.value ?? 'DEMO-42').trim() || 'DEMO-42';
}

function show(root: HTMLElement, ctx: SectionContext, html: string): void {
  const target = byId<HTMLDivElement>(root, 'c-result');
  if (target) target.innerHTML = html;
}

/** Lancement : `createCanary` décide — le rôle agent reçoit le refus du domaine. */
function launch(root: HTMLElement, session: Session, ctx: SectionContext): void {
  const outcome = createCanary({
    issueId: readIssueKey(root).toLowerCase(),
    issueKey: readIssueKey(root),
    createdBy: 'demo-visiteur',
    role: byId<HTMLSelectElement>(root, 'c-role')?.value ?? 'agent',
    now: ctx.now,
    language: ctx.lang,
    steps: STEPS[ctx.lang],
  });
  session.launched += 1;
  session.canary = outcome.ok ? outcome.canary : null;
  session.hits = [];
  show(root, ctx, outcomeHtml(outcome, ctx));
  if (!outcome.ok) ctx.notify(outcome.error);
}

/** Coup simulé : `detectHit` tranche, `obedienceDepth` mesure la profondeur. */
function simulate(root: HTMLElement, session: Session, ctx: SectionContext): void {
  if (!session.canary) {
    show(root, ctx, note(label(ctx, 'needCanary')));
    return;
  }
  const count = Number(byId<HTMLSelectElement>(root, 'c-depth')?.value ?? '0');
  const observation: HitObservation = {
    canary: session.canary,
    labelsAdded: count > 0 ? [session.canary.labelName] : [],
    actorAccountId: 'compte-demo',
    actorType: (byId<HTMLSelectElement>(root, 'c-actor')?.value ?? 'unknown') as CanaryActorType,
    now: ctx.now,
  };
  const hit = detectHit(observation);
  if (hit) session.hits.push(hit);
  const summary = summarizeCanary(session.canary, session.hits);
  show(root, ctx, hitHtml(summary, obedienceDepth(depthFlags(count)), session.launched, ctx));
}

/** Clôture automatique : à l'échéance, `isExpired` puis `closeCanary` (§13). */
function closeAtExpiry(root: HTMLElement, session: Session, ctx: SectionContext): void {
  if (!session.canary) {
    show(root, ctx, note(label(ctx, 'needCanary')));
    return;
  }
  const at = expiryInstant(ctx.now);
  if (!isExpired(session.canary, at)) {
    show(root, ctx, note(label(ctx, 'empty')));
    return;
  }
  session.canary = closeCanary(session.canary, at);
  show(root, ctx, `${badge(label(ctx, 'expired'), 'warn')}${canaryCard(session.canary, ctx)}`);
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  const session: Session = { canary: null, hits: [], launched: 0 };
  byId<HTMLButtonElement>(root, 'c-launch')?.addEventListener('click', () => launch(root, session, ctx));
  byId<HTMLButtonElement>(root, 'c-simulate')?.addEventListener('click', () => simulate(root, session, ctx));
  byId<HTMLButtonElement>(root, 'c-close')?.addEventListener('click', () => closeAtExpiry(root, session, ctx));
}

function render(ctx: SectionContext): string {
  return grid(form(ctx), panel(note(label(ctx, 'empty')), 'c-result'));
}

export const canarySection: Section = {
  id: 'canary',
  titles: { fr: 'Exercice d’alerte', en: 'Alert exercise' },
  render,
  mount,
};
