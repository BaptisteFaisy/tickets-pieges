# Budget de requêtes et dégradation propre

> Forge SQL a des **limites d'installation**. Le 12 novembre 2026, sur le site
> de démonstration, la couche C3 a cessé de fonctionner avec l'erreur
> « Limits for the current installation have been exceeded ». Un quota qu'on ne voit
> pas est un quota qui casse en silence.

## La règle

**Le risque ne doit pas dépendre du quota.** Passé le plafond :

- les **lectures** continuent — la détection n'en demande aucune ;
- les **écritures** sont **sautées**, et le budget le note ;
- le relevé est **journalisé**, donc la dégradation est **annoncée** ;
- l'analyse rend quand même son résultat : l'origine, la suspicion et le mode
  sont calculés comme d'habitude.

Un ticket analysé mais non persisté est un ticket dont l'écran ne montre rien —
donc la dégradation doit se voir dans l'interface, pas seulement dans un journal.

## Le compteur

`src/platform/budget.ts` — un `SqlBudget` par invocation (le runtime Forge donne
une instance par invocation : le compteur est donc naturellement isolé).

| Grandeur | Sens |
|---|---|
| `writes` | écritures demandées |
| `reads` | lectures effectuées |
| `queries` | total des requêtes parties vers la base |
| `skippedWrites` | écritures **sautées** (le mode dégradé) |
| `limit` | plafond d'écritures |
| `degraded` | vrai dès qu'une écriture a été sautée |
| `nearLimit` | vrai quand on approche du plafond (à surveiller) |

Plafond par défaut : **120 écritures** par invocation (`DEFAULT_WRITE_LIMIT`),
alerte à 80 % (`DEFAULT_WARN_RATIO`).

## Où il est branché

`src/platform/db.ts` : l'exécuteur compte chaque requête. Passé le plafond,
`exec()` **saute** l'écriture et appelle `markSkipped()`. `src/jobs/support.ts`
crée le budget au démarrage de l'invocation et le branche (`setBudget`).

Le relevé est lisible par le diagnostic (`budgetReading()` dans
`src/platform/db.ts`), qui le publica dans son rapport.

## Ce que le budget ne fait pas

- Il ne **mesure pas** le quota réel de l'installation : il compte ce que le
  produit demande. Une installation plus grosse peut dépasser le quota avant que
  le compteur ne le voie.
- Il ne couvre pas les appels **REST** : ceux-ci ont leur propre limite.
- Il ne remplace pas la **lecture** qui vérifie l'existence du schéma : celle-ci
  est faite une fois par instance et ne consomme pas de quota d'écriture
  (`docs/FORGE.md` §2).

## Le nombre de requêtes par analyse

Mesuré pendant la mise au point du 12 novembre 2026 (analyse d'une demande avec
trois segments, sur le site de démonstration) :

| Étape | Requêtes |
|---|---|
| vérification du schéma (une lecture) | 1 |
| lecture de la demande, des commentaires, des pièces | 3 |
| écriture des segments | 1 par segment |
| écriture des constats | 1 par constat |
| écriture de l'état et de la propriété | 2 |
| journalisation | 1 par événement |

Soit **une dizaine de requêtes pour une demande simple**, et un compte qui monte
linéairement avec le nombre de constats. C'est cette linéarité qui rend
le plafond utile : il protège l'installation d'un lot pathologique (une campagne
de cinq cents charges identiques, §22) bien avant que Forge SQL ne tranche.

## En pratique

- **Surveiller** `nearLimit` : un taux d'atteinte haut et constant annonce un
  lot trop gros ou une boucle.
- **Réduire** le travail par invocation avant de vouloir augmenter le quota :
  traiter par lots plus petits (`consumer`), ou ne pas persister ce qui n'a pas
  changé (la propriété n'est réécrite que si l'état change).
- **Si le mode dégradé s'active** : le produit continue d'analyser ; c'est la
  persistance qui manque. Le dire dans le rapport d'exposition (la part
  « réellement analysée »下降 alors que le taux d'analyse reste bon).
