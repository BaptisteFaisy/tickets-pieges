# Rétention — conservation, registre, chiffrement, export et restauration

Références : `docs/CAHIER-DES-CHARGES.md` §8.3 (original neutralisé conservé
hors du ticket), §13 (exercice d'alerte), §14 (revue, campagnes), §19 (modèle
de données), §22 (cas limites, export avant désinstallation).

**Règle du fichier** : ce qui n'est pas écrit ici n'existe pas. Les parties
« pas couvert » sont aussi importantes que les autres : une politique de
conservation qui prétend supprimer des lignes alors qu'elle ne fait que les
désigner serait un mensonge.

## 1. Ce que le lot apporte

| Élément | Où | Ce que c'est |
|---|---|---|
| Politique de conservation | `src/core/retention.ts` | Durées par famille (défaut, neutralisé, exercice, campagne). |
| Décision de purge | `src/core/retention.ts` | Fonction pure : âge injecté → purger ou garder. |
| Registre des traitements | `src/core/retention.ts` | Ce que l'app lit, écrit, où, combien de temps. |
| Contrat d'export/restauration | `src/core/retention.ts` | JSON versionné, import idempotent. |
| Chiffrement au repos | `src/platform/crypto.ts` | AES-256-GCM, format versionné, clé de l'appelant. |
| Purge et export/restauration | `src/jobs/retention.ts` | Glue sur le `Store`, testable sans site. |

## 2. La politique de conservation

Une durée par famille. La famille est décidée par la nature de la donnée, pas
par le projet : un ticket neutralisé reste un ticket neutralisé.

| Famille | Durée par défaut | Ce qui la déclenche | Pourquoi |
|---|---|---|---|
| `default` | 90 jours | Ticket analysé sans charge bloquée, constats, journal de revue. | Passé un trimestre sans suite, la donnée ne sert plus. |
| `neutralized` | 365 jours | Original d'un segment neutralisé, constat `neutralized`. | Le litige se juge plus tard que la détection. |
| `exercise` | 7 jours | Exercice d'alerte (ticket témoin et ses observations). | Un témoin n'a de valeur que pendant l'exercice. |
| `campaign` | 180 jours | Campagne (charges répétées). | La revue des campagnes suit la saison, pas le jour. |

Les durées sont **injectées** (`RetentionPolicy`) : le code n'en fige aucune,
et `DEFAULT_RETENTION` n'est qu'un point de départ. Un réglage par projet
pourrait les remplacer ; ce n'est pas fait dans ce lot (§ 9).

## 3. La purge planifiée

La purge est une **décision**, pas une suppression. `decidePurge` est pure :
elle reçoit des éléments datés et un instant de référence, et rend pour chacun
l'âge, l'horizon de sa famille et la décision `purge`. Aucun accès disque, aucune
horloge lue.

Ce que la première passe sait énumérer (`src/jobs/retention.ts`) :

| Tiroir | Famille | Date de référence |
|---|---|---|
| `original` (non restaurés) | `neutralized` | `storedAt` |
| `campaign` | `campaign` | `lastSeen` |
| `canary` (encore ouverts) | `exercise` | `createdAt` |
| `finding` | `neutralized` ou `default` | `createdAt` |

`runRetentionPurge` journalise le décompte dans `events` (evenement
`retention-purge`) : la purge est traçable, y compris quand elle ne supprime
rien.

## 4. Le registre des traitements

Ce que l'app fait des données. Un DPO doit pouvoir le lire sans connaître le
code. La source est `TREATMENT_REGISTER` (`src/core/retention.ts`) : toute
nouvelle table y entre.

| Traitement | Lit | Écrit | Conservation |
|---|---|---|---|
| Origine et indexation | segment, auteur | `segment`, `issue_state`, propriété Jira | `default` |
| Détection et constats | texte du segment | `finding`, `verdict` | `default`, `neutralized` si neutralisé |
| Original neutralisé | texte du segment | `original` | `neutralized`, chiffré au repos |
| Journal d'audit | décisions internes | `event` | `default` |
| Exercice d'alerte | consigne du témoin | `canary`, `canary_hit` | `exercise` |
| Campagnes | empreinte de charge | `campaign` | `campaign` |
| Session contaminée | `sessionRef`, `accountId` | `tainted_session` | le temps du sas |
| Contrôle des sorties | commentaire ou champ sortant | `outbound_check` | `default` |
| Brouillon interne | texte du brouillon | `draft` | `default` après publication |
| Jeton d'accès au hook | empreinte du jeton | `hook_token` | tant que le jeton est actif |

## 5. Ce qu'un DPO doit lire

1. **Le tableau ci-dessus** : quelles données existent, d'où elles viennent,
   où elles atterrissent.
