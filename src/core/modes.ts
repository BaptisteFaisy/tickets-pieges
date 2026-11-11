/**
 * Les trois modes d'entrée (§8.1, TP-09, TP-10) et ce qu'ils changent vraiment.
 *
 * | Mode          | Ce qui change dans le ticket                          | Prix à payer |
 * |---------------|-------------------------------------------------------|--------------|
 * | signaler      | rien : un bandeau dans le panneau, une propriété       | aucun        |
 * | étiqueter     | un encart visible en tête, par ajout seulement         | le client le voit |
 * | neutraliser   | le passage suspect est remplacé, l'original conservé   | le texte du client est modifié |
 *
 * Réglage par défaut : « signaler ». Réglage conseillé une fois les faux positifs
 * mesurés : « neutraliser » à partir du niveau « suspect », pour les origines T0
 * et T1. Ce module applique exactement ce réglage — et respecte le silence envers
 * l'attaquant (§21) : en mode « signaler », rien ne change dans le portail.
 */

import type { IssueState, Language, ProtectionMode, ProjectSettings } from './types';
import { atLeast } from './levels';
import { t } from './i18n';

/** Ce que le moteur d'application doit faire sur un ticket. */
export interface ModeDecision {
  /** Le mode effectivement appliqué (peut retomber sur `report`). */
  mode: ProtectionMode;
  /** Texte de l'encart à ajouter en tête, `null` si aucun encart. */
  banner: string | null;
  /** Faut-il remplacer les passages suspects. */
  neutralize: boolean;
  /** Rien de visible pour le demandeur : silence envers l'attaquant (§21). */
  silent: boolean;
  /** Codes de décision, pour l'écran et le journal. */
  reasons: string[];
}

/** Y a-t-il quelque chose à dire sur ce ticket ? (§21 : peu de bruit) */
export function hasSomethingToSay(state: IssueState): boolean {
  return state.suspicionLevel !== 'clean' || state.unanalyzed.length > 0;
}

/** Encart visible en tête du ticket (mode « étiqueter », §8.1). */
export function labelBanner(state: IssueState, language: Language): string {
  const unanalyzed = state.unanalyzed.map((reason) => t(language, `framing.not-analyzed.${reason}`));
  const lines = [
    t(language, 'mode.banner.title'),
    t(language, 'mode.banner.body', {
      trust: t(language, `trust.${state.trustLevel}`),
      suspicion: t(language, `suspicion.${state.suspicionLevel}`),
    }),
  ];
  if (unanalyzed.length > 0) lines.push(t(language, 'mode.banner.unanalyzed', { list: unanalyzed.join(', ') }));
  lines.push(t(language, 'mode.banner.footer'));
  return lines.join('\n');
}

/** Le mode « neutraliser » s'applique-t-il à ce ticket, avec ces réglages ? */
export function shouldNeutralize(state: IssueState, settings: ProjectSettings): boolean {
  if (settings.mode !== 'neutralize') return false;
  if (!atLeast(state.suspicionLevel, settings.neutralizeFrom)) return false;
  return settings.neutralizeOrigins.includes(state.trustLevel);
}

/** Décision de mode pour un ticket : ce que l'app va faire, et pourquoi. */
export function decideMode(
  state: IssueState,
  settings: ProjectSettings,
  language: Language = 'fr',
): ModeDecision {
  if (!hasSomethingToSay(state)) {
    return { mode: 'report', banner: null, neutralize: false, silent: true, reasons: ['mode.nothing-to-report'] };
  }

  if (shouldNeutralize(state, settings)) {
    return {
      mode: 'neutralize',
      banner: null,
      neutralize: true,
      silent: false,
      reasons: ['mode.neutralize-applied', `mode.threshold.${settings.neutralizeFrom}`],
    };
  }

  if (settings.mode === 'neutralize') {
    return {
      mode: 'report',
      banner: null,
      neutralize: false,
      silent: true,
      reasons: ['mode.threshold-not-met'],
    };
  }

  if (settings.mode === 'label') {
    return {
      mode: 'label',
      banner: labelBanner(state, language),
      neutralize: false,
      silent: false,
      reasons: ['mode.label-applied'],
    };
  }

  return { mode: 'report', banner: null, neutralize: false, silent: true, reasons: ['mode.report-default'] };
}

/** Phrase d'explication du mode, pour le panneau du ticket et les rapports. */
export function modeExplanation(decision: ModeDecision, language: Language): string {
  return t(language, `mode.explanation.${decision.mode}`);
}

/**
 * L'encart est un **ajout** : il ne modifie jamais le texte existant (§8.1,
 * « le ticket est modifié, par ajout seulement »). Cette fonction refuse un
 * texte qui ne ferait que remplacer l'encart précédent.
 */
export function prependBanner(currentText: string, banner: string): string {
  if (currentText.startsWith(banner)) return currentText;
  return currentText.length === 0 ? banner : `${banner}\n\n${currentText}`;
}
