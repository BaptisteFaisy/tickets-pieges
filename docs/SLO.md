# SLO — les budgets de rapidité du §21, rendus vérifiables

Le cahier des charges (§21, « Rapidité ») pose trois exigences chiffrées :

- origine et couches C1 et C2 en moins de **2 s** ;
- couche C3 en moins de **30 s** ;
- `get-request-safe` en moins de **2 s**.

Avant ce lot, ces exigences étaient des **phrases**. Elles sont maintenant des
**budgets vérifiables** : un seuil, une fenêtre d'étapes, un verdict, et une
règle d'alerte. Le code est dans `src/core/slo.ts` (budgets, verdict, alerte)
et `src/core/timing.ts` (mesure). Règle de la maison (§21) : ce qui n'est pas
mesuré est écrit « à mesurer sur site » — aucun chiffre n'est inventé.

## 1. Les trois budgets

| Budget | Seuil | Fenêtre mesurée | Code |
|---|---|---|---|
| origine + C1 + C2 | < 2 s | `created → c2` | `LEXICAL_BUDGET_MS`, budget `lexical` |
| couche C3 (file asynchrone) | < 30 s | `created → c3` (et attente de file) | `C3_OBJECTIVE_MS` (`src/core/timing.ts`) |
| `get-request-safe` (outil MCP) | < 2 s | latence d'outil, hors trace | `SAFE_TOOL_BUDGET_MS`, budget `safe-tool` |

Chaque budget a une **fenêtre d'étapes** : deux extrémités datées délimitent la
durée jugée, les étapes du milieu peuvent manquer. Quand elles manquent, la
mesure est déclarée **borne** (`bound`), pas exacte — on sait ce qui est daté
et ce qui ne l'est pas (`missingStages`).

## 2. Méthode de mesure — temps injectés, donc reproductible

`src/core/timing.ts` est un domaine pur : aucun `@forge/*`, aucune E/S, aucune
lecture d'horloge — l'instant est **toujours un paramètre**. Les tests
(`src/core/timing.test.ts`, `src/core/slo.test.ts`) n'attendent donc jamais
réellement : ils injectent des temps et vérifient la règle, pas la vitesse de
la machine.

Le verdict d'un budget est `tenu`, `dépassé` ou `à mesurer`. Un dépassement est
**caractérisé** : l'écart en millisecondes (`overshootMs`) et la part du budget
consommée (`sharePct`, en pourcentage). Un budget se juge sur son **pire** cas,
jamais sur une moyenne (`docs/MESURES.md` §4). Une mesure absente n'est jamais
comptée comme tenue.

La mesure est faite **par type d'événement** (création de demande, commentaire,
mise à jour, lien) : `evaluateByEventKind()` rend un verdict par type. La
création est l'exposition la plus large ; un lien n'expose que ce que la source
expose.

## 3. Règle d'alerte

> Un budget dépassé n'est pas une faute : c'est une information à remonter,
> avec le taux d'atteinte.

`src/core/slo.ts` ne lève jamais d'erreur. `sloStatus()` rend un niveau
`info` (jamais « faute »), le taux d'atteinte (`hitRate`), la liste des budgets
dépassés et le pire écart. Un dépassement signale qu'un seuil est franchi et
qu'il faut regarder — il n'interrompt pas l'analyse, qui rend quand même son
résultat (voir `docs/BUDGET-SQL.md`, lot 1, pour la dégradation propre des
écritures).

## 4. Ce qui est mesuré ici — chiffres réels

Mesuré **le 12 novembre 2026** sur le poste de développement (Linux, Node
26.9.0, processeur i5 de 11e génération), **hors site** : le domaine seul, sur
les **38 demandes** du jeu d'essai intégré (`src/sample/`), 19 passes utiles
après une passe d'échauffement (722 mesures), horloge `performance.now`.

Le banc a rejoué les cinq étapes du §18 sans Jira, sans file C3, sans modèle
(`src/replay/engine.ts`) et relevé les durées de chaque étape du domaine :

| Étape du domaine | médiane | p95 | pire |
|---|---|---|---|
| origine (par demande) | 0,001 ms | 0,004 ms | 0,03 ms |
| C1 + C2 — détection (tous segments d'une demande) | 0,11 ms | 0,28 ms | 2 ms |
| suspicion + mode | 0,003 ms | 0,008 ms | 0,2 ms |
| **fenêtre lexicale (origine + C1 + C2)** | **0,11 ms** | **0,28 ms** | **2 ms** |

Verdict : sur le **domaine seul**, le budget « origine + C1 + C2 < 2 s » est
tenu avec une marge de quatre ordres de grandeur. Ce chiffre prouve seulement
que **le calcul n'est pas le goulot** — il ne couvre pas les lectures/écritures
Jira, la latence du déclencheur ni le réseau, qui dominent le chemin complet.

## 5. Ce qui reste à mesurer sur le site

Trois choses restent « à mesurer sur site », et le sont dit comme telles :

- **la fenêtre d'exposition réelle** (`created → mode appliqué`) : elle inclut
  le temps passé dans Jira et le déclencheur, que seul le site horodate
  (`docs/MESURES.md` §3 — aujourd'hui l'événement `scan` borne l'analyse
  lexicale sans séparer origine, C1 et C2) ;
- **la file C3 sur 500 messages** (médiane, p95, pire attente, face à 30 s) —
  `src/jobs/timing.ts` la lit dans le journal, mais l'instant de mise en file
  n'est pas journalisé (la file mesurée est une borne basse) ;
- **la latence de `get-request-safe`** : l'outil n'existe que sur le site
  déployé.

## 6. Le contrat des cinq étapes

`TIMING_STAGES` (`src/core/timing.ts`) nomme désormais les **cinq** étapes du
§18 : origine, C1/C2, mise en file C3, suspicion + mode, journal. Aujourd'hui,
la mise en file C3 (`enqueued-c3`) et l'écriture du journal (`journal`) ne sont
**pas datées** par le journal de la plateforme : elles sont déclarées pour que
le contrat soit complet et que le manque soit visible, pas pour faire croire
qu'elles sont mesurées. Dater ces deux étapes (un événement dédié dans
`src/jobs/pipeline.ts`, un branchement dans `src/jobs/timing.ts`) resserrerait
les bornes — c'est un changement hors de la propriété foncière de ce lot,
consigné dans le corps de la PR.