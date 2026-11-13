# Démo live — environnement, données, et ce qui a été mesuré

> Le site de démonstration public rejoue le **code** du produit dans un navigateur.
> Cette page décrit l'autre moitié : l'**app Forge réellement déployée**, installée
> sur un site Jira Service Management, nourrie de **données live**, et mesurée.
>
> Aucun jeton n'est dans ce dépôt ; le jeton API est lu depuis un fichier local
> (`~/.atlassian-api-token`, jamais versionné).

## 1. Les environnements

| Environnement | Forge | Rôle | État mesuré |
|---|---|---|---|
| **development** | `forge deploy -e development` | l'app de travail, celle qui reçoit les événements | déployée (v3.1.0), installée sur `one-atlas-cndz.atlassian.net` **en Jira et en Confluence** |
| staging | `forge deploy -e staging` | avant promotion | non déployé à ce jour |
| production | `forge deploy -e production` | la version submitted au Marketplace | non déployé à ce jour |

L'installation en **development** est un avertissement de la plateforme : « You
are about to install a development app to a production site ». C'est voulu pour la
démo (le code du jour, les données du jour) ; la promotion en production reste
à faire avant toute soumission.

Changer de version majeure (ajout de scope) demande une approbation :
`forge deploy --approve MAJOR_VERSION_RULE`.

## 2. Les données live

Le jeu d'essai intégré (**38 demandes**, 19 familles en français et en anglais)
est semé tel quel sur le service desk **SECOPS** (`Security Operations`) du site
de démonstration, via l'API Service Desk :

```bash
python3 scripts/seed-demo-site.py --site one-atlas-cndz.atlassian.net \
  --email moi@example.com --service-desk 11 --request-type 142 \
  --customer <accountId> --lang fr            # --dry-run pour lister, --only <id> pour une
```

Le script est **idempotent** (relancer ne recrée pas) et il écrit ce qui ne peut
pas être reproduit avec un jeton d'admin : un canal anonyme, un courriel d'inconnu,
un compte d'intégration, un commentaire de client. Ces divergences sont **dites**
dans `out/demo-seed-<lang>.json`, jamais silencieuses.

| Cas du jeu | Geste réel | Fidélité |
|---|---|---|
| compte client du portail | `POST /rest/servicedeskapi/request` avec `raiseOnBehalfOf` | **exacte** (auteur client, canal portail) |
| agent interne (T3) | même appel sans `raiseOnBehalfOf` | **exacte** (auteur Atlassian) |
| portail anonyme, courriel, compte d'app | impossible avec un jeton d'admin | demande créée en portail, **divergence signalée** |
| commentaire de client | posé par l'admin | auteur interne, **divergence signalée** |
| pièce jointe | non téléversée par le script | le ticket est sans pièce, **divergence signalée** |

## 3. La recette jouée sur le site

```bash
python3 scripts/verify-demo-site.py --site one-atlas-cndz.atlassian.net \
  --email moi@example.com --lang fr
```

Le script relit la propriété indexée `pieges` **par REST** — ce que voit un
humain dans l'interface — et la compare à l'attendu du jeu d'essai.

**Mesuré le 12 novembre 2026, sur les 19 demandes françaises semées
(`SECOPS-205` à `SECOPS-223`) :**

| Mesure | Résultat |
|---|---|
| demandes propagées par les déclencheurs | **19 / 19** (propriété `pieges` écrite sur chacune) |
| conformes à l'attendu du jeu (origine + suspicion) | **14 / 19** |
| écart 1 — `fr-02-anonyme` | T0 attendu, T1 obtenu : **canal anonyme non reproductible** |
| écart 2 — `fr-10-exfiltration` | `review` obtenu au lieu de `suspect` : l'URL est bien détectée (C2-05), le niveau diffère |
| écart 3 — `fr-15-repartie` | `clean` au lieu de `review` : la charge est répartie sur trois commentaires, et **C3 ne voit qu'un segment à la fois** — limite réelle du produit |
| écart 4 — `fr-17-integration` | T1 obtenu au lieu de T0 : **compte d'app non reproductible** |
| écart 5 — `fr-19-langue-rare` | `review` obtenu au lieu de `clean` : **le modèle a trouvé la charge en langue rare**, mieux que l'attente prudente du jeu |

Les écarts qui ne relèvent pas du geste (niveaux, portée de C3, détection plus
forte que prévu) sont **des décisions à traiter**, pas des anomalies à cacher : le
niveau de l'exfiltration, la lecture du fil entier par C3, et le fait qu'un jeu
d'essai prudent sous-estime le modèle.

### 3.1 Re-déclencher avant de mesurer (après chaque déploiement)

Les demandes semées portent l'état calculé par la version **précédente** :
`verify-demo-site.py` le relit tel quel, on mesure donc l'ancien code. Après un
`forge deploy`, il faut provoquer une nouvelle analyse.

```bash
python3 scripts/retrigger-demo-site.py --site one-atlas-cndz.atlassian.net \
  --email moi@example.com --lang fr          # --dry-run pour lister, --keys pour cibler
```

Le geste est **une étiquette ajoutée** (`pieges-retrigger-<horodatage>`) : c'est
une action utilisateur, donc `avi:jira:updated:issue` part et l'app relit le
ticket. Deux pièges mesurés le 13 novembre 2026 : l'endpoint
`/rest/api/3/issue/{clé}/labels` n'existe pas partout (404), et le `PUT` sur le
ticket **remplace** la liste d'étiquettes — le script relit les étiquettes
existantes avant d'ajouter la sienne. Compter ~30 s par segment (file C3) avant
de relancer la vérification.

