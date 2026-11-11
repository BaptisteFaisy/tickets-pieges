/**
 * Les dix outils MCP du §16 — les noms exportés sont exactement ceux du manifeste.
 *
 * `manifest.yml` les appelle par `index.<nom>` (relais : `src/index.ts`) : un nom
 * qui dévie ici casse le déploiement sans erreur de compilation, d'où la garde
 * `tools/validate_manifest.mjs`. Les implémentations vivent dans `read.ts`
 * (huit verbes `GET`, aucune écriture) et `write.ts` (deux verbes `CREATE`) —
 * ce fichier ne fait que les rassembler, pour rester sous la limite de taille.
 *
 * Contrat commun : signature `(payload) => Promise<ToolResult<unknown>>`,
 * enveloppe `{ ok, data | error, warnings }` de `src/mcp/result.ts`, aucune
 * exception ne sort d'un outil (§16).
 */

import type { Tool } from './result';
import {
  checkOutbound,
  checkText,
  explainFinding,
  getExposureReport,
  getOrigin,
  getRequestSafe,
  listFindings,
  listSuspectRequests,
} from './read';
import { proposePublicReply, reportSuspicion } from './write';

// Outils de lecture (verbe `GET` : utilisables par un agent en automatisation).
export {
  getRequestSafe,
  getOrigin,
  listFindings,
  explainFinding,
  listSuspectRequests,
  checkText,
  checkOutbound,
  getExposureReport,
};

// Outils d'écriture (verbe `CREATE` : jamais appelés par une automatisation).
export { proposePublicReply, reportSuspicion };

/** Les dix outils par clé du manifeste : une seule liste, lue par les tests. */
export const MCP_TOOLS: Record<string, Tool> = {
  'get-request-safe': getRequestSafe,
  'get-origin': getOrigin,
  'list-findings': listFindings,
  'explain-finding': explainFinding,
  'list-suspect-requests': listSuspectRequests,
  'check-text': checkText,
  'check-outbound': checkOutbound,
  'propose-public-reply': proposePublicReply,
  'report-suspicion': reportSuspicion,
  'get-exposure-report': getExposureReport,
};
