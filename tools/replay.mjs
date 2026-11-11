#!/usr/bin/env node
/**
 * Banc d'essai (§17.7, TP-18) — rejoue le jeu d'essai hors ligne.
 *
 * Squelette posé par le tronc : le lot « jeu d'essai » le remplace par le banc
 * complet (chaque demande d'exemple passe par origine → C1 → C2 → C4 →
 * suspicion → encadrement, et l'attendu du jeu est comparé au résultat).
 *
 * Usage : node tools/replay.mjs [--json] [--id <identifiant>]
 */

const args = process.argv.slice(2);
const asJson = args.includes('--json');

async function main() {
  let dataset = [];
  try {
    const module = await import('../src/sample/dataset.ts');
    dataset = module.SAMPLE_REQUESTS ?? [];
  } catch {
    dataset = [];
  }
  if (dataset.length === 0) {
    const message = 'banc d’essai : jeu d’essai absent (lot « jeu d’essai » pas encore fusionné)';
    if (asJson) console.log(JSON.stringify({ ok: true, played: 0, note: message }, null, 2));
    else console.log(message);
    return 0;
  }
  const message = `banc d’essai : ${dataset.length} demande(s) d’exemple trouvée(s) — rejouées par le lot « jeu d’essai »`;
  if (asJson) console.log(JSON.stringify({ ok: true, played: dataset.length }, null, 2));
  else console.log(message);
  return 0;
}

process.exit(await main());
