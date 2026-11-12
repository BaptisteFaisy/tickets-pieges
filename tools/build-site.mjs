#!/usr/bin/env node
/**
 * Construction du site de démonstration — `site/` → `dist/site/`.
 *
 * Le site n'embarque **aucune** logique propre : esbuild assemble `site/demo.ts`
 * avec le domaine déjà fusionné (`src/core/`, `src/sample/`, `src/replay/`), si
 * bien que la page publique exécute exactement le code de l'app.
 *
 * Seul écart au navigateur : `src/core/hashing.ts` importe `node:crypto`, qui
 * n'existe pas dans une page. Le plugin ci-dessous le remplace par
 * `site/shims/node-crypto.ts` (SHA-256 pur + `crypto.getRandomValues`), dont
 * `src/site/crypto-shim.test.ts` vérifie qu'il produit les **mêmes empreintes**
 * que Node — sinon les campagnes et les identifiants de constat dériveraient.
 *
 * Usage : node tools/build-site.mjs [--out dist/site]
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Remplace `node:crypto` par le shim navigateur, à la résolution seulement. */
const cryptoShim = {
  name: 'node-crypto-shim',
  setup(plugin) {
    plugin.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve(ROOT, 'site/shims/node-crypto.ts'),
    }));
  },
};

/**
 * Les fichiers de test ne font jamais partie d'un bundle navigateur : ils
 * importent `node:fs` et `vitest`, qui n'existent pas dans une page. Tout module
 * `*.test.ts` atteint par le graphe est remplacé par un module vide.
 */
const skipTests = {
  name: 'skip-tests',
  setup(plugin) {
    plugin.onResolve({ filter: /\.test(\.tsx?)?$/ }, (args) => ({ path: args.path, namespace: 'vide' }));
    plugin.onLoad({ filter: /.*/, namespace: 'vide' }, () => ({ contents: '', loader: 'js' }));
  },
};

/** Empreinte du build affichée en pied de page : commit + date, rien d'autre. */
function buildStamp() {
  let sha = 'local';
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    // Dépôt non cloné (archive) : l'empreinte reste « local », ce n'est pas bloquant.
  }
  return `build ${sha} · ${new Date().toISOString().slice(0, 10)} · runs offline, no network call`;
}

function parseArgs(argv) {
  const out = { target: resolve(ROOT, 'dist/site') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out.target = resolve(ROOT, argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

async function main() {
  const { target } = parseArgs(process.argv.slice(2));
  rmSync(target, { recursive: true, force: true });
  mkdirSync(resolve(target, 'assets'), { recursive: true });

  await build({
    entryPoints: [resolve(ROOT, 'src/site/app.ts')],
    outfile: resolve(target, 'assets/site.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: { __BUILD__: JSON.stringify(buildStamp()) },
    // `Buffer` n'existe pas dans une page : le domaine (jeton de session signé)
    // en a besoin, on l'injecte plutôt que de modifier le code produit.
    inject: [resolve(ROOT, 'site/shims/globals.ts')],
    plugins: [cryptoShim, skipTests],
    logLevel: 'warning',
  });

  cpSync(resolve(ROOT, 'site/index.html'), resolve(target, 'index.html'));
  cpSync(resolve(ROOT, 'site/styles.css'), resolve(target, 'styles.css'));
  // Un site statique sans backend : pas de 404 pour les routes inconnues.
  cpSync(resolve(ROOT, 'site/index.html'), resolve(target, '404.html'));

  console.log(`site construit dans ${target}`);
  console.log(`  index.html, styles.css, assets/site.js`);
  console.log(`  ${buildStamp()}`);
}

await main();
