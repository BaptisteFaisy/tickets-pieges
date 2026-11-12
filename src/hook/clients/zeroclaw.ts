/**
 * Rendu ZeroClaw (#22) — hooks et serveur MCP en TOML, un seul fichier.
 *
 * ZeroClaw lit ses hooks dans sa configuration TOML : deux sections
 * `[hooks.inbound]` / `[hooks.outbound]` (mêmes URL et mêmes matchers que le
 * fichier généré du §11) et une section `[mcp.<serveur>]` pour la politique
 * (#29). Le blocage à l'écriture est porté par `on_failure = "block"`, et le
 * jeton par le **nom** de la variable d'environnement, jamais sa valeur.
 *
 * Domaine pur : aucune E/S.
 */

import { t } from '../../core/i18n';
import type { ArtifactDraft, ClientPlan } from './index';

export const ZEROCLAW_PATH = 'zeroclaw-hooks.toml';

/** Valeur TOML : chaînes entre guillemets, tableaux sur une ligne. */
function tomlValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => `"${item}"`).join(', ')}]`;
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/** Une section TOML : `[nom]` puis ses clés dans l'ordre donné. */
function tomlSection(name: string, entries: [string, string | number | boolean | string[]][]): string[] {
  const lines = [`[${name}]`];
  for (const [key, value] of entries) lines.push(`${key} = ${tomlValue(value)}`);
  return lines;
}

/** Fichier ZeroClaw : hooks de lecture/écriture + serveur de politique. */
export function renderZeroclaw(plan: ClientPlan, label: string): ArtifactDraft[] {
  const title = t(plan.language, 'hook.client.title', { client: label });
  const lines = [`# ${title}`, `# ${t(plan.language, 'hook.client.path', { path: ZEROCLAW_PATH })}`, ''];
  lines.push(
    ...tomlSection('hooks.inbound', [
      ['event', 'PostToolUse'],
      ['matcher', plan.readMatcher],
      ['url', plan.inboundUrl],
      ['timeout_seconds', plan.timeoutSeconds],
      ['authorization_env', plan.tokenEnvVar],
    ]),
    '',
  );
  lines.push(
    ...tomlSection('hooks.outbound', [
      ['event', 'PreToolUse'],
      ['matcher', plan.writeMatcher],
      ['url', plan.outboundUrl],
      ['timeout_seconds', plan.timeoutSeconds],
      ['on_failure', 'block'],
      ['authorization_env', plan.tokenEnvVar],
    ]),
    '',
  );
  lines.push(
    ...tomlSection(`mcp.${plan.policyServer}`, [
      ['url', plan.policyUrl],
      ['tools', [plan.policyTool]],
      ['authorization_env', plan.tokenEnvVar],
    ]),
    '',
    '# ' + plan.texts.write,
    '# ' + plan.texts.policy,
    '# ' + plan.texts.token,
    ...plan.texts.limits.map((limit) => `# ${limit}`),
    '',
  );
  return [
    { path: ZEROCLAW_PATH, format: 'toml', purpose: 'hooks', content: lines.join('\n') },
  ];
}
