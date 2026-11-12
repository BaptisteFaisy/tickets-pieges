# Mesures de terrain — protocole, fenêtre d'exposition, chiffres

Ce document consigne **ce qui est mesuré** sur une instance réelle de
« Tickets piégés » (idées #84 et #85), comment cela est mesuré, et ce qui ne
l'est pas encore. Règle du dépôt (§21) : ce qui n'est pas mesuré est écrit
« à mesurer sur site ». Aucun chiffre n'est inventé, aucun chiffre supposé
n'est présenté comme mesuré.

## 1. Pourquoi mesurer

Tant que la fenêtre d'exposition est supposée, l'argument de sécurité repose
sur une intuition : « l'analyse est rapide, donc le texte piégé reste peu de
temps visible ». Mesurer remplace l'intuition par un fait opposable :

- **fenêtre d'exposition** : délai entre la création du ticket et l'application
  du mode (bandeau, neutralisation, ou rien en mode `report`) — pendant cette
  fenêtre, le texte entré de l'extérieur est vivant dans Jira ;
- **débit (#84)** : capacité de la chaîne sur un volume de 5 000 tickets ;
- **charge de la file C3 (#85)** : attente de 500 messages face à l'objectif
  de 30 s.

Ces mesures ne disent pas que l'app « protège » : elles disent **combien de
temps** un texte non analysé reste exposé, et **ce qui n'est pas analysé**.

## 2. Ce qui est mesuré, et par quoi

Chaîne instrumentée (`src/core/timing.ts` pour le calcul, `src/jobs/timing.ts`
pour la lecture du réel) :

| Intervalle | Définition | Preuve disponible |
|---|---|---|
| `origin` | création → origine écrite | non séparable aujourd'hui (voir §3) |
| `c1` | création → fin de la couche C1 | non séparable aujourd'hui |
| `c2` | création → fin de la couche C2 | borne haute : événement `scan` |
| `mode` | création → mode appliqué | borne haute : `scan` ; borne serrée : `label-applied`, `neutralized`, `state-published` |
| `c3` | création → verdict du modèle | événement `c3` |

Ordre réel des étapes : le mode est appliqué **pendant** l'analyse synchrone,
le verdict C3 arrive **après**, par la file asynchrone. Les durées sont bornées
(0 à 24 h) et monotones : une étape datée avant une étape déjà enregistrée est
ramenée au niveau de la précédente, jamais négative.

Deux mesures de charge complètent les traces :

- **file C3 (#85)** : attente entre la mise en file et le verdict, sur 500
  messages — médiane, p95, pire attente, nombre de dépassements de l'objectif ;
- **débit (#84)** : nombre d'analyses (`scan`) par tranche d'une minute, sur
  5 000 tickets.

## 3. Ce que le journal prouve — et ce qu'il ne prouve pas

Honnêteté obligatoire : la granularité du journal (`src/platform/log.ts`,
`src/jobs/pipeline.ts`) fixe la précision des mesures.

- L'événement `scan` est écrit **après** l'application du mode : il borne par
  le haut la fin de l'analyse lexicale **et** le mode appliqué, sans les
  séparer. Origine, C1 et C2 ne sont donc pas datés séparément aujourd'hui.
- L'instant de **mise en file** C3 n'est pas journalisé. L'attente de file
  mesurée ici part de l'événement `scan` : c'est une **borne basse** du délai
  réel (elle sous-estime, elle ne surestime jamais).
- En mode `report`, aucun geste n'est appliqué au portail (silence envers
  l'attaquant) : l'absence d'événement de mode est une mesure, pas un manque.

Ce qui n'est pas daté reste « à mesurer sur site » dans le tableau ci-dessous.

## 4. Protocole de mesure sur le site

1. **Prérequis** : app installée sur un site de test Jira Service Management,
   jeton de diagnostic disponible (`PIEGE_TOKEN`, §11), horloge du site connue.
2. **Échantillon** : 5 000 tickets pour le débit (#84), dont un sous-ensemble
   de 500 messages passés par la file C3 (#85). Les clés de tickets sont
   passées par `--issues` ; aucune n'est écrite dans ce document.
3. **Sonde** :

   ```bash
   export PIEGES_SITE_URL="https://<hote>.forgeapps.net/…/pieges-ops"
   export PIEGE_TOKEN="<jeton de diagnostic>"
   node tools/probe-site.mjs --issues SUP-1,SUP-2 --json
   ```

   La sonde réécrit la section §5, délimitée par ses deux commentaires
   marqueurs `MESURES:DEBUT` et `MESURES:FIN` (la dernière paire du document
   fait foi). `--dry-run` affiche sans écrire ; `--in <fichier.json>` rejoue
   une charge utile déjà produite, hors ligne et sans réseau.
4. **Répétitions** : trois passages à des heures différentes (creux, charge
   normale, pointe) ; la valeur retenue est la **pire** observée, pas la
   médiane — une fenêtre d'exposition se juge sur son pire cas.
5. **Sortie** : chiffres et libellés uniquement. La sonde **refuse** (code de
   sortie 2) toute réponse qui porterait une clé de texte de ticket
   (`text`, `body`, `content`, `excerpt`, `original`, `description`,
   `summary`) : rien ne sort d'Atlassian (§21).

## 5. Résultats

État au 12 novembre 2026 : le site n'a pas encore été sondé. La section
ci-dessous est régénérée par `tools/probe-site.mjs` à chaque sondage.

<!-- MESURES:DEBUT -->

_Sondé le 2026-11-12T00:57:49.992Z — source : indisponible._

Le site n’a pas rendu de mesures : ni --url ni --in : rien à sonder.

Aucun chiffre n’est inventé : tout reste « à mesurer sur site ».

| Mesure | Valeur | Source |
| --- | --- | --- |
| origine écrite | à mesurer sur site | assumed |
| couche C1 (dissimulation) | à mesurer sur site | assumed |
| couche C2 (adresse à une IA) | à mesurer sur site | assumed |
| mode appliqué — fenêtre d’exposition | à mesurer sur site | assumed |
| verdict C3 (file asynchrone) | à mesurer sur site | assumed |
| file C3 | à mesurer sur site | assumed |
| débit | à mesurer sur site | assumed |

**Échantillons** : aucun échantillon

- Hors site : les chiffres seront relevés sur l’instance installée.

<!-- MESURES:FIN -->

## 6. Objectifs

| Objectif | Valeur | Source |
|---|---|---|
| Attente de la file C3 | 30 s | cahier des charges (#85) |
| Fenêtre d'exposition | à fixer avec le site pilote | aucun objectif chiffré n'est inventé ici |
| Débit sur 5 000 tickets | à fixer avec le site pilote | mesure descriptive (#84) |

Un dépassement d'objectif est **signalé** (`status: late`, avec le dépassement
en ms), jamais masqué ni moyenné. Une mesure absente reste `unknown` : elle
n'est jamais comptée comme atteinte.

## 7. Ce qui manque dans le tronc pour mesurer exactement

Deux ajouts hors de ce lot (fichiers d'autres lots) resserreraient les bornes :

1. journaliser l'instant de **mise en file** C3 (événement dédié dans
   `src/jobs/pipeline.ts` ou `src/jobs/consumer.ts`) : l'attente de file
   deviendrait exacte au lieu d'être une borne basse ;
2. exposer `measureSite()` (`src/jobs/timing.ts`) sur le `webtrigger`
   `pieges-ops` (action `timing`) dans `src/jobs/webhook.ts` : sans cette
   route, la sonde retombe sur « à mesurer sur site » et écrit la raison.

Séparer origine, C1 et C2 dans le journal donnerait en plus les trois
intervalles aujourd'hui confondus.

## 8. Reproductibilité hors ligne

Les calculs sont du domaine pur (`src/core/timing.ts`) : horloge en paramètre,
aucune E/S. Ils sont couverts par `src/core/timing.test.ts` (monotonicité,
bornes, objectifs dépassés, mesuré contre supposé) et par
`src/jobs/timing.test.ts` (ce que le journal prouve, absence de texte de
ticket dans la charge utile). La sonde se teste sans site :
`node tools/probe-site.mjs --in <charge-utile.json> --doc /tmp/essai.md`.
