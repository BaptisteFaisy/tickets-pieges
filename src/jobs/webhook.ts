/**
 * Webtriggers : le hook (§11) et le diagnostic de bout en bout (§17.7) — lot Hook.
 *
 * `inbound-hook`  : `PostToolUse` — l'app remplace la sortie de l'outil MCP par
 *                   le contenu encadré (`updatedToolOutput`) et ajoute le contexte.
 * `outbound-hook` : `PreToolUse` — une écriture publique sur une demande externe
 *                   demande confirmation (`permissionDecision: ask`).
 * `smoke-test`    : rejoue le jeu d'essai sans navigateur et rend son rapport.
 * `ops`           : pilotage (chargement du jeu d'essai, export des originaux).
 *
 * Squelette : les corps sont remplacés par le lot Hook.
 */

import { jsonResponse, type WebTriggerRequest, type WebTriggerResponse } from '../platform/http';

/** `webtrigger: pieges-inbound` — réécriture d'une lecture (§11). */
export async function inboundHook(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  void request;
  return jsonResponse(501, { ok: false, error: 'hook entrant pas encore implémenté' });
}

/** `webtrigger: pieges-outbound` — confirmation d'une écriture publique (§11). */
export async function outboundHook(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  void request;
  return jsonResponse(501, { ok: false, error: 'hook sortant pas encore implémenté' });
}

/** `webtrigger: pieges-smoke` — diagnostic de bout en bout. */
export async function smokeTrigger(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  void request;
  return jsonResponse(501, { ok: false, error: 'banc de diagnostic pas encore implémenté' });
}

/** `webtrigger: pieges-ops` — pilotage et export avant désinstallation (§22). */
export async function opsTrigger(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  void request;
  return jsonResponse(501, { ok: false, error: 'pilotage pas encore implémenté' });
}
