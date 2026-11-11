/**
 * Les dix outils MCP du §16 — squelette posé par le tronc, implémenté par le lot MCP.
 *
 * Contrat : chaque outil rend une enveloppe `{ ok, data | error, warnings }`
 * (`src/mcp/result.ts`) et ne jette jamais. Les outils de lecture sont des
 * verbes `GET` dans le manifeste : un agent lancé par une règle d'automatisation
 * peut s'en servir (§16).
 *
 * À remplacer lot par lot ; si le fichier dépasse 500 lignes, le découper en
 * `src/mcp/read.ts` / `src/mcp/write.ts` (règle de taille du dépôt).
 */

import { failure, type JsonPayload, type Tool } from './result';

const NOT_READY = 'outil pas encore implémenté sur cette branche';

function pending(name: string): Tool {
  return async (_payload: JsonPayload) => failure(`${name} : ${NOT_READY}`);
}

/** Contenu encadré, origine et suspicion par segment (§8.2, TP-08). */
export const getRequestSafe = pending('get-request-safe');

/** Auteur, canal et niveau de confiance de chaque segment (§5, TP-01). */
export const getOrigin = pending('get-origin');

/** Constats : couche, extrait, demande résumée, verdict (§6, TP-05). */
export const listFindings = pending('list-findings');

/** Règle déclenchée, raison, précision de la règle (§14). */
export const explainFinding = pending('explain-finding');

/** Demandes au niveau « à vérifier » ou plus (§17.2, TP-14). */
export const listSuspectRequests = pending('list-suspect-requests');

/** Verdict de détection sur un texte quelconque (§17.7). */
export const checkText = pending('check-text');

/** Fuite probable et éléments en cause (§10, TP-13). */
export const checkOutbound = pending('check-outbound');

/** Brouillon en note interne, en attente de publication (§10, TP-12). */
export const proposePublicReply = pending('propose-public-reply');

/** Constat ouvert par un agent : les agents deviennent des capteurs (§16). */
export const reportSuspicion = pending('report-suspicion');

/** Constats, verdicts, exercices, réponses retenues (§13, §14, TP-16). */
export const getExposureReport = pending('get-exposure-report');
