# Table de correspondance MITRE ATLAS

> Idée #96 · source des données : [`data/atlas.json`](../data/atlas.json) · module :
> [`src/core/atlas.ts`](../src/core/atlas.ts) · ce document est **généré** depuis la table,
> aucune ligne n’y est recopiée à la main.

Chaque règle du produit est rattachée à une technique de [MITRE ATLAS](https://atlas.mitre.org),
la matrice des techniques d’attaque contre les systèmes d’IA. Le catalogue officiel compte
170 techniques (relevé du 2026-11-12) ; la table en cite
24, celles que le produit rencontre réellement sur un portail de support.

## Pourquoi une telle table

Un responsable sécurité ne lit pas du TypeScript. Il lit une matrice. Cette table répond à la
seule question qui compte : « pour chaque technique connue, que fait votre produit ? » — et elle
répond aussi quand la réponse est « rien ».

## Les quatre niveaux de couverture

- **Détecté** (`detected`) — Un constat est élevé et remonté à la revue humaine ; rien n’est bloqué automatiquement.
- **Encadré** (`framed`) — Le passage est neutralisé puis ne parvient au modèle que comme donnée entre balises à identifiant aléatoire.
- **Bloqué** (`blocked`) — La sortie est retenue par le sas (§10) : rien ne quitte l’organisation.
- **Non couvert** (`not-covered`) — La technique n’est pas analysée par le produit ; rien n’est affirmé sur elle.

Un niveau décrit **ce que le produit fait**, pas ce qu’il promet. Rien ici ne « protège » :
chaque verrou retire un ingrédient de l’attaque, et un ingrédient retiré peut revenir par un
autre chemin (§7 du cahier des charges).

Répartition des 46 règles mappées :
- Encadré : 27
- Détecté : 7
- Non couvert : 1
- Bloqué : 11

## Lecture par famille d’attaque

| Famille | Techniques citées | Règles du produit | Couverture | Ce que cela veut dire |
|---|---|---|---|---|
| Injection de consignes | 5 | 10 | Encadré / Détecté | le contenu porteur n’atteint le modèle que comme donnée encadrée |
| Dissimulation et masquage | 5 | 24 | Encadré / Détecté / Non couvert | le contenu porteur n’atteint le modèle que comme donnée encadrée |
| Exfiltration et fuite de données | 5 | 14 | Encadré / Bloqué | le sas retient la sortie |
| Invocation d’outils par l’agent | 1 | 1 | Encadré | le contenu porteur n’atteint le modèle que comme donnée encadrée |
| Préparation de l’attaque (comptes, identité) | 2 | 2 | Détecté | signalé à la revue humaine, rien n’est arrêté |
| Déni de service d’agent | 2 | 0 | Non couvert | aucune règle ne l’analyse — 2 trou(x) nommé(s) |
| Corruption de mémoire et de contexte | 4 | 0 | Non couvert | aucune règle ne l’analyse — 4 trou(x) nommé(s) |

Une famille sans règle est une famille non couverte : elle reste dans la table, avec son trou.

## C1 et DC — la dissimulation

Le texte porte une consigne que l’œil ne voit pas : caractères invisibles, couleur fondue,
encodage, lien dont le libellé ment. Famille ATLAS dominante : **obscurcissement de consigne**.

| `ruleId` | Technique ATLAS | Couverture | Ce que fait le produit |
|---|---|---|---|
| `C1-01` | AML.T0068 Obscurcissement de consigne | Encadré | Caractères de largeur nulle : la consigne est cachée au lecteur humain. |
| `C1-02` | AML.T0068 Obscurcissement de consigne | Encadré | Caractères de balise Unicode, invisibles dans la plupart des éditeurs. |
| `C1-03` | AML.T0068 Obscurcissement de consigne | Encadré | Espaces insécables en série : découpage de mots pour franchir un filtre lexical. |
| `C1-04` | AML.T0068 Obscurcissement de consigne | Encadré | Séries de liantes : recomposition du mot au rendu, une lettre à la fois. |
| `C1-05` | AML.T0068 Obscurcissement de consigne<br>AML.T0074 Masquage (apparence trompeuse) | Encadré | Marque bidi : l’ordre visuel ne correspond plus à l’ordre lu par la machine. |
| `C1-06` | AML.T0068 Obscurcissement de consigne | Encadré | Texte de la couleur du fond : présent pour l’IA, absent pour l’œil. |
| `C1-07` | AML.T0068 Obscurcissement de consigne | Encadré | Traits d’union conditionnels en série : le mot est découpé sans laisser de trace visible. |
| `C1-08` | AML.T0068 Obscurcissement de consigne | Encadré | Texte blanc sur blanc repéré par la couleur seule. |
| `C1-09` | AML.T0051.001 Injection indirecte<br>AML.T0068 Obscurcissement de consigne | Encadré | Consigne portée par le texte alternatif d’une image : elle n’atteint l’IA que par le canal indirect. |
| `C1-10` | AML.T0074 Masquage (apparence trompeuse)<br>AML.T0011.003 Lien malveillant | Encadré | Le libellé du lien annonce une autre adresse que la cible réelle. |
| `C1-11` | AML.T0011.003 Lien malveillant | Encadré | Schéma de lien non navigable (javascript:, data:) : le clic exécute. |
| `C1-12` | AML.T0011.003 Lien malveillant<br>AML.T0025 Exfiltration par voie numérique | Encadré | Hôte inconnu : destination possible de collecte, jamais consultée par le produit. |
| `C1-13` | AML.T0068 Obscurcissement de consigne | Encadré | Long bloc encodé : le contenu lisible n’apparaît qu’après décodage. |
| `DC-01` | AML.T0068 Obscurcissement de consigne | Encadré | Bloc base64 décodé puis réanalysé comme du texte ordinaire. |
| `DC-02` | AML.T0068 Obscurcissement de consigne | Encadré | Bloc hexadécimal décodé puis réanalysé. |
| `DC-03` | AML.T0068 Obscurcissement de consigne | Encadré | Encodage d’URL décodé puis réanalysé. |
| `DC-04` | AML.T0068 Obscurcissement de consigne | Encadré | Échappement Unicode décodé puis réanalysé. |
| `DC-05` | AML.T0068 Obscurcissement de consigne | Encadré | Encodage imbriqué : le décodage est répété tant qu’il produit du sens. |
| `DC-06` | AML.T0074 Masquage (apparence trompeuse)<br>AML.T0011.003 Lien malveillant | Encadré | Raccourcisseur d’URL : la cible réelle est masquée, l’adresse n’est jamais suivie. |

## C2 — l’adresse à une IA

Le texte ne s’adresse plus à l’agent : il s’adresse à l’assistant qui lira le ticket. C’est le
canal d’injection indirect d’ATLAS, et c’est le cœur du produit.

| `ruleId` | Technique ATLAS | Couverture | Ce que fait le produit |
|---|---|---|---|
| `C2-01` | AML.T0051.001 Injection indirecte | Encadré | Consigne impérative adressée à l’assistant dans un ticket : canal d’injection indirect. |
| `C2-02` | AML.T0054 Contournement d’instruction (jailbreak)<br>AML.T0051.001 Injection indirecte | Encadré | Changement de rôle ou de mode demandé : tentative de jailbreak. |
| `C2-03` | AML.T0051.001 Injection indirecte<br>AML.T0074 Masquage (apparence trompeuse) | Encadré | Faux marqueur de système : le texte se fait passer pour une consigne de la plateforme. |
| `C2-04` | AML.T0053 Invocation d’un outil par l’agent<br>AML.T0086 Exfiltration par un outil de l’agent | Encadré | Verbe d’outil : la consigne vise une action d’agent (recherche, export, mise à jour). |
| `C2-05` | AML.T0025 Exfiltration par voie numérique<br>AML.T0086 Exfiltration par un outil de l’agent | Encadré | Adresse jointe à un envoi de données : la voie d’exfiltration se dessine. |

## C3 — la lecture par modèle encadré

Un modèle lit le passage **comme une donnée**, dans un bloc à identifiant aléatoire, et rend un
verdict. La technique est la même ; ce qui change, c’est qui la constate.

| `ruleId` | Technique ATLAS | Couverture | Ce que fait le produit |
|---|---|---|---|
| `C3-01` | AML.T0051 Injection de consigne dans un modèle de langage<br>AML.T0051.001 Injection indirecte | Encadré | Le modèle encadré répond « consigne » : l’injection est confirmée par une lecture isolée. |
| `C3-02` | AML.T0051 Injection de consigne dans un modèle de langage | Encadré | Le modèle encadré répond « suspect » sans trancher : la charge reste encadrée. |
| `C3-90` | AML.T0054 Contournement d’instruction (jailbreak) | Encadré | Réponse non conforme du modèle encadré : le passage est traité comme suspect, jamais comme sain. |

## C4 — le contexte et la pression

Signaux faibles : compte neuf, canal anonyme, longueur inhabituelle, densité d’impératifs,
consigne différée, acrostiche. Aucun de ces signaux ne bloque quoi que ce soit : ils pèsent sur
la suspicion, et c’est tout.

| `ruleId` | Technique ATLAS | Couverture | Ce que fait le produit |
|---|---|---|---|
| `C4-01` | AML.T0021 Création de comptes | Détecté | Compte créé récemment : indice de provenance, pas de preuve. |
| `C4-02` | AML.T0073 Usurpation d’identité | Détecté | Canal anonyme : l’auteur n’est pas identifiable, le contenu reste interne. |
| `C4-03` | AML.T0046 Envoi de données de remplissage | Détecté | Longueur inhabituelle : signal de volume, pas de verdict. |
| `C4-04` | AML.T0068 Obscurcissement de consigne | Détecté | Changement de langue : le filtre lexical perd ses repères. |
| `C4-05` | AML.T0011.000 Artefacts non sûrs | Non couvert | Pièce jointe non analysable : le contenu n’est pas lu, le produit le dit et s’arrête là. |
| `C4-06` | AML.T0065 Façonnage de consigne | Détecté | Densité de phrases impératives : forme typique d’une consigne façonnée. |
| `C4-07` | AML.T0094 Report de l’exécution d’une consigne | Détecté | Consigne différée (« plus tard, quand… ») : l’exécution est reportée. |
| `C4-08` | AML.T0068 Obscurcissement de consigne<br>AML.T0065 Façonnage de consigne | Détecté | Acrostiche : le sens est reconstruit lettre par lettre. |

## S — le sas de sortie

Motifs de données et d’identifiants relevés dans ce qu’une IA s’apprête à publier. Ici le produit
ne se contente pas de signaler : il retient.

| `ruleId` | Technique ATLAS | Couverture | Ce que fait le produit |
|---|---|---|---|
| `iban` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `card` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `siret` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `siren` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `nir` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `email` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `phone` | AML.T0057 Fuite de données par le modèle<br>AML.T0025 Exfiltration par voie numérique | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `github-token` | AML.T0055 Identifiants exposés<br>AML.T0057 Fuite de données par le modèle<br>AML.T0098 Vol d’identifiants par un outil de l’agent | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `api-key` | AML.T0055 Identifiants exposés<br>AML.T0057 Fuite de données par le modèle<br>AML.T0098 Vol d’identifiants par un outil de l’agent | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `aws-access-key` | AML.T0055 Identifiants exposés<br>AML.T0057 Fuite de données par le modèle<br>AML.T0098 Vol d’identifiants par un outil de l’agent | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |
| `jwt` | AML.T0055 Identifiants exposés<br>AML.T0057 Fuite de données par le modèle<br>AML.T0098 Vol d’identifiants par un outil de l’agent | Bloqué | Motif de donnée personnelle ou de compte : retenu par le sas, rien ne sort. |

## Ce que le produit n’analyse pas

Liste volontairement publique. Un trou nommé se corrige ; un trou caché se découvre en incident.

- `AML.T0080` AI Agent Context Poisoning — La quarantaine de session limite la conséquence d’un contexte pollué ; le produit ne détecte pas l’empoisonnement lui-même.
- `AML.T0029` Denial of AI Service — La limite de débit du sas (#38) plafonne les réponses publiques par agent, pas les appels au modèle : un déni de service de l’IA n’est ni détecté ni bloqué.
- `AML.T0034.002` Agentic Resource Consumption — La consommation de ressources par l’agent n’est pas mesurée ; seule la limite de débit du sas (#38) borne indirectement le volume de sorties.
- `AML.T0070` RAG Poisoning — Le produit n’ingère aucun corpus RAG : la surface n’existe pas ici.
- `AML.T0092` Manipulate User LLM Chat History — L’historique de conversation n’est pas réanalysé à chaque tour.
- `AML.T0058` Publish Poisoned Models — Aucun modèle n’est entraîné ni publié depuis le produit.

## Règles explicitement non mappées

- `C2-09` — Identifiant présent uniquement dans un fixture de test (precision.test.ts) : aucune règle de production ne l’émet.

## Comment la table est vérifiée

Trois garde-fous dans [`src/core/atlas.test.ts`](../src/core/atlas.test.ts), sans réseau :

1. **aucune technique inventée** — toute technique citée existe dans le catalogue MITRE repris
   dans `data/atlas.json`, avec son nom officiel ;
2. **chaque `ruleId` du dépôt est traité** — il a une entrée, ou il figure dans la liste des
   règles non mappées avec sa raison ;
3. **la couverture d’un rapport est cohérente avec ses constats** — un constat dont la règle est
   inconnue de la table est rendu comme « non couvert », jamais ignoré en silence.

## Rendu programmatique

```ts
import { coverageOfFindings, coverageOfReport } from './core/atlas';

coverageOfFindings(findings);        // un ticket : une ligne par technique déclenchée
coverageOfReport(report, findings);  // une fenêtre : techniques + trous nommés + règles inconnues
```

Les deux fonctions sont du domaine pur : aucune entrée-sortie, aucune heure lue, aucun
`@forge/*`. La table est chargée par import statique au build.
