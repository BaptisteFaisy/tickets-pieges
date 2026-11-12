# Test d'intégration Forge — la boucle qui a trouvé les cinq défauts

> Ni `forge lint`, ni `tsc`, ni les 1232 tests ne montrent ce qui n'existe
> que sur la plateforme : le SQL exécuté par TiDB, les appels REST really
> envoyés, la file d'événements, les quotas, la forme des identifiants. Ce test
> est la boucle qui les a trouvés.

## Le protocole

```
1. déployer     forge deploy --non-interactive -e development --approve MAJOR_VERSION_RULE
2. installer    forge install --upgrade --site … -p jira -e development --confirm-scopes --non-interactive
3. semer        python3 scripts/seed-demo-site.py --site … --email … --lang fr
4. vérifier    python3 scripts/verify-demo-site.py --site … --email … --lang fr
5. comparer    node scripts/live-check.mjs --site … --email … --lang fr
```

Ou en une commande : `node scripts/live-check.mjs --site … --email … --lang fr`
(enchaîne les étapes 3 à 5 ; `--seed-only` réutilise les rapports déjà présents).

## Ce que le test compare

Trois jeux de données, trois rôles :

| Jeu | Rôle |
|---|---|
| `data/expectations.json` | les **attendus figés** des 38 demandes (origine + suspicion), extraits du jeu au moment où il a été figé |
| `out/demo-seed-<lang>.json` | ce que le jeu a demandé au site (et les **divergences de reproduction**) |
| `out/demo-verify-<lang>.json` | ce que le site **porte réellement**, lu par REST |

La comparaison (`src/live/check.ts`) ne dit pas seulement « conforme » : elle
distingue quatre situations.

| Situation | Sens | Bloque ? |
|---|---|---|
| `conforme` | le site porte l'attendu figé | non |
| `ecart-connu` | écart **mesuré et expliqué** (liste `KNOWN_GAPS`) | non |
| `regression` | écart **inconnu** : le produit a régressé | **oui** |
| `propagation-manquante` | le site ne porte **rien** sur ce ticket | **oui** |

`non-seme` (le jeu n'a pas été semé) n'est pas un échec : c'est une absence.

## Les écarts connus au 12 novembre 2026

Ils sont **figés dans le code** (`KNOWN_GAPS`), avec leur cause :

| Écart | Cause |
|---|---|
| `fr-02-anonyme` | le portail anonyme n'est pas reproductible avec un jeton d'admin (T1 au lieu de T0) |
| `fr-10-exfiltration` | l'URL est détectée (C2-05), mais le niveau rendu est `review` et non `suspect` |
| `fr-15-repartie` | la charge est répartie sur trois commentaires : C3 ne voit qu'un segment à la fois |
| `fr-17-integration` | un compte d'intégration n'est pas reproductible avec un jeton d'admin |
| `fr-19-langue-rare` | le modèle a trouvé la charge en langue rare : le produit fait **mieux** que l'attente du jeu |

Un écart qui sort de cette liste est une régression — et la porte échoue.

## Ce que ce test ne peut pas faire

- Il exige **un site** : il est donc hors de la CI, et c'est dit. Le contrôle
  automatique qui tourne partout est `tools/check-traceability.mjs` (l Existence
  des fichiers) ; celui-ci va **exécuter** le produit.
- Il ne mesure pas les **délais** : c'est le lot `slo` qui s'en charge.
- Il ne traite que l/français tant que le jeu anglais n'est pas semé : le
  protocole est le même, la langue est un paramètre.
- Il **constate** : il ne rejoue pas le traitement des tickets déjà analysés
  (`scripts/replay-batch.mjs` constate lui aussi).

## Pourquoi c'est le test le plus rentable du dépôt

Les cinq défauts de la nuit du 12 novembre (aucune table créée à cause d'un
mot réservé SQL, `415` faute d'en-tête, propriété stockée en double, file C3 qui
ne démarrait pas, détection du banc différente de celle du ticket) sont
**invisibles** pour tout test qui ne parle pas à la plateforme. Ce test parle à
la plateforme, sur des données réelles, et compare à des attendus figés.

C'est aussi pour cela qu'il est **hors de la CI** : la CI est un garde-fou
rapide, ce test est une **mesure**. Les deux ne se remplacent pas.
