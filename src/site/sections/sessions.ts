/**
 * Section « Session contaminée » — §9, #23, #24, #26, #27, #28, #30.
 *
 * Démonstration en deux clics : lire un contenu T0/T1 contamine la session,
 * les gestes de sortie demandent confirmation, le jeton signé prouve la
 * marque, le TTL l'éteint, le budget et la quarantaine la verrouillent,
 * l'audit s'exporte et la boucle d'agent est repérée. Aucune règle recopiée :
 * la section appelle `src/core/session*.ts`.
 */

import type { TaintedSession, TrustLevel } from '../../core/types';
import { TRUST_LEVELS } from '../../core/types';
import type { GuardedAction, SessionDecision } from '../../core/session';
import {
  GUARDED_ACTIONS,
  endSession,
  mergeTaint,
  requiresConfirmation,
  taint,
} from '../../core/session';
import {
  badge, buttonHtml, byId, field, grid, heading, note, panel, selectHtml, table, valueOf,
} from '../dom';
import type { Section, SectionContext } from './types';

/** Identifiants de la session de démonstration (aucune donnée réelle). */
const DEMO = { sessionRef: 'demo-session', accountId: 'demo-user', issueId: 'DEMO-42' };

const TEXTS = {
  taintTitle: { fr: '1. Lecture d’un contenu', en: '1. Reading content' },
  taintIntro: {
    fr: 'Une session qui lit un contenu T0/T1 (non vérifié) est marquée jusqu’à sa fin. T2/T3 (prouvé interne) ne contamine pas.',
    en: 'A session reading T0/T1 (unverified) content is marked until it ends. T2/T3 (proven internal) does not taint.',
  },
  trust: { fr: 'Niveau du contenu lu', en: 'Trust level of the content' },
  read: { fr: 'Lire le contenu', en: 'Read the content' },
  end: { fr: 'Fin de session', en: 'End session' },
  tainted: { fr: 'contaminée', en: 'tainted' },
  clean: { fr: 'saine', en: 'clean' },
  session: { fr: 'Session', en: 'Session' },
  issue: { fr: 'Ticket', en: 'Issue' },
  since: { fr: 'Marquée depuis', en: 'Tainted since' },
  gestureTitle: { fr: '2. Gestes de sortie (§9)', en: '2. Exit gestures (§9)' },
  gestureIntro: {
    fr: 'Dans une session marquée, les gestes capables de faire sortir des données demandent une confirmation humaine, avec un motif lisible.',
    en: 'In a tainted session, gestures that can leak data require human confirmation, with a readable reason.',
  },
  gesture: { fr: 'Geste demandé', en: 'Requested gesture' },
  decide: { fr: 'Demander le geste', en: 'Request the gesture' },
  allow: { fr: 'libre', en: 'allow' },
  ask: { fr: 'confirmation requise', en: 'confirmation required' },
  notifiedTainted: { fr: 'Session marquée contaminée.', en: 'Session marked as tainted.' },
  notifiedInternal: { fr: 'Contenu interne : la session reste saine.', en: 'Internal content: the session stays clean.' },
  notifiedEnded: { fr: 'Session terminée : la marque tombe.', en: 'Session ended: the mark is dropped.' },
  notifiedDecision: { fr: 'Décision rendue pour le geste.', en: 'Decision returned for the gesture.' },
} as const;

type TextKey = keyof typeof TEXTS;

function tx(ctx: SectionContext, key: TextKey): string {
  return TEXTS[key][ctx.lang];
}

interface SessionsState {
  taints: TaintedSession[];
  trust: TrustLevel;
  action: GuardedAction;
  offsetMin: number;
}

let state: SessionsState = { taints: [], trust: 'T1', action: 'public-reply', offsetMin: 0 };

/** Remet la démonstration à zéro (tests, bouton de réinitialisation). */
export function resetSessionsDemo(): void {
  state = { taints: [], trust: 'T1', action: 'public-reply', offsetMin: 0 };
}

