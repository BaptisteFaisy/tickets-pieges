# Pipeline du dépôt — file de merge, gardes et agents

Ce document décrit la chaîne qui fait passer une PR du dépôt **Tickets piégés**
(`BaptisteFaisy/tickets-pieges`) à `main`. Il n'y a **qu'un seul pilote de
merge** : la file Mergify. Ni les gardes ni les agents ne mergent quoi que ce
soit.

Le dépôt est mono-paquet : un `tsconfig.json` à la racine, aucun workspace npm,
les tests vivent à côté du code (`src/**/*.test.ts`). Les quatre commandes de
contrôle sont `npm run typecheck`, `npm run test`, `npm run limits` et
`npm run manifest` (`npm run check` enchaîne les trois premières).

## 1. Les checks requis

Trois checks sont exigés par le ruleset de `main` et par la file
(`.mergify.yml`) :

| Check | Workflow | Rôle |
|---|---|---|
| `ci` | `.github/workflows/ci.yml` | types (`tsc --noEmit`), tests vitest, limites de taille, manifeste Forge, sanity docs, tests des gardes |
| `ci-budget` | `.github/workflows/ci-budget.yml` | aucun job de CI au-delà de 5 minutes, `concurrency` et `fetch-depth: 1` présents |
| `couche0` | `.github/workflows/couche0.yml` | périmètre déclaré dans `## Scope` + motifs interdits dans le diff |

`stale-base-guard` est informatif : il signale une branche trop loin de `main`
et reste vert dans ce cas (la file met la branche à jour par merge de `main`).
`triage-rouge` et `pr-auto-merge` ne publient aucun check requis : ils
commentent, labellisent et saisissent les agents.

### Le budget de 5 minutes

Chaque job déclare `timeout-minutes: 5` au plus, et `.github/ci-budget/
check_timeouts.py` le vérifie à chaque PR. Deux dispositifs tiennent ce budget
sur des runners self-hosted :

- **`node_modules` reste en place** entre les runs (`git clean -ffdx -e
  node_modules`) et n'est réinstallé que si l'empreinte de `package-lock.json`
  change (`node_modules/.ci-lock-hash`) ;
- **les temporaires vont sur le disque** (`TMPDIR=$HOME/.cache/ci-tmp`) : le
  `/tmp` des runners est un tmpfs partagé et saturable, où vitest meurt en
  `ENOSPC` alors que le disque a encore de la place.

Node n'est pas sur le `PATH` par défaut du runner : le job l'ajoute depuis
`$HOME/.local/node/bin` et échoue explicitement s'il est absent.

## 2. Les runners

Quatre workers self-hosted sur la machine r630 : `r630-tickets-pieges-01` à
`r630-tickets-pieges-04`, label `tickets-pieges-worker` (avec `self-hosted`,
`Linux`, `X64`, `ci-node`). La file Mergify spécule sur quatre têtes au plus
(`merge_queue.max_parallel_checks: 4`), les lots allant de 1 à 3 PR
(`batch_size`), fusionnées en squash.

## 3. La file de merge

