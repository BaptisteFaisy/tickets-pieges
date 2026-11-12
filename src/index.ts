/**
 * Point d'entrée Forge — ce fichier ne fait que réexporter.
 *
 * Chaque module du `manifest.yml` pointe vers `index.<nom>` ; les
 * implémentations vivent dans le dossier du lot correspondant (docs/LOTS.md).
 * Aucune logique ici : ajouter un handler se fait dans le module qui le porte,
 * jamais dans ce fichier (sinon deux lots entrent en conflit).
 */

// Écrans (§17) — lot UI.
export { resolver } from './resolvers/index';

// Événements (§18) — lot Jobs.
export { issueCreated, issueUpdated, commentCreated, commentUpdated, issueLinkCreated } from './jobs/triggers';
export { c3Consumer } from './jobs/consumer';
export { dailyMaintenance, weeklyReport } from './jobs/scheduled';

// Hook et diagnostic (§11, §17.7) — lot Hook.
export { inboundHook, outboundHook, smokeTrigger, opsTrigger } from './jobs/webhook';

// Diagnostic de l'app par elle-même (lot 10) : un webtrigger, un handler.
export { diagnostic } from './jobs/diagnostic';

// Outils MCP (§16) — lot MCP.
export {
  getRequestSafe,
  getOrigin,
  listFindings,
  explainFinding,
  listSuspectRequests,
  checkText,
  checkOutbound,
  proposePublicReply,
  reportSuspicion,
  getExposureReport,
} from './mcp/actions';

// Confluence (#61, TP-26) — lot Confluence : un handler, quatre déclencheurs.
export { confluenceContentEvent } from './jobs/confluence';
