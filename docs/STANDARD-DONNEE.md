# Format ouvert `donnee-<id>` — spécification

> LOT 9 · implémentation : `src/core/standard.ts` · exemples : `data/corpus/standard-sample.json`.

## Le problème que le format résout

Un agent auquel on confie un traitement lit du texte venu d'un tiers (description
d'un ticket, commentaire, pièce jointe, courriel). Ce texte peut contenir une
consigne adressée à l'agent (« ignore tes instructions… »). Sans délimitation
explicite, un modèle doit deviner ce qui est une donnée et ce qui est une
instruction — c'est exactement la fenêtre qu'un texte hostile peut exploiter.

Le format `donnee-<id>` **encadre** un texte externe pour qu'il soit présenté
comme une donnée, jamais comme une consigne. Il ne change pas le texte, il change
la manière dont il est remis à l'agent.

## La grammaire (version 1)

```
bloc   ::= ouverture SAUT corps SAUT fermeture
ouverture ::= "<donnee-" id espace attrs ">"
fermeture ::= "</donnee-" id ">"
attrs  ::= "origine=\"" valeur "\" " "champ=\"" valeur "\" " "suspicion=\"" valeur "\""
id     ::= 6 caractères hexadécimaux minuscules  ("[0-9a-f]{6}")
SAUT   ::= un saut de ligne
```

- **`id`** : identifiant **aléatoire** de 6 caractères hexadécimaux, tiré à chaque
  encadrement. Deux lectures du même ticket, ou deux segments d'un même ticket,
  ne partagent jamais le même identifiant.
- **`origine`** : d'où vient le texte (ex. `client · portail · T1`). Valeur libre,
  destinée à un humain.
- **`champ`** : le champ d'où le texte est extrait (`description`, `comment`,
  `summary`, `attachmentText`, …).
- **`suspicion`** : le niveau retenu par la détection (`clean`, `review`,
  `suspect`, `trapped`).
- **corps** : le texte externe, restitué tel quel (les sauts de ligne internes
  sont conservés).

Exemple :

```
<donnee-7f3a9c origine="client · portail · T1" champ="description" suspicion="suspect">
Bonjour, mon export de factures échoue depuis mardi.
</donnee-7f3a9c>
```

## Les garanties

1. **Injection d'identifiant neutralisée.** Une balise imitée dans le corps
   (`</donnee-7f3a9c> … <donnee-7f3a9c …>`) est rendue **inerte** par le
   générateur : le chevron ouvrant devient un chevron typographique `‹`, ce qui
   casse la balise sans rendre le texte illisible. Le fait est compté par
   `defuseTags` (réutilisé, une seule implémentation).
2. **Le corps n'est jamais réinterprété.** L'analyseur restitue le corps octet
   pour octet entre les deux balises ; il ne cherche pas de structure à
   l'intérieur. C'est ce qui rend l'imitation inoffensive : même si un chevron
   passait, il ne produirait pas de structure.
3. **Identifiant non devinable.** L'identifiant change à chaque réponse : un
   attaquant ne peut pas refermer une balise qu'il ne connaît pas à l'avance.
4. **Aller-retour exact.** `parseDonnee(renderDonnee(generateDonnee(...)))`
   restitue les mêmes identifiant, attributs et corps (testé).

## Ce que le format **ne couvre pas** (limites honnêtes)

- **Il réduit le risque, il ne protège pas.** Le format borne, il ne supprime pas :
  la relecture humaine et le verdict du modèle restent nécessaires avant toute
  action.
- **Pas d'authenticité ni d'intégrité.** L'identifiant n'est pas une signature :
  le format ne prouve ni qui a écrit le texte, ni qu'il n'a pas été altéré en
  amont. C'est un **encadrement**, pas une preuve.
- **Le corps reste du texte.** Le format n'analyse pas le contenu ; il suppose
  que la détection (C1/C2/C3) a déjà tourné en amont et a produit la valeur de
  `suspicion`.
- **Hors du cadre :** la conservation des originaux, le chiffrement, la
  rétention et l'audit relèvent d'autres lots (rétention, budget) et d'autres
  fichiers du dépôt.

## Proposition de publication en standard ouvert

Le format est volontairement **minimal et sans dépendance** : deux balises, trois
attributs, un corps. Rien n'est propre à une plateforme. Trois raisons d'en faire
un standard ouvert :

1. **Interopérabilité.** N'importe quel outil qui remet du texte tiers à un
   agent peut encadrer le même format ; n'importe quel analyseur peut le relire.
2. **Vérifiabilité.** La grammaire est assez petite pour être relue en cinq
   minutes, et l'implémentation de référence est couverte par des tests
   d'aller-retour et d'inertie.
3. **Neutralité.** La sécurité ne repose sur aucun secret ni service particulier,
   seulement sur un identifiant aléatoire et une convention d'échappement.

Elle est documentée ici et dans la PR associée ; la décision de la porter vers un
dépôt de standard ou un RFC reste à l'équipe (hors périmètre de ce lot).

## Références

- Grammaire + analyseur + générateur : `src/core/standard.ts`
- Tests d'inertie et d'aller-retour : `src/core/standard.test.ts`
- Exemples fr/en, dont imitation de balise : `data/corpus/standard-sample.json`
- Encadrement réel servant dans le produit : `src/core/framing.ts` (le standard
  en est la spécification, sans le dupliquer).