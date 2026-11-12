# Diagnostic — l'app se lit elle-même

Un `webtrigger` (`pieges-diagnostic`) rend, en JSON et en texte lisible, l'état
de l'app **sans passer par personne** : quelles tables existent, ce qu'elles
contiennent, ce que l'invocation consomme, ce que le journal a vu. C'est la
réponse au « qu'est-ce qui casse, et pourquoi ? » du matin, quand un agent
automatisé ne peut pas regarder l'écran.

## 1. Ce que le rapport dit

Assemblé par `src/core/diagnostic.ts` (domaine pur), alimenté par
`src/jobs/diagnostic.ts` (glue Forge). Sept sections :

| Section | Ce qu'elle montre | D'où ça vient |
|---|---|---|
| **Version / généré le** | la version publiée (`APP_VERSION`, alignée sur `package.json`) et l'instant du rapport | constante + horloge du runtime |
| **Tables** | les seize tables du modèle (§19), chacune avec son nombre de lignes | `SELECT COUNT(*)` sur chaque table |
| **Budget de requêtes** | écritures / lectures / requêtes / écritures sautées / plafond, et le mode dégradé | `budgetReading()`, le getter prévu par le lot 1 |
| **Latences par étape** | les cinq intervalles du §18, plus l'attente dans la file C3 | `src/core/timing.ts`, d'après le journal |
| **Erreurs récentes** | les dix derniers incidents du journal (genre + champs scalaires) | événements `*-failed` / `*-refused` / `*-exceeded` |
| **Tickets traités** | le nombre de tickets qui ont un état (_issue_state_) | la section « Tables » |
| **Files en attente** | la profondeur de la file C3 (borne basse) | `scan` − `c3` dans le journal |

**Aucune ligne ne contient de texte de ticket.** Le journal est déjà assaini
(`src/platform/log.ts` retire `text`, `body`, `content`, `excerpt`…), et le
rapport ne garde que des volumes, des durées, des noms de table et des genres
d'incident. Ce qui manque est dit, jamais comblé par un chiffre inventé : la
valeur absente s'affiche « à mesurer sur site ».

## 2. Comment le lire en deux minutes

1. **Version et tables** : la version dit *quoi* tourne ; les tables et leurs
   lignes disent *où en sont les données*. Une table qui ne devrait pas être
   vide (ex. `finding`) l'est ? Le déclencheur n'a pas écrit.
2. **Budget** : `écritures x / 120`. `x` proche de 120, ou `mode dégradé : oui`
   → les écritures sont sautées : l'analyse rend quand même un résultat, mais
   plus rien n'est persisté (c'est le comportement voulu du lot 1, pas un bug).
3. **Latences et file C3** : l'attente C3 face à l'objectif de 30 s. Une attente
   qui grimpe = la file ne se vide pas.
4. **Erreurs récentes** : la liste des incidents, du plus ancien au plus récent.
   `storage-budget-exceeded` = quota Forge SQL atteint ; `c3-enqueue-failed` =
   la file d'analyse refuse du monde.

L'appel :

```bash
export PIEGE_TOKEN="<jeton de diagnostic, §11>"
curl -H "Authorization: Bearer $PIEGE_TOKEN" -H "x-account-id: <accountId>" \
  "https://<hote>.forgeapps.net/<chemin>/pieges-diagnostic?lang=en"
```

`?lang=en` rend le texte en anglais ; absent, le texte est en français. Sans
jeton valide, le `webtrigger` rend **401** (même réponse pour un jeton absent et
un jeton faux — seul le journal distingue les cas, §11).

## 3. Mesures déjà faites

Chiffres réels, pas des intentions — tout le reste est dit « à mesurer sur
site ».

| Mesure | Valeur | Source |
|---|---|---|
| tables du modèle | **16** (`segment`, `issue_state`, `finding`, `verdict`, `original`, `outbound_check`, `tainted_session`, `canary`, `canary_hit`, `trust_rule`, `pattern`, `campaign`, `event`, `hook_token`, `draft`, `settings`) | `src/platform/sql.ts` (§19) |
| plafond d'écritures par invocation | **120**, alerte à 80 % | `src/platform/budget.ts` |
| objectif d'attente de la file C3 | **30 s** | cahier (§18, #85) |
| bornes lues par diagnostic | **2 000** entrées de journal, **10** erreurs listées | `src/jobs/diagnostic.ts` |
| coût du diagnostic lui-même | **≈ 19 lectures, 0 écriture** (1 vérification de schéma + 16 `COUNT` + 2 lectures de tiroir) | compté dans le budget de l'invocation |
| jeu d'essai semé (site de démo) | **38 demandes** (19 fr, 19 en) ; 19/19 propagées, **14/19 conformes**, 5 écarts caractérisés | `docs/DEMO-LIVE.md` |

**Latences sur le site** : non sondées à ce jour — la sonde
(`tools/probe-site.mjs`) n'a pas été passée, `docs/MESURES.md` §5 le dit
explicitement. Le rapport de diagnostic affiche donc « à mesurer sur site »
pour ces intervalles jusqu'au premier sondage, et n'invente rien d'ici là.

## 4. Limites honnêtes

- **Budget** : le getter `budgetReading()` porte le budget de **l'invocation
  courante**. Quand on appelle le webtrigger, c'est donc celui du diagnostic
  (≈ 19 lectures) qui s'affiche. Le relevé de fin d'une invocation d'analyse
  n'est pas journalisé d'une invocation à l'autre : ce n'est pas couvert par ce
  lot.
- **Latences** : le journal ne date pas la création du ticket ni la mise en file
  C3 (`docs/MESURES.md` §3). L'attente de file est une **borne basse** ; les
  intervalles origine/C1/C2 restent « à mesurer sur site ».
- **Profondeur de file** : Forge ne donne pas la profondeur réelle de sa file ;
  la « file en attente » est l'écart `scan` − `c3`, une borne basse, jamais une
  surestimation.
- Ce rapport **réduit le temps de diagnostic**, il ne « protège » pas : il ne
  remplace ni le runbook (`docs/RUNBOOKS.md`) ni le post-mortem
  (`docs/POST-MORTEM.md`).