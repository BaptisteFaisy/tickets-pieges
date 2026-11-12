/**
 * Section « Hook et clients d'agents » (§11) — le fichier de hooks généré pour
 * les cinq clients, avec les noms de serveur et d'outils réglables, rendu dans
 * un `<pre>` copiable (aucun réseau : tout se calcule dans la page).
 *
 * Aucune logique métier recopiée : la section appelle `src/hook/clients/*` et
 * `src/hook/config.ts` et affiche leur résultat (règle du site, `docs/SITE.md`).
 */

import type { HookConfig, Language } from '../../core/types';
import {
  buildPlan,
  renderClient,
  CLIENT_IDS,
  CLIENT_LABELS,
  type ClientArtifact,
  type ClientId,
} from '../../hook/clients/index';
import {
  badge,
  buttonHtml,
  byId,
  esc,
  field,
  grid,
  kv,
  note,
  panel,
  pre,
  selectHtml,
  valueOf,
} from '../dom';
import type { Section, SectionContext } from './types';

/** Textes de la section, dans les deux langues (règle 9 : rien au catalogue). */
const L = {
  client: { fr: 'Client d’agent', en: 'Agent client' },
  baseUrl: { fr: 'URL de base des webtriggers', en: 'Webtrigger base URL' },
  serverName: { fr: 'Nom du serveur MCP', en: 'MCP server name' },
  readTools: { fr: 'Outils de lecture (regex, séparées par des virgules)', en: 'Read tools (regex, comma-separated)' },
  writeTools: { fr: 'Outils d’écriture publique', en: 'Public write tools' },
  tokenEnvVar: { fr: 'Variable d’environnement du jeton', en: 'Token environment variable' },
  timeoutSeconds: { fr: 'Délai d’attente (secondes)', en: 'Timeout (seconds)' },
  token: { fr: 'Jeton du poste — jamais écrit dans les fichiers, seule son empreinte apparaît', en: 'Workstation token — never written to the files, only its fingerprint appears' },
  generate: { fr: 'Générer les fichiers', en: 'Generate files' },
  copy: { fr: 'Copier', en: 'Copy' },
  copied: { fr: 'Fichier copié dans le presse-papiers : rien n’a quitté la page.', en: 'File copied to the clipboard: nothing left the page.' },
  copyFailed: { fr: 'Copie impossible dans ce navigateur — sélectionnez le texte du fichier.', en: 'Copy unavailable in this browser — select the file text instead.' },
  file: { fr: 'Fichier', en: 'File' },
  format: { fr: 'Format', en: 'Format' },
  purpose: { fr: 'Rôle', en: 'Purpose' },
  writeBlocked: { fr: 'écriture bloquée si l’app ne répond pas (§11)', en: 'write blocked if the app does not answer (§11)' },
  writeOpen: { fr: 'pas de blocage à l’écriture', en: 'no write blocking' },
  filesTitle: { fr: 'Fichiers générés pour ce client', en: 'Files generated for this client' },
  local: { fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, le jeton n’est jamais envoyé.', en: 'Everything runs in your browser: no network call, the token is never sent.' },
} as const;

function label(ctx: SectionContext, key: keyof typeof L): string {
  return L[key][ctx.lang];
}

/** Valeurs des champs du bloc « configuration » (texte brut, avant parsing). */
export interface ConfigInput {
  baseUrl: string;
  serverName: string;
  readTools: string;
  writeTools: string;
  tokenEnvVar: string;
  timeoutSeconds: number;
  token: string;
}

/** Réglages initiaux : ceux du serveur MCP Atlassian courant (§11). */
export const DEFAULT_INPUTS: ConfigInput = {
  baseUrl: 'https://app.tickets-pieges.exemple',
  serverName: 'atlassian',
  readTools: '.*',
  writeTools: 'addCommentToJiraIssue,editJiraIssue',
  tokenEnvVar: 'PIEGE_TOKEN',
  timeoutSeconds: 5,
  token: 'demo-poste-4f9a',
};

function splitList(csv: string): string[] {
  return csv.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

/** Des champs du formulaire vers le `HookConfig` partiel du domaine. */
export function hookConfigOf(input: ConfigInput): Partial<HookConfig> & { baseUrl: string } {
  return {
    baseUrl: input.baseUrl,
    serverName: input.serverName,
    readTools: splitList(input.readTools),
    writeTools: splitList(input.writeTools),
    tokenEnvVar: input.tokenEnvVar,
    timeoutSeconds: input.timeoutSeconds,
  };
}

/** Les fichiers d'un client, rendus par le domaine pour les réglages saisis. */
export function artifactsFor(clientId: ClientId, input: ConfigInput, lang: Language): ClientArtifact[] {
  const plan = buildPlan(hookConfigOf(input), { language: lang, token: input.token || undefined });
  return renderClient(clientId, plan);
}

function textInput(id: string, value: string, type = 'text'): string {
  return `<input id="${esc(id)}" type="${esc(type)}" value="${esc(value)}">`;
}

/** Formulaire des réglages du poste : client visé, serveur, outils, jeton. */
export function configForm(ctx: SectionContext, input: ConfigInput = DEFAULT_INPUTS): string {
  const clients = CLIENT_IDS.map((id) => [id, CLIENT_LABELS[id]] as [string, string]);
  return panel(
    field(label(ctx, 'client'), selectHtml('h-client', clients, CLIENT_IDS[0])) +
      field(label(ctx, 'baseUrl'), textInput('h-baseurl', input.baseUrl)) +
      field(label(ctx, 'serverName'), textInput('h-server', input.serverName)) +
      field(label(ctx, 'readTools'), textInput('h-readtools', input.readTools)) +
      field(label(ctx, 'writeTools'), textInput('h-writetools', input.writeTools)) +
      field(label(ctx, 'tokenEnvVar'), textInput('h-tokenenv', input.tokenEnvVar)) +
      field(label(ctx, 'timeoutSeconds'), textInput('h-timeout', String(input.timeoutSeconds), 'number')) +
      field(label(ctx, 'token'), textInput('h-token', input.token)) +
      buttonHtml('h-generate', label(ctx, 'generate')) +
      note(label(ctx, 'local')),
  );
}

/** Un fichier rendu : chemin, format, rôle, blocage, contenu et copie. */
function artifactBlock(artifact: ClientArtifact, index: number, ctx: SectionContext): string {
  return `<div class="block">
    ${kv([
      [label(ctx, 'file'), artifact.path],
      [label(ctx, 'format'), artifact.format],
      [label(ctx, 'purpose'), artifact.purpose],
    ])}
    ${badge(artifact.writeBlocked ? label(ctx, 'writeBlocked') : label(ctx, 'writeOpen'), artifact.writeBlocked ? 'ok' : 'warn')}
    ${pre(artifact.content)}
    ${buttonHtml(`h-copy-${index}`, label(ctx, 'copy'), 'ghost')}
  </div>`;
}

/** Le panneau des fichiers générés, réinjecté à chaque changement de réglage. */
export function filesPanel(artifacts: ClientArtifact[], ctx: SectionContext): string {
  const title = `${label(ctx, 'filesTitle')} — ${artifacts[0]?.clientLabel ?? ''}`;
  return `<h4>${esc(title)}</h4>` + artifacts.map((artifact, i) => artifactBlock(artifact, i, ctx)).join('');
}

/** Lit les champs du formulaire ; les valeurs absentes retombent sur les défauts. */
export function readInput(root: HTMLElement): ConfigInput {
  const timeout = Number.parseInt(valueOf(root, 'h-timeout'), 10);
  return {
    baseUrl: valueOf(root, 'h-baseurl') || DEFAULT_INPUTS.baseUrl,
    serverName: valueOf(root, 'h-server') || DEFAULT_INPUTS.serverName,
    readTools: valueOf(root, 'h-readtools') || DEFAULT_INPUTS.readTools,
    writeTools: valueOf(root, 'h-writetools') || DEFAULT_INPUTS.writeTools,
    tokenEnvVar: valueOf(root, 'h-tokenenv') || DEFAULT_INPUTS.tokenEnvVar,
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_INPUTS.timeoutSeconds,
    token: valueOf(root, 'h-token'),
  };
}

/** Recalcule les fichiers du client choisi et réinjecte le panneau. */
function updateFiles(root: HTMLElement, ctx: SectionContext): void {
  const clientId = (valueOf(root, 'h-client') || CLIENT_IDS[0]) as ClientId;
  const target = byId<HTMLDivElement>(root, 'h-files');
  if (target) target.innerHTML = filesPanel(artifactsFor(clientId, readInput(root), ctx.lang), ctx);
}

/** Copie locale via `navigator.clipboard` : aucun réseau (règle du site). */
async function copyText(text: string, ctx: SectionContext): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ctx.notify(label(ctx, 'copied'));
  } catch {
    ctx.notify(label(ctx, 'copyFailed'));
  }
}

/** Clic sur un bouton « Copier » : le texte vient du `<pre>` du même bloc. */
function onFilesClick(ctx: SectionContext): (event: Event) => void {
  return (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button?.id.startsWith('h-copy-')) return;
    const text = button.closest('.block')?.querySelector('pre')?.textContent ?? '';
    void copyText(text, ctx);
  };
}

function renderConfig(ctx: SectionContext): string {
  const artifacts = artifactsFor(CLIENT_IDS[0] ?? 'claude-code', DEFAULT_INPUTS, ctx.lang);
  return grid(configForm(ctx), panel(filesPanel(artifacts, ctx), 'h-files'));
}

export const hookSection: Section = {
  id: 'hook',
  titles: { fr: 'Hook et clients d’agents', en: 'Hook & agent clients' },
  render(ctx) {
    return renderConfig(ctx);
  },
  mount(root, ctx) {
    byId<HTMLButtonElement>(root, 'h-generate')?.addEventListener('click', () => updateFiles(root, ctx));
    byId<HTMLSelectElement>(root, 'h-client')?.addEventListener('change', () => updateFiles(root, ctx));
    byId<HTMLDivElement>(root, 'h-files')?.addEventListener('click', onFilesClick(ctx));
  },
};
