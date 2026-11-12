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
  DEFAULT_SESSION_TTL_MS,
  expiresAt,
  remainingMs,
  signSessionToken,
  verifySessionToken,
  type SessionClaims,
  type SessionTokenCheck,
} from '../../core/session-token';
import {
  badge, buttonHtml, byId, field, grid, heading, kv, note, panel, pre, selectHtml, table, valueOf,
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
  tokenTitle: { fr: '3. Jeton signé HMAC (#23) et TTL d’inactivité (#24)', en: '3. HMAC-signed token (#23) and inactivity TTL (#24)' },
  tokenIntro: {
    fr: 'La marque est auto-portée : un jeton signé avec une clé de démonstration saisie ici (jamais stockée). Altérer la charge casse la signature. Le TTL glissant compte depuis la dernière activité — simulez le temps qui passe.',
    en: 'The mark is self-contained: a token signed with a demo key typed here (never stored). Altering the payload breaks the signature. The sliding TTL runs from the last activity — simulate time passing.',
  },
  key: { fr: 'Clé de démonstration (≥ 16 caractères)', en: 'Demo key (≥ 16 characters)' },
  sign: { fr: 'Signer la marque', en: 'Sign the mark' },
  verify: { fr: 'Vérifier le jeton', en: 'Verify the token' },
  tamper: { fr: 'Altérer la charge', en: 'Tamper with the payload' },
  plus5: { fr: '+5 min d’inactivité', en: '+5 min idle' },
  plus35: { fr: '+35 min d’inactivité', en: '+35 min idle' },
  noToken: { fr: 'Aucun jeton signé pour l’instant.', en: 'No signed token yet.' },
  valid: { fr: 'jeton valable', en: 'token valid' },
  expires: { fr: 'Échéance (TTL glissant)', en: 'Expires at (sliding TTL)' },
  remaining: { fr: 'Activité restante', en: 'Activity remaining' },
  notifiedSigned: { fr: 'Jeton signé.', en: 'Token signed.' },
  notifiedNoKey: { fr: 'Clé trop courte : rien n’est signé sans clé utilisable.', en: 'Key too short: nothing is signed without a usable key.' },
  notifiedVerified: { fr: 'Jeton vérifié.', en: 'Token verified.' },
  notifiedTampered: { fr: 'Charge altérée : vérifiez, la signature tombe.', en: 'Payload altered: verify it, the signature fails.' },
  notifiedNoToken: { fr: 'Signez d’abord un jeton.', en: 'Sign a token first.' },
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
  key: string;
  token: string | null;
  check: SessionTokenCheck | null;
}

let state: SessionsState = {
  taints: [], trust: 'T1', action: 'public-reply', offsetMin: 0,
  key: '', token: null, check: null,
};

/** Remet la démonstration à zéro (tests, bouton de réinitialisation). */
export function resetSessionsDemo(): void {
  state = {
    taints: [], trust: 'T1', action: 'public-reply', offsetMin: 0,
    key: '', token: null, check: null,
  };
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

/** Affirmations signables (#23) pour la session de démonstration. */
export function demoClaims(ctx: SectionContext): SessionClaims {
  const now = demoNow(ctx);
  return {
    sessionRef: DEMO.sessionRef,
    accountId: DEMO.accountId,
    issueId: DEMO.issueId,
    taintedSince: currentTaint()?.since ?? now,
    lastActivityAt: now,
    publicRepliesUsed: 0,
    quarantine: false,
  };
}

/** Altère un caractère de la charge : la signature ne peut plus suivre. */
export function tamperToken(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) return token;
  const payload = parts[1] ?? '';
  parts[1] = (payload.charAt(0) === 'A' ? 'B' : 'A') + payload.slice(1);
  return parts.join('.');
}