`.mergify.yml` : `merge_method: squash` (une PR = un commit sur `main`) et
`update_method: merge` (mise à jour par fusion de `main`, jamais de réécriture
de la branche de PR). Le rebase de GitHub refusait les PR ayant déjà fusionné
`main` (« GitHub cannot rebase the pull request ») : c'est ce qui a motivé ce
réglage. L'entrée en file est native (`merge_protections_settings.
auto_merge_conditions: true`) ; les labels `urgent` et `priority-low` règlent
l'ordre.

## 4. Le balayeur (`pr-auto-merge`)

Il se réveille sur `push` vers `main`, à la fin d'un run `CI`, et sur
`pull_request: edited` / `ready_for_review`. Il inventorie les PR ouvertes, les
classe (`CLEAN`, `BEHIND`, `DIRTY`, `BLOCKED`, `DRAFT`) et agit :

- `CLEAN` → embarquement dans la file ;
- `BEHIND` → mise à jour par Mergify ;
- `DIRTY` → rebase tenté, et **en cas de conflit, saisine de l'agent de
  conflit** ;
- `BLOCKED` sur un check rouge → panne d'infrastructure relancée (deux fois
  maximum par tête), `couche0` rouge sur le périmètre confié à l'agent de
  périmètre, échec réel commenté (et confié à l'agent de réparation quand
  `triage-rouge` n'est pas armé).

Un backoff par PR évite de ressaisir un agent sur une tête qui n'a pas bougé.

## 5. Les agents

| Agent | Fichier | Déclencheur | Ce qu'il fait |
|---|---|---|---|
| Conflit | `.github/fireworks/conflict_agent.py` | PR `DIRTY` après un rebase en conflit | résout chaque conflit élémentaire, garde les deux intentions, pousse sur la branche de la PR |
| Périmètre | `.github/fireworks/scope_agent.py` | `couche0` rouge sur le périmètre | propose un corps de PR avec le `## Scope` manquant |
| Test rouge | `.github/fireworks/test_agent.py` | `ci` rouge + verdict de triage | propose un correctif de code |
| Triage | `tools/triage_test.py` | `ci` rouge | dit si le test tombé est dans le périmètre de la PR, et s'il passe quand il est rejoué seul |
| Repli hermes | `.github/hermes/a2a.py` | l'API du fournisseur refuse | repose la même question à l'agent `hermes` du daemon ZeroClaw du runner (A2A) |

### Fournisseur de modèle

Les agents interrogent une API compatible OpenAI. Par défaut : **InferHub**
(`https://api.inferhub.dev/v1/chat/completions`, modèle `combo/cheap`). Les
variables génériques `MODEL_API_KEY`, `MODEL_API_URL`, `MODEL_NAME` ont la
priorité sur les noms historiques `FIREWORKS_API_KEY`, `FIREWORKS_BASE_URL`,
`FIREWORKS_MODEL`. Les clés sont posées par `gh secret set` : jamais de secret
dans l'arbre.

Si l'API refuse (clé, quota, modèle retiré), le repli interroge l'agent
`hermes` du daemon ZeroClaw local. Si le repli est indisponible, l'erreur
d'origine est conservée, un commentaire est posé et le label
`intervention-humaine` est ajouté — **jamais de CI rouge à cause d'un agent**.

### Garde-fous communs

- empreinte par tête de PR + cooldown, plafond de saisines par période
  (`quota.py`) ;
- périmètre d'écriture : la branche de la PR uniquement — jamais `main`,
  `.github/`, `.mergify.yml` ni les gardes (`REFUSED_PREFIXES`) ;
- une résolution qui ne compile pas n'est jamais poussée
  (`compilation_gate.py`) ;
- les journaux en ajout pur sont réunis sans modèle (`union_journal.py`) ;
- le succès se juge sur l'état réel de la PR (`mergeable_state`), jamais sur le
  récit du modèle ;
- coupe-circuit : `FIREWORKS_AGENT_RESOLVE=0` désactive toute saisine.

## 6. Les gardes testées par la CI

Le job `ci` exécute les tests des gardes elles-mêmes, en bibliothèque standard
et sans réseau :

```bash
python3 .github/hermes/test_a2a.py
python3 tools/test_triage.py
python3 .github/couche0/test_check_couche0.py
python3 .github/fireworks/test_conflict_agent.py
python3 .github/fireworks/test_provider.py
python3 .github/fireworks/test_test_agent.py
python3 .github/fireworks/test_scope_agent.py
python3 .github/fireworks/test_union_journal.py
python3 .github/fireworks/test_quota.py
```

Modifier un fichier de garde (`.github/couche0/`, `.github/ci-budget/`,
`.github/workflows/{ci,ci-budget,couche0,pr-auto-merge}.yml`) exige la mention
`PIEGES_ALLOW_GUARD_BUMP` dans le corps de la PR.

## 7. Ce qui ne dépend pas de la CI

Le déploiement de l'app Forge (`forge deploy`, `forge install`), l'installation
sur un site Jira Service Management et la création réelle de tickets demandent
un tenant Atlassian et un jeton Forge : voir `README.md` et
`docs/CAHIER-DES-CHARGES.md`. Tout ce que l'app calcule — détection,
hachage, cadrage, i18n — est vérifié ici sans tenant, par `npm run check` et
`npm run replay`.
