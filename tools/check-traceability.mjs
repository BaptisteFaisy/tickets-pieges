#!/usr/bin/env node
/**
 * Porte de traçabilité — exigence ↔ module ↔ test (lot « traceability »).
 *
 * Le domaine du contrôle est en TypeScript avec des imports sans extension :
 * comme `tools/bench.mjs` et `tools/replay.mjs`, cet outil assemble
 * `src/bench/traceability.ts` avec esbuild (déjà dans `node_modules`), en
 * mémoire, puis l'exécute. Aucune règle n'est écrite deux fois : la porte ne
 * fait que lire le disque et appeler le domaine.
 *
 * Deux vérifications, et un seul code de sortie non nul :
 *  - chaque exigence de `data/requirements.json` cite des modules et des tests
 *    **existants** ; un chemin absent est un trou ;
 *  - le tableau de `docs/TRACEABILITE.md` est **à jour** : il est comparé à ce
 *    que le domaine génère, bloc généré compris.
 *
 * Usage :
 *   node tools/check-traceability.mjs            # porte : trous + tableau à jour
 *   node tools/check-traceability.mjs --write    # régénère le tableau du document
 *   node tools/check-traceability.mjs --quiet    # n'affiche que le verdict
 *
 * Code de sortie : 0 si tout va bien ; 1 si un trou existe ou si le tableau
 * du document n'est plus à jour ; 2 si le document des exigences est illisible.
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIREMENTS_PATH = resolve(ROOT, 'data/requirements.json');
const DOC_PATH = resolve(ROOT, 'docs/TRACEABILITE.md');
const BEGIN_MARK = '<!-- BEGIN:GENERATED -->';
const END_MARK = '<!-- END:GENERATED -->';

/** Assemble puis charge le domaine du contrôle — rien n'est écrit sur le disque. */
async function loadDomain() {
  const result = await build({
    entryPoints: [resolve(ROOT, 'src/bench/traceability.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  });
  const code = result.outputFiles[0].text;
  const href = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(href);
}

/** Les options de la ligne de commande, comprises sans dépendance. */
function parseArgs(argv) {
  const options = { write: false, quiet: false };
  for (const arg of argv) {
    if (arg === '--write') options.write = true;
    else if (arg === '--quiet') options.quiet = true;
    else throw new Error(`option inconnue : ${arg}`);
  }
  return options;
}

/** L'index de la ligne qui vaut exactement `marker` (marqueur seul sur sa ligne). */
function markerLine(text, marker) {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === marker) return index;
  }
  return -1;
}

/** Le bloc généré du document, ou `null` s'il est absent. */
function readGeneratedBlock(text) {
  const begin = markerLine(text, BEGIN_MARK);
  const end = markerLine(text, END_MARK);
  if (begin < 0 || end < 0 || end <= begin) return null;
  const lines = text.split('\n');
  return lines.slice(begin + 1, end).join('\n').trim();
}

/** Réécrit le bloc généré du document, en gardant le reste intact. */
function writeGeneratedBlock(text, table) {
  const begin = markerLine(text, BEGIN_MARK);
  const end = markerLine(text, END_MARK);
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error(`le document doit porter ${BEGIN_MARK} et ${END_MARK}, chacun seul sur sa ligne`);
  }
  const lines = text.split('\n');
  return [...lines.slice(0, begin + 1), table, ...lines.slice(end)].join('\n');
}

/** Assemble le rapport : lecture du document des exigences, contrôle, tableau. */
function buildReport(domain) {
  const raw = JSON.parse(readFileSync(REQUIREMENTS_PATH, 'utf8'));
  const doc = domain.parseRequirements(raw);
  const exists = (path) => existsSync(resolve(ROOT, path));
  const report = domain.checkTraceability(doc, exists);
  return { doc, report, table: domain.renderMarkdownTable(report) };
}

/** Affiche le rapport console, sauf en mode silencieux. */
function printReport(domain, report, quiet) {
  if (quiet) return;
  console.log(domain.formatGapReport(report));
}

/** La porte : trous + tableau à jour. Renvoie le code de sortie. */
function check(domain, options) {
  const { report, table } = buildReport(domain);
  printReport(domain, report, options.quiet);
  const doc = readFileSync(DOC_PATH, 'utf8');
  const current = readGeneratedBlock(doc);
  if (current === null) {
    console.error(`KO ${DOC_PATH} : bloc généré absent (${BEGIN_MARK} … ${END_MARK})`);
    return 1;
  }
  if (current !== table) {
    console.error(`KO ${DOC_PATH} : le tableau n'est plus à jour — lancer « node tools/check-traceability.mjs --write »`);
    return 1;
  }
  if (!report.ok) {
    console.error(`KO traçabilité : ${report.holes} exigence(s) en trou.`);
    return 1;
  }
  if (!options.quiet) console.log(`OK — ${report.covered}/${report.requirements.length} exigences couvertes, tableau à jour.`);
  return 0;
}

/** Régénère le tableau du document — la prose reste intacte. */
function write(domain) {
  const { report, table } = buildReport(domain);
  const doc = readFileSync(DOC_PATH, 'utf8');
  writeFileSync(DOC_PATH, writeGeneratedBlock(doc, table), 'utf8');
  console.log(`${DOC_PATH} : tableau régénéré (${report.requirements.length} exigences).`);
  return report.ok ? 0 : 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const domain = await loadDomain();
  if (options.write) return write(domain);
  return check(domain, options);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`KO traçabilité : ${error.message}`);
    process.exit(2);
  });
