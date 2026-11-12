# Contrat de détection — règles figées et versionnées

Ce lot gèle un contrat que trois appelants contournaient jusqu'ici : le banc
jouait **C1 + C2 + décodage + pression**, la production ne jouait que
**C1 + C2**, et le site rejouait la production. Résultat mesuré sur le site
réel le 12 novembre 2026 : un long bloc encodé était « suspect » dans le jeu
d'essai et **propre** sur le ticket, parce que le décodeur n'était branché nulle
part sauf dans le banc.

Le contrat tient désormais en trois points, portés par deux fichiers —
`src/core/rules-version.ts` (la version et le refus) et `src/core/detect.ts`
(le point d'entrée unique qui applique le contrat).

## Ce que le contrat garantit

1. **Une famille déclarée est réellement jouée.** La liste des familles est une
   source unique (`RULE_FAMILIES` dans `rules-version.ts`). `detect.ts` tient un
   joueur par famille (`PLAYERS`) ; le typage de ce tableau (`Record<DetectLayer,
   LayerPlayer>`) fait échouer la compilation dès qu'une famille est ajoutée sans
   joueur — c'est l'erreur, pas le silence. Un appel à l'import
   (`assertFamilies`) le refuse aussi à l'exécution.
2. **Le résultat porte la version.** Une détection rend, en plus des constats, la
   version majeure (`rulesVersion`), l'empreinte des tables de motifs
   (`rulesFingerprint`), l'identifiant court (`rulesId`) et les familles jouées.
   On peut donc dire avec quelle version des règles un constat a été produit, et
   rejouer un ticket ancien en le comparant honnêtement à ceux d'aujourd'hui.
3. **Une famille inconnue est refusée.** Demander une famille que le produit ne
   connaît pas lève une erreur, jamais un constat vide.

## La version et l'empreinte

Le catalogue de règles est identifié par une **version majeure** (un entier) et
une **empreinte des tables de motifs** (SHA-256). Chiffres réels au moment de ce
lot :

| Champ | Valeur |
|---|---|
| Version majeure (`RULES_VERSION`) | 1 |
| Empreinte (`RULES_FINGERPRINT`) | `af0719f51c84f9ac698b8e53138633804a4c6b238eb408c0c15dc344f3b22635` |
| Identifiant court (`RULES_ID`) | `v1-af0719f51c84` |
| Tables emprintées | 14 |
| Entrées emprintées | 233 |

Les 14 tables couvrent, par famille :

- **C2** : les sept lexiques (`lexique-fr`, `-en`, `-es`, `-de`, `-pt`, `-it`,
  `-nl`) — règle, genre, confiance et **expression régulière comprise**. C'est
  la table de motifs la plus grosse du produit, et l'empreinte la voit en entier.
- **C1, décodage, pression** : les identifiants de règles du catalogue produit
  (`C1-01`…`C1-12`, `DC-01`…`DC-06`, `C4-06`…`C4-08`) et leurs seuils publics
  (`MIN_ENCODED_RUN`, `MIN_ALT_LENGTH`, `COLOR_COLLAPSE_DISTANCE`,
  `MIN_DECODE_RUN`, `MAX_DECODED_LENGTH`, `MAX_DECODE_DEPTH`).

**Limite dite, pas cachée** : les motifs internes de C1, du décodage et de la
pression ne sont pas exportés de leurs modules ; l'empreinte ne les voit donc
pas. Un changement de seuil ou d'identifiant de règle fait bouger l'empreinte,
un changement de motif interne à ces trois familles non. C'est la rançon de ne
pas ouvrir ces modules au moment du lot : à étendre dès qu'un module expose ses
motifs.

La version majeure, elle, se change à la main : +1 quand la liste des familles
change, qu'une famille est renommée, qu'une règle disparaît. Les détails de motif
sont suivis par l'empreinte.

## Ajouter une famille de règles sans réintroduire l'écart

La procédure est conçue pour que l'écart « la production ne joue pas ce que joue
le banc » ne puisse pas réapparaître :

1. Ajouter le nom de famille à `RULE_FAMILIES` dans `src/core/rules-version.ts`.
2. À cet instant, **la compilation casse** : `PLAYERS` dans `detect.ts` n'a pas de
   joueur pour la famille nouvelle. L'agent doit l'écrire — c'est le geste
   obligatoire, pas une option.
3. Écrire le joueur dans `PLAYERS`, en appelant un module existant (jamais un
   second point d'entrée de détection).
4. Incrémenter `RULES_VERSION` (la liste des familles a changé).
5. Ajouter un échantillon à `SAMPLES` dans `src/core/detect.test.ts` et la règle
   attendue : le test « chaque famille déclarée lève au moins un constat sur son
   échantillon » échoue tant qu'on ne l'a pas fait.
6. L'empreinte change toute seule : `RULES_ID` (version + empreinte) change aussi,
   et le test `rules-version.test.ts` l'encaisse.

Tant que l'étape 2 n'est pas résolue, rien ne compile ; tant que l'étape 5 n'est
pas faite, le test est rouge. Les deux verrous couvrent respectivement l'erreur
« branchement oublié » et l'erreur « branchement mort ».

## Rejouer un ticket ancien avec les règles d'aujourd'hui

Un constat est désormais daté par la version du catalogue qui l'a produit :

```ts
import { detectWithVersion } from './src/core/detect';

const { hits, rulesId, rulesVersion } = detectWithVersion(ancien, { language: 'fr' });
// rulesId === 'v1-af0719f51c84' — la version de règles qui a produit `hits`
```

Le banc de rejeu (`node tools/replay.mjs`) passe par `src/replay/engine.ts`,
qui appelle `detectText` : le résultat qu'il exploite porte donc déjà la version.
Ce lot ne modifie pas le rapport du rejeu — **afficher** `rulesId` dans le compte
rendu du rejeu est un travail de `src/replay/`, hors de portée de ce lot ; le
champ est là, prêt à être rendu.

Comparer honnêtement : un ticket ancien rejoué avec les règles d'aujourd'hui **ne
prétend pas** reproduire le verdict d'hier — il dit « voici ce que les règles
actuelles produisent sur ce texte », et la version le dit. Si la version a changé
entre deux rejeux, on compare des choses différentes, et c'est écrit.

## Les tests

- `src/core/rules-version.test.ts` (15 tests) : version entière, empreinte
  stable, **empreinte qui change** quand un motif ou un seuil change, famille
  inconnue refusée, famille déclarée et non jouée signalée.
- `src/core/detect.test.ts` (12 tests) : chaque famille déclarée lève un constat
  par `detectText`, le résultat porte la version, les métadonnées ne polluent pas
  le tableau des constats, une famille inconnue est refusée.