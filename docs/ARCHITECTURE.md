# Architecture — Tickets piégés

Référence : `docs/CAHIER-DES-CHARGES.md` (§18 architecture, §19 données, §20 contraintes).

## 1. Trois couches, une règle

```
┌──────────────────────────────────────────────────────────────────────┐
│  src/ui/  src/resolvers/  src/mcp/  src/jobs/        GLUE (Forge)     │
│  écrans, outils MCP, événements, file, tâches planifiées, hook        │
└───────────────▲──────────────────────────────────────▲───────────────┘
                │ appels                              │ contrats
┌───────────────┴────────────────┐   ┌─────────────────┴───────────────┐
│  src/core/      DOMAINE PUR    │   │  src/platform/      I/O         │
│  aucune importation @forge/*   │   │  schema.ts (contrats)           │
│  aucune entrée-sortie          │   │  db.ts (Forge SQL)              │
│  testable sans site Jira       │   │  memory.ts (double de test)     │
└────────────────────────────────┘   │  jira.ts jsm.ts llm.ts log.ts   │
                                     └─────────────────────────────────┘
```

**La règle : le domaine ne connaît pas la plateforme.** `src/core/*` reçoit des
objets simples (`SegmentSource`, `ProjectSettings`, `Finding`…) et rend des
décisions. Il n'importe jamais `@forge/api`, `@forge/sql`, `@forge/llm` ; il ne
lit ni l'heure ni le réseau (l'horloge est injectée, `Clock` dans
`src/platform/schema.ts`). Tout ce qui est mesurable du produit — origine,
détection, encadrement, neutralisation, sas, campagnes, exercice — est donc
testé en unitaire, sans site Atlassian.

Le glue (`src/jobs/`, `src/mcp/`, `src/resolvers/`, `src/ui/`) est le seul à
parler au `Store` et aux ports Jira/modèle. Il reste mince : lire, appeler le
domaine, écrire, journaliser.

## 2. Contrats partagés

| Fichier | Rôle | Qui le modifie |
|---|---|---|
| `src/core/types.ts` | tous les types du domaine (§4 à §17) | une PR dédiée, déclarée |
| `src/platform/schema.ts` | tables (§19), `Store`, ports `JiraPort` / `ModelPort` / `Clock` | une PR dédiée, déclarée |
| `src/platform/memory.ts` | `Store` en mémoire : tests et banc d'essai | une PR dédiée, déclarée |
| `src/core/i18n.ts` | assemblage des catalogues, `t()` | tronc |
| `src/core/catalog/*.ts` | textes visibles, un fichier par domaine | le lot concerné |
| `src/core/hashing.ts` | empreintes, identifiants aléatoires, shingles | tronc |
| `src/mcp/result.ts` | enveloppe `{ ok, data \| error, warnings }` des outils | tronc |
| `src/platform/http.ts` | types `webtrigger` | tronc |
| `manifest.yml` | modules, actions, écrans, permissions | tronc (une PR à la fois) |

Ajouter un type partagé se fait dans `types.ts` **avant** de coder le lot qui
l'utilise ; sinon deux lots inventent deux vocabulaires et la fusion coûte plus
cher que le code.

## 3. Déroulement à l'arrivée d'une demande (§18)

```
 événement AVI ──► jobs/triggers ──► 1. origine (core/origin)      ── sans modèle
                                     2. C1 + C2 (core/c1*, core/c2*)── déterministe
                                     3. mise en file pieges-c3      ── C3 différée
                                     4. suspicion + mode du projet  ── core/suspicion
                                     5. journal (platform/log)
```

L'origine et la propriété indexée sont écrites à l'étape 1 : le bandeau est
disponible avant toute lecture par une IA. La couche C3 rend son avis en
quelques secondes par la file (`jobs/consumer.ts`), hors du chemin de
l'événement. Budgets (§21) : origine + C1 + C2 en moins de 2 s, C3 en moins de
30 s, `get-request-safe` en moins de 2 s.

## 4. Les trois verrous dans le code

