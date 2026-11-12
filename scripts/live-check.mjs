#!/usr/bin/env node
/**
 * La recette live : semis, vérification, comparaison aux **attendus figés**.
 *
 * C'est la boucle qui a trouvé les cinq défauts de la nuit du 12 novembre 2026.
 * Elle exige un site (le site de démonstration) : elle est donc **hors de la CI**,
 * et c'est dit.
 *
 * Sortie non nulle uniquement si une **régression** apparaît (un écart qui n'est
 * pas dans la liste des écarts connus) ou si une demande n'a pas été propagée.
 *
 * Usage :
 *   node scripts/live-check.mjs --help
 *   node scripts/live-check.mjs --site x.atlassian.net --email moi@x --lang fr
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = [
  'Recette live : semis, verification, comparaison aux attendus figes.',
  '',
  '  --site <site>      site Atlassian',
  '  --email <courriel>  compte qui lit',
  '  --lang <fr|en>      jeu a jouer (defaut : fr)',
  '  --seed-only         ne seme pas, utilise les rapports deja presents',
  '  --json              rapport JSON',
].join('\n');

if (process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

function value(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function loadModule() {
  const outdir = resolve(ROOT, 'node_modules/.bench-live');
  await build({
    entryPoints: [resolve(ROOT, 'src/live/check.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: resolve(outdir, 'check.mjs'),
    logLevel: 'error',
  });
  return import(resolve(outdir, 'check.mjs'));
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

/** Semis puis verification sur le site : les deux etapes qui produisent les rapports. */
function seedAndVerify(site, email, lang) {
  console.log('Semis des demandes du jeu…');
  execFileSync(
    'python3',
    [resolve(ROOT, 'scripts/seed-demo-site.py'), '--site', site, '--email', email, '--lang', lang],
    { stdio: 'inherit' },
  );
  console.log('Verification de ce que le site porte…');
  execFileSync(
    'python3',
    [resolve(ROOT, 'scripts/verify-demo-site.py'), '--site', site, '--email', email, '--lang', lang],
    { stdio: 'inherit' },
  );
}

async function main() {
  const site = value('--site', '');
  const email = value('--email', '');
  const lang = value('--lang', 'fr');
  const seedOnly = process.argv.includes('--seed-only');
  const asJson = process.argv.includes('--json');

  if (!site || !email) {
    console.error('--site et --email sont requis (voir --help).');
    return 2;
  }
  const module = await loadModule();
  const seedPath = resolve(ROOT, `out/demo-seed-${lang}.json`);
  const verifyPath = resolve(ROOT, `out/demo-verify-${lang}.json`);

  if (!seedOnly) seedAndVerify(site, email, lang);

  const seed = readJson(seedPath, { requests: [] });
  const verify = readJson(verifyPath, { requests: [] });
  const frozen = readJson(resolve(ROOT, 'data/expectations.json'), { exigences: [] });
  const expectations = frozen.exigences.filter((item) => item.lang === lang);
  const report = module.compareLive(verify.requests, expectations);

  const outPath = resolve(ROOT, `out/live-report-${lang}.json`);
  writeFileSync(outPath, JSON.stringify({ site, lang, ...report }, null, 2), 'utf8');

  if (asJson) {
    console.log(JSON.stringify({ site, lang, ...report }, null, 2));
  } else {
    console.log(`\n${module.summarizeLive(report)}`);
    for (const verdict of report.verdicts) {
      if (verdict.kind === 'conforme') continue;
      console.log(`  ${verdict.id} — ${verdict.kind}${verdict.attendu ? ` (attendu ${verdict.attendu}, obtenu ${verdict.obtenu})` : ''}`);
      if (verdict.raison) console.log(`      ${verdict.raison}`);
    }
    console.log(`\nRapport : ${outPath}`);
  }
  if (report.regressions > 0 || report.propagationManquante > 0) {
    console.error('::error::regression(s) ou demande(s) non propagee(s) — voir le rapport');
    return 1;
  }
  console.log('OK — aucune régression par rapport aux attendus figés');
  return 0;
}

process.exit(await main());