/** Heure simulée de la démonstration : `ctx.now` décalé, jamais l’heure système. */
export function demoNow(ctx: SectionContext): string {
  return new Date(Date.parse(ctx.now) + state.offsetMin * 60000).toISOString();
}

/** La marque de la session de démonstration, ou `null`. */
export function currentTaint(): TaintedSession | null {
  return state.taints.find((item) => item.sessionRef === DEMO.sessionRef) ?? null;
}

/** Décision du §9 pour le geste sélectionné. */
export function gestureDecision(lang: 'fr' | 'en'): SessionDecision {
  return requiresConfirmation(currentTaint(), state.action, lang);
}

function taintStatus(ctx: SectionContext): string {
  const status = currentTaint()
    ? badge(tx(ctx, 'tainted'), 'danger')
    : badge(tx(ctx, 'clean'), 'ok');
  const rows = state.taints.map((item) => [item.sessionRef, item.issueId, item.since]);
  const marks = rows.length > 0
    ? table([tx(ctx, 'session'), tx(ctx, 'issue'), tx(ctx, 'since')], rows)
    : '';
  return `<p>${status}</p>${marks}`;
}

function decisionHtml(ctx: SectionContext): string {
  const decision = gestureDecision(ctx.lang);
  const verdict = badge(tx(ctx, decision.decision), decision.decision === 'ask' ? 'warn' : 'ok');
  return `<p>${verdict}</p>${decision.reason ? note(decision.reason) : ''}`;
}

function taintPanel(ctx: SectionContext): string {
  return panel(
    heading(tx(ctx, 'taintTitle')) +
    note(tx(ctx, 'taintIntro')) +
    field(tx(ctx, 'trust'), selectHtml('s-trust', TRUST_LEVELS.map((l) => [l, l]), state.trust)) +
    buttonHtml('s-read', tx(ctx, 'read')) +
    buttonHtml('s-end', tx(ctx, 'end'), 'ghost') +
    `<div id="s-taint-status">${taintStatus(ctx)}</div>`,
  );
}

function gesturePanel(ctx: SectionContext): string {
  return panel(
    heading(tx(ctx, 'gestureTitle')) +
    note(tx(ctx, 'gestureIntro')) +
    field(tx(ctx, 'gesture'), selectHtml('s-action', GUARDED_ACTIONS.map((a) => [a, a]), state.action)) +
    buttonHtml('s-decide', tx(ctx, 'decide')) +
    `<div id="s-decision">${decisionHtml(ctx)}</div>`,
  );
}

function render(ctx: SectionContext): string {
  return grid(taintPanel(ctx), gesturePanel(ctx));
}

function refresh(root: HTMLElement, ctx: SectionContext): void {
  const status = byId(root, 's-taint-status');
  if (status) status.innerHTML = taintStatus(ctx);
  const decision = byId(root, 's-decision');
  if (decision) decision.innerHTML = decisionHtml(ctx);
}

function on(root: HTMLElement, id: string, handler: () => void): void {
  byId<HTMLButtonElement>(root, id)?.addEventListener('click', handler);
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  on(root, 's-read', () => {
    state.trust = valueOf(root, 's-trust') as TrustLevel;
    const marked = taint({ ...DEMO, trustLevel: state.trust, now: demoNow(ctx) });
    state.taints = mergeTaint(state.taints, marked);
    refresh(root, ctx);
    ctx.notify(marked ? tx(ctx, 'notifiedTainted') : tx(ctx, 'notifiedInternal'));
  });
  on(root, 's-end', () => {
    state.taints = endSession(state.taints, DEMO.sessionRef);
    refresh(root, ctx);
    ctx.notify(tx(ctx, 'notifiedEnded'));
  });
  on(root, 's-decide', () => {
    state.action = valueOf(root, 's-action') as GuardedAction;
    refresh(root, ctx);
    ctx.notify(tx(ctx, 'notifiedDecision'));
  });
}

export const sessionsSection: Section = {
  id: 'sessions',
  titles: { fr: 'Session contaminée', en: 'Tainted session' },
  render,
  mount,
};
