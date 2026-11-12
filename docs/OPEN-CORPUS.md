# Corpus ouvert `data/corpus` — provenance, licence, contribution

> LOT 9 · accompagne la proposition de standard ouvert `donnee-<id>`
> (`docs/STANDARD-DONNEE.md`).

## Ce que c'est

Un jeu de textes **inoffensifs** qui sert à mesurer la détection : les charges
à reconnaître (faux négatifs) et les textes légitimes à ne pas relever (faux
positifs), plus les exemples de la grammaire d'encadrement. Le principe (§21) :
**aucun texte du corpus ne demande de geste réel sur un système tiers** — on peut
le publier sans risque, et le diffuser pour que d'autres équipes étalonnent leurs
propres détecteurs sur les mêmes entrées.

## Les fichiers (réutilisés, pas dupliqués)

| Fichier | Contenu | Entrées |
|---|---|---|
| `attacks-fr.json` | Charges synthétiques en français (8 familles) | 30 |
| `attacks-en.json` | Charges synthétiques en anglais (8 familles) | 30 |
| `legitimate-fr.json` | Textes de support légitimes (faux positifs) | 28 |
| `legitimate-en.json` | Textes de support légitimes (faux positifs) | 27 |
| `scenario-cato-2025.json` | Scénario documenté (légitime + scénario) | 8 |
| `standard-sample.json` | Exemples de la grammaire `donnee-<id>` (fr/en, imitation) | 12 |

Les familles de charges couvertes couvrent : changement de rôle, attaque du
détecteur, marqueur système, commande d'outil, exfiltration, dissimulation,
encodage, pression. Chaque entrée porte un `source` (`synthetic`, `support`,
`cato-2025`) et, pour les charges, les règles attendues (`expectedRuleIds`).

## Licence (proposition)

Le corpus est destiné à être **réutilisable librement** par des équipes de
sécurité, des éditeurs et des chercheurs. Proposition : domaine public **CC0-1.0**
pour les données de `data/corpus/`. C'est une proposition, pas un acte : l'ajout
d'un fichier `LICENSE` officiel et la validation juridique relèvent de l'équipe,
hors périmètre de ce lot.

## Règles de contribution

Toute entrée ajoutée doit :

1. être **inoffensive** : aucune instruction qui, si elle était exécutée par un
   agent connecté, provoquerait un geste réel ou une exfiltration (§21) ;
2. déclarer son `source` (`synthetic` pour un texte forgé, `support` pour un
   texte réel de support anonymisé, un nom de scénario sinon) ;
3. déclarer sa `lang` (`fr` ou `en`) et son `label` (`attack` / `legitimate` /
   `scenario`) ;
4. pour une charge, déclarer les `expectedRuleIds` attendus, afin que le banc
   puisse vérifier la non-régression de la détection ;
5. être recouverte par le banc existant (`npx vitest run`, `python3
   tools/check_limits.py`, `node tools/validate_manifest.mjs`).

On ne duplique pas : toute nouvelle entrée rejoint le fichier de sa famille déjà
présent dans `data/corpus/`, on n'en crée pas de copie.

## Limites honnêtes

- Le corpus **ne remplace pas** un corpus de production réel : les textes
  synthétiques couvrent des motifs, pas la diversité réelle d'un site.
- La licence est **proposée, pas signée** : voir plus haut.
- Le corpus mesure le bruit et le rappel **sur ces entrées** ; les taux mesurés
  sont décrits dans les documents de mesure du dépôt, pas ici.