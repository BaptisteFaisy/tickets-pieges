#!/usr/bin/env node
/**
 * Rejouer un lot de tickets sur le site de démonstration : on relit l'état
 * écrit par l'app (propriété `pieges`) et on compare à l'attendu du jeu.
 *
 * Le rejeu ne modifie rien : il **constate**. Quand une correction a été
 * déployée, on veut savoir si les tickets déjà traités portent le nouvel état —
 * sinon le rejeu est un miroir de l'état, pas une action.
 *
 * Usage :
 *   node scripts/replay-batch.mjs --help
 *   node scripts/replay-batch.mjs --site x.atlassian.net --email moi@x --lang fr
 *   node scripts/replay-batch.mjs --site x.atlassian.net --email moi@x --keys SUP-1,SUP-2
 */

import { execFileSync } from 'node:child_process';

const HELP = [
  'Rejouer un lot de tickets (constat, sans modification).',
  '',
  '  --site <site>       site Atlassian',
  '  --email <courriel>  compte qui lit',
  '  --token-file <f>    fichier du jeton API (defaut : ~/.atlassian-api-token)',
  '  --lang <fr|en>      jeu d\'essai a relire (defaut : fr)',
  '  --keys <a,b>        lire ces cles de tickets plutot que le jeu complet',
  '  --json              sortie JSON',
].join('\n');

function usage() {
  console.log(HELP);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  usage();
  process.exit(args.includes('--help') ? 0 : 1);
}

function value(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const site = value('--site', '');
const email = value('--email', '');
const tokenFile = value('--token-file', '~/.atlassian-api-token');
const lang = value('--lang', 'fr');
const keys = value('--keys', '');
const asJson = args.includes('--json');

if (!site || !email) {
  console.error('--site et --email sont requis (voir --help).');
  process.exit(2);
}

const token = execFileSync('cat', [tokenFile.replace('~', process.env.HOME)], { encoding: 'utf8' }).trim();
const auth = Buffer.from(`${email}:${token}`).toString('base64');

async function readProperty(key) {
  const response = await fetch(`https://${site}/rest/api/3/issue/${key}/properties/pieges`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const raw = await response.text();
  if (!raw.trim()) return null;
  return JSON.parse(raw).value ?? null;
}

async function main() {
  let keysToRead = keys ? keys.split(',').map((k) => k.trim()).filter(Boolean) : [];
  if (keysToRead.length === 0) {
    const seed = JSON.parse(execFileSync('cat', [`out/demo-seed-${lang}.json`], { encoding: 'utf8' }));
    keysToRead = seed.requests.map((row) => row.issueKey);
  }
  const rows = [];
  for (const key of keysToRead) {
    const value = await readProperty(key);
    rows.push({
      issueKey: key,
      trustLevel: value?.trustLevel ?? null,
      suspicionLevel: value?.suspicionLevel ?? null,
      modeApplied: value?.modeApplied ?? null,
      analyzedAt: value?.analyzedAt ?? null,
    });
  }
  const sansEtat = rows.filter((row) => row.trustLevel === null);
  if (asJson) {
    console.log(JSON.stringify({ site, lang, total: rows.length, sansEtat: sansEtat.length, rows }, null, 2));
  } else {
    console.log(`Rejeu — ${rows.length} ticket(s) sur ${site}`);
    for (const row of rows) {
      console.log(
        `  ${row.issueKey.padEnd(14)} ${String(row.trustLevel ?? '—').padEnd(4)} ${String(row.suspicionLevel ?? '—').padEnd(9)} ${row.modeApplied ?? '—'}`,
      );
    }
    console.log(sansEtat.length === 0 ? 'Tous les tickets portent la propriété.' : `${sansEtat.length} ticket(s) sans propriété.`);
  }
  return 0;
}

process.exit(await main());
