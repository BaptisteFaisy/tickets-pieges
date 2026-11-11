# Méthode — comment le produit est construit, et pourquoi

Références : `docs/CAHIER-DES-CHARGES.md` (le produit), `docs/ARCHITECTURE.md`
(le code), `docs/LOTS.md` (qui écrit quoi), `docs/PIPELINE.md` (la chaîne de
fusion), `docs/FORGE.md` (contraintes mesurées), `docs/VALIDATIONS.md` (ce qui
reste à prouver).

Ce document explique les choix de construction. Il dit aussi ce qui n'est pas
encore fait : au 11 novembre 2026, le tronc (manifeste, types, contrats,
catalogues, squelettes) est posé et la CI est verte ; les lots de code
fonctionnel sont à venir (`docs/LOTS.md`).

## 1. Le principe : trois verrous indépendants, pas un détecteur

L'attaque (§2 du cahier) a besoin de trois ingrédients réunis : l'IA lit un
contenu non fiable, elle atteint des données privées, et un canal lui permet de
renvoyer ces données vers l'extérieur. Le produit retire chaque ingrédient par
un verrou distinct :

| Verrou | Ingrédient retiré | Moyen |
|---|---|---|
| **Entrée** (§8) | le contenu non fiable pris pour une consigne | origine T0-T3, encadrement, neutralisation |
| **Portée** (§9) | l'IA atteint des données sans rapport | outils limités au ticket en cours, session contaminée |
| **Sortie** (§10) | l'IA renvoie des données dehors | brouillon interne, sas, validation humaine |

**Pourquoi indépendants.** Aucun des trois ne suppose les autres en état de
marche. La détection peut être aveuglée : l'origine, l'encadrement et le sas
continuent de fonctionner. Un verrou qui cède ne fait pas tomber les deux
autres. C'est la différence avec un simple antivirus de texte, dont la panne
désarme tout.

**Ce que cela coûte.** Le mode par défaut est « signaler » : rien ne change
dans le ticket, seul un bandeau prévient l'agent. Les modes qui modifient le
ticket (« étiqueter », « neutraliser ») sont des choix explicites par projet,
réversibles et journalisés (§7 ci-dessous).

## 2. Ce que la détection ne promet pas

Le produit ne promet **jamais** une détection complète, et l'interface le dit :

- Une charge bien écrite, sans rien de caché, dans une langue rare, **passera**.
  Les couches C1 (dissimulation) et C2 (lexiques fr/en) sont déterministes mais
  bornées ; la couche C3 (modèle) est probabiliste ; la couche C4 pondère.
  Aucune n'est exhaustive.
- Le texte dans une image n'est pas analysé : le ticket est marqué « image non
  analysée » (§22 du cahier). Chaque ticket affiche ce qui a été analysé et ce
  qui ne l'a pas été (§21).
- Entre la création d'une demande et la fin de l'analyse, il existe une fenêtre
  de quelques secondes pendant laquelle une IA peut déjà avoir lu le texte
  (§18). L'origine et le bandeau, eux, sont écrits dès l'étape 1.
- Le détecteur est lui-même exposé : la couche C3 lit du texte hostile. Quatre
  précautions (§6) : pas d'outil, balises à identifiant aléatoire, format de
  réponse vérifié (non-conforme = « suspect », jamais « sain »), C3 ne lève
  jamais un constat C1/C2.

**Règle de vocabulaire, partout** (§21) : l'app « réduit le risque », elle ne
« protège » pas. Un message qui dirait « ce ticket est sûr » est un défaut.
Cette règle vaut pour l'interface, les documents, la vidéo et la note de
soumission — y compris ce fichier.

C'est précisément parce que la détection est faillible que le produit ne repose
pas sur elle : l'origine est calculée sans modèle, à partir de faits que Jira
connaît (type de compte, organisation, canal, domaine, visibilité) ;
l'encadrement traite tout texte externe comme une donnée quel que soit le
verdict ; le sas contrôle les sorties même d'un texte déclaré sain.

## 3. Séparation domaine pur / plateforme

La règle d'architecture tient en une phrase : **le domaine ne connaît pas la
plateforme** (`docs/ARCHITECTURE.md` §1).

- `src/core/*` — le domaine pur : aucune importation `@forge/*`, aucune
  entrée-sortie, ni heure ni réseau (l'horloge est injectée, contrat `Clock`
  dans `src/platform/schema.ts`). Tout ce qui est mesurable du produit y vit :
  types (`src/core/types.ts`, `src/core/types-flow.ts`), niveaux
  (`src/core/levels.ts`), empreintes et identifiants aléatoires
  (`src/core/hashing.ts`), textes visibles (`src/core/i18n.ts` et
  `src/core/catalog/*.ts`).
