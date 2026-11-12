# Runbooks — symptôme → diagnostic → geste → vérification

> Un runbook est écrit **après** un incident, jamais avant. Chaque entrée part
> d'un symptôme que quelqu'un a réellement vu, et se termine par une **vérification**
> — la commande qui prouve que le problème est réglé.
>
> Commandes utiles : `forge logs -e development -s 30m -n 60` (journaux),
> `forge install --upgrade …` (nouveaux scopes), `python3 scripts/verify-demo-site.py …`
> (l'état écrit sur les tickets), `bash scripts/rollback.sh --dry-run` (retour arrière).

---

## R1 — « le sas retient tout »

**Symptôme.** Toute réponse publique est refusée, même une réponse banale.

**Diagnostic.**
1. `forge logs -e development -s 30m -n 60 | grep -i "outbound\\|sas"` — le refus porte
   portent sur un élément en cause (autre organisation, clé d'un autre ticket, jeton).
2. Vérifier les **organisations connues** : le sas compare aux organisations de la
   demande ; une liste vide fait tout ressembler à une fuite.
3. Vérifier les **formules à ignorer** : une signature de courriel qui contient
   « merci de ne pas… » peut ressembler à une consigne.

**Geste.** Corriger les réglages du projet (organisations de confiance, formules
ignorées), pas le code. Si le refus est un faux positif, le signaler dans la file
des suspects : la règle fautive est **rétrogradée** (`precision.ts`).

**Vérification.** Rejouer la demande et relire la propriété :
`python3 scripts/verify-demo-site.py --site … --lang fr` → la demande doit passer
de `suspect` à `clean`/`review` selon le cas.

---

## R2 — « l'origine ne s'écrit plus »

**Symptôme.** Les déclencheurs partent, mais la propriété `pieges` n'apparaît sur
aucun ticket, et le journal est muet ou en erreur.

**Diagnostic.**
1. `forge logs -e development -s 30m -n 60 | grep -i "error\\|ER_PARSE\\|415\\|Limits"` :
   - `ER_PARSE_ERROR` → le schéma SQL : une table ou une colonne est invalide
     (`precision` est un mot réservé — voir `docs/FORGE.md` §2) ;
   - `415` → une écriture REST part sans `Content-Type: application/json` ;
   - `Limits for the current installation have been exceeded` → **quota Forge SQL** :
     le schéma est recréé à chaque invocation (corrigé : une lecture suffit) ou le
     volume d'un lot dépasse le quota.
2. `forge logs … | grep -i "c3-enqueue-failed\\|self-echo-ignored"` : la file C3
   ou la garde anti-écho Confluence.

**Geste.**
- schéma invalide : corriger le DDL (`src/platform/sql.ts`), **relire la liste des
  mots réservés MySQL** avant de rejouer ;
- 415 : l'en-tête est posé par `requestJson` — vérifier qu'aucun appel ne contourne
  ce point d'entrée ;
- quota : réduire le lot traité par invocation, ou laisser le produit **dégrader**
  (voir `docs/BUDGET-SQL.md` quand il existe) : la détection continue, la
  persistance saute, et c'est journalisé.

**Vérification.** Créer une demande témoin et relire sa propriété par REST :
`curl -u "$EMAIL:$(cat ~/.atlassian-api-token)" -H 'Accept: application/json' \
 "https://$SITE/rest/api/3/issue/<CLÉ>/properties/pieges"` → la réponse doit
contenir `trustLevel`.

---

## R3 — « la file C3 ne part pas »

**Symptôme.** La couche C3 ne rend aucun avis ; `Queue.push` répond 400, ou le
consumer n'est jamais appelé.

**Diagnostic.**
1. `forge logs … | grep -i "Queue.push\\|400 Bad Request"` → la forme du consumer
   est peut-être la mauvaise : `resolver: { function, method }` **n'enregistre pas
   la file** dans le runtime. La forme qui fonctionne est `function: <clé>`.
2. `grep -n "consumer:" -A4 manifest.yml` → vérifier la forme déclarée.
3. `grep -n "C3_QUEUE" src/jobs/support.ts` → le nom de file doit être **exactement**
   celui du manifeste (`queue:`), sinon la publication vise une file inexistante.

**Geste.** Corriger le manifeste (une seule forme), redéployer, puis rejouer une
demande dont la charge n'est visible que par le modèle (cas `fr-11` du jeu
d'essai).

**Vérification.** La propriété de la demande doit passer de `clean` à `review` :
le modèle a vu la consigne reformulée.

---

## R4 — « la propriété est illisible »

**Symptôme.** La propriété existe mais contient `value.value`, ou le lecteur ne
trouve pas `trustLevel`.

**Diagnostic.** Relire par REST et regarder la forme :
- corps **stocké tel quel** → il faut envoyer la **valeur nue**, pas
  `{ "value": … }` ;
- lecture `value.value` → le corps a été enveloppé à tort.

**Geste.** `src/platform/jira.ts` (et `src/platform/confluence.ts` pour les pages) :
envoyer `JSON.stringify(value)`.

**Vérification.** Relire la propriété : `value.trustLevel` doit être présent
directement sous `value`.

---

## R5 — « la détection ne voit rien »

**Symptôme.** Le ticket est classé `clean` alors que la charge est évidente.

**Diagnostic.**
1. Comparer le **jeu d'essai** et le **ticket** : `python3 scripts/verify-demo-site.py`
   dit si le jeu et le site divergent. Un écart sur les kinds signale deux
   implémentations de la détection (voir `docs/CONTRAT-DETECTION.md`).
2. `forge logs … | grep -i "c1\\|C2\\|decode"` : une famille peut ne pas être jouée
   (le contrat de détection le dirait).
3. Vérifier que le **texte** lu par l'app est bien le texte analysé : les
   tickets Jira portent l'ADF, pas une chaîne.

**Geste.** Ne pas « corriger » au cas par cas : si l'écart vient de la
détection, corriger `src/core/detect.ts` (source unique) ; s'il vient du texte
lu, corriger `adfToText`.

**Vérification.** Le rapport de vérification doit afficher des écarts **connus** et
aucun écart nouveau.

---

## R6 — « le quota SQL est atteint »

**Symptôme.** `Limits for the current installation have been exceeded`.

**Diagnostic.** Compter les requêtes par analyse : le budget est journalisé avec
chaque invocation (voir `docs/BUDGET-SQL.md`). Le schéma recréé à chaque
invocation est la première cause ; le volume du lot, la seconde.

**Geste.** Ne pas augmenter le quota (on ne le maîtrise pas) : réduire le travail
par invocation (une lecture au lieu de seize écritures de schéma), traiter par
lots plus petits, ou activer la **dégradation** : la détection continue, seules
les écritures sautent, et le journal le dit.

**Vérification.** Relire le journal de l'invocation : `degraded: true` et un
événement `storage-budget-exceeded` — donc le produit **annonce** sa dégradation
au lieu d'échouer en silence.
