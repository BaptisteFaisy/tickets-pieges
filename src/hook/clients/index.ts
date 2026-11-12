/**
 * Les cinq clients d'agent (#22) — un seul modèle interne, cinq rendus.
 *
 * L'app ne sait pas quel assistant tourne sur le poste : elle rend **la même
 * configuration** (mêmes URL, même variable de jeton, mêmes noms d'outils)
 * dans le format que chaque client lit réellement —
 *  - Claude Code : `.claude/settings.json` (hooks) + `.mcp.json` (serveur) ;
 *  - Cursor : `.cursor/mcp.json` + `.cursor/rules/tickets-pieges.mdc` ;
 *  - GitHub Copilot : `.github/mcp.json` + `.github/copilot-instructions.md` ;
 *  - Cline : `cline_mcp_settings.json` + `.clinerules` ;
 *  - ZeroClaw : `zeroclaw-hooks.toml` (hooks + serveur, un seul fichier).
 *
 * Le contenu vient de `src/hook/config.ts` (réutilisé, jamais recopié) : les
 * hooks Claude Code **sont** le fichier généré du §11, les autres clients en
 * reçoivent l'équivalent dans leur syntaxe.
 *
 * Deux règles de sécurité tiennent sur tous les rendus : le jeton n'est jamais
 * écrit (seule la variable d'environnement, et son empreinte, apparaissent), et
 * l'écriture publique porte le blocage si l'app ne répond pas (§11).
 *
 * Domaine pur : aucune E/S, aucun `@forge/*`, aucune heure lue.
 */

import type { HookConfig, Language } from '../../core/types';
import { t } from '../../core/i18n';
import { hookLimits, resolveHookConfig, toolMatcher } from '../config';
import { tokenFingerprint } from '../token';
import { renderClaudeCode } from './claude-code';
import { renderCline } from './cline';
import { renderCopilot } from './copilot';
import { renderCursor } from './cursor';
import { renderZeroclaw } from './zeroclaw';

/** Les cinq clients servis. En ajouter un = un fichier de rendu + une entrée. */
export type ClientId = 'claude-code' | 'cursor' | 'copilot' | 'cline' | 'zeroclaw';

export const CLIENT_IDS: readonly ClientId[] = [
  'claude-code',
  'cursor',
  'copilot',
  'cline',
  'zeroclaw',
];

/** Nom lisible du client (nom propre : identique dans les deux langues). */
export const CLIENT_LABELS: Record<ClientId, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  cline: 'Cline',
  zeroclaw: 'ZeroClaw',
};

/** Format du rendu : ce que le client parse vraiment. */
export type ArtifactFormat = 'json' | 'toml' | 'markdown';

/** Rôle du fichier : hooks, déclaration du serveur MCP, ou règles lues par le modèle. */
export type ArtifactPurpose = 'hooks' | 'mcp' | 'rules';

/** Un fichier rendu, prêt à copier sur le poste. */
export interface ClientArtifact {
  clientId: ClientId;
  clientLabel: string;
  path: string;
  format: ArtifactFormat;
  purpose: ArtifactPurpose;
  /** Porte le blocage à l'écriture (§11) : `onFailure: block` ou équivalent. */
  writeBlocked: boolean;
  content: string;
}

/** Ce qu'un rendu de client produit, avant marquage par `renderClient`. */
export type ArtifactDraft = Omit<ClientArtifact, 'clientId' | 'clientLabel' | 'writeBlocked'>;

/** Signature d'un rendu client : le plan suffit, le nom lisible est passé. */
export type ClientRenderer = (plan: ClientPlan, label: string) => ArtifactDraft[];

/** Textes partagés par les cinq rendus : une seule source, au catalogue. */
export interface ClientTexts {
  intro: string;
  read: string;
  write: string;
  policy: string;
  token: string;
  limits: string[];
  /** Ligne de blocage à l'écriture, avec le marqueur `onFailure: block`. */
  block: string;
  /** À dire aux clients sans hook : la règle repose sur l'agent, pas sur un verrou. */
  noHooks: string;
  /** Corps des fichiers de règles (Cursor, Copilot, Cline) : titre exclu. */
  rulesBody: string;
}

/** Le modèle interne unique : tout ce dont un rendu a besoin, déjà calculé. */
export interface ClientPlan {
  config: HookConfig;
  serverName: string;
  readMatcher: string;
  writeMatcher: string;
  inboundUrl: string;
  outboundUrl: string;
  policyUrl: string;
  policyTool: string;
  /** Nom sous lequel le serveur de politique est déclaré chez le client. */
  policyServer: string;
  tokenEnvVar: string;
  /** Référence au jeton, jamais sa valeur : `$PIEGE_TOKEN`. */
  tokenRef: string;
  /** En-tête prêt à coller : `Bearer $PIEGE_TOKEN`. */
  authHeader: string;
  /** Empreinte du jeton, si l'appelant en a fourni un ; sinon `null`. */
  fingerprint: string | null;
  timeoutSeconds: number;
  language: Language;
  texts: ClientTexts;
}