### 3.2 Mesuré le 13 novembre 2026 (production v2.4.0, 19 demandes re-déclenchées)

| Mesure | Résultat |
|---|---|
| conformes à l'attendu du jeu | **15 / 19** (contre 14 / 19 le 12) |
| `fr-10-exfiltration` | **fermé** : `suspect` (les formes « envoyez » / « appelez » sont reconnues par C2-05) |
| `fr-15-repartie` | **fermé** : `review` (le fil de commentaires est relu par C3) |
| `fr-13-mentions` | écart **assumé** : mention légale pleine d'impératifs, le modèle la prenait pour une consigne |
| `fr-19-langue-rare` | écart **assumé** : le modèle lit l'espéranto, mieux que l'attendu prudent |
| `fr-02`, `fr-17` | écarts de **geste** : canal anonyme et compte d'intégration non reproductibles avec un jeton d'admin |

Pour `fr-13`, la réponse du §14 est la liste de formules à ignorer du projet.
Elle est désormais appliquée **avant la lecture par modèle** : un passage
intégralement couvert n'est pas soumis au modèle et ne lève aucun constat, et
un pied de page collé à une vraie demande en est retiré (le modèle voit
`[passage ignoré]`). Les défauts livrés avec l'app couvrent les pieds de page
d'entreprise français et anglais les plus courants ; un projet ajoute les siens
dans la page de réglages.

**Mesuré deux fois (production v2.7.0 puis v2.8.0) : `fr-13` reste `review`.**
Le pied de page n'est plus lu, mais le modèle doute sur ce qui reste : « merci
de mettre à jour mon adresse de facturation » lui ressemble à une consigne, ou il
répond « uncertain » — et le doute profite à la protection (§6). Deux affinage
du prompt ont été tentés et mesurés : le critère de cible (v2.7.0) puis deux
exemples (v2.8.0). Aucun ne change le verdict du modèle hébergé ; aucun ne
casse `fr-11` ni `fr-19`. L'écart reste donc **assumé**, comme `fr-19` : ce
n'est pas un défaut de la liste d'exceptions, c'est la prudence du modèle sur une
demande légitime — et on n'affaiblit pas la détection pour faire du chiffre.

## 4. Ce que le site live a révélé (et que rien d'autre ne montrait)

Cinq défauts que ni `forge lint`, ni `tsc`, ni les 1226 tests ne montraient,
parce qu'ils n'existent que sur Forge :

| Défaut | Symptôme sur le site | Correctif |
|---|---|---|
| `precision` est un **mot réservé** MySQL/TiDB | `ER_PARSE_ERROR 1064` : **aucune table créée**, aucun déclencheur ne pouvait rien écrire | colonne `rule_precision` |
| `Content-Type` absent sur les écritures REST | `415 Unsupported Media Type` : la propriété indexée n'était jamais écrite | en-tête posé au point d'entrée commun |
| corps de propriété enveloppé dans `value` | `value.value` : la propriété était illisible | le corps est stocké tel quel |
| `Queue.push` en forme `resolver` + `method` | `400 Bad Request` : **la couche C3 ne tournait jamais** | consumer en forme « fonction simple » |
| schéma recréé à chaque invocation | « Limits for the current installation have been exceeded » (Forge SQL) | une **lecture** suffit à savoir si le schéma existe |

Plus deux corrections de fond, trouvées par la comparaison automatique entre le
jeu d'essai et le site :

- **trois appelants n'assemblaient pas la même détection** (banc, production,
  site) → `src/core/detect.ts` est désormais le point d'entrée unique ;
- **un compte Atlassian cloud moderne était classé « compte d'app »** (préfixe de
  tenant), donc les tickets internes semblaient venir d'une intégration (T0 au
  lieu de T3).

## 5. Le déroulé d'une démonstration (sans vidéo)

1. Ouvrir <https://tradoooo.github.io/tickets-pieges/> — le code du
   produit, hors ligne, douze sections.
2. Ouvrir `https://one-atlas-cndz.atlassian.net/jira/software/projects/SECOPS/boards` —
   les **19 demandes du jeu**, semées pour de vrai.
3. Ouvrir une demande hostile (`SECOPS-211`, consigne adressée à une IA) et
   montrer le **panneau de l'app** : origine T1, niveau de suspicion, constats
   avec extrait et résumé neutre.
4. Ouvrir la **file des suspects** : les demandes classées, regroupées par campagne.
5. Montrer la **propriété indexée** en JQL :
   `"pieges-trust" = "T1" and "pieges-suspicion" = "suspect"`.
6. Appeler les **outils MCP** depuis un agent, ou le panneau Rovo « Lecteur
   prudent » sur la même demande.
7. Lancer un **exercice d'alerte** (rôle sécurité) et montrer l'entrée dans le
   rapport d'exposition.

## 6. Ce qui reste avant la soumission

- déployer en **production** et réinstaller (la version de développement n'est pas
  ce qu'un juge installera) ;
- semer le jeu **anglais** (`--lang en`) pour que la démo soit bilingue ;
- téléverser une vraie pièce jointe (le cas `fr-18-image` n'a pas de fichier) ;
- traiter les trois écarts de fond : le niveau de l'exfiltration, la lecture du
  fil entier par C3, et l'attente du jeu d'essai sur la langue rare ;
- mesurer les **fenêtres de délai** sur le site (création → origine, → C3) et
  consigner les chiffres dans `docs/MESURES.md` ;
- enregistrer la **vidéo** (hors périmètre de cette demande).
