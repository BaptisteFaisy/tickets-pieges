# Validations — ce qui est prouvé, ce qui reste à prouver

Références : `docs/CAHIER-DES-CHARGES.md` §20 (contraintes et points à valider),
§21 (exigences non fonctionnelles), §22 (cas limites), §23 (recette),
`docs/FORGE.md` §6 (la chaîne à passer), `docs/METHODE.md` §8.

**Règle du fichier** : une validation qui n'est pas écrite ici n'a pas eu lieu.
Tant qu'un point est marqué **à faire**, aucune ligne de code, aucun document et
aucune vidéo ne peut le présenter comme acquis.

## 1. Acquis et mesurés au 11 novembre 2026

Ces mesures ont été prises sur l'arbre de `main`, pas sur une branche de lot.

| # | Ce qui est acquis | Preuve / commande | Mesure |
|---|---|---|---|
| A1 | `forge lint` sans erreur | `npm run lint` | passé, aucune erreur |
| A2 | `forge build` réussi | `npm run build` | build tag `1f423769-0297-4bad-ac3f-6b108fb758ca` |
| A3 | App enregistrée dans Forge | `manifest.yml` (`app.id`) | `ari:cloud:ecosystem::app/6fb8fafb-3d45-4a47-bcac-f5d1cffe4902`, Developer Space « laddition » |
| A4 | Types stricts verts | `npm run typecheck` (`tsc --noEmit`) | passé, 11 novembre 2026 |
| A5 | Tests unitaires posés, verts, sans réseau | `npm test` | 3 fichiers, 22 tests, ~1 s |
| A6 | Règles de taille respectées | `npm run limits` | aucun fichier ≥ 500 lignes, aucune fonction ≥ 50 lignes |
| A7 | Manifeste cohérent (modules ↔ fonctions ↔ ressources) | `npm run manifest` | 23 fonctions, 10 actions, 1 `rovo:mcp`, 1 `rovo:agent`, 1 `rovo:skill` |
| A8 | CI self-hosted verte en moins de 5 minutes par job | `.github/workflows/ci.yml`, `ci-budget.yml` | cadre posé ; budget vérifié par `ci-budget` |
| A9 | Quatre workers d'exécution | `.github/workflows/ci.yml` (labels) | `r630-tickets-pieges-01` à `-04`, label `tickets-pieges-worker` |

