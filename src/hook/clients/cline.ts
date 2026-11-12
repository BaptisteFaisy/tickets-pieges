/**
 * Rendu Cline (#22) — `cline_mcp_settings.json` + `.clinerules`.
 *
 * Cline déclare ses serveurs MCP dans un fichier JSON propre et lit les règles
 * du dépôt dans `.clinerules`. Aucun hook HTTP : comme pour Cursor et Copilot,
 * le blocage à l'écriture n'est **pas** promis ici (§21), il est demandé à
 * l'agent de passer par l'outil de l'app avant une réponse publique.
 *
 * Domaine pur : aucune E/S.
 */

import { t } from '../../core/i18n';
import type { ArtifactDraft, ClientPlan } from './index';

export const CLINE_MCP_PATH = 'cline_mcp_settings.json';
export const CLINE_RULES_PATH = '.clinerules';

/** Fichiers Cline : serveur MCP + règles du dépôt. */
export function renderCline(plan: ClientPlan, label: string): ArtifactDraft[] {
  const title = t(plan.language, 'hook.client.title', { client: label });
  const servers = {
    mcpServers: {
      [plan.policyServer]: {
        type: 'streamableHttp',
        url: plan.policyUrl,
        headers: { Authorization: plan.authHeader },
        timeout: plan.timeoutSeconds,
        disabled: false,
        alwaysAllow: [] as string[],
      },
    },
  };
  const lines = [`# ${title}`, ''];
  lines.push(t(plan.language, 'hook.client.path', { path: CLINE_RULES_PATH }), '');
  lines.push(plan.texts.rulesBody, '', plan.texts.noHooks, '');
  return [
    {
      path: CLINE_MCP_PATH,
      format: 'json',
      purpose: 'mcp',
      content: JSON.stringify(servers, null, 2),
    },
    { path: CLINE_RULES_PATH, format: 'markdown', purpose: 'rules', content: lines.join('\n') },
  ];
}
