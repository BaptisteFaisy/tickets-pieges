# Rejouer un lot de tickets

## Ce que « rejouer » veut dire (et ne veut pas dire)

Rejouer, ici, c'est **constater** : relire ce que l'app a écrit sur des tickets
réels et le comparer à l'attendu. Ce n'est pas une action sur les tickets — les
relancer modifierait le site de démonstration et brouillerait la mesure.

Quand un correctif est déployé (correction de détection, de niveau, de property),
le rejeu répond à une seule question : **les tickets déjà traités portent-ils le
nouvel état ?** Si non, c'est que l'app ne retraite pas ce qui a déjà été
analysé — et c'est une décision à prendre (recalcul sur lot, ou version de règles
différente, voir `docs/CONTRAT-DETECTION.md`).

## La commande

```bash
node scripts/replay-batch.mjs --site one-atlas-cndz.atlassian.net \
  --email moi@example.com --lang fr            # tout le jeu semé
node scripts/replay-batch.mjs --site … --email … --keys SUP-205,SUP-206
node scripts/replay-batch.mjs --site … --email … --json > out/replay.json
```

Elle lit la propriété `pieges` de chaque ticket et rend, par ticket, l'origine,
la suspicion, le mode et la date d'analyse ; puis le nombre de tickets **sans
propriété** (ceux que l'app n'a pas traités).

## Rejouer une recette entière

```bash
python3 scripts/seed-demo-site.py --site … --email … --lang fr   # semer (idempotent)
python3 scripts/verify-demo-site.py --site … --email … --lang fr  # la recette §23
node scripts/replay-batch.mjs --site … --email … --lang fr       # l'état porté
```

Le semis est **idempotent** (relancer ne recrée pas), la vérification compare à
l'attendu du jeu, et le rejeu constate. Les trois se combinent : semer une
demande nouvelle, vérifier qu'elle est traitée, puis relire l'ensemble.

## Après un correctif déployé

1. `forge deploy --non-interactive -e development --approve MAJOR_VERSION_RULE`
2. `forge install --upgrade --site … -p jira -e development --confirm-scopes --non-interactive`
   (si des scopes ont changé)
3. `node scripts/replay-batch.mjs …` → les tickets qui n'ont pas bougé sont
   ceux que l'app **ne retraite pas** : c'est information, pas anomalie.
4. Pour un traitement neuf : semis d'une demande témoin, puis vérification.

## Limites

- Le rejeu **constate**, il ne rejoue pas le traitement : la commande qui
  rejoue vraiment un lot de tickets est à écrire (elle demandera une action
  d'écriture sur le site — donc une décision, pas un script silencieux).
- Les écarts **de reproduction** (canal anonyme, compte d'app, courriel, pièce
  jointe) ne sont pas des échecs : ils sont dans le rapport de semis.
- Une demande dont l'analyse a été **neutralisée** (mode « neutraliser ») porte un
  état particulier : le rejeu le montre tel quel, il ne le juge pas.