**Ce que ces mesures ne disent pas.** Elles portent sur le tronc (manifeste,
types, contrats, catalogues, squelettes, gardes). Elles ne prouvent **aucun**
comportement sur un site Jira : ni l'écriture au nom de l'app, ni le délai
d'analyse, ni le modèle de la couche C3. Le banc d'essai (`npm run replay`) est
en place mais son jeu de données est à venir (lot jeu d'essai) : il affiche
« jeu d'essai absent » et ne mesure rien pour l'instant.

## 2. Contraintes déjà vérifiées sur documentation (rappel du §20)

Reprises du cahier des charges : elles fondent la conception, elles ne
remplacent pas une mesure sur ce site.

| Contrainte | Ce qui est établi | Reste à confirmer sur le site |
|---|---|---|
| L'attaque existe | démonstration Cato Networks (juin 2025) contre un service de support et le serveur MCP d'Atlassian, lue par des comptes rendus concordants | — (fait externe, non rejoué ici) |
| Atlassian reconnaît le risque | note du 26 juin 2025, quatre mesures, déclarées non exhaustives | — |
| Le sujet reste ouvert | note de la Cloud Security Alliance du 14 août 2026, un chemin encore ouvert | — |
| Un hook peut réécrire une sortie d'outil | `PostToolUse` `updatedToolOutput` / `updatedMCPToolOutput` | forme exacte et non-validation du schéma MCP (point V4) |
| Un hook peut demander confirmation | `PreToolUse` `permissionDecision: deny\|ask\|allow` | point V4 |
| Le canal d'une demande est connu | `request-channel-type` : `jira`, `portal`, `anonymousportal`, `email`, `API`, `deployment` | valeurs réelles sur le site, canal d'une demande par courriel |
| Le type de compte est connu | `atlassian`, `app`, `customer` | défaut signalé : un compte d'app présenté comme `atlassian` |
| La visibilité d'un commentaire est connue | drapeau JSM / propriété `sd.public.comment` | point V2 |
| Le modèle de Forge | texte seulement, sans image, sans vecteurs de similarité | point V6 |
| `rovo:mcp` et `Action` | Preview, 50 outils au plus, 55 s par action, `GET` seuls pour une automatisation | point V4 (voisin) |

## 3. Les neuf points à valider par un prototype

Chaque point se termine par **État : `à faire`**. Le passage à « fait » exige
une mesure datée sur le site de démonstration et la commande exécutée.

### V1 — Modifier au nom de l'app la description ou le commentaire d'un client

- **Pourquoi ça se joue** : c'est le socle des modes « étiqueter » et
  « neutraliser » (TP-09, TP-10). Sans ce droit d'écriture, l'app ne peut que
  signaler.
- **Comment on le teste** : sur le site de démonstration, projet de test, mode
  « étiqueter » actif (`jira:projectSettingsPage`), déposer une demande depuis le
  portail, puis
  ```bash
  forge logs --environment development   # trace de l'appel d'écriture
  ```
  et vérifier dans le ticket que l'encart est présent, attribué à l'app, et que
  le texte du client n'est pas perdu. Refaire le geste en mode « neutraliser »
  puis `Restauration` depuis le panneau.
- **Où est le code** : `src/core/neutralize.ts`, `src/core/modes.ts` et
  `src/core/catalog/framing.ts` (à venir, lot entrée, `docs/LOTS.md`) ;
  adaptateurs `src/platform/jira.ts` et `src/platform/jsm.ts` (à venir, lot
  plateforme) ; écran `src/ui/project-settings.tsx` (squelette posé, lot ui).
- **Repli prévu** : mode « signaler » seul — bandeau et propriété indexée, sans
  toucher au texte.
- **État** : `à faire`.

### V2 — Repasser en interne un commentaire public par l'API

- **Pourquoi ça se joue** : c'est le geste « strict » du sas après coup
  (TP-24, §10). Un défaut est signalé sur la modification de cette propriété
  (JSDCLOUD-6050) et un client déjà notifié ne se « dé-notifie » pas.
- **Comment on le teste** : poster un commentaire public sur une demande T1,
  déclencher le contrôle, puis
  ```bash
  # depuis le site : basculer le commentaire en interne via l'appel de l'app
  forge logs --environment development   # vérifier le code de retour et la propriété
  ```
  et vérifier dans le portail client : le commentaire disparaît-il ? Le courriel
  de notification était-il déjà parti ?
- **Où est le code** : `src/core/outbound.ts` (à venir, lot sortie) ;
  adaptateur `src/platform/jsm.ts` (à venir, lot plateforme) ; déclencheur
  `src/jobs/triggers.ts` (squelette posé).
- **Repli prévu** : alerte seule — la sécurité est prévenue, le commentaire
  reste public.
- **État** : `à faire`.

### V3 — Délai réel entre la création et la fin de l'analyse

- **Pourquoi ça se joue** : c'est la fenêtre d'exposition (§18). L'origine et le
  bandeau doivent être en place avant toute lecture par une IA ; la couche C3,
  elle, peut prendre quelques secondes.
- **Comment on le teste** : déposer une demande piégée du jeu d'essai à `T`,
  puis relever dans le journal (`event`) et dans la propriété indexée
  `pieges-analyzed-at` :
  ```bash
  # horodatages côté app, un run par mode
  forge logs --environment development | grep -E "origin|suspicion|analyzedAt"
  ```
  Comparer `T` (création AVI) → origine écrite → C1/C2 rendues → C3 rendue
  (`analyzedAt`). Budget §21 : origine + C1 + C2 < 2 s, C3 < 30 s.
- **Où est le code** : `src/jobs/triggers.ts`, `src/jobs/consumer.ts`
  (squelettes posés, lot jobs) ; table `issue_state` de
  `src/platform/schema.ts` (posée).
- **Repli prévu** : origine et bandeau immédiats, C3 différée sans bloquer le
  reste (déjà l'architecture : file `pieges-c3`).
- **État** : `à faire`.

### V4 — Motif de filtre du hook pour un serveur MCP, forme de la sortie réécrite

- **Pourquoi ça se joue** : c'est TP-19 et tout le §11. Si la réécriture ne
  fonctionne pas, un agent de code lit le texte brut par le serveur MCP
  d'Atlassian.
- **Comment on le teste** : générer le fichier de hooks depuis l'app, l'installer
  sur le poste, appeler un outil de lecture du serveur MCP d'Atlassian sur une
  demande piégée, et vérifier deux choses : que le motif
  `mcp__atlassian__.*` déclenche bien, et que `updatedToolOutput` (ou
  `updatedMCPToolOutput`) remplace la sortie. Puis un `PreToolUse` d'écriture
  publique : `permissionDecision: ask` doit apparaître.
  ```bash
  curl -sS -X POST "https://<installation>.webtrigger.atlassian.app/<chemin>/inbound" \
    -H "Authorization: Bearer $PIEGE_TOKEN" -d @hook-read-sample.json | jq .
  ```
- **Où est le code** : `src/jobs/webhook.ts` (squelette posé, répond 501, lot
  hook) ; `src/hook/config.ts`, `inbound.ts`, `outbound.ts`, `token.ts` (à
  venir, lot hook) ; types `src/platform/http.ts` (posés).
- **Repli prévu** : `additionalContext` seul, sans réécriture — le modèle est
  prévenu, il voit encore le texte brut.
- **État** : `à faire`.

### V5 — Couleur du texte et texte alternatif dans le format de document Atlassian

- **Pourquoi ça se joue** : deux détections de la couche C1 (texte de la couleur
  du fond, texte alternatif d'image) dépendent de ce que le format ADF expose.
- **Comment on le teste** : créer un commentaire contenant (a) un paragraphe
  blanc sur fond blanc et (b) une image dont le texte alternatif porte une
  consigne, puis relire le document par l'API et inspecter les marques :
  ```bash
  curl -sS -u "$ATLASSIAN_USER:$ATLASSIAN_TOKEN" \
    "https://<site>.atlassian.net/rest/api/3/issue/<CLE>/comment" | jq '.comments[].body'
  ```
  Chercher `textColor` / couleur de fond dans les `marks`, et `attrs.alt`.
- **Où est le code** : `src/core/c1-concealment.ts` (à venir, lot c1),
  catalogue `src/core/catalog/detection-c1.ts` (posé).
- **Repli prévu** : couches C2 et C3 seules pour ces deux motifs ; le motif
  reste marqué « non analysé » dans ce que voit l'agent.
- **État** : `à faire`.

### V6 — Le modèle de Forge classe-t-il un texte hostile sans refuser ni se laisser entraîner

- **Pourquoi ça se joue** : c'est la couche C3 (TP-04). Deux échecs possibles :
  le modèle refuse de traiter le texte, ou il obéit à la consigne qu'il lit.
- **Comment on le teste** : sur le site, banc d'essai (`Banc d'essai`,
  `jira:globalPage` route `banc`) ou outil `check-text` sur les charges du jeu
  d'essai — dont une reformulée sans mot du lexique (recette §23.5). Vérifier
  que la réponse respecte le format attendu, que le verdict est rendu, et
  qu'une réponse non conforme vaut « suspect » (recette §23.6).
  ```bash
  npm run replay        # une fois le jeu d'essai livré (lot jeu d'essai)
  ```
- **Où est le code** : `src/core/c3-model.ts` (à venir, lot c3),
  `src/platform/llm.ts` (à venir, lot c3), catalogue
  `src/core/catalog/detection-c3.ts` (posé) ; ressource `pieges-llm` du
  `manifest.yml` (posée).
- **Repli prévu** : couches C1 et C2 seules, verdict humain dans la file des
  suspects.
- **État** : `à faire`.

### V7 — Événement d'ajout de pièce jointe et lecture du fichier dans les limites de Forge

- **Pourquoi ça se joue** : TP-22. Sans événement dédié, les pièces doivent être
  relevées autrement — et si le fichier est illisible, il faut le dire.
- **Comment on le teste** : joindre un PDF texte puis une image à une demande,
  et relever ce qui se déclenche :
  ```bash
  forge logs --environment development | grep -iE "attachment|issue-updated"
  ```
  Puis vérifier la lecture effective du texte du PDF (taille, délai) et que
  l'image est bien marquée « non analysée ».
- **Où est le code** : `src/platform/attachments.ts` (à venir, lot plateforme) ;
  relevé actuel par `src/jobs/triggers.ts` (`issue-updated`) et
  `src/jobs/scheduled.ts` (squelettes posés) ; note du `manifest.yml` §trigger.
- **Repli prévu** : marquer « non analysé », ne rien promettre sur le contenu du
  fichier.
- **État** : `à faire`.

### V8 — Rovo lit-il le contenu affiché dans un panneau d'app

- **Pourquoi ça se joue** : l'original neutralisé est affiché dans l'app ; s'il
  est lisible par une IA, la neutralisation est annulée.
- **Comment on le teste** : neutraliser un passage, puis demander à un agent
  Rovo du site (Rovo Chat) de lire le contenu des panneaux de la demande et de
  recopier ce qu'il trouve. Vérifier qu'il ne rend pas l'original. Refaire
  depuis la page « Originaux conservés » (`route: originaux`), qui est le repli.
- **Où est le code** : `src/ui/issue-panel.tsx`, `src/ui/originals-page.tsx`,
  `src/ui/global-pages.tsx` (squelettes posés, lot ui) ; règle de rôle dans
  `src/core/levels.ts` et `src/core/types.ts` (posés).
- **Repli prévu** : affichage sur une page séparée à accès réservé (déjà prévue
  par le manifeste), panneau sans original.
- **État** : `à faire`.

### V9 — Taux de faux positifs sur un vrai flux de support

- **Pourquoi ça se joue** : c'est l'adoption (§27). Un mode par défaut trop
  bavard fait désactiver l'app en deux semaines.
- **Comment on le teste** : laisser le projet en mode « signaler » sur le site
  de démonstration avec le jeu d'essai chargé, puis compter motif par motif :
  constats levés / verdicts « faux positif » dans la file des suspects, sur au
  moins 30 demandes variées (facturation, IT, réclamations, courriels avec
  signatures).
  ```bash
  # rapport agrégé, une fois les lots exercice et plateforme livrés
  npm run replay -- --report     # cible ; aujourd'hui sans jeu de données
  ```
- **Où est le code** : `src/core/precision.ts` (à venir, lot exercice) ;
  `src/core/findings.ts`, `src/core/suspicion.ts` (à venir, lot constats) ;
  catalogue `src/core/catalog/detection-c4.ts` (posé).
- **Repli prévu** : mode « signaler », règles imprécises rétrogradées en simple
  pondération (§14).
- **État** : `à faire`.

## 4. Tableau de synthèse du §20 (avec état)

| Point | Repli | État |
|---|---|---|
| Modifier, au nom de l'app, la description ou le commentaire d'un client | mode « signaler » seul | `à faire` (V1) |
| Repasser en interne un commentaire public par l'API | alerte seule | `à faire` (V2) |
| Délai réel entre la création et la fin de l'analyse | origine et bandeau immédiats, C3 différée | `à faire` (V3) |
| Motif de filtre du hook MCP, forme de la sortie réécrite | `additionalContext` seul, sans réécriture | `à faire` (V4) |
| Couleur du texte et texte alternatif dans le format ADF | couches C2 et C3 | `à faire` (V5) |
| Le modèle classe-t-il un texte hostile sans refuser ni obéir | C1 + C2, verdict humain | `à faire` (V6) |
| Événement de pièce jointe et lecture du fichier | marquer « non analysé » | `à faire` (V7) |
| Rovo lit-il le contenu d'un panneau d'app | page séparée à accès réservé | `à faire` (V8) |
| Taux de faux positifs sur un vrai flux | mode « signaler », règles rétrogradées | `à faire` (V9) |

## 5. Recette (§23) — une ligne par point

La colonne « geste » est ce qu'on fera au moment de la recette ; aucune ligne
n'est acquise avant d'avoir été jouée sur le site et cochée ici.

| N° | Geste ou commande | Lot qui la rend possible | État |
|---|---|---|---|
| 1 | Déposer la même demande depuis le portail (T1) puis depuis un compte interne (T3) ; lire `pieges-trust` en JQL | origine, plateforme | `à faire` |
| 2 | Déposer une demande depuis le portail anonyme ; vérifier T0 | origine | `à faire` |
| 3 | Charger la charge à caractères invisibles du jeu d'essai ; vérifier un constat C1 **et** zéro appel modèle dans `forge logs` | c1, constats, jeu d'essai | `à faire` |
| 4 | Charger la charge « adresse à une IA » ; vérifier le constat C2 et son résumé neutre | c2, constats | `à faire` |
| 5 | Charger la charge reformulée sans mot du lexique ; vérifier le constat C3 | c3 | `à faire` |
| 6 | Provoquer une réponse non conforme du modèle (charge du jeu d'essai) ; vérifier « suspect » | c3 | `à faire` |
| 7 | `get-request-safe` deux fois sur la même demande ; comparer les identifiants de balise | entrée, mcp | `à faire` |
| 8 | Mode « neutraliser » : le passage disparaît, l'original est lisible par le rôle sécurité, la restauration fonctionne | entrée, ui, plateforme | `à faire` |
| 9 | Interroger « Lecteur prudent » sur une demande piégée ; il résume, n'exécute pas, signale | mcp, ui (agent Rovo du manifeste) | `à faire` |
| 10 | `propose-public-reply` ; vérifier note interne et absence côté client | sortie, mcp | `à faire` |
| 11 | Proposer un brouillon citant la clé d'un autre ticket ; le voir retenu par `check-outbound` | sortie | `à faire` |
| 12 | Suivre la consigne du ticket témoin ; vérifier l'entrée dans le rapport d'exposition, avec type d'acteur | exercice, ui | `à faire` |
| 13 | Faire citer une charge par un client ; vérifier « légitime mais risqué » et encadrement conservé | constats, exercice | `à faire` |
| 14 | Charger trois demandes à charge identique ; vérifier une campagne et une alerte | constats (campagnes : hérédité) | `à faire` |
| 15 | Pendant l'analyse, surveiller les appels sortants (`forge logs`, aucune URL hors Atlassian) | jobs, plateforme | `à faire` |

## 6. Comment ce fichier se tient à jour

1. Une mesure faite se note **le jour même** ici et dans la note mémoire du
   jour (`docs/FORGE.md` §6), avec la commande et le résultat.
2. Un point passe à « fait » quand la mesure est reproductible sur le site de
   démonstration — pas quand le code est fusionné.
3. Un point qui échoue reste `à faire` et son repli est activé ; le repli activé
   se dit dans l'interface (§21 : ce qui n'a pas été analysé est affiché).
4. La recette (§23) ne se coche qu'en entier, dans l'ordre, sur une installation
   neuve : c'est ce que verra un juge.

## 7. Ce qui est mesuré à ce jour (11 novembre 2026, au soir)

Ce qui suit est **mesuré**, pas supposé. Chaque ligne donne la commande et le
résultat obtenu.

### Chaîne Forge réelle

| Étape | Commande | Résultat |
|---|---|---|
| Enregistrement de l'app | `forge create --template blank` (pseudo-TTY) | `ari:cloud:ecosystem::app/6fb8fafb-3d45-4a47-bcac-f5d1cffe4902`, Developer Space « laddition » |
| Lint | `forge lint` | `No issues found` |
| Build | `forge build` | `Build successful` (tag `00a6500d-85f3-4898-814b-e6c859bf0cb8`) |
| Déploiement | `forge deploy --non-interactive -e development` | `✔ Deployed` — **manifeste validé par la plateforme**, pas seulement par le linter |
| Installation | `forge install --site one-atlas-cndz.atlassian.net -p jira -e development --confirm-scopes` | `✔ Install in Jira complete!` |

Le site de démonstration est `one-atlas-cndz.atlassian.net` (Jira + JSM).
L'installation a accepté les neuf scopes déclarés, dont
`read:request:jira-service-management`, `read:organization:jira-service-management`
et `storage:app`.

### Chaîne locale et CI

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` (strict) | aucune erreur |
| `npx vitest run` | **572 tests verts**, 46 fichiers, aucun réseau |
| `python3 tools/check_limits.py` | tous les fichiers < 500 lignes, toutes les fonctions < 50 lignes |
| `node tools/validate_manifest.mjs` | manifeste cohérent : 23 fonctions, 5 déclencheurs, 1 file, 2 tâches planifiées, 10 actions, 1 agent Rovo, 1 skill, 1 serveur MCP, 4 webtriggers, 1 SQL, 1 LLM |
| `node tools/replay.mjs` | **38 demandes rejouées hors ligne** (les 19 familles du §22, en français et en anglais) |
| CI self-hosted | checks `ci`, `ci-budget`, `couche0` verts ; 4 workers `r630-tickets-pieges-01..04` |
| File de merge | 18 lots fusionnés par la file Mergify, **aucun push direct sur `main`** après l'amorce |

### Ce que le banc d'essai prouve déjà, hors ligne

Les points 1, 2, 3, 4, 7, 8 et 15 de la recette §23 sont joués par
`node tools/replay.mjs` sans site Atlassian : origine T0/T1/T3, constat C1 sans
modèle, constat C2 avec résumé neutre, identifiant de balise propre à chaque
bloc et à chaque appel, déclenchement du mode « neutraliser » au-dessus du
seuil, et absence d'appel réseau. Les points 5, 6, 9 à 14 exigent le modèle
hébergé, un écran ou un agent Rovo : ils ne se cochent que sur le site.

### Ce qui reste à mesurer sur le site

Les neuf points du §20 (tableau de synthèse plus haut) et les points 5, 6 et 9 à
14 de la recette §23. Le chemin est tracé : l'app est déployée et installée, le
`webtrigger` de diagnostic (`pieges-smoke`) est déclaré au manifeste — son URL
s'obtient par `forge webtrigger list -e development --site one-atlas-cndz.atlassian.net`
(commande interactive : elle exige un TTY), puis le jeu d'essai se dépose depuis
le portail pour déclencher de vrais événements.

## 8. Ce qui a été mesuré sur un site live (12 novembre 2026)

L'app a été **déployée et installée** sur `one-atlas-cndz.atlassian.net`
(Jira **et** Confluence, environnement de développement, v3.1.0), puis nourrie de
**données live** : les 19 demandes françaises du jeu d'essai semées sur le service
desk SECOPS. Le détail, les commandes et les cinq défauts trouvés au passage sont
dans [`docs/DEMO-LIVE.md`](DEMO-LIVE.md).

| Mesure | Résultat |
|---|---|
| demandes propagées par les déclencheurs | **19 / 19** — la propriété `pieges` est écrite sur chacune |
| conformes à l'attendu du jeu (origine + suspicion) | **14 / 19** ; les 5 écarts sont tous caractérisés (3 limites de reproduction du geste, 1 différence de niveau, 1 portée de C3) |
| couche C3 (modèle hébergé) | **tourne** : la consigne reformulée sans mot du lexique (`fr-11`) passe de `clean` à `review` sur le ticket |
| couche C1 | joue : caractères invisibles, bidi, bloc encodé — les trois sont `suspect` sur le ticket |
| couche C2 | joue : consigne à un assistant, faux marqueur de système, action sur d'autres tickets — `suspect` sur le ticket |
| origine | T1 pour une demande de client du portail, **T3 pour une demande d'agent interne** |
| erreurs REST / SQL dans les journaux | **aucune** après les correctifs (avant : 415, 1064, 400, quota) |

Ce qui reste à mesurer sur le site, et n'est donc **pas** coché : les fenêtres
de délai (création → origine, → C3), le débit au-delà des 19 demandes, et les
points du §20 qui exigent un agent Rovo réel (le « Lecteur prudent » de la
démo).
