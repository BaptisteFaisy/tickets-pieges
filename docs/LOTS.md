# Découpage en lots — qui écrit quoi

Un lot = une branche = une PR = un propriétaire. Les fichiers d'un lot ne sont
touchés par personne d'autre : c'est ce qui permet de travailler en parallèle
sans conflit, et c'est ce que `couche0` vérifie (tout fichier modifié doit être
déclaré dans le `## Scope` du corps de la PR).

Références : `docs/CAHIER-DES-CHARGES.md` (TP-nn = exigence du §15).

## Tronc (déjà posé, ne pas réécrire)

| Fichier | Contenu |
|---|---|
| `manifest.yml` | tous les modules, les dix actions, l'agent, la skill, les écrans |
| `src/core/types.ts` | tous les types du domaine |
| `src/core/hashing.ts` | empreintes, identifiants aléatoires, shingles |
| `src/core/i18n.ts` + `src/core/catalog/*.ts` | textes visibles (un catalogue par lot) |
| `src/platform/schema.ts` | tables (§19), `Store`, `JiraPort`, `ModelPort`, `Clock` |
| `src/platform/memory.ts` | `Store` en mémoire (tests, banc d'essai) |
| `src/platform/http.ts` | types `webtrigger` |
| `src/mcp/result.ts` | enveloppe des outils |
| `src/index.ts` | réexportations vers les handlers du manifeste |
| `tools/check_limits.py` | garde de taille (< 500 / < 50) |

Modifier le tronc demande une PR dédiée qui le dit explicitement dans son corps.

## Vague 1 — domaine pur, aucun lot ne dépend d'un autre

| Lot | Fichiers | Exigences | Livrable |
|---|---|---|---|
| **origine** | `src/core/origin.ts`, `src/core/trust-rules.ts`, `src/core/catalog/origin.ts` | TP-01, TP-02 | niveau T0-T3 calculé sans modèle, raisons tracées, réglages domaines/organisations/intégrations |
| **c1** | `src/core/c1-concealment.ts`, `src/core/catalog/detection-c1.ts` | TP-03 (§6 C1) | invisibles, bidi, texte couleur du fond, texte alternatif, libellé/lien, blocs encodés |
| **c2** | `src/core/c2-addressing.ts`, `src/core/lexicon-fr.ts`, `src/core/lexicon-en.ts`, `src/core/catalog/detection-c2.ts` | TP-03 (§6 C2) | lexiques fr/en : impératifs, changement de rôle, faux marqueurs système, outils, exfiltration |
| **c3** | `src/core/c3-model.ts`, `src/platform/llm.ts`, `src/core/catalog/detection-c3.ts` | TP-04 | prompt encadré, format de réponse vérifié, non-conforme = suspect, cache par empreinte |
| **constats** | `src/core/findings.ts`, `src/core/suspicion.ts`, `src/core/context.ts`, `src/core/catalog/detection-c4.ts` | TP-05, TP-06 (données), §6 C4 | assemblage des constats, pondération C4, niveau de suspicion, récap neutre |
| **entrée** | `src/core/framing.ts`, `src/core/neutralize.ts`, `src/core/modes.ts`, `src/core/catalog/framing.ts` | TP-08, TP-09, TP-10 | encadrement à identifiant aléatoire, bandeau d'étiquetage, neutralisation + restauration |
| **sortie** | `src/core/outbound.ts`, `src/core/catalog/outbound.ts` | TP-12, TP-13, TP-24 | données d'un autre client, adresse inconnue, requête longue, bloc encodé, hors sujet |
| **hérédité** | `src/core/campaigns.ts`, `src/core/fingerprint.ts`, `src/core/inheritance.ts`, `src/core/session.ts` | TP-20, TP-21, TP-23, TP-25 | campagnes par empreinte, héritage vers ticket lié/cloné, recopie interne, session contaminée |
| **exercice** | `src/core/canary.ts`, `src/core/exposure.ts`, `src/core/precision.ts`, `src/core/catalog/canary.ts` | TP-14, TP-15, TP-16 | ticket témoin, coups et rapport d'exposition, précision par règle et rétrogradation |
| **plateforme** | `src/platform/db.ts`, `src/platform/jira.ts`, `src/platform/jsm.ts`, `src/platform/log.ts`, `src/platform/properties.ts`, `src/platform/attachments.ts` | §19, TP-07, TP-22 | `Store` Forge SQL, ports Jira/JSM, propriété indexée, journal, pièces jointes |
| **jeu d'essai** | `src/sample/dataset.ts`, `src/sample/load.ts`, `data/sample/*.json`, `tools/replay.mjs` | TP-18, §25 | demandes d'exemple fr/en avec attendu, banc d'essai rejouable hors ligne |
| **docs** | `docs/METHODE.md`, `docs/VALIDATIONS.md`, `docs/JUDGES.md`, `docs/VIDEO.md`, `docs/SUBMISSION.md` | §21, §23, §24, §25 | méthode, recette §23 point par point, instructions aux juges (anglais), scénario vidéo |
| **socle CI** | `.github/**`, `.mergify.yml`, `tools/validate_manifest.mjs`, `docs/PIPELINE.md` | — | file Mergify, garde `couche0`, budget 5 min, agents de conflit/périmètre/test sur InferHub |

## Vague 2 — glue, après fusion de la vague 1

| Lot | Fichiers | Exigences | Livrable |
|---|---|---|---|
| **jobs** | `src/jobs/triggers.ts`, `src/jobs/consumer.ts`, `src/jobs/scheduled.ts` | TP-01, TP-04, §18 | le déroulement en cinq étapes à l'arrivée d'une demande, file C3, tâches planifiées |
| **hook** | `src/jobs/webhook.ts`, `src/hook/config.ts`, `src/hook/inbound.ts`, `src/hook/outbound.ts`, `src/hook/token.ts`, `src/core/catalog/hook.ts` | TP-19, §11 | réécriture des lectures, confirmation des écritures publiques, fichier de hooks généré, jeton |
| **mcp** | `src/mcp/actions.ts` (+ `src/mcp/read.ts`, `src/mcp/write.ts` si besoin) | TP-17, §16 | les dix outils, enveloppes uniformes, verbes GET pour les lectures |
| **ui** | `src/resolvers/*.ts`, `src/ui/**`, `src/core/catalog/ui.ts` | TP-06, TP-14, §17 | panneau du ticket, file « Suspects », revue d'un constat, réglages, exposition, originaux, banc d'essai |

## Règles communes à tous les lots

1. **Taille** : moins de 500 lignes par fichier, moins de 50 lignes par fonction
   (`npm run limits`). Au-delà, découper — jamais laisser grossir.
2. **Zéro duplication** : un helper existe dans `src/core/hashing.ts`,
   `src/mcp/result.ts`, `src/platform/http.ts` — le réutiliser. Chercher avant
   d'écrire.
3. **Domaine pur** : `src/core/*` n'importe aucun `@forge/*`, ne lit ni l'heure ni
   le réseau. L'horloge est passée en paramètre (`Clock`).
4. **Textes visibles** dans `src/core/catalog/<domaine>.ts`, en français **et** en
   anglais (§21). Jamais de chaîne utilisateur en dur dans le code.
5. **Tests** : chaque lot livre ses `*.test.ts` à côté de son code, sans réseau,
   et `npm run typecheck && npm test` vert localement avant de pousser.
6. **Pas de fausse assurance** (§21) : « réduit le risque », jamais « protège » ;
   ce qui n'a pas été analysé est dit.
7. **Corps de PR** : une section `## Scope` liste chaque fichier touché, au format
   `` - `chemin` — raison ``. `couche0` refuse une PR dont le périmètre n'est pas
   déclaré. Ne jamais toucher `.github/` hors du lot socle CI.
8. **Motifs interdits** dans le diff : `--force` sans `--force-with-lease`,
   `pull_request_target`, clé `sk-…`/`ghp_…` en clair, `-X ours|theirs`.
9. **Dates** : ne pas écrire de date au format `AAAA-MM-JJ` antérieure au
   26/10 ni au format `JJ/10` dans les lignes ajoutées (motif refusé par
   `couche0`) ; citer « relevé antérieur, hors de cet arbre ».
10. **Jamais de push direct sur `main`** : une branche, une PR, la file Mergify
    merge. En cas de conflit, l'agent de conflit (InferHub) intervient.