/** Compte à rebours lisible (m:ss) ; `0:00` une fois l’échéance passée. */
export function formatRemaining(ms: number): string {
  if (Number.isNaN(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
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

function tokenHtml(ctx: SectionContext): string {
  if (!state.token) return note(tx(ctx, 'noToken'));
  const { check } = state;
  const verdict = check
    ? (check.ok ? badge(tx(ctx, 'valid'), 'ok') : badge(check.reason, 'danger'))
    : '';
  const claims = check?.claims ?? demoClaims(ctx);
  const deadline = check?.expiresAt ?? expiresAt(claims, DEFAULT_SESSION_TTL_MS);
  const left = formatRemaining(remainingMs(claims, demoNow(ctx), DEFAULT_SESSION_TTL_MS));
  return pre(state.token) +
    `<p>${verdict}</p>` +
    kv([[tx(ctx, 'expires'), deadline ?? '—'], [tx(ctx, 'remaining'), left]]);
}

function tokenPanel(ctx: SectionContext): string {
  return panel(
    heading(tx(ctx, 'tokenTitle')) +
    note(tx(ctx, 'tokenIntro')) +
    field(tx(ctx, 'key'), '<input id="s-key" type="text" size="34" placeholder="demo-key-0123456789">') +
    buttonHtml('s-sign', tx(ctx, 'sign')) +
    buttonHtml('s-verify', tx(ctx, 'verify'), 'ghost') +
    buttonHtml('s-tamper', tx(ctx, 'tamper'), 'ghost') +
    buttonHtml('s-plus5', tx(ctx, 'plus5'), 'ghost') +
    buttonHtml('s-plus35', tx(ctx, 'plus35'), 'ghost') +
    `<div id="s-token">${tokenHtml(ctx)}</div>`,
  );
}

function render(ctx: SectionContext): string {
  return grid(taintPanel(ctx), gesturePanel(ctx)) + tokenPanel(ctx);
}

function refresh(root: HTMLElement, ctx: SectionContext): void {
  const status = byId(root, 's-taint-status');
  if (status) status.innerHTML = taintStatus(ctx);
  const decision = byId(root, 's-decision');
  if (decision) decision.innerHTML = decisionHtml(ctx);
  const token = byId(root, 's-token');
  if (token) token.innerHTML = tokenHtml(ctx);
}

function on(root: HTMLElement, id: string, handler: () => void): void {
  byId<HTMLButtonElement>(root, id)?.addEventListener('click', handler);
}

function mountToken(root: HTMLElement, ctx: SectionContext): void {
  on(root, 's-sign', () => {
    state.key = valueOf(root, 's-key');
    state.token = signSessionToken(demoClaims(ctx), state.key);
    state.check = null;
    refresh(root, ctx);
    ctx.notify(state.token ? tx(ctx, 'notifiedSigned') : tx(ctx, 'notifiedNoKey'));
  });
  on(root, 's-verify', () => {
    if (!state.token) {
      ctx.notify(tx(ctx, 'notifiedNoToken'));
      return;
    }
    state.key = valueOf(root, 's-key') || state.key;
    state.check = verifySessionToken(state.token, state.key, demoNow(ctx), DEFAULT_SESSION_TTL_MS);
    refresh(root, ctx);
    ctx.notify(tx(ctx, 'notifiedVerified'));
  });
  on(root, 's-tamper', () => {
    if (!state.token) {
      ctx.notify(tx(ctx, 'notifiedNoToken'));
      return;
    }
    state.token = tamperToken(state.token);
    state.check = null;
    refresh(root, ctx);
    ctx.notify(tx(ctx, 'notifiedTampered'));
  });
  on(root, 's-plus5', () => {
    state.offsetMin += 5;
    refresh(root, ctx);
  });
  on(root, 's-plus35', () => {
    state.offsetMin += 35;
    refresh(root, ctx);
  });
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
  mountToken(root, ctx);
}

export const sessionsSection: Section = {
  id: 'sessions',
  titles: { fr: 'Session contaminée', en: 'Tainted session' },
  render,
  mount,
};