- `src/platform/*` — les entrées-sorties : contrats des tables et ports
  (`schema.ts`, posé), double en mémoire pour les tests (`memory.ts`, posé),
  types webtrigger (`http.ts`, posé) ; Forge SQL, Jira/JSM, modèle, journal
  sont à venir (lot plateforme, lot c3).
- `src/jobs/`, `src/mcp/`, `src/resolvers/`, `src/ui/` — le glue Forge, mince :
  lire, appeler le domaine, écrire, journaliser. Les squelettes sont posés
  (ils répondent « pas encore implémenté »), les implémentations sont à venir
  (lots jobs, mcp, ui, hook).

**Pourquoi.** Trois raisons, toutes vérifiables :

1. **Tester sans site Atlassian.** La chaîne complète — origine, détection,
   encadrement, neutralisation, sas, campagnes, exercice — s'exerce en
   unitaire avec `memory.ts` et le jeu d'essai (lot jeu d'essai, à venir).
   `npm test` ne touche jamais le réseau.
2. **Écrire juste du premier coup côté Forge.** Les pièges du runtime réel
   (SQL, file, modèle, bundler) sont consignés dans `docs/FORGE.md`, mesurés
   sur des déploiements réels ; seuls les adaptateurs les encaissent, le
   domaine reste lisible.
3. **Travailler en parallèle.** Les lots de la vague 1 ne dépendent ni les uns
   des autres ni d'un site : douze lots peuvent avancer en même temps sans se
   marcher dessus.

**Le prix.** Les contrats partagés (`types.ts`, `schema.ts`) doivent être
écrits avant les lots qui les consomment ; un type partagé s'ajoute dans
`types.ts` par une PR dédiée et déclarée (`docs/ARCHITECTURE.md` §2). Sinon
deux lots inventent deux vocabulaires et la fusion coûte plus cher que le code.

## 4. La façon de travailler : lots, PR, file de merge, gardes

**Un lot = une branche = une PR = un propriétaire** (`docs/LOTS.md`). Les
fichiers d'un lot ne sont touchés par personne d'autre. Le tronc (manifeste,
types, contrats, catalogues, squelettes, gardes) est déjà posé : le modifier
demande une PR dédiée qui le dit explicitement.

**Aucun push direct sur `main`.** Chaque PR passe par trois checks requis :

| Check | Rôle |
|---|---|
| `ci` | types stricts, tests vitest, limites de taille, cohérence du manifeste, sanity docs, tests des gardes elles-mêmes |
| `ci-budget` | aucun job CI au-delà de 5 minutes |
| `couche0` | périmètre déclaré dans le corps de PR (`## Scope`), motifs interdits rejetés |

Puis la **file Mergify** merge en squash, par lots de trois têtes au plus, sur
quatre workers self-hosted (`r630-tickets-pieges-01` à `-04`). Un seul pilote
de merge : la file. Ni les gardes ni les agents ne mergent ; un agent de
conflit, un agent de périmètre et un agent de test rouge (InferHub, repli
local) réparent ce qui peut l'être, sans jamais pousser vers `main` ni toucher
aux gardes (`docs/PIPELINE.md`).

**Ce que `couche0` refuse dans un diff** : un fichier modifié hors du
périmètre déclaré ; un push forcé qui n'utilise pas la variante avec bail ;
le déclencheur GitHub à privilèges pour les PR ; une clé d'API ou un jeton en
clair ; une stratégie de fusion qui prend un seul côté ; une date octobre 2026
antérieure au 26 (héritage d'un autre dépôt — ici, les dates s'écrivent en
toutes lettres, par exemple « le 11 novembre 2026 »). La liste exacte est dans
`.github/couche0/check_couche0.py`, seul fichier exempté de son propre scan.

**Boucle locale avant de pousser** : `npm run typecheck && npm test && npm run
limits && npm run manifest` — sans réseau, sans site. Le verdict CI arrive en
moins de 5 minutes : `node_modules` reste en place entre les runs et les
temporaires vont sur le disque (`docs/PIPELINE.md` §1).

## 5. Règles de taille et de duplication

- **Moins de 500 lignes par fichier, moins de 50 lignes par fonction.** La
  garde `tools/check_limits.py` (`npm run limits`) est exécutée en local et en
  CI ; au-delà, on découpe — module, helper, sous-composant — jamais on ne
  laisse grossir. Un fichier annoncé trop long dans `docs/LOTS.md` se scinde
  comme prévu (`src/mcp/actions.ts` en `read.ts`/`write.ts` si besoin).