/** Réglages du rendu, en plus de `HookConfig` (noms d'outils et jeton). */
export interface ClientOptions {
  language?: Language;
  /** Nom de l'outil MCP de politique (#29) : réglable comme les autres. */
  policyTool?: string;
  /** Chemin du point de politique sous `baseUrl` (défaut : `policy`). */
  policyPath?: string;
  /** Nom du serveur de politique déclaré chez le client (défaut : `tickets-pieges`). */
  policyServer?: string;
  /** Jeton du poste : seule son empreinte est rendue, jamais sa valeur. */
  token?: string;
}

export const DEFAULT_POLICY_TOOL = 'get-policy';
export const DEFAULT_POLICY_PATH = 'policy';
export const DEFAULT_POLICY_SERVER = 'tickets-pieges';

/** Marqueurs du blocage à l'écriture, par syntaxe (JSON Claude/Cursor…, TOML). */
const BLOCK_MARKERS: readonly string[] = [
  '"onFailure": "block"',
  'on_failure = "block"',
  'onFailure: block',
];

/** Un fichier rendu porte-t-il le blocage de l'écriture (§11) ? */
export function declaresWriteBlock(content: string): boolean {
  return BLOCK_MARKERS.some((marker) => content.includes(marker));
}

/** Construit le modèle interne : mêmes URL, mêmes noms, pour les cinq clients. */
export function buildPlan(
  partial: Partial<HookConfig> & { baseUrl: string },
  options: ClientOptions = {},
): ClientPlan {
  const config = resolveHookConfig(partial);
  const language = options.language ?? 'fr';
  const policyTool = options.policyTool ?? DEFAULT_POLICY_TOOL;
  const fingerprint = options.token ? tokenFingerprint(options.token) : null;
  const policyUrl = `${config.baseUrl}/${options.policyPath ?? DEFAULT_POLICY_PATH}`;
  return {
    config,
    serverName: config.serverName,
    readMatcher: toolMatcher(config.serverName, config.readTools),
    writeMatcher: toolMatcher(config.serverName, config.writeTools),
    inboundUrl: `${config.baseUrl}/inbound`,
    outboundUrl: `${config.baseUrl}/outbound`,
    policyUrl,
    policyTool,
    policyServer: options.policyServer ?? DEFAULT_POLICY_SERVER,
    tokenEnvVar: config.tokenEnvVar,
    tokenRef: `$${config.tokenEnvVar}`,
    authHeader: `Bearer $${config.tokenEnvVar}`,
    fingerprint,
    timeoutSeconds: config.timeoutSeconds,
    language,
    texts: buildTexts(language, config, policyTool, policyUrl, fingerprint),
  };
}

/** Les phrases communes aux cinq rendus — une seule fois, depuis le catalogue. */
function buildTexts(
  language: Language,
  config: HookConfig,
  policyTool: string,
  policyUrl: string,
  fingerprint: string | null,
): ClientTexts {
  const tokenKey = fingerprint ? 'hook.client.token' : 'hook.client.token.unset';
  const intro = t(language, 'hook.client.intro');
  const read = t(language, 'hook.client.read', { url: `${config.baseUrl}/inbound` });
  const write = t(language, 'hook.client.write', { url: `${config.baseUrl}/outbound` });
  const policy = t(language, 'hook.client.policy', { tool: policyTool, url: policyUrl });
  const token = t(language, tokenKey, {
    env: config.tokenEnvVar,
    fingerprint: fingerprint ?? '',
  });
  const limits = hookLimits(language);
  const block = t(language, 'hook.client.block');
  const noHooks = t(language, 'hook.client.noHooks');
  const rulesBody = [
    intro,
    '',
    `- ${read}`,
    `- ${write}`,
    `- ${block}`,
    `- ${policy}`,
    `- ${token}`,
    '',
    t(language, 'hook.client.limits'),
    ...limits.map((limit) => `- ${limit}`),
  ].join('\n');
  return { intro, read, write, policy, token, limits, block, noHooks, rulesBody };
}

const RENDERERS: Record<ClientId, ClientRenderer> = {
  'claude-code': renderClaudeCode,
  cursor: renderCursor,
  copilot: renderCopilot,
  cline: renderCline,
  zeroclaw: renderZeroclaw,
};

/** Rend les fichiers d'un client, marqués de son identifiant. */
export function renderClient(clientId: ClientId, plan: ClientPlan): ClientArtifact[] {
  const label = CLIENT_LABELS[clientId];
  return RENDERERS[clientId](plan, label).map((draft) => ({
    ...draft,
    clientId,
    clientLabel: label,
    writeBlocked: declaresWriteBlock(draft.content),
  }));
}

/** Rend les cinq clients d'un coup : c'est ce que l'écran d'installation sert. */
export function renderAllClients(plan: ClientPlan): ClientArtifact[] {
  return CLIENT_IDS.flatMap((clientId) => renderClient(clientId, plan));
}
