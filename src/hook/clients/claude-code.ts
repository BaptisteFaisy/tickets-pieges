/**
 * Rendu Claude Code (#22) — le client qui lit vraiment des hooks (§11).
 *
 * Deux fichiers :
 *  - `.claude/settings.json` : **exactement** le fichier de hooks généré par
 *    `src/hook/config.ts` (réutilisé, pas recopié) — `PostToolUse` sur les
 *    lectures MCP, `PreToolUse` sur les écritures publiques avec
 *    `onFailure: 'block'` ;
 *  - `.mcp.json` : le serveur de politique (#29), pour que l'agent puisse lire
 *    le droit applicable avant d'agir.
 *
 * Le jeton n'apparaît jamais : l'en-tête renvoie à la variable d'environnement.
 * Domaine pur : aucune E/S.
 */

import { renderHookFile } from '../config';
import type { ArtifactDraft, ClientPlan } from './index';

export const CLAUDE_SETTINGS_PATH = '.claude/settings.json';
export const CLAUDE_MCP_PATH = '.mcp.json';

/** Fichiers Claude Code : hooks générés + serveur de politique. */
export function renderClaudeCode(plan: ClientPlan): ArtifactDraft[] {
  const servers = {
    mcpServers: {
      [plan.policyServer]: {
        type: 'http',
        url: plan.policyUrl,
        headers: { Authorization: plan.authHeader },
        timeout: plan.timeoutSeconds,
        tools: [plan.policyTool],
      },
    },
  };
  return [
    {
      path: CLAUDE_SETTINGS_PATH,
      format: 'json',
      purpose: 'hooks',
      content: renderHookFile(plan.config),
    },
    {
      path: CLAUDE_MCP_PATH,
      format: 'json',
      purpose: 'mcp',
      content: JSON.stringify(servers, null, 2),
    },
  ];
}