- **Zéro duplication.** Les helpers existent : empreintes et identifiants
  aléatoires dans `src/core/hashing.ts`, enveloppe `{ ok, data | error,
  warnings }` dans `src/mcp/result.ts`, réponses webtrigger dans
  `src/platform/http.ts`. On cherche avant d'écrire ; on paramètre au lieu de
  copier ; une seule implémentation par logique.
- **Textes visibles dans les catalogues** : `src/core/catalog/<domaine>.ts`, en
  français **et** en anglais (§21 du cahier), assemblés par `src/core/i18n.ts`.
  Jamais de chaîne utilisateur en dur dans le code — c'est ce qui permet de
  relire tous les messages d'un lot d'un coup, et d'y appliquer la règle
  « réduit le risque, jamais protège ».

## 6. Journalisation : ce qui est tracé

Tout geste qui modifie ce que voit un humain ou une IA est écrit dans la table
`event` (§19 du cahier, contrat dans `src/platform/schema.ts` ; implémentation
`src/platform/log.ts` à venir, lot plateforme) :

- le calcul d'origine et de suspicion, couche par couche, avec l'extrait et la
  position du constat ;
- la neutralisation d'un passage **et** sa restauration — les deux gestes, pas
  seulement le premier ;
- les verdicts humains de la file des suspects (piégé, faux positif, légitime
  mais risqué) avec leur motif ;
- les contrôles de sortie (ce qui a été retenu, par qui, pourquoi) ;
- les exercices d'alerte : création du ticket témoin, coup éventuel, type
  d'acteur — jamais de jugement d'une personne (§13) ;
- l'usage du hook (jeton, horodatage, table `hook_token`).

Le rapport d'exposition (§14) agrège ces journaux : demandes examinées,
constats par couche, verdicts, exercices, réponses retenues, part des demandes
réellement analysées. Le journal sert aussi l'auditeur (§28) : montrer, chiffres
à l'appui, ce qui a été vu et ce qui ne l'a pas été.

## 7. Réversibilité : rien n'est perdu, tout se défait

- **Toute neutralisation se restaure en un clic** (§8.3, §21). Le texte
  original est conservé hors du ticket, dans la table `original` : accès
  réservé au rôle sécurité, affichage inerte, jamais servi à une IA sans
  encadrement.
- **Limite connue, dite clairement** : pour une description neutralisée,
  l'historique du ticket garde l'ancienne valeur. Le mode réduit l'exposition,
  il ne l'annule pas.
- **Le mode « étiqueter » n'ajoute qu'un encart** en tête de texte : le retrait
  de l'encart rend le texte d'origine, par construction (ajout seul).
- **Les réglages sont par projet** et le défaut est « signaler » : désactiver
  l'app suffit à revenir à l'état antérieur du flux de travail.
- **Désinstallation** : les originaux conservés sont exportables avant (§22) —
  l'app ne part pas avec des données qu'elle a retirées de la vue.

## 8. Ce qui est posé, ce qui est à venir (état honnête)

**Posé et vérifié au 11 novembre 2026** : `manifest.yml` complet (23 fonctions,
10 actions, agent et skill Rovo, `rovo:mcp`, 4 écrans, propriété indexée,
webtriggers, SQL, LLM) — `forge lint` sans erreur, `forge build` réussi ;
contrats du domaine et de la plateforme ; catalogues de textes ; squelettes de
glue ; gardes de taille, de manifeste et de CI ; pipeline complet. Détail et
mesures : `docs/VALIDATIONS.md`.

**À venir, lot par lot** (`docs/LOTS.md`) : le code fonctionnel des onze lots
de la vague 1 (origine, c1, c2, c3, constats, entrée, sortie, hérédité,
exercice, plateforme, jeu d'essai), puis la vague 2 (jobs, hook, mcp, ui). Les
neuf points « à valider par un prototype » du §20 du cahier sont **tous à
faire** : aucun n'est acquis tant qu'il n'a pas été mesuré sur un site réel et
écrit dans `docs/VALIDATIONS.md` — une validation qui n'est pas écrite n'a pas
eu lieu (`docs/FORGE.md` §6).

Ce que ce document n'analyse pas : la sécurité du runtime Forge lui-même, le
comportement des IA natives du site hors des outils de l'app (§27 du cahier :
les modes « étiqueter »/« neutraliser » et le contrôle après coup réduisent ce
risque sans l'annuler), ni les formats de pièces jointes autres que le texte
lisible (marqués « non analysés »).
