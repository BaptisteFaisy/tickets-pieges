#!/usr/bin/env node
/**
 * Banc de détection (#15, #16, #17, #95) — rapport JSON + texte, hors ligne.
 *
 * Le domaine du banc est en TypeScript avec des imports sans extension : comme
 * `tools/replay.mjs`, cet outil assemble `src/bench/*` avec esbuild (déjà dans
 * `node_modules`), puis l'exécute. Aucun réseau, aucun `npm install`, aucune
 * écriture dans un site Atlassian.
 *
 * Les verdicts humains du mode shadow sont, hors ligne, les **étiquettes du
 * corpus** : le rapport le dit explicitement (§21 — ce qui n'est pas mesuré en
 * conditions réelles est déclaré). Le rapport ne porte aucune horodatage :
 * mêmes entrées → mêmes chiffres, octet pour octet.
 *
 * Usage :
 *   node tools/bench.mjs [--json <chemin>] [--sample <n>] [--seed <n>]
 *                        [--lang fr|en] [--scenario <nom>] [--max-mutants <n>]
 *                        [--fail-under-recall <0..1>] [--quiet]
 * Code de sortie : 0 si le corpus est valide ; 1 sinon (ou seuil non atteint).
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'node_modules/.banc/bench');
const CORPUS_DIR = resolve(ROOT, 'data/corpus');
const ENTRIES = ['corpus', 'metrics', 'fuzz', 'shadow', 'detector'];

/** Assemble puis charge les modules du banc — domaine pur, aucune E/S dedans. */
async function loadBench() {
  mkdirSync(OUT, { recursive: true });
  await build({
    entryPoints: ENTRIES.map((name) => resolve(ROOT, `src/bench/${name}.ts`)),
    bundle: true,
    format: 'esm',
    platform: 'node',
    outdir: OUT,
    outbase: resolve(ROOT, 'src/bench'),
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
  });
  const loaded = {};
  for (const name of ENTRIES) loaded[name] = await import(resolve(OUT, `${name}.mjs`));
  return loaded;
}

/** Lit `data/corpus/*.json` dans un ordre stable (nom de fichier trié). */
function readCorpusFiles() {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const doc = JSON.parse(readFileSync(resolve(CORPUS_DIR, name), 'utf8'));
      return { name: doc.name ?? name.replace('.json', ''), version: doc.version ?? 1, entries: doc.entries ?? [] };
    });
}

/** Arguments de la ligne de commande, sans dépendance externe. */
function readArgs(argv) {
  const args = { seed: 1, maxMutants: 3, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--json') { args.json = next === undefined || next.startsWith('--') ? 'bench-report.json' : next; if (!args.json.startsWith('--')) i += 1; }
    else if (key === '--sample') { args.sample = Number(next); i += 1; }
    else if (key === '--seed') { args.seed = Number(next); i += 1; }
    else if (key === '--lang') { args.lang = next; i += 1; }
    else if (key === '--scenario') { args.scenario = next; i += 1; }
    else if (key === '--max-mutants') { args.maxMutants = Number(next); i += 1; }
    else if (key === '--fail-under-recall') { args.failUnderRecall = Number(next); i += 1; }
    else if (key === '--quiet') args.quiet = true;
  }
  return args;
}

/** Filtre le corpus selon la langue ou le scénario demandé. */
function selectEntries(mods, corpus, args) {
  let entries = corpus;
  if (args.lang) entries = mods.corpus.byLanguage(entries, args.lang);
  if (args.scenario) entries = mods.corpus.scenarioSteps(entries, args.scenario);
  if (args.sample) entries = mods.corpus.sampleCorpus(entries, args.sample, args.seed);
  return entries;
}

/** Verdicts humains hors ligne : les étiquettes du corpus, dites comme telles. */
function humanReference(entries) {
  const verdicts = {};
  for (const entry of entries) verdicts[entry.id] = entry.label === 'attack' ? 'trapped' : 'false-positive';
  return verdicts;
}

function percent(value) {
  return value === null ? 'non mesuré' : `${(value * 100).toFixed(1).replace(/\.0$/, '')} %`;
}

