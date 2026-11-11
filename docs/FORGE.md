# Contraintes Forge vérifiées — à lire avant d'écrire un adaptateur

Ce fichier rassemble les contraintes **mesurées sur un déploiement réel** (apps
sœurs du même atelier, novembre 2026) et non devinées. Un lot qui écrit dans
`src/platform/`, `src/jobs/` ou `src/ui/` les respecte ; un lot qui écrit dans
`src/core/` (domaine pur) n'en a pas besoin — c'est tout l'intérêt de la
séparation.

## 1. Bundler et TypeScript

- **Imports sans extension.** Webpack (le bundler Forge) ne résout pas `./x.js`
  vers `x.ts`. Écrire `from './origin'`, jamais `from './origin.js'`.
- **`tsconfig` sans `noEmit: true`** : le bundler échoue avec « TypeScript
  emitted no output ». Le `--noEmit` se passe en ligne de commande
  (`npm run typecheck`), pas dans le fichier.
- **`@forge/sql` importé statiquement.** Un import dynamique à spécificateur
  variable déclenche « Critical dependency » au build.
- Les ressources `resources[].path` du manifeste pointent vers le fichier
  d'entrée de l'écran (`.tsx`) ; vérifier avec `forge lint` après tout ajout.

## 2. Forge SQL (moteur mysql = TiDB)

- **`LIMIT ?` lié → `ERROR 1210 Incorrect arguments to LIMIT`.** La limite
  s'inline après coercion entière : `` `LIMIT ${Math.max(1, n | 0)}` ``.
- Le schéma se crée explicitement : un `defineSchemaOnce()` jamais appelé laisse
  les tables absentes (panne silencieuse au premier `SELECT`).
- Les colonnes `TEXT`/`JSON` se lisent en chaîne : sérialiser soi-même
  (`payload_json`), ne pas compter sur un typage automatique.

## 3. File d'événements (`@forge/events`)

- Le `consumer` reçoit un **`AsyncEvent { body, jobId, … }`**, pas le message nu.
  Lire `payload.body` (ou le champ équivalent selon la version) — un
  `versionId: undefined` vient de là.
- La production passe par `new Queue('<nom>')` avec un `body` sérialisable.

## 4. Modèle hébergé (`@forge/llm`)

- La réponse arrive en **blocs** `content: [{ type: 'text', text }]` et pas
  seulement en chaîne : un code qui ne gère que `typeof content === 'string'`
  lit du vide.
- Le modèle choisi à l'exécution par `list()` peut changer (ex.
  `claude-haiku-4-5`) : ne jamais coder en dur un nom de modèle.
- Un vrai modèle renvoie du prose et du markdown : séparer les violations
  **dures** (format absent, identifiant inconnu → rejet) des écarts **souples**
  (mise en forme → nouvelle tentative puis acceptation). Une vérification trop
  stricte jette une réponse juste (§6 du cahier : une réponse non conforme vaut
  « suspect », pas « sain »).
- Les listes de jetons dans une réponse se découpent (`"SUP-1, SUP-2"` = deux
  jetons), sinon un contrôle d'appartenance rejette à tort.

## 5. CLI Forge

- Les invites du CLI exigent un **TTY** : piloter avec `script -qec` et une FIFO
  si l'on répond de façon automatisée.
- `forge lint` exige `app.id`. Une app neuve s'enregistre par
  `forge register "<nom>"` (ou `forge create` pour un squelette neuf) ; l'identifiant
  écrit dans `manifest.yml` est ensuite versionné.
- `forge install --demo-site` crée un site de démonstration gratuit (90 jours,
  données réalistes) — c'est le site de la recette §23 et des juges §25.

## 6. Ce que seul le déploiement réel révèle

Un projet « 100 % vert en local » n'est pas fini : la base SQL, la file, le
format de réponse du modèle et les limites du runtime ne se voient que sur un
site. La chaîne à passer avant de déclarer une validation acquise :

```bash
forge lint && forge build && forge deploy && forge install   # puis le webtrigger smoke
```

Chaque mesure se note dans `docs/VALIDATIONS.md` (§20 du cahier) **et** dans la
note mémoire du jour : une validation qui n'est pas écrite n'a pas eu lieu.

## 7. Points encore à valider pour ce produit (§20 du cahier)

| Point | Pourquoi | Repli |
|---|---|---|
| Modifier au nom de l'app la description ou un commentaire client | fonde les modes « étiqueter » et « neutraliser » | mode « signaler » seul |
| Repasser un commentaire public en interne par l'API | défaut signalé (JSDCLOUD-6050) | alerte seule |
| Délai réel création → fin d'analyse | fenêtre d'exposition | origine et bandeau immédiats, C3 différée |
| Motif de filtre du hook pour un serveur MCP, forme de la sortie réécrite | fonde TP-19 | `additionalContext` seul, sans réécriture |
| Couleur du texte et texte alternatif dans le format de document Atlassian | couche C1 | couches C2 et C3 |
| Le modèle classe-t-il un texte hostile sans refuser ni se laisser entraîner | couche C3 | C1 + C2, verdict humain |
| Événement d'ajout de pièce jointe, lecture du fichier dans les limites Forge | TP-22 | marquer « non analysé » |
| Rovo lit-il le contenu affiché dans un panneau d'app | l'original conservé ne doit pas y être lu | page séparée à accès réservé |
| Taux de faux positifs sur un vrai flux de support | adoption | mode « signaler », règles rétrogradées |
