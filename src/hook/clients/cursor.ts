/**
 * Rendu Cursor (#22) — `mcp` + règles.
 *
 * Cursor n'offre pas de hook HTTP `PreToolUse` : le blocage à l'écriture ne
 * peut donc **pas** être garanti par ce rendu (§21 — on le dit, on ne le promet
 * pas). Deux fichiers sont servis :
 *  - `.cursor/mcp.json` : le serveur de politique (#29) ;
 *  - `.cursor/rules/tickets-pieges.mdc` : la règle toujours appliquée, qui
 *    renvoie l'agent vers le hook d'écriture de l'app avant toute réponse
 *    publique.
 *
 * Domaine pur : aucune E/S.
 */

import { t } from '../../core/i18n';
import type { ArtifactDraft, ClientPlan } from './index';

export const CURSOR_MCP_PATH = '.cursor/mcp.json';
export const CURSOR_RULES_PATH = '.cursor/rules/tickets-pieges.mdc';

/** Fichiers Cursor : serveur MCP + règle `.mdc` toujours appliquée. */
export function renderCursor(plan: ClientPlan, label: string): ArtifactDraft[] {
  const title = t(plan.language, 'hook.client.title', { client: label });
  const servers = {
    mcpServers: {
      [plan.policyServer]: {
        url: plan.policyUrl,
        headers: { Authorization: plan.authHeader },
        timeout: plan.timeoutSeconds,
      },
    },
  };
  const rules = ['---', `description: ${title}`, 'alwaysApply: true', '---', '', `# ${title}`, ''];
  rules.push(t(plan.language, 'hook.client.path', { path: CURSOR_RULES_PATH }), '');
  rules.push(plan.texts.rulesBody, '');
  return [
    {
      path: CURSOR_MCP_PATH,
      format: 'json',
      purpose: 'mcp',
      content: JSON.stringify(servers, null, 2),
    },
    { path: CURSOR_RULES_PATH, format: 'markdown', purpose: 'rules', content: rules.join('\n') },
  ];
}
