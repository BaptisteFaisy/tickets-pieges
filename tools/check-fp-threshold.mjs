#!/usr/bin/env node
/**
 * Porte « faux positifs » : casse la CI quand le corpus légitime dépasse le
 * seuil, ou quand il retombe sous la taille minimale par langue.
 *
 * Le domaine est en TypeScript (`src/bench/legitimate.ts`, importé sans
 * extension) : comme `tools/check-traceability.mjs`, cet outil assemble le
 * domaine avec esbuild (déjà dans `node_modules`) puis l'exécute. Aucun réseau,
 * aucune écriture dans un site Atlassian. Le message rendu est chiffré :
 * mêmes entrées → mêmes chiffres, octet pour octet.
 *
 * Usage :
 *   node tools/check-fp-threshold.mjs [--corpus <fichier.json>]...
 *                              [--plain-max-fp-rate <n>] [--trap-max-fp-rate <n>]
 * Code de sortie : 0 si le seuil est tenu ; 1 sinon. Abaisser
 * `--trap-max-fp-rate` sous la mesure fait échouer la porte : c'est ainsi que
 * le seuil est testé de bout en bout (voir `src/bench/legitimate.test.ts`).
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_FILES = ['legitimate-fr.json', 'legitimate-en.json'];
const MIN_PER_LANG = 40;

async function loadModules() {
  const outdir = resolve(ROOT, 'node_modules/.fp-threshold');
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [
      resolve(ROOT, 'src/bench/legitimate.ts'),
      resolve(ROOT, 'src/bench/detector.ts'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outdir,
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
  });
  const legitimate = await import(resolve(outdir, 'legitimate.mjs'));
  const detector = await import(resolve(outdir, 'detector.mjs'));
  return { legitimate, detector };
}

function readEntries(files) {
  return files.flatMap((name) => {
    const doc = JSON.parse(readFileSync(resolve(ROOT, name), 'utf8'));
    return doc.entries;
  });
}

function readArgs(argv) {
  const args = { corpora: [], plainMaxFpRate: null, trapMaxFpRate: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--corpus') {
      args.corpora.push(resolve(ROOT, argv[i + 1]));
      i += 1;
    } else if (key === '--plain-max-fp-rate') {
      args.plainMaxFpRate = Number(argv[i + 1]);
      i += 1;
    } else if (key === '--trap-max-fp-rate') {
      args.trapMaxFpRate = Number(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function percent(value) {
  return (value * 100).toFixed(1).replace(/\.0$/, '') + ' %';
}

/** La porte elle-même : erreurs à afficher, et code de sortie. */
function runGate(legitimate, measure, applied, counts) {
  const errors = [];
  if (counts.fr < MIN_PER_LANG) errors.push('corpus français : ' + counts.fr + ' textes (< ' + MIN_PER_LANG + ')');
  if (counts.en < MIN_PER_LANG) errors.push('corpus anglais : ' + counts.en + ' textes (< ' + MIN_PER_LANG + ')');
  for (const line of legitimate.checkThreshold(measure, applied)) errors.push(line);
  return errors;
}

/** Rapport chiffré — mêmes entrées, mêmes chiffres. */
function reportLines(measure, applied, counts) {
  const lines = [];
  lines.push('Corpus légitime : ' + measure.total + ' textes (' + measure.plainCount + ' ordinaires, ' + measure.trapCount + ' pièges ; fr ' + counts.fr + ' / en ' + counts.en + ')');
  lines.push('faux positifs ordinaires : ' + measure.plainFalsePositives.length + '/' + measure.plainCount + ' (taux ' + percent(measure.plainFpRate) + ') — seuil ' + percent(applied.plainMaxFpRate));
  lines.push('motifs C2 sur support ordinaire : ' + measure.plainC2Fp + ' — seuil ' + applied.plainMaxC2Fp);
  lines.push('bruit du corpus piège : ' + measure.trapFalsePositives.length + '/' + measure.trapCount + ' (taux ' + percent(measure.trapFpRate) + ') — seuil ' + percent(applied.trapMaxFpRate));
  for (const rule of measure.perRule) {
    lines.push('  ' + rule.ruleId + ' : FP ordinaires ' + rule.falsePositivesPlain + ' / pièges ' + rule.falsePositivesTrap);
  }
  return lines;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const { legitimate, detector } = await loadModules();
  const files = args.corpora.length > 0 ? args.corpora : CORPUS_FILES.map((name) => 'data/corpus/' + name);
  const entries = readEntries(files);
  const measure = legitimate.measureLegit(entries, detector.createDetector());
  const applied = Object.assign({}, legitimate.defaultThreshold());
  if (args.plainMaxFpRate !== null) applied.plainMaxFpRate = args.plainMaxFpRate;
  if (args.trapMaxFpRate !== null) applied.trapMaxFpRate = args.trapMaxFpRate;
  const counts = {
    fr: entries.filter((entry) => entry.lang === 'fr').length,
    en: entries.filter((entry) => entry.lang === 'en').length,
  };
  const errors = runGate(legitimate, measure, applied, counts);
  console.log(reportLines(measure, applied, counts).join('\n'));
  if (errors.length > 0) {
    for (const line of errors) console.log('::error::' + line);
    console.log('::error::le corpus légitime dépasse le seuil de faux positifs');
    return 1;
  }
  console.log('OK — le corpus légitime respecte le seuil');
  return 0;
}

process.exit(await main());