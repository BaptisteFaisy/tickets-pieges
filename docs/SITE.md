# Le site de démonstration public

**URL : <https://baptistefaisy.github.io/tickets-pieges/>** — accessible à tous, sans compte,
sans installation, et sans aucun appel réseau : tout calcule dans le navigateur du visiteur.

## Ce que c'est

Une page qui présente le produit (les trois verrous, les quatre couches, les dix outils MCP,
l'exercice d'alerte, ce qui n'est pas promis) et surtout **douze sections interactives** — une
par feature, un onglet chacune :

| Onglet | Ce qu'on y fait | Modules du domaine appelés |
|---|---|---|
| Détecteur | analyser une des 38 demandes du jeu (ou son propre texte) : origine, C1/C2/C4, constats, suspicion, mode, encadrement | `replay/engine`, `core/*` |
| Ce que le texte cache | décodage prudent puis réanalyse, réducteurs de lien, langue détectée et lexique, homoglyphes, extraction PDF/OOXML, part non analysée | `core/decode`, `langues`, `homoglyphs`, `platform/extract*`, `core/unanalyzed` |
| Session contaminée | jeton signé HMAC (signer, vérifier, altérer), TTL, budget de gestes, quarantaine, audit, agent en boucle | `core/session*` |
| Sas de sortie | données d'un autre client, DLP (IBAN, carte, SIRET, NIR, jetons), masquage réversible, débit, notification, pièces sortantes, mode red team | `core/outbound*`, `dlp`, `redaction`, `drafts` |
| Les dix outils MCP | appeler chaque outil dans la page, JSON brut + lecture humaine, preuve que les GET n'écrivent rien | `mcp/*` |
| Hook et clients d'agents | config générée pour Claude Code, Cursor, Copilot, Cline, ZeroClaw (copiable), réponses `PostToolUse`/`PreToolUse` réelles, cycle du jeton, limites du §11 | `hook/*` |
| Campagnes et hérédité | regroupement par empreinte, recopie d'un texte externe par un interne, héritage vers ticket lié ou cloné | `core/campaigns`, `fingerprint`, `inheritance` |
| Exercice d'alerte | ticket témoin, consigne unique, appât, profondeur d'obéissance, planning, journal à hash chaîné vérifiable | `core/canary*`, `lure` |
| Exposition | rapport, score 0-100 et ses pondérations, avant/après, obéissance par assistant, exports CSV/JSON locaux | `core/exposure`, `scores`, `exports`, `assistants` |
| Précision et réglages | précision par règle, calibration bornée, tentative de corrompre le détecteur, drapeaux par projet | `core/precision`, `autotune`, `flags` |
| Banc de détection | corpus navigable, métriques par règle, fuzzing (5 mutations), mode shadow, scénario Cato 2025 | `bench/*` |
| Mesures de terrain | fenêtre d'exposition instrumentée étape par étape, budgets du §21 tenus ou non, débit — en distinguant ce qui est mesuré ici de ce qui reste à mesurer sur site | `core/timing`, `replay/engine` |

Bilingue : le bouton **FR / EN** en haut à droite bascule toute la page, y compris les libellés
des rapports (les catalogues du produit sont les mêmes que dans l'app).

## Le site n'a aucune logique propre

C'est la règle du dépôt (`docs/ARCHITECTURE.md` §1) poussée jusqu'au bout : la page appelle
`replaySample()` de `src/replay/engine.ts`, donc **le même code** que le banc d'essai en ligne
de commande (`node tools/replay.mjs`) et que l'app Forge. Rien n'est recopié, rien n'est
réimplémenté : une règle ajoutée au domaine apparaît aussitôt sur le site.

Deux écarts au navigateur, tous les deux comblés par des shims plutôt qu'en modifiant le
domaine :

- `node:crypto` (`src/core/hashing.ts`, et `src/core/session-token.ts` pour le jeton signé) :
  `site/shims/node-crypto.ts` fournit SHA-256, **HMAC-SHA256**, comparaison à temps constant et
  octets aléatoires en TypeScript pur ;
- `Buffer`, absent d'une page et utilisé par le jeton de session en `base64url` :
  `site/shims/globals.ts` en fournit un minimal (utf8, hex, base64, base64url), injecté par
  esbuild (`inject:`).

`src/site/crypto-shim.test.ts` vérifie que ces shims produisent **exactement** les mêmes
empreintes, MAC, encodages et comparaisons que Node — sinon les campagnes (§14), les
identifiants stables de constat (§6) et les jetons de session (#23) dériveraient entre le site
et l'app.

## Reconstruire et republier

```bash
node tools/build-site.mjs                 # → dist/site/ (index.html, styles.css, assets/demo.js)
node tools/build-site.mjs --out /tmp/x    # autre dossier de sortie

# publication : la branche gh-pages porte le site construit, jamais édité à la main
rm -rf /tmp/pub && mkdir -p /tmp/pub && cp -r dist/site/. /tmp/pub/ && touch /tmp/pub/.nojekyll
cd /tmp/pub && git init -q -b gh-pages . && git add -A \
  && git commit -q -m "Site de démonstration construit" \
  && git remote add origin https://github.com/BaptisteFaisy/tickets-pieges.git \
  && git push -q -f origin gh-pages
```

GitHub Pages sert la branche `gh-pages` à la racine (réglage déjà posé :
`gh api repos/BaptisteFaisy/tickets-pieges/pages`). `.nojekyll` évite le traitement Jekyll,
`404.html` est une copie de la page : le site n'a qu'une route.

Le build n'exige **aucun réseau** (esbuild et le domaine sont dans `node_modules`) et prend
quelques secondes. `dist/` est ignoré par git : seule la branche `gh-pages` porte le résultat.

## Vérifier que la page publique fonctionne

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://baptistefaisy.github.io/tickets-pieges/
google-chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=10000 \
  --dump-dom https://baptistefaisy.github.io/tickets-pieges/ | grep -c 'donnee-'
```

Le premier doit rendre `200` ; le second doit compter au moins un bloc encadré : c'est la
preuve que le domaine s'exécute bien dans le navigateur et que la première demande d'exemple
a été analysée au chargement. Pour chaque onglet, l'ancre `#<id>` doit rendre la section :

```bash
for id in detector content sessions outbound mcp hook campaigns canary exposure tuning bench timing; do
  google-chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=9000 \
    --dump-dom "https://baptistefaisy.github.io/tickets-pieges/#$id" | wc -c
done
```

Mesuré le 12 novembre 2026 sur le build `1b37c1e` : `200`, **12 onglets**, les 12 sections
rendues (DOM de 23 à 43 Ko), 4 blocs encadrés sur le détecteur, **0 erreur JavaScript**, aucune
requête sortante, 1211 tests verts côté dépôt.
