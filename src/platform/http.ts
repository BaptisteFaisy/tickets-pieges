/**
 * Types HTTP des `webtrigger` Forge (§11 hook, §17.7 banc d'essai).
 *
 * Posés ici parce que trois lots les utilisent (hook, diagnostic, jeu d'essai) :
 * un seul exemplaire, aucune logique.
 */

/** Requête reçue par un webtrigger Forge. */
export interface WebTriggerRequest {
  body?: string;
  queryParameters?: Record<string, string[]>;
  headers?: Record<string, string[]>;
  method?: string;
}

/** Réponse renvoyée par un webtrigger Forge. */
export interface WebTriggerResponse {
  body: string;
  statusCode: number;
  headers?: Record<string, string[]>;
}

const JSON_HEADERS = { 'Content-Type': ['application/json; charset=utf-8'] };

/** Réponse JSON, avec le code HTTP voulu. */
export function jsonResponse(statusCode: number, payload: unknown): WebTriggerResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload, null, 2) };
}

/** Corps de requête décodé en JSON ; `null` s'il est absent ou illisible. */
export function jsonBody(request: WebTriggerRequest): Record<string, unknown> | null {
  if (!request.body) return null;
  try {
    const parsed: unknown = JSON.parse(request.body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Première valeur d'un paramètre de requête, ou `null`. */
export function queryParam(request: WebTriggerRequest, name: string): string | null {
  const values = request.queryParameters?.[name];
  const first = values?.[0];
  return first === undefined || first === '' ? null : first;
}

/** Première valeur d'un en-tête, ou `null`. */
export function headerValue(request: WebTriggerRequest, name: string): string | null {
  const entries = Object.entries(request.headers ?? {});
  const found = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
  const first = found?.[1]?.[0];
  return first === undefined || first === '' ? null : first;
}

/**
 * Jeton `Bearer` de la requête (§11 : `Authorization: Bearer $PIEGE_TOKEN`).
 * La comparaison se fait ailleurs, sur une empreinte — jamais en clair ici.
 */
export function bearerToken(request: WebTriggerRequest): string | null {
  const value = headerValue(request, 'authorization');
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
