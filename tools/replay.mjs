#!/usr/bin/env node
/**
 * Banc d'essai (§17.7, TP-18) — rejoue le jeu d'essai de bout en bout, hors ligne.
 *
 * La chaîne du domaine est en TypeScript avec des imports sans extension :
 * Node ne sait pas les charger tels quels. Cet outil assemble donc les modules
 * du banc avec esbuild (déjà présent dans `node_modules`), en mémoire, puis les
 * exécute — aucun fichier temporaire, aucun réseau, aucun `npm install`.
 *
 * Jeu d'essai : `src/sample/dataset.ts` s'il est fusionné (lot « jeu d'essai »),
 * sinon le jeu local `src/replay/fixtures.ts` (le rapport le dit).
 *
 * Usage : node tools/replay.mjs [--json] [--id <identifiant>] [--lang fr|en]
 * Code de sortie : toujours 0 — une divergence informe, elle ne bloque pas.
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'node_modules/.banc/replay-bundle.mjs');

/** Modules du banc assemblés puis chargés — domaine pur, aucune E/S dedans. */
async function loadBench() {
  mkdirSync(dirname(OUT), { recursive: true });
  await build({
    entryPoints: [
      resolve(ROOT, 'src/replay/engine.ts'),
      resolve(ROOT, 'src/replay/compare.ts'),
      resolve(ROOT, 'src/replay/report.ts'),
      resolve(ROOT, 'src/replay/fixtures.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outdir: dirname(OUT),
    outbase: resolve(ROOT, 'src/replay'),
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
  });
  const base = dirname(OUT);
  const load = (name) => import(resolve(base, `${name}.mjs`));
  return {
    engine: await load('engine'),
    compare: await load('compare'),
    report: await load('report'),
    fixtures: await load('fixtures'),
  };
}

/** Jeu d'essai : le lot « jeu d'essai » d'abord, le jeu local sinon. */
async function loadDataset(modules) {
  try {
    const outdir = resolve(ROOT, 'node_modules/.banc/sample');
    await build({
      entryPoints: [resolve(ROOT, 'src/sample/dataset.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outdir,
      outbase: resolve(ROOT, 'src/sample'),
      outExtension: { '.js': '.mjs' },
      logLevel: 'error',
    });
    const sample = await import(resolve(outdir, 'dataset.mjs'));
    const rows = typeof sample.loadDataset === 'function' ? sample.loadDataset() : (sample.SAMPLE_REQUESTS ?? []);
    if (rows.length > 0) {
      return { samples: [...rows], label: `src/sample — ${rows.length} demandes du jeu d’essai intégré` };
    }
  } catch {
    // Jeu d'essai illisible : le repli local dit la vérité dans le rapport.
  }
  return { samples: [...modules.fixtures.LOCAL_SAMPLES], label: 'jeu local src/replay/fixtures.ts' };
}

/** Arguments de la ligne de commande. */
function parseArgs(argv) {
  const args = { json: false, id: null, lang: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--id') { args.id = argv[i + 1]; i += 1; }
    else if (argv[i] === '--lang') { args.lang = argv[i + 1] === 'en' ? 'en' : 'fr'; i += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modules = await loadBench();
  const { samples, label } = await loadDataset(modules);
  const selected = args.id ? samples.filter((s) => s.id === args.id) : samples;
  if (args.id && selected.length === 0) {
    console.error(`banc d'essai : aucune demande « ${args.id} » dans le jeu`);
    return 0;
  }
  const replayOptions = { dataset: label.includes('fixtures') ? 'local' : 'sample' };
  if (args.lang) replayOptions.language = args.lang;
  const result = await modules.engine.replayBench(selected, replayOptions);
  const summary = modules.compare.compareBench(selected, result, args.lang ?? 'fr');
  const recipes = modules.compare.evaluateRecipes(result, args.lang ?? 'fr');
  const view = { result, summary, recipes, datasetLabel: label };
  console.log(args.json ? modules.report.renderBenchJson(view) : modules.report.renderBenchText(view, args.lang ?? 'fr'));
  return 0;
}

process.exit(await main());
