/**
 * Exercices permanents (§41) — un planning hebdomadaire par file : chaque file
 * reçoit un exercice par semaine, les jetons tournent d'une semaine à l'autre,
 * et le tirage est déterministe à partir d'une graine. Reproductible en test
 * (même graine ? même planning), imprévisible en production quand la graine
 * change. Aucune horloge : la semaine est un paramètre.
 */

import { sha256 } from './hashing';

/** Une case du planning : une file, une semaine, un jeton. */
export interface WeeklySlot {
  queueKey: string;
  week: string;
  token: string;
}

/** Jeton d'une file pour une semaine donnée, dérivé de la graine (#41). */
export function weekToken(seed: string, queueKey: string, week: string): string {
  return sha256(`${seed}\n${queueKey}\n${week}`).slice(0, 12);
}

/** Planning hebdomadaire complet : file ? semaine, jetons qui tournent (#41). */
export function weeklySchedule(
  seed: string,
  queues: readonly string[],
  weeks: readonly string[],
): WeeklySlot[] {
  const slots: WeeklySlot[] = [];
  for (const week of weeks) {
    for (const queueKey of queues) {
      slots.push({ queueKey, week, token: weekToken(seed, queueKey, week) });
    }
  }
  return slots;
}