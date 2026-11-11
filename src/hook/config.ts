/**
 * Fichier de hooks généré par l'app (§11) — la configuration client.
 *
 * Sur les clients qui le permettent, ce fichier branche deux webtriggers :
 *  - `PostToolUse` sur les lectures MCP : l'app remplace la sortie de l'outil
 *    par le contenu encadré (§8.2) — **limite 1 : l'outil a déjà été exécuté
 *    quand le hook intervient** ; la réécriture protège le modèle, pas la cible ;
 *  - `PreToolUse` sur les écritures publiques : confirmation avant l'envoi,
 *    avec `onFailure: 'block'` — si l'app ne répond pas, l'écriture ne part pas.
 *
 * **Limite 2 : ce mécanisme n'existe que sur les clients qui offrent des
 * hooks.** Ailleurs, rien n'est promis : la génération du fichier est un
 * service rendu, pas une protection universelle.
 *
 * Les noms de serveur et d'outils sont ceux du poste de chacun (§11) : tout
 * est réglable via `HookConfig`, avec des défauts qui correspondent au serveur
 * MCP Atlassian courant.
 *
 * Domaine pur : aucune E/S, aucun `@forge/*`.
 */

import type { HookConfig, Language } from '../core/types';
import { t } from '../core/i18n';

/** Défauts du fichier généré : serveur MCP Atlassian, outils d'écriture usuels. */
export const DEFAULT_HOOK_CONFIG: HookConfig = {
  serverName: 'atlassian',
  readTools: ['.*'],
  writeTools: ['addCommentToJiraIssue', 'editJiraIssue'],
  baseUrl: '',
  tokenEnvVar: 'PIEGE_TOKEN',
  timeoutSeconds: 5,
};

/** Une entrée `hooks` du fichier généré, telle que le client l'attend (§11). */
export interface HookEntry {
  type: 'http';
  url: string;
  timeout: number;
  onFailure?: 'block';
  headers: Record<string, string>;
  allowedEnvVars: string[];
}

/** Un groupe matcher + hooks, pour `PostToolUse` ou `PreToolUse`. */
export interface HookGroup {
  matcher: string;
  hooks: HookEntry[];
}

/** Le fichier complet : `{ hooks: { PostToolUse: […], PreToolUse: […] } }`. */
export interface GeneratedHookFile {
  hooks: {
    PostToolUse: HookGroup[];
    PreToolUse: HookGroup[];
  };
}

/** Fusionne les réglages du poste avec les défauts ; `baseUrl` est requis. */
export function resolveHookConfig(partial: Partial<HookConfig> & { baseUrl: string }): HookConfig {
  return {
    serverName: partial.serverName ?? DEFAULT_HOOK_CONFIG.serverName,
    readTools: partial.readTools?.length ? [...partial.readTools] : [...DEFAULT_HOOK_CONFIG.readTools],
    writeTools: partial.writeTools?.length ? [...partial.writeTools] : [...DEFAULT_HOOK_CONFIG.writeTools],
    baseUrl: partial.baseUrl.replace(/\/+$/, ''),
    tokenEnvVar: partial.tokenEnvVar ?? DEFAULT_HOOK_CONFIG.tokenEnvVar,
    timeoutSeconds: partial.timeoutSeconds ?? DEFAULT_HOOK_CONFIG.timeoutSeconds,
  };
}

/** `mcp__<serveur>__.*` pour tout lire, `mcp__<serveur>__(a|b)` pour cibler. */
export function toolMatcher(serverName: string, tools: string[]): string {
  const pasTout = tools.length === 1 && tools[0] === '.*';
  return pasTout ? `mcp__${serverName}__.*` : `mcp__${serverName}__(${tools.join('|')})`;
}

/** Une entrée HTTP : jeton passé par variable d'environnement, jamais en dur. */
function hookEntry(config: HookConfig, path: 'inbound' | 'outbound', block: boolean): HookEntry {
  const entry: HookEntry = {
    type: 'http',
    url: `${config.baseUrl}/${path}`,
    timeout: config.timeoutSeconds,
    headers: { Authorization: `Bearer $${config.tokenEnvVar}` },
    allowedEnvVars: [config.tokenEnvVar],
  };
  // `onFailure: 'block'` à l'écriture seulement : une lecture ne doit pas être
  // bloquée par une app muette, une écriture publique oui (§11).
  if (block) entry.onFailure = 'block';
  return entry;
}

/** Génère le fichier de hooks complet, structure exacte du §11. */
export function generateHookFile(config: HookConfig): GeneratedHookFile {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: toolMatcher(config.serverName, config.readTools),
          hooks: [hookEntry(config, 'inbound', false)],
        },
      ],
      PreToolUse: [
        {
          matcher: toolMatcher(config.serverName, config.writeTools),
          hooks: [hookEntry(config, 'outbound', true)],
        },
      ],
    },
  };
}

/** Rendu texte (JSON à deux espaces) : c'est ce que l'écran fait copier. */
export function renderHookFile(config: HookConfig): string {
  return JSON.stringify(generateHookFile(config), null, 2);
}

/**
 * Les deux limites du §11, dites honnêtement à qui installe le hook (§21) :
 * l'outil a déjà été exécuté à la lecture, et seuls les clients à hooks sont
 * couverts. Les textes vivent au catalogue (`hook.limit.*`).
 */
export function hookLimits(language: Language = 'fr'): string[] {
  return [t(language, 'hook.limit.executed'), t(language, 'hook.limit.clients')];
}
