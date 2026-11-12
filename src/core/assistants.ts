/**
 * Taux d'obéissance par assistant (#42).
 *
 * §13 lit les exercices par **type d'acteur**, jamais par personne. Ce module
 * ajoute une maille : parmi les acteurs « IA », quel assistant (Rovo, Claude,
 * Copilot…) a obéi à ce qu'il a lu. Un assistant est nommé par son intégration
 * (nom de service), jamais par un compte humain — l'agrégat reste anonyme.
 *
 * Domaine pur : aucune E/S, aucune heure lue.
 */

import { obedienceRate } from './canary';
import type { Language } from './types';
import { t } from './i18n';

/** Assistants connus du produit ; tout autre nom retombe sur `unknown`. */
export const KNOWN_ASSISTANTS = ['rovo', 'claude', 'copilot', 'gemini', 'chatgpt'] as const;

export type AssistantKind = (typeof KNOWN_ASSISTANTS)[number] | 'unknown';

export const ASSISTANT_KINDS: readonly AssistantKind[] = [...KNOWN_ASSISTANTS, 'unknown'];

/** Alias observés sur le terrain, repliés vers le nom canonique. */
const ALIASES: readonly (readonly [AssistantKind, readonly string[]])[] = [
  ['rovo', ['rovo']],
  ['claude', ['claude', 'anthropic']],
  ['copilot', ['copilot']],
  ['gemini', ['gemini', 'bard']],
  ['chatgpt', ['chatgpt', 'openai', 'gpt-']],
];

/** Normalise un nom brut d'intégration en assistant canonique. */
export function normalizeAssistant(raw: string): AssistantKind {
  const folded = raw.toLowerCase().trim();
  for (const [kind, aliases] of ALIASES) {
    if (aliases.some((alias) => folded.includes(alias))) return kind;
  }
  return 'unknown';
}

/** Un exercice d'alerte attribué à un assistant : lancé, et suivi d'effet ou non. */
export interface AssistantLaunch {
  /** Nom brut de l'intégration (jamais une personne). */
  assistant: string;
  canaryId: string;
  obeyed: boolean;
}

export interface AssistantObedience {
  assistant: AssistantKind;
  launched: number;
  obeyed: number;
  /** Taux 0-1, même définition que `obedienceRate` (§13). */
  rate: number;
}

/**
 * Agrège les exercices par assistant : du plus obéissant au moins obéissant,
 * à taux égal par nom canonique (ordre stable, reproductible).
 */
export function obedienceByAssistant(launches: readonly AssistantLaunch[]): AssistantObedience[] {
  const groups = new Map<AssistantKind, { launched: number; obeyed: number }>();
  for (const launch of launches) {
    const kind = normalizeAssistant(launch.assistant);
    const group = groups.get(kind) ?? { launched: 0, obeyed: 0 };
    group.launched += 1;
    if (launch.obeyed) group.obeyed += 1;
    groups.set(kind, group);
  }
  return [...groups.entries()]
    .map(([assistant, group]) => ({
      assistant,
      launched: group.launched,
      obeyed: group.obeyed,
      rate: obedienceRate(group.launched, group.obeyed),
    }))
    .sort((a, b) => b.rate - a.rate || a.assistant.localeCompare(b.assistant));
}

/** Libellé localisé d'un assistant (catalogue `exposition`). */
export function assistantLabel(lang: Language, kind: AssistantKind): string {
  return t(lang, `exposition.assistant.${kind}`);
}
