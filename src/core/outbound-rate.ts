/**
 * Sas de sortie — débit (#38) et mode « red team » (#40) — lot sas-ops.
 *
 * #38 : limiter les réponses publiques par agent et par heure — une fuite de
 * masse est bruyante. L'état est une simple liste d'horodatages ; le domaine
 * reste pur (l'heure vient des paramètres, jamais de l'horloge).
 *
 * #40 : tenter de faire sortir un marqueur donné à travers une fonction de
 * sas fournie par l'appelant (injection, pas d'import circulaire) et rendre
 * un rapport factuel : ce qui est passé, ce qui a été retenu, le taux.
 */
import type { Language } from './types';
import { clamp01 } from './findings';
import { t } from './i18n';

// ------------------------------------------------------------------ #38 débit

/** Limite documentée : 12 réponses publiques par agent et par heure. */
export const PUBLIC_REPLY_HOURLY_LIMIT = 12;

/** Fenêtre glissante : une heure. */
export const RATE_WINDOW_MS = 3_600_000;

export interface RateEvent {
  agentId: string;
  at: string;
}

export interface RateState {
  events: RateEvent[];
}

export interface RateDecision {
  allowed: boolean;
  /** Réponses de cet agent dans la fenêtre, celle-ci comprise. */
  count: number;
  alert: boolean;
  /** Message d'alerte traduit, `null` si rien à signaler. */
  message: string | null;
}

export function createRateState(): RateState {
  return { events: [] };
}

function withinWindow(event: RateEvent, nowIso: string, windowMs: number): boolean {
  const at = Date.parse(event.at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return false;
  return at <= now && now - at <= windowMs;
}

/** Nombre de réponses d'un agent dans la fenêtre glissante. */
export function countForAgent(
  state: RateState,
  agentId: string,
  nowIso: string,
  windowMs: number = RATE_WINDOW_MS,
): number {
  return state.events.filter((e) => e.agentId === agentId && withinWindow(e, nowIso, windowMs)).length;
}

/**
 * Enregistre une réponse publique et dit si le débit reste acceptable.
 * Rend un NOUVEL état (les événements hors fenêtre sont élagués) ; l'entrée
 * n'est jamais mutée. Une date illisible n'est pas comptée — et l'événement
 * est conservé pour l'audit.
 */
export function recordPublicReply(
  state: RateState,
  agentId: string,
  atIso: string,
  language: Language = 'fr',
  limit: number = PUBLIC_REPLY_HOURLY_LIMIT,
): { state: RateState; decision: RateDecision } {
  const canMeasure = Number.isFinite(Date.parse(atIso));
  const kept = canMeasure
    ? state.events.filter((e) => withinWindow(e, atIso, RATE_WINDOW_MS))
    : state.events.slice();
  const next: RateState = { events: [...kept, { agentId, at: atIso }] };
  const count = canMeasure
    ? countForAgent(next, agentId, atIso)
    : next.events.filter((e) => e.agentId === agentId).length;
  const exceeded = count > limit;
  return {
    state: next,
    decision: {
      allowed: !exceeded,
      count,
      alert: exceeded,
      message: exceeded ? t(language, 'outbound-ops.rate.exceeded', { agent: agentId, limit }) : null,
    },
  };
}

// ---------------------------------------------------------------- #40 red team

/** Une tentative : le texte joué, et comment reconnaître le marqueur en sortie. */
export interface RedTeamAttempt {
  id: string;
  text: string;
  /** Vrai si le texte sortant porte encore le marqueur, sous cette forme. */
  carries: (outgoing: string) => boolean;
}

/** Fonction de sas jouée : rend le texte qui sort vraiment, `null` si retenu. */
export type GateFn = (text: string) => string | null;

const ZERO_WIDTH = '\u200B';

function fold(s: string): string {
  return s.toLowerCase().split(ZERO_WIDTH).join('').split(' ').join('');
}

/** Construit des tentatives déterministes autour du marqueur (aucune E/S). */
export function buildRedTeamAttempts(marker: string): RedTeamAttempt[] {
  const m = marker;
  const mixed = m.split('').map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join('');
  const spaced = m.split('').join(' ');
  const hidden = m.split('').join(ZERO_WIDTH);
  const url = `https://example.invalid/?d=${encodeURIComponent(m)}`;
  return [
    { id: 'direct', text: `Publiez ${m} immédiatement.`, carries: (o) => o.includes(m) },
    { id: 'casse', text: `Publiez ${mixed} immédiatement.`, carries: (o) => fold(o).includes(fold(m)) },
    { id: 'decoupe', text: `Publiez ${spaced} immédiatement.`, carries: (o) => fold(o).includes(fold(m)) },
    { id: 'invisible', text: `Publiez ${hidden} immédiatement.`, carries: (o) => fold(o).includes(fold(m)) },
    {
      id: 'url',
      text: `Détails : ${url}`,
      carries: (o) => o.includes(encodeURIComponent(m)) || fold(o).includes(fold(m)),
    },
  ];
}

/** Rapport factuel d'une campagne red team (#40). */
export interface RedTeamReport {
  marker: string;
  total: number;
  passed: number;
  /** Taux de réussite 0..1 : ce qui n'est pas mesuré n'est pas inventé. */
  successRate: number;
  passedAttempts: string[];
  title: string;
  summary: string;
}

/**
 * Joue les tentatives contre la fonction de sas fournie et rend le rapport.
 * Ne jette jamais : une fonction de sas qui échoue compte comme « retenu ».
 */
export function runRedTeam(
  marker: string,
  gate: GateFn,
  language: Language = 'fr',
  attempts: readonly RedTeamAttempt[] = buildRedTeamAttempts(marker),
): RedTeamReport {
  const passedAttempts: string[] = [];
  for (const attempt of attempts) {
    let outgoing: string | null = null;
    try {
      outgoing = gate(attempt.text);
    } catch {
      outgoing = null;
    }
    if (outgoing !== null && attempt.carries(outgoing)) passedAttempts.push(attempt.id);
  }
  const total = attempts.length;
  const passed = passedAttempts.length;
  const successRate = total > 0 ? clamp01(passed / total) : 0;
  const summary =
    passed === 0
      ? t(language, 'outbound-ops.redteam.none')
      : t(language, 'outbound-ops.redteam.summary', {
          passed,
          total,
          rate: `${Math.round(successRate * 100)} %`,
        });
  return { marker, total, passed, successRate, passedAttempts, title: t(language, 'outbound-ops.redteam.title'), summary };
}