2. **La section 2** : combien de temps chaque famille est conservée, et pourquoi
   la charge neutralisée est conservée plus longtemps (le litige est plus long
   que l'incident).
3. **La section 6** : comment sortir les données (export) et comment les
   remettre (restauration), y compris ce qui n'est pas exporté.
4. **La section 7** : ce que le chiffrement protège, et sa limite — la clé
   est gérée par l'exploitant, l'app ne la détient pas.
5. **La section 8** : ce que la politique **ne couvre pas** aujourd'hui.

## 6. Export et restauration

L'export est un document JSON versionné (`schema`, `version`, `exportedAt`).
Les originaux y figurent **chiffrés** : le texte en clair n'apparaît nulle part
dans le document.

Procédure d'export :

1. `exportRetention(deps, secret)` lit les originaux non restaurés, chiffre
   chacun (AES-256-GCM) et rend le document versionné ;
2. l'export est journalisé (`retention-export`) ;
3. le document est remis à l'exploitant, qui le stocke où il le décide.

Procédure de restauration :

1. `restoreRetention(deps, secret, document)` valide le document (schéma,
   version, champs) et **refuse** ce qui n'est pas le nôtre ;
2. chaque original est déchiffré puis réécrit **seulement s'il n'existe pas
   déjà** (`planRestore`) : l'import est idempotent, rejouer deux fois ne crée
   aucun doublon ;
3. une ligne indéchiffrable (mauvaise clé, contenu altéré) est comptée en
   `failed`, pas passée sous silence ;
4. la restauration est journalisée (`retention-restore`).

Le cycle complet — chiffrer, exporter, déchiffrer, restaurer — est vérifié par
un test : le contenu restauré est **exactement** celui qui était exporté, et
le rejeu ne duplique rien.

## 7. Chiffrement au repos

- Algorithme : AES-256-GCM (`node:crypto`), IV aléatoire de 12 octets, tag
  d'authentification vérifié à la lecture.
- Clé : fournie par l'appelant à chaque appel, jamais écrite en dur, jamais
  stockée à côté du chiffré. Les 32 octets sont dérivés du secret de
  l'exploitant par SHA-256.
- Format : enveloppe versionnée `v1.iv.tag.chiffre` (base64url). Une version
  ultérieure du format devra continuer à lire les enveloppes `v1` ; le lecteur refuse
  aujourd'hui toute version qu'il ne connaît pas.
- Détection d'une altération : GCM la refuse. Une enveloppe modifiée est
  rejetée, pas déchiffrée en silence.

**Limite honnête** : le chiffrement ne vaut que ce que vaut la clé. Si l'exploitant
perd sa clé, les originaux exportés sont irrécupérables ; si elle fuit, ils
sont lisibles. L'app ne détient pas la clé, donc elle ne peut ni la protéger
ni la reconstruire. La gestion de la clé (rotation, sauvegarde, WhoIs
détenu) reste hors de ce lot.

## 8. Ce qui n'est pas couvert

Dit franchement, pour qu'aucun lecteur ne croie le contraire :

1. **La suppression physique des lignes n'est pas faite.** Le contrat `Store`
   (`src/platform/schema.ts`) n'expose pas de suppression, à deux exceptions
   près (`trust.remove`, `sessions.clear`). La purge rend la décision et la
   journalise ; elle ne supprime pas encore. Il faut un `remove` par tiroir —
   un changement de contrat partagé, hors de la propriété de ce lot.
2. **Les segments, états, sessions et jetons de hook ne sont pas énumérés** par
   la purge : le `Store` n'a pas d'énumération globale pour eux. Seuls les
   quatre tiroirs du § 3 sont concernés.
3. **Les jetons de hook ne sont pas exportés** : ils ne sont pas énumérables
   non plus. Le champ `tokens` du format est donc vide en pratique. Le
   chiffrement, lui, est générique et vérifié sur n'importe quelle chaîne.
4. **La politique n'est pas paramétrable par projet** : les durées sont
   injectées dans le code, pas lues d'un réglage.
5. **Aucun test sur un site Atlassian** : tout ce qui est écrit ici est vérifié
   en unitaire, sans réseau.
6. **La purge n'est pas encore câblée** dans `dailyMaintenance` : voir § 9.

## 9. Câblage

`src/jobs/retention.ts` n'ajoute **aucun** module de manifeste. Les trois
fonctions (`runRetentionPurge`, `exportRetention`, `restoreRetention`) sont
prêtes à être appelées par le `dailyMaintenance` existant
(`src/jobs/scheduled.ts`), qui est la propriété du tronc :

```ts
// src/jobs/scheduled.ts — dailyMaintenance
const purge = await runRetentionPurge(deps);
```

Le même câblage vaut pour l'export et la restauration, qui sont des opérations
à la demande et non des tâches quotidiennes : les appeler depuis
`dailyMaintenance` conviendrait mal. Elles doivent être branchées sur une
action existante — la décision de branchement et l'interface ne sont pas dans
ce lot.

## 10. Vérifications

| Vérification | Commande | Résultat |
|---|---|---|
| Types | `npx tsc --noEmit` | vert |
| Tests du lot | `npx vitest run src/core/retention.test.ts src/platform/crypto.test.ts src/jobs/retention.test.ts` | 32 tests, tous verts |
| Tailles | `python3 tools/check_limits.py` | aucun fichier ≥ 500 lignes, aucune fonction ≥ 50 lignes |
| Manifeste | `node tools/validate_manifest.mjs` | inchangé par ce lot |

Les 32 tests se répartissent en 13 pour le domaine (politique, purge, registre,
contrat d'export), 11 pour le chiffrement (aller-retour, clé fausse, altération,
version) et 8 pour le glue (purge à dates injectées, cycle export/restauration,
idempotence). Aucune attente réelle, aucun réseau : les dates sont injectées,
donc les résultats sont reproductibles.
