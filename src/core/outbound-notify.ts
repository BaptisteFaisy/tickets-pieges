/**
 * Sas de sortie — opérations (#31, #39) — propriétaire : lot sas-ops.
 *
 * #31 : Jira envoie le courriel de notification dès le commentaire public
 * posé, avant tout contrôle. On ne peut pas annuler ce courriel : on mesure
 * la fenêtre, on la DIT (§21), et on contrôle le contenu de la notification
 * elle-même avec le sas existant (`checkOutbound`, jamais recopié).
 *
 * #39 : un commentaire interne destiné à être recopié ailleurs (autre ticket,
 * autre outil) emporte avec lui le niveau de confiance du texte d'origine
 * qu'il contient — l'hérédité sortante. S'il porte du texte externe, il passe
 * par le sas avant la recopie.
 *
 * Domaine pur : aucune E/S, l'heure vient toujours des paramètres.
 */
import type { Language, OutboundAction, OutboundContext, TrustLevel } from './types';
import { checkOutbound } from './outbound';
import { isExternal } from './levels';
import { t } from './i18n';

/** Objectif documenté : contrôler au plus 60 s après le commentaire public. */
export const NOTIFY_WINDOW_TARGET_MS = 60_000;

/** Fenêtre d'exposition mesurée entre commentaire public et contrôle (#31). */
export interface NotifyWindow {
  commentedAt: string;
  checkedAt: string;
  /** `false` : au moins une des deux dates était illisible — rien n'est supposé. */
  measured: boolean;
  delayMs: number;
  withinTarget: boolean;
  /** `true` : le courriel a pu partir avant le contrôle (ou la mesure a échoué). */
  notificationMayHaveLeft: boolean;
}

/** Mesure la fenêtre commentaire → contrôle. Ne jette jamais. */
export function measureNotifyWindow(
  commentedAt: string,
  checkedAt: string,
  targetMs: number = NOTIFY_WINDOW_TARGET_MS,
): NotifyWindow {
  const from = Date.parse(commentedAt);
  const to = Date.parse(checkedAt);
  const measured = Number.isFinite(from) && Number.isFinite(to);
  const delayMs = measured ? Math.max(0, to - from) : 0;
  return {
    commentedAt,
    checkedAt,
    measured,
    delayMs,
    withinTarget: measured && delayMs <= targetMs,
    notificationMayHaveLeft: !measured || delayMs > 0,
  };
}

/** Annonce honnête de la fenêtre : ce qui n'est pas mesuré est dit, jamais tu. */
export function notifyWindowAnnouncement(window: NotifyWindow, language: Language): string {
  if (!window.measured) return t(language, 'outbound-ops.notify.window-unmeasured');
  const seconds = Math.round(window.delayMs / 1000);
  return t(language, 'outbound-ops.notify.window', { seconds });
}

/** Résultat du contrôle d'une notification sortante (#31). */
export interface NotifyCheck {
  issueKey: string;
  allowed: boolean;
  action: OutboundAction;
  window: NotifyWindow;
  announcement: string;
}

/** Contrôle le contenu d'une notification et mesure sa fenêtre d'exposition. */
export function checkNotification(
  text: string,
  context: OutboundContext,
  commentedAt: string,
  checkedAt: string,
  language: Language = 'fr',
): NotifyCheck {
  const verdict = checkOutbound(text, context, { stage: 'after', language, now: checkedAt });
  const window = measureNotifyWindow(commentedAt, checkedAt);
  return {
    issueKey: context.issueKey,
    allowed: verdict.allowed,
    action: verdict.action,
    window,
    announcement: notifyWindowAnnouncement(window, language),
  };
}

/** Entrée du contrôle d'hérédité sortante (#39). */
export interface InternalCopyInput {
  text: string;
  /** Niveau de confiance du texte d'origine contenu dans le commentaire interne. */
  inheritedTrust: TrustLevel;
  context: OutboundContext;
  language?: Language;
  now?: string;
}

/** Verdict d'hérédité sortante : le commentaire recopié garde son niveau. */
export interface InternalCopyCheck {
  checked: boolean;
  inherits: TrustLevel | null;
  allowed: boolean;
  action: OutboundAction | 'unchecked';
  note: string;
}

/**
 * Contrôle un commentaire interne destiné à être recopié ailleurs (#39).
 * Si le texte qu'il contient vient de l'extérieur (T0/T1), la recopie hérite
 * de ce niveau et passe par le sas ; sinon rien n'est imposé (et c'est dit).
 */
export function checkInternalCopy(input: InternalCopyInput): InternalCopyCheck {
  const language = input.language ?? 'fr';
  if (!isExternal(input.inheritedTrust)) {
    return {
      checked: false,
      inherits: null,
      allowed: true,
      action: 'unchecked',
      note: t(language, 'outbound-ops.internal.no-inheritance'),
    };
  }
  const verdict = checkOutbound(input.text, input.context, { language, now: input.now });
  return {
    checked: true,
    inherits: input.inheritedTrust,
    allowed: verdict.allowed,
    action: verdict.action,
    note: t(language, 'outbound-ops.internal.copy', { level: input.inheritedTrust }),
  };
}
