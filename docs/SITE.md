# Le site de démonstration public

**URL : <https://baptistefaisy.github.io/tickets-pieges/>** — accessible à tous, sans compte,
sans installation, et sans aucun appel réseau : tout calcule dans le navigateur du visiteur.

## Ce que c'est

Une page qui présente le produit (les trois verrous, les quatre couches, les dix outils MCP,
l'exercice d'alerte, ce qui n'est pas promis) et surtout **un détecteur en ligne** : le visiteur
choisit l'une des 38 demandes du jeu d'essai intégré (§22, en français et en anglais) ou colle
son propre texte, choisit le canal, le type de compte et le mode du projet, et voit le résultat
réel — origine T0 à T3 avec ses raisons, constats par couche avec extrait et résumé neutre,
niveau de suspicion, décision de mode, encart d'étiquetage, et le texte tel qu'un agent le
recevrait (balises à identifiant aléatoire du §8.2).

Bilingue : le bouton **FR / EN** en haut à droite bascule toute la page, y compris les libellés
du rapport (les catalogues du produit sont les mêmes que dans l'app).

## Le site n'a aucune logique propre

C'est la règle du dépôt (`docs/ARCHITECTURE.md` §1) poussée jusqu'au bout : la page appelle
`replaySample()` de `src/replay/engine.ts`, donc **le même code** que le banc d'essai en ligne
de commande (`node tools/replay.mjs`) et que l'app Forge. Rien n'est recopié, rien n'est
réimplémenté : une règle ajoutée au domaine apparaît aussitôt sur le site.

Seul écart au navigateur : `src/core/hashing.ts` importe `node:crypto`, absent d'une page.
`site/shims/node-crypto.ts` fournit les deux gestes utilisés (SHA-256 et octets aléatoires)
en TypeScript pur, et `src/site/crypto-shim.test.ts` vérifie qu'il produit **les mêmes
empreintes** que Node — sinon les campagnes (§14) et les identifiants stables de constat (§6)
dériveraient entre le site et l'app.

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
a été analysée au chargement. Mesuré le 11 novembre 2026 : `200`, 4 occurrences, 36 options
de demandes présentes, aucune erreur JavaScript, aucune requête sortante.
