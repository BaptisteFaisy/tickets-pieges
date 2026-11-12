/**
 * Section « Les dix outils MCP » — l'appelant universel du §16.
 *
 * Les dix outils du manifeste sont appelables dans la page, sans réseau :
 * un sélecteur, des champs d'entrée générés d'après le contrat de chaque outil,
 * le résultat brut en JSON **et** sa lecture humaine. Le domaine
 * (`src/mcp/actions.ts`) fait tout le travail ; cette section ne recopie
 * aucune règle — les adaptateurs locaux (port Jira hors réseau, semis du jeu
 * analysé) vivent dans `mcp-demo.ts`.
 */

import { MCP_TOOLS } from '../../mcp/actions';
import type { ToolResult } from '../../core/types';
import {
  badge,
  buttonHtml,
  byId,
  details,
  field,
  grid,
  heading,
  list,
  note,
  panel,
  pre,
  selectHtml,
  table,
} from '../dom';
import {
  callTool,
  countsDelta,
  fieldsHtml,
  humanLines,
  prepare,
  readPayload,
  type McpDemo,
} from './mcp-demo';
import type { Section, SectionContext } from './types';

/** Verbe du manifeste : huit `GET` qui ne modifient rien, deux `CREATE` tracés. */
export const TOOL_VERBS: Record<string, 'GET' | 'CREATE'> = {
  'get-request-safe': 'GET',
  'get-origin': 'GET',
  'list-findings': 'GET',
  'explain-finding': 'GET',
  'list-suspect-requests': 'GET',
  'check-text': 'GET',
  'check-outbound': 'GET',
  'get-exposure-report': 'GET',
  'propose-public-reply': 'CREATE',
  'report-suspicion': 'CREATE',
};

/** Outil appelé à l'ouverture de l'onglet : une lecture de la demande semée. */
const FIRST_TOOL = 'get-request-safe';

/** Textes propres à la section (les catalogues du produit ne sont pas modifiés). */
const LABELS = {
  tool: { fr: 'Outil', en: 'Tool' },
  run: { fr: 'Appeler l’outil', en: 'Call the tool' },
  inputs: { fr: 'Paramètres de l’appel', en: 'Call parameters' },
  human: { fr: 'Lecture humaine', en: 'Human read' },
  warnings: { fr: 'Avertissements : ce qui n’a pas pu être vérifié', en: 'Warnings: what could not be checked' },
  raw: { fr: 'Résultat brut (JSON)', en: 'Raw result (JSON)' },
  ok: { fr: 'appel réussi', en: 'call succeeded' },
  error: { fr: 'échec', en: 'failure' },
  tools: { fr: 'Les dix outils du manifeste', en: 'The ten tools of the manifest' },
  verb: { fr: 'Verbe', en: 'Verb' },
  effect: { fr: 'Effet', en: 'Effect' },
  none: { fr: 'aucune écriture', en: 'no write' },
  internalNote: { fr: 'note interne (jamais publique)', en: 'internal note (never public)' },
  finding: { fr: 'constat journalisé', en: 'journaled finding' },
  seeded: { fr: 'Demandes analysées, semées dans la session : ', en: 'Analysed requests seeded in the session: ' },
  proof: {
    fr: 'Preuve par les compteurs : ce que l’appel a écrit dans le store de session',
    en: 'Counter proof: what the call wrote to the session store',
  },
  noWrite: {
    fr: 'Verbe GET : 0 ligne écrite — le store est strictement identique avant et après l’appel.',
    en: 'GET verb: 0 rows written — the store is strictly identical before and after the call.',
  },
  drawer: { fr: 'Tiroir', en: 'Drawer' },
  before: { fr: 'Avant', en: 'Before' },
  after: { fr: 'Après', en: 'After' },
  delta: { fr: 'Écart', en: 'Delta' },
  notesProof: {
    fr: 'Note interne enregistrée par le port local : ',
    en: 'Internal note recorded by the local port: ',
  },
  publicProof: { fr: ' — commentaire public : ', en: ' — public comment: ' },
  hint: {
    fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, rien ne quitte la page.',
    en: 'Everything runs in your browser: no network call, nothing leaves this page.',
  },
} as const;

function label(ctx: SectionContext, key: keyof typeof LABELS): string {
  return LABELS[key][ctx.lang];
}

/** Options du sélecteur : les dix clés du manifeste, avec leur verbe. */
export function toolOptions(): [string, string][] {
  return Object.keys(MCP_TOOLS).map((key) => [key, `${key} (${TOOL_VERBS[key] ?? '?'})`]);
}

/** Rendu brut d'une enveloppe d'outil : ce que l'agent reçoit, mot pour mot. */
export function rawJson(result: ToolResult<unknown>): string {
  return JSON.stringify(result, null, 2);
}

/** Zone de résultat : pastille, lecture humaine, avertissements, JSON brut. */
export function resultBlock(tool: string, result: ToolResult<unknown>, ctx: SectionContext): string {
  const head = result.ok ? badge(label(ctx, 'ok'), 'ok') : badge(label(ctx, 'error'), 'bad');
  const verb = badge(`${TOOL_VERBS[tool] ?? '?'}`, TOOL_VERBS[tool] === 'GET' ? 'clean' : 'review');
  const warnings = result.warnings.length > 0
    ? details(label(ctx, 'warnings'), list(result.warnings))
    : '';
  return `${head} ${verb} ${badge(tool)}
    ${heading(label(ctx, 'human'))}${list(humanLines(tool, result, ctx.lang))}
    ${warnings}
    ${details(label(ctx, 'raw'), pre(rawJson(result)), true)}`;
}

