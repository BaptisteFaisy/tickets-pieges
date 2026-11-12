#!/usr/bin/env node
/**
 * Porte de traçabilité : chaque exigence du cahier a ses modules et ses tests —
 * et le tableau `docs/TRACEABILITE.md` est régénéré.
 *
 * L.exit est non nul **seulement** si un fichier cité a disparu (une exigence
 * qui pointe dans le vide) : les états « partiel » et « à faire » sont des
 * écarts assumés, affichés mais non bloquants. `--strict` les bloque aussi.
 *
 * Usage : node tools/check-traceability.mjs [--strict] [--check]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const CHECK = process.argv.includes('--check');

async function loadModule() {
  const outdir = resolve(ROOT, 'node_modules/.bench-trace');
  await build({
    entryPoints: [resolve(ROOT, 'src/bench/traceability.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: resolve(outdir, 'traceability.mjs'),
    logLevel: 'error',
  });
  return import(resolve(outdir, 'traceability.mjs'));
}

/** Tous les fichiers du dépôt (hors dépendances et fichiers générés). */
function listFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((line) => line.trim().length > 0);
}

async function main() {
  const module = await loadModule();
  const requirements = JSON.parse(readFileSync(resolve(ROOT, 'data/requirements.json'), 'utf8')).exigences;
  const files = listFiles();
  const report = module.verifyTraceability(requirements, files);
  const markdown = module.renderTraceabilityMarkdown(report, requirements);

  const docPath = resolve(ROOT, 'docs/TRACEABILITE.md');
  if (CHECK) {
    const current = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
    if (current !== markdown) {
      console.log('::error::docs/TRACEABILITE.md est perime — relance node tools/check-traceability.mjs');
      return 1;
    }
    console.log('OK — tableau de traçabilité à jour');
    return 0;
  }
  writeFileSync(docPath, markdown, 'utf8');

  console.log(`Traçabilité — ${report.total} exigences, ${report.complets} couvertes, ${report.ecarts.length} écart(s)`);
  for (const status of report.ecarts) {
    const missing = [...status.modulesManquants, ...status.testsManquants];
    console.log(`  ${status.id} (${status.priorite}) ${status.declaree}${missing.length ? ` — fichier(s) disparu(s) : ${missing.join(', ')}` : ''}`);
  }
  const disparus = report.ecarts.filter((status) => status.modulesManquants.length + status.testsManquants.length > 0);
  if (disparus.length > 0 || (STRICT && report.ecarts.length > 0)) {
    console.log('::error::la traçabilité a des trous — voir le tableau');
    return 1;
  }
  console.log('OK — aucun fichier cité ne manque');
  return 0;
}

process.exit(await main());
