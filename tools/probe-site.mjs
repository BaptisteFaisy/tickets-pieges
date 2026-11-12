#!/usr/bin/env node
/**
 * Sonde du site installé — mesure la fenêtre d'exposition réelle (#84, #85).
 *
 * Deux modes, et **aucun texte de ticket** dans la sortie (§21) :
 *   --url   sonde le `webtrigger` de diagnostic de l'app installée (`pieges-ops`) ;
 *   --in    relit une charge utile déjà produite (hors ligne, sans réseau).
 *
 * Quand le site ne répond pas — ou ne sait pas encore rendre les mesures — la
 * sonde écrit « à mesurer sur site » avec la raison exacte : jamais un chiffre
 * inventé. Le rendu des chiffres vient du domaine (`src/core/timing.ts`),
 * assemblé par esbuild comme le fait `tools/replay.mjs` : zéro duplication.
 *
 * Usage :
 *   node tools/probe-site.mjs --url https://<hote>/pieges-ops --token <jeton> [--issues SUP-1,SUP-2]
 *   node tools/probe-site.mjs --in /tmp/mesures.json
 *   node tools/probe-site.mjs --dry-run --json
 * Environnement : PIEGES_SITE_URL, PIEGE_TOKEN.
 * Codes de sortie : 0 = écrit (ou rien à écrire), 1 = erreur d'usage,
 * 2 = réponse refusée parce qu'elle porte du texte de ticket.
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = resolve(ROOT, 'node_modules/.banc/timing-bundle.mjs');
const DOC = resolve(ROOT, 'docs/MESURES.md');
const DEBUT = '<!-- MESURES:DEBUT -->';
const FIN = '<!-- MESURES:FIN -->';
const TIMEOUT_MS = 20_000;

/** Miroir de `FORBIDDEN_KEYS` (`src/platform/log.ts`) : ce qui ne sort jamais. */
const FORBIDDEN_KEYS = ['text', 'body', 'content', 'excerpt', 'original', 'description', 'summary'];

/** Le domaine de mesure, assemblé puis chargé (aucune E/S dedans). */
async function loadCore() {
  mkdirSync(dirname(BUNDLE), { recursive: true });
  await build({
    entryPoints: [resolve(ROOT, 'src/core/timing.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: BUNDLE,
    logLevel: 'error',
  });
  return import(BUNDLE);
}

function parseArgs(argv) {
  const options = {
    url: process.env.PIEGES_SITE_URL ?? '',
    token: process.env.PIEGE_TOKEN ?? '',
    action: 'timing',
    issues: [],
    input: '',
    doc: DOC,
    dryRun: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[(index += 1)] ?? '';
    if (argument === '--url') options.url = value();
    else if (argument === '--token') options.token = value();
    else if (argument === '--action') options.action = value();
    else if (argument === '--issues') options.issues = value().split(',').map((key) => key.trim()).filter(Boolean);
    else if (argument === '--in') options.input = value();
    else if (argument === '--doc') options.doc = resolve(ROOT, value());
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--json') options.json = true;
    else throw new Error('option inconnue : ' + String(argument));
  }
  return options;
}

/** Une réponse qui porterait du texte de ticket est refusée, pas écrite. */
function hasTicketText(value, depth = 0) {
  if (value === null || depth > 12) return false;
  if (Array.isArray(value)) return value.some((item) => hasTicketText(item, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value).some(
      ([key, item]) => FORBIDDEN_KEYS.includes(key) || hasTicketText(item, depth + 1),
    );
  }
  return false;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'hote illisible';
  }
}

/** Sonde le `webtrigger` de diagnostic ; un refus est une raison, pas une plante. */
async function probeSite(options) {
  const separator = options.url.includes('?') ? '&' : '?';
  const target = options.url + separator + 'action=' + encodeURIComponent(options.action);
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + options.token },
    body: JSON.stringify({ action: options.action, issueKeys: options.issues }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok !== true) {
    const reason = payload && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status;
    return { available: false, reason, payload: null };
  }
  return { available: true, reason: null, payload };
}

function readPayloadFile(path) {
  if (!existsSync(path)) return { available: false, reason: 'fichier absent : ' + path, payload: null };
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    payload = null;
  }
  if (!payload || payload.ok !== true || !payload.report) {
    return { available: false, reason: 'charge utile illisible ou incomplète', payload };
  }
  return { available: true, reason: null, payload };
}

function usableReport(report) {
  return Boolean(report && typeof report === 'object' && report.intervals && Array.isArray(report.objectives));
}

function samplesLine(samples) {
  if (!samples) return 'aucun échantillon';
  const parts = [
    samples.traces + ' trace(s) de ticket',
    samples.queue + ' attente(s) de file C3',
    samples.throughput + ' tranche(s) de débit',
    samples.events + ' entrée(s) de journal lues',
  ];
  return parts.join(', ');
}

/** La section écrite dans `docs/MESURES.md`, entre ses deux marqueurs. */
function buildSection(core, result, generatedAt, options) {
  const source = result.available
    ? options.input
      ? 'fichier ' + options.input
      : 'site ' + hostOf(options.url)
    : 'indisponible';
  const scope = result.available ? 'site' : 'offline';
  const report =
    result.available && usableReport(result.payload.report)
      ? result.payload.report
      : core.buildTimingReport({ scope, traces: [] });
  const markdown =
    result.available && typeof result.payload.markdown === 'string' && result.payload.markdown.length > 0
      ? result.payload.markdown
      : core.renderReportMarkdown(report);
  const lines = [DEBUT, '', '_Sondé le ' + generatedAt + ' — source : ' + source + '._', ''];
  if (!result.available) {
    lines.push('Le site n’a pas rendu de mesures : ' + String(result.reason) + '.', '');
    lines.push('Aucun chiffre n’est inventé : tout reste « à mesurer sur site ».', '');
  }
  lines.push(markdown, '', '**Échantillons** : ' + samplesLine(result.payload?.samples), '');
  for (const caveat of report.caveats ?? []) lines.push('- ' + String(caveat));
  lines.push('', FIN);
  return lines.join('\n');
}

/** Remplace la section entre les marqueurs, sinon l'ajoute en fin de document. */
function writeSection(section, docPath, dryRun) {
  if (dryRun) {
    process.stdout.write(section + '\n');
    return;
  }
  const current = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
  // Dernière occurrence : le document peut citer les marqueurs dans son prose.
  const start = current.lastIndexOf(DEBUT);
  const end = start >= 0 ? current.indexOf(FIN, start) : -1;
  const next =
    start >= 0 && end > start
      ? current.slice(0, start) + section + current.slice(end + FIN.length)
      : (current ? current.replace(/\s*$/, '\n\n') : '') + section + '\n';
  writeFileSync(docPath, next, 'utf8');
  process.stdout.write('écrit : ' + docPath + '\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const core = await loadCore();
  let result;
  if (options.input) result = readPayloadFile(options.input);
  else if (options.url) result = await probeSite(options);
  else result = { available: false, reason: 'ni --url ni --in : rien à sonder', payload: null };
  if (result.payload && hasTicketText(result.payload)) {
    process.stderr.write('REFUS : la réponse porte une clé de texte de ticket (§21).\n');
    process.exit(2);
  }
  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        ok: result.available,
        reason: result.reason,
        samples: result.payload?.samples ?? null,
      }) + '\n',
    );
  }
  writeSection(buildSection(core, result, new Date().toISOString(), options), options.doc, options.dryRun);
}

main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exit(1);
});
