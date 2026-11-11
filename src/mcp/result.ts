/**
 * Enveloppe commune des outils MCP (§16).
 *
 * Un outil ne jette **jamais** : il rend `{ ok: true, data }` ou
 * `{ ok: false, error }` avec des avertissements. Un agent qui appelle un outil
 * doit pouvoir expliquer l'échec à l'utilisateur au lieu de voir sa conversation
 * se rompre — et les avertissements portent ce qui n'a pas été analysé (§21 :
 * pas de fausse assurance).
 */

import type { ToolResult } from '../core/types';

/** Charge utile d'un outil : ce que l'agent envoie. */
export type JsonPayload = Record<string, unknown>;

/** Signature commune des dix outils du manifeste. */
export type Tool = (payload: JsonPayload) => Promise<ToolResult<unknown>>;

/** Exécute le corps d'un outil et convertit toute erreur en enveloppe. */
export async function run<T>(
  body: () => Promise<T>,
  warnings: string[] = [],
): Promise<ToolResult<T>> {
  try {
    return { ok: true, data: await body(), warnings };
  } catch (error) {
    return { ok: false, error: messageOf(error), warnings };
  }
}

/** Texte d'une erreur, quel que soit son emballage. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error ?? 'erreur inconnue');
}

/** Échec lisible, sans pile : ce que rend un outil qui ne peut pas répondre. */
export function failure(error: string, warnings: string[] = []): ToolResult<never> {
  return { ok: false, error, warnings };
}

/** Paramètre texte obligatoire : absent ou vide, l'outil le dit explicitement. */
export function requireText(payload: JsonPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`paramètre « ${key} » requis`);
  }
  return value.trim();
}

/** Paramètre texte facultatif : `null` quand il est absent ou vide. */
export function optionalText(payload: JsonPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Paramètre numérique facultatif, borné (jamais de valeur devinée). */
export function optionalNumber(
  payload: JsonPayload,
  key: string,
  fallback: number,
  max: number,
): number {
  const value = payload[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/** Paramètre booléen strict : une chaîne « true » est refusée, pas interprétée. */
export function optionalBoolean(payload: JsonPayload, key: string, fallback: boolean): boolean {
  const value = payload[key];
  return typeof value === 'boolean' ? value : fallback;
}