| Verrou | Modules | Fichiers |
|---|---|---|
| Entrée (§8) | origine, encadrement, neutralisation | `core/origin.ts`, `core/framing.ts`, `core/neutralize.ts` |
| Portée (§9) | outils étroits, session contaminée | `mcp/actions.ts`, `core/session.ts` |
| Sortie (§10) | brouillon interne, sas, contrôle après coup | `core/outbound.ts`, `jobs/triggers.ts` |

Chaque verrou retire un ingrédient de l'attaque (§2) et tient indépendamment des
autres : la panne de la détection ne désarme ni l'origine, ni l'encadrement, ni
le sas.

## 5. Le détecteur est lui-même exposé (§6)

La couche C3 lit le texte hostile. Quatre précautions, toutes dans le code :

1. aucun outil, aucune donnée : le modèle ne reçoit que le passage ;
2. le passage est transmis entre balises à identifiant aléatoire (`randomBlockId`) ;
3. la réponse doit suivre un format fixe, validé par `core/c3model.ts` — une
   réponse non conforme vaut `suspect` (`model-malformed`), jamais `clean` ;
4. C3 peut élever une suspicion, jamais lever un constat C1 ou C2.

Le résultat est gardé par empreinte du texte : la même charge ne repasse pas
devant le modèle (§20 : pas de vecteurs de similarité fournis par la
plateforme, d'où `core/hashing.ts`).

## 6. Stockage (§19)

Forge SQL (`sql: pieges-sql`, moteur mysql). Les tables sont déclarées dans
`src/platform/schema.ts` : `segment`, `issue_state`, `finding`, `verdict`,
`original`, `outbound_check`, `tainted_session`, `canary`, `canary_hit`,
`trust_rule`, `pattern`, `campaign`, `event`, `hook_token`, `draft`,
`settings`.

Deux implémentations du contrat `Store` : `db.ts` (production) et `memory.ts`
(tests, banc d'essai). Une ligne écrite par l'une est lisible par l'autre :
c'est ce qui permet de tester un écran entier sans site Jira.

Les originaux neutralisés (§8.3) sont dans `original` : accès réservé au rôle
sécurité, affichage inerte, restauration en un clic, export avant
désinstallation (§22).

## 7. Rien ne sort (§18, §21)

- L'analyse utilise le modèle hébergé par Forge (`llm: pieges-llm`, famille
  `claude`) : aucun texte de ticket n'est envoyé à un service extérieur.
- Aucun appel réseau hors Atlassian dans le code applicatif. Le hook renvoie vers
  l'app un contenu qui vient du même site.
- La recette (§23.15) vérifie l'absence d'appel sortant pendant l'analyse.

## 8. Tests

| Niveau | Où | Sans réseau |
|---|---|---|
| Domaine | `src/core/*.test.ts` | oui |
| Glue | `src/jobs/*.test.ts`, `src/mcp/*.test.ts` avec `memory.ts` + doubles de `JiraPort` | oui |
| Jeu d'essai | `src/sample/` rejoué par `tools/replay.mjs` | oui |
| Manifeste | `tools/validate_manifest.mjs` | oui |
| Tailles | `tools/check_limits.py` (< 500 lignes / < 50 lignes) | oui |
| Runtime réel | `webtrigger pieges-smoke` sur le site de démonstration | non (§20) |

`vitest` est lancé par la CI ; aucun test ne doit toucher le réseau ni exiger un
site Atlassian.

## 9. Contraintes Forge vérifiées (§20)

- `rovo:mcp` : Preview, un module par app, 50 outils au plus, entrées simples,
  55 s par action. Un agent lancé par automatisation n'appelle que des verbes
  `GET` — d'où les verbes du manifeste.
- Le modèle de Forge traite du texte seulement, sans image, et ne fournit pas de
  vecteurs de similarité.
- La modification au nom de l'app d'une description ou d'un commentaire client
  (modes « étiqueter » et « neutraliser ») est à valider sur le site de
  démonstration ; repli prévu : mode « signaler » seul.
- Repasser un commentaire public en interne par l'API : défaut signalé
  (JSDCLOUD-6050) ; repli : alerte seule.
- Événement d'ajout de pièce jointe : non vérifié à ce jour ; les pièces sont
  relevées sur `issue-updated` et par la tâche planifiée, et marquées
  « non analysées » si le format n'est pas lisible.

L'état de chaque validation est tenu à jour dans `docs/VALIDATIONS.md`.
