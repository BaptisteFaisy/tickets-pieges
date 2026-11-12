# Post-mortem — le premier incident réel (12 novembre 2026, au soir)

Le modèle de post-mortem de ce dépôt est court : **symptôme, portée, cause,
correctif, ce qui aurait dû l'attraper**. Une validation qui n'est pas écrite
n'a pas eu lieu (`docs/FORGE.md` §6) ; de même, un incident qui n'est pas écrit
recommence.

## Incident 1 — « rien ne se passe » : l'app ne pouvait rien écrire

**Symptôme.** Les déclencheurs partaient, aucune erreur visible côté Jira, et la
propriété indexée `pieges` n'apparaissait sur aucun ticket. Le journal de la
plateforme, lui, répétait la même erreur des milliers de fois.

**Portée.** Tous les tickets, toutes les installations. Le produit était
**complet et muet** : les tests passaient, `forge lint` passait, le banc
dessaie donnait 8/8.

**Cause.** Trois défauts successifs, trouvés dans cet ordre :

1. `precision` est un **mot réservé** MySQL/TiDB. Le `CREATE TABLE` échouait
   (`ER_PARSE_ERROR 1064`), donc **aucune table n'existait**, donc aucune
   écriture n'était possible.
2. Les écritures REST partaient **sans `Content-Type: application/json`** :
   Forge envoie alors `text/plain` et Jira répond **415**. La propriété
   indexée n'était jamais écrite.
3. Le corps d'une propriété Jira est **stocké tel quel** : l'envelopper dans
   `{ value }` produisait `value.value`, que le lecteur ne sait pas déchiffrer.

**Correctif.** Colonne `rule_precision` ; en-tête posé au point d'entrée commun
des requêtes ; corps envoyé nu. Puis, pour que la suite ne soit pas un死角 :
le schéma n'est plus recréé à chaque invocation (une **lecture** suffit), et le
corps vide d'une réponse (204) ne casse plus l'écriture.

**Ce qui aurait dû l'attraper.** Un test d'intégration sur un vrai site. Le
`forge lint` ne voit pas le SQL ; les tests unitaires n'exécutent pas de SQL.
Il aurait fallu, depuis le début, un test « déployer → semer → relire ».

## Incident 2 — « la couche C3 ne tourne jamais »

**Symptôme.** La file d'analyse ne démarrait pas : `400 Bad Request` sur
`Queue.push`. Le produit perdait sa couche modèle **entièrement**, — et sans le dire : rien dans
l'interface ne signalait que C3 ne jouait pas.

**Portée.** La couche C3 seulement : C1, C2 et l'origine fonctionnaient.

**Cause.** Le consumer était déclaré en forme `resolver: { function, method }`.
Cette forme **n'enregistre pas la file** dans le runtime Forge : la file n'existe
donc pas au moment où l'app la publie.

**Correctif.** Consumer en forme « fonction simple » (`function: <clé>`), la
forme de l'app sœur déployée le même jour.

**Ce qui aurait dû l'attraper.** Un journal qui distingue « file refusée » de
« file vide », et une property qui est **réécrite** après l'avis du modèle — sans
cela, le ticket continuait d'annoncer « sain » après que le modèle eut relevé
une consigne.

## Incident 3 — « la détection du banc n'est pas celle du ticket »

**Symptôme.** Le jeu d'essai annonçait « suspect » là où le ticket réel disait
« propre » : sur 19 demandes semées, **6** seulement étaient conformes à
l'attendu, et 5 ne portaient même pas la propriété.

**Portée.** Toute la mesure de qualité du produit : les chiffres du banc
mesuraient **autre chose** que ce que fait l'app.

**Cause.** Trois appelants assemblaient les couches différemment — le banc
(C1 + C2 + décodage + pression), la production (C1 + C2), le site (la
production). Une charge encodée passait par le décodeur dans un cas et pas dans
l'autre.

**Correctif.** `src/core/detect.ts` est devenu l'**unique** point d'entrée de la
détection : production, banc et site appellent la même fonction. Le banc local
passe de 7/8 à **8/8**, et le site de 6/19 à **14/19**.

**Ce qui aurait dû l'attraper.** Un test de contrat : « toute famille de règles
déclarée est jouée par la détection ». C'est le lot `detection-contract` de la
vague de consolidation.

## Incident 4 — « les tickets internes semblaient venir d'une intégration »

**Symptôme.** Un ticket créé par un agent de support était classé **T0** (externe
par défaut) au lieu de **T3** (interne).

**Portée.** Tous les tickets créés en interne : l'origine affichée était fausse.

**Cause.** `accountTypeOf` traitait tout identifiant contenant `:` comme un
**compte d'app**. Or un compte Atlassian cloud moderne porte le **préfixe de son
tenant** (`712020:…`) : la règle inversait les deux cas.

**Correctif.** Seule la forme `ari:…` est un compte d'app ; un identifiant à
préfixe de tenant est un compte Atlassian.

**Ce qui aurait dû l'attraper.** Un cas de test sur la forme réelle d'un
identifiant de tenant — écrit à partir d'un ticket réel, pas d'un souvenir.

## La règle qui en sort

> Tout ce qui n'existe que sur la plateforme — le SQL, les appels REST, la file
> d'événements, les quotas, la forme des identifiants — doit être **exercé par un
> test qui parle à la plateforme**. Tout le reste peut rester un test unitaire.
>
> Le test d'intégration Forge (lot `forge-integration`) est né de ces quatre
> incidents.
