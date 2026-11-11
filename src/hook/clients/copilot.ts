/**
 * Rendu GitHub Copilot (#22) — instructions + serveur MCP.
 *
 * Copilot ne lit pas de hook : la décision d'écriture passe par l'outil MCP
 * `check-outbound` de l'app, et les instructions disent de l'appeler **avant**
 * toute réponse publique. Deux fichiers :
 *  - `.github/mcp.json` : le serveur de politique (#29) et ses outils ;
 *  - `.github/copilot-instructions.md` : les instructions du dépôt.
 *
 * Domaine pur : aucune E/S.
 */

import { t } from '../../core/i18n';
import type { ArtifactDraft, ClientPlan } from './index';

export const COPILOT_MCP_PATH = '.github/mcp.json';
export const COPILOT_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';

/** Fichiers Copilot : `.github/mcp.json` + instructions de dépôt. */
export function renderCopilot(plan: ClientPlan, label: string): ArtifactDraft[] {
  const title = t(plan.language, 'hook.client.title', { client: label });
  const servers = {
    servers: {
      [plan.policyServer]: {
        type: 'http',
        url: plan.policyUrl,
        headers: { Authorization: plan.authHeader },
        tools: [plan.policyTool, 'check-outbound'],
      },
    },
  };
  const lines = [`# ${title}`, ''];
  lines.push(t(plan.language, 'hook.client.path', { path: COPILOT_INSTRUCTIONS_PATH }), '');
  lines.push(plan.texts.rulesBody, '');
  return [
    {
      path: COPILOT_MCP_PATH,
      format: 'json',
      purpose: 'mcp',
      content: JSON.stringify(servers, null, 2),
    },
    {
      path: COPILOT_INSTRUCTIONS_PATH,
      format: 'markdown',
      purpose: 'rules',
      content: lines.join('\n'),
    },
  ];
}