/** Ligne de preuve du §10 : notes internes enregistrées, commentaires publics zéro. */
function notesProof(demo: McpDemo, ctx: SectionContext): string {
  return note(`${label(ctx, 'notesProof')}${demo.notes.length}${label(ctx, 'publicProof')}${demo.publicComments.length}`);
}

/**
 * Preuve par les compteurs (`store.counts()`) : un `GET` ne bouge aucune ligne ;
 * `propose-public-reply` écrit un brouillon, une sortie et le journal — et la
 * note reste interne (le compteur de commentaires publics ne bouge jamais).
 */
export function proofBlock(
  tool: string,
  before: Record<string, number>,
  after: Record<string, number>,
  demo: McpDemo,
  ctx: SectionContext,
): string {
  const head = heading(label(ctx, 'proof'));
  const delta = countsDelta(before, after);
  if (delta.length === 0) {
    return `${head}${badge(label(ctx, 'noWrite'), 'ok')}${notesProof(demo, ctx)}`;
  }
  const rows = delta.map(([drawer, was, is]) => [drawer, String(was), String(is), `+${is - was}`]);
  const wrote = TOOL_VERBS[tool] === 'CREATE'
    ? badge(ctx.lang === 'fr' ? 'verbe CREATE : écriture tracée' : 'CREATE verb: journaled write', 'review')
    : badge(label(ctx, 'noWrite'), 'ok');
  return `${head}${wrote}${table(
    [label(ctx, 'drawer'), label(ctx, 'before'), label(ctx, 'after'), label(ctx, 'delta')],
    rows,
  )}${notesProof(demo, ctx)}`;
}

/** Les dix outils, leur verbe et leur effet — le tableau que le §16 garantit. */
export function toolsTable(ctx: SectionContext): string {  const rows = Object.keys(MCP_TOOLS).map((key) => {
    const verb = TOOL_VERBS[key] ?? '?';
    let effect = label(ctx, 'none');
    if (key === 'propose-public-reply') effect = label(ctx, 'internalNote');
    if (key === 'report-suspicion') effect = label(ctx, 'finding');
    return [key, verb, effect];
  });
  return heading(label(ctx, 'tools'))
    + table([label(ctx, 'tool'), label(ctx, 'verb'), label(ctx, 'effect')], rows);
}

/** Colonne de gauche : sélecteur d'outil, champs générés, bouton d'appel. */
function controls(ctx: SectionContext, demo: McpDemo): string {
  return panel(
    field(label(ctx, 'tool'), selectHtml('m-tool', toolOptions(), FIRST_TOOL))
    + heading(label(ctx, 'inputs'))
    + `<div id="m-inputs">${fieldsHtml(FIRST_TOOL, demo, ctx.lang)}</div>`
    + `<div class="row">${buttonHtml('m-run', label(ctx, 'run'))}</div>`
    + note(`${label(ctx, 'seeded')}${demo.issueKeys.join(', ')}`)
    + note(label(ctx, 'hint')),
  );
}

/** Câblage : le sélecteur régénère les champs, le bouton appelle l'outil. */
function wire(root: HTMLElement, ctx: SectionContext): void {
  void prepare(ctx).then((demo) => {
    const select = byId<HTMLSelectElement>(root, 'm-tool');
    select?.addEventListener('change', () => {
      const box = byId<HTMLDivElement>(root, 'm-inputs');
      if (box) box.innerHTML = fieldsHtml(select.value, demo, ctx.lang);
    });
    byId<HTMLButtonElement>(root, 'm-run')?.addEventListener('click', () => {
      const target = byId<HTMLDivElement>(root, 'm-result');
      const tool = select?.value ?? FIRST_TOOL;
      if (!target) return;
      const before = ctx.store.counts();
      void callTool(tool, readPayload(root, tool)).then((result) => {
        const after = ctx.store.counts();
        target.innerHTML = `${resultBlock(tool, result, ctx)}${proofBlock(tool, before, after, demo, ctx)}`;
      });
    });
  });
}

/**
 * Le site ne lit jamais l'heure du système : tout passe par `ctx.now`.
 * `render` sème les demandes analysées puis joue un premier appel réel —
 * l'onglet démontre en deux clics, le bouton rejoue n'importe quel outil.
 */
async function render(ctx: SectionContext): Promise<string> {
  const demo = await prepare(ctx);
  const before = ctx.store.counts();
  const result = await callTool(FIRST_TOOL, { issueKey: demo.issueKey });
  const after = ctx.store.counts();
  const right = panel(
    `${resultBlock(FIRST_TOOL, result, ctx)}${proofBlock(FIRST_TOOL, before, after, demo, ctx)}`,
    'm-result',
  );
  return panel(`${grid(controls(ctx, demo), right)}${toolsTable(ctx)}`);
}

export const mcpSection: Section = {
  id: 'mcp',
  titles: { fr: 'Les dix outils MCP', en: 'The ten MCP tools' },
  render,
  mount: wire,
};