/** Rapport texte, en français, sans horodatage. */
function textReport(parts) {
  const { stats, metrics, robustness, shadow, gaps, corpusSize, args } = parts;
  const lines = [
    '— Banc de détection (hors ligne) —',
    `corpus : ${stats.total} entrées (${stats.attacks} charges, ${stats.legitimate} légitimes), fr ${stats.byLang.fr} / en ${stats.byLang.en}, scénarios ${stats.scenarios}`,
    `joué sur : ${corpusSize} entrées${args.sample ? ` (échantillon ${args.sample}, graine ${args.seed})` : ''}`,
    ...gaps,
    '',
    `rappel charges : ${percent(metrics.recall)}   précision : ${percent(metrics.precision)}   faux positifs : ${percent(metrics.falsePositiveRate)}`,
    `matrice : TP ${metrics.confusion.truePositives}, FN ${metrics.confusion.falseNegatives}, FP ${metrics.confusion.falsePositives}, TN ${metrics.confusion.trueNegatives}`,
    `charges manquées (${metrics.missedAttacks.length}) : ${metrics.missedAttacks.join(', ') || 'aucune'}`,
    `textes légitimes relevés (${metrics.falsePositiveIds.length}) : ${metrics.falsePositiveIds.join(', ') || 'aucun'}`,
    `règles attendues jamais vues : ${metrics.neverFiredRules.join(', ') || 'aucune'}`,
    '',
    'par règle :',
  ];
  for (const rule of metrics.byRule) {
    lines.push(
      `  ${rule.ruleId.padEnd(7)} TP ${String(rule.truePositives).padStart(3)}  FP ${String(rule.falsePositives).padStart(3)}` +
        `  précision ${percent(rule.precision).padStart(10)}  rappel ${percent(rule.recall).padStart(10)}`,
    );
  }
  lines.push('', `robustesse aux mutations : ${percent(robustness.robustness)} (${robustness.broken} cassures sur ${robustness.total} mutants)`);
  for (const score of robustness.byMutation) {
    if (score.total > 0) lines.push(`  ${score.mutation.padEnd(17)} ${String(score.total).padStart(3)} mutants, ${String(score.broken).padStart(2)} cassures, ${percent(score.robustness)}`);
  }
  lines.push('', ...shadow, '');
  return lines.join('\n');
}

/** Rapport JSON : tout ce que la CI ou un humain peut relire. */
function jsonReport(parts) {
  const { stats, metrics, robustness, shadowReport, gaps, corpusSize, issues, args } = parts;
  const { outcomes, results, ...metricsRest } = metrics;
  const { outcomes: _robustOutcomes, ...robustnessRest } = robustness;
  const { results: _shadowResults, ...shadowRest } = shadowReport;
  return {
    version: 1,
    offline: true,
    humanReference: 'étiquettes du corpus (aucun verdict humain réel hors ligne)',
    selection: { corpusEntries: stats.total, played: corpusSize, lang: args.lang ?? null, scenario: args.scenario ?? null, sample: args.sample ?? null, seed: args.seed },
    corpus: stats,
    corpusIssues: issues,
    gaps,
    metrics: metricsRest,
    robustness: robustnessRest,
    shadow: shadowRest,
  };
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const mods = await loadBench();
  const files = readCorpusFiles();
  const issues = mods.corpus.validateCorpus(files);
  const corpus = mods.corpus.mergeCorpus(files);
  const entries = selectEntries(mods, corpus, args);
  const detect = mods.detector.createDetector();
  const metrics = mods.metrics.measureCorpus(entries, detect);
  const robustness = mods.fuzz.measureRobustness(entries, detect, { seed: args.seed, maxPerEntry: args.maxMutants });
  const port = mods.shadow.createRecordingPort();
  const shadowReport = mods.shadow.runShadow(entries, detect, humanReference(entries), port);
  const parts = {
    stats: mods.corpus.corpusStats(corpus),
    metrics,
    robustness,
    shadowReport,
    shadow: mods.shadow.shadowDigest(shadowReport),
    gaps: mods.detector.benchGapLines(),
    corpusSize: entries.length,
    issues,
    args,
  };
  if (args.json) writeFileSync(resolve(ROOT, args.json), `${JSON.stringify(jsonReport(parts), null, 2)}\n`);
  if (!args.quiet) process.stdout.write(`${textReport(parts)}\n`);
  if (issues.length > 0) {
    process.stderr.write(`corpus invalide : ${issues.length} anomalie(s)\n`);
    return 1;
  }
  if (args.failUnderRecall !== undefined && (metrics.recall ?? 0) < args.failUnderRecall) {
    process.stderr.write(`rappel ${metrics.recall} sous le seuil ${args.failUnderRecall}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
