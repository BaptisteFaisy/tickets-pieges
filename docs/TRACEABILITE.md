# Traçabilité — exigence ↔ module ↔ test

Le cahier des charges (§15) liste **vingt-huit exigences** `TP-01` à `TP-28`.
Ce document les rend **vérifiables** : chaque exigence déclare, dans
`data/requirements.json`, les fichiers qui l'implémentent et les tests qui la
couvrent, par chemin. Une porte (`tools/check-traceability.mjs`) contrôle que
chaque chemin cité **existe encore** et que le tableau ci-dessous est à jour.

Rien n'est caché : une exigence sans implémentation ou sans test est **comptée
comme un trou**, pas comme une exigence satisfaite.

## Lire en dix minutes

1. Ouvrir `data/requirements.json` : une entrée par exigence, avec `modules`,
   `tests` et, s'il y en a un, `reste` (ce qui reste à faire, déclaré).
2. Ouvrir le tableau ci-dessous : la colonne **Écart** dit ce qui manque ou ce
   qui reste — quand elle vaut « — », l'exigence a un module **et** un test
   présents dans le dépôt.
3. Lancer la porte :

   ```
   node tools/check-traceability.mjs
   ```

   Elle sort en `1` si un chemin cité a disparu, si une exigence n'a plus de
   module ni de test, ou si le tableau de ce document n'est plus à jour. Elle
   sort en `0` sinon.

4. Régénérer le tableau après une modification de `data/requirements.json` :

   ```
   node tools/check-traceability.mjs --write
   ```

   Le bloc généré (borné par les deux commentaires HTML en fin de document) est
   réécrit ; la prose ci-dessus et la section anglaise en dessous ne sont pas
   touchées.

## Ce que la porte garantit

- **Chaque exigence a au moins un module existant et un test existant.** Un
  chemin cité qui n'existe plus est signalé par son chemin exact.
- **Les vingt-huit identifiants sont présents et uniques** (`TP-01` … `TP-28`),
  dans l'ordre du cahier ; un identifiant manquant ou en double est refusé.
- **Le tableau du document est celui que le domaine produit** : la porte compare
  le bloc généré au rendu courant et échoue s'ils diffèrent. Un tableau écrit à
  la main ne passe pas.
- **Aucune règle n'est écrite deux fois** : le contrôle est dans
  `src/bench/traceability.ts` (domaine pur, existence des fichiers *injectée*) ;
  l'outil `tools/check-traceability.mjs` ne fait qu'assembler ce module, lire le
  disque et appliquer le code de sortie.

## Ajouter ou modifier une exigence

1. Éditer `data/requirements.json` : ajouter ou modifier l'entrée, avec ses
   `modules` et ses `tests` (chemins relatifs à la racine du dépôt). Un `reste`
   peut être ajouté : il apparaîtra dans la colonne « Écart ».
2. Lancer `node tools/check-traceability.mjs --write` pour régénérer le tableau.
3. Lancer `node tools/check-traceability.mjs` : la porte doit sortir en `0`.
4. Lancer `npx vitest run src/bench/traceability.test.ts` : le test qui lit le
   document réel échoue si un chemin cité n'existe pas.

## Limites honestes

- La matrice vérifie **l'existence** des fichiers, pas leur **contenu** : un
  fichier vide satisferait la porte. C'est la limite d'un contrôle automatique
  de présence ; la relecture humaine reste nécessaire.
- Une exigence peut être couverte par un test qui ne la prouve pas. La colonne
  « Écart » est le lieu pour dire ce qui n'est **pas** mesuré.
- Quatre exigences déclarent un écart : `TP-07` (index JQL vérifié sur le site,
  pas en test local), `TP-11` (la consigne de l'agent Rovo vit dans
  `manifest.yml`, hors test), `TP-22` (la lecture d'une pièce jointe réelle
  dépend du runtime Forge), `TP-28` (le registre inter-organisation n'est pas
  branché : seules les briques d'empreinte existent).
- La porte ne vérifie pas la **couverture du code** : elle vérifie la couverture
  des *exigences*. Une exigence sans test de bout en bout peut rester « couverte »
  si un fichier de test lui est associé.

<!-- BEGIN:GENERATED -->
| Exigence | Titre | Prio | Modules | Tests | Écart |
|---|---|---|---|---|---|
| TP-01 | Calculer l'origine de chaque segment à la création d'une demande et à chaque commentaire | M | `src/core/origin.ts`<br>`src/core/catalog/origin.ts`<br>`src/jobs/pipeline.ts` | `src/core/origin.test.ts`<br>`src/jobs/pipeline.test.ts` | — |
| TP-02 | Niveaux T0 à T3 réglables : domaines, organisations, intégrations de confiance | M | `src/core/trust-rules.ts`<br>`src/core/levels.ts`<br>`src/core/catalog/reglages.ts` | `src/core/trust-rules.test.ts`<br>`src/core/origin.test.ts` | — |
| TP-03 | Couches C1 et C2 sur le résumé, la description, les commentaires, les champs texte et les noms de fichiers | M | `src/core/detect.ts`<br>`src/core/c1-concealment.ts`<br>`src/core/c2-addressing.ts`<br>`src/core/lexicon-fr.ts`<br>`src/core/lexicon-en.ts`<br>`src/core/catalog/detection-c1.ts`<br>`src/core/catalog/detection-c2.ts` | `src/core/c1-concealment.test.ts`<br>`src/core/c2-addressing.test.ts`<br>`src/core/lexicons-multilingues.test.ts` | — |
| TP-04 | Couche C3 par le modèle de Forge, avec les précautions du § 6 | M | `src/core/c3-model.ts`<br>`src/platform/llm.ts`<br>`src/core/catalog/detection-c3.ts`<br>`src/jobs/c3.ts` | `src/core/c3-model.test.ts`<br>`src/platform/llm.test.ts` | — |
| TP-05 | Constats avec extrait, position, couche et demande résumée | M | `src/core/findings.ts`<br>`src/core/context.ts` | `src/core/findings.test.ts`<br>`src/core/context.test.ts` | — |
| TP-06 | Bandeau sur le ticket, visible avant toute action d'IA, avec le détail des constats | M | `src/core/suspicion.ts`<br>`src/core/catalog/detection-c4.ts`<br>`src/core/catalog/ui.ts`<br>`src/ui/issue-panel.tsx`<br>`src/resolvers/panel.ts` | `src/core/suspicion.test.ts`<br>`src/resolvers/panel.test.ts` | — |
| TP-07 | Propriété indexée (confiance, suspicion) pour les files, le JQL et l'automatisation | M | `src/platform/properties.ts`<br>`src/platform/db.ts`<br>`src/platform/schema.ts` | `src/platform/properties.test.ts`<br>`src/platform/memory.test.ts` | L'index JQL réel dépend de Forge SQL : vérifié sur le site, pas de test local. |
| TP-08 | Outil `get-request-safe` : contenu encadré, balises à identifiant aléatoire | M | `src/core/framing.ts`<br>`src/core/catalog/framing.ts`<br>`src/mcp/read.ts` | `src/core/framing.test.ts`<br>`src/mcp/actions.test.ts` | — |
| TP-09 | Mode « étiqueter » | M | `src/core/modes.ts`<br>`src/core/catalog/framing.ts` | `src/core/modes.test.ts` | — |
| TP-10 | Mode « neutraliser » : original conservé, restauration, journal | M | `src/core/neutralize.ts`<br>`src/core/exports.ts`<br>`src/platform/log.ts` | `src/core/neutralize.test.ts`<br>`src/core/exports.test.ts`<br>`src/platform/log.test.ts` | — |
| TP-11 | Agent Rovo « Lecteur prudent », limité au ticket en cours | M | `src/core/assistants.ts`<br>`src/mcp/service.ts`<br>`manifest.yml` | `src/core/assistants.test.ts` | La consigne de l'agent vit dans `manifest.yml` : elle n'est pas couverte par un test local (vérifiée sur le site). |
| TP-12 | Brouillon de réponse en note interne, publié par un humain | M | `src/core/drafts.ts`<br>`src/core/outbound.ts`<br>`src/core/catalog/outbound.ts` | `src/core/drafts.test.ts`<br>`src/core/outbound.test.ts` | — |
| TP-13 | Contrôle des réponses publiques : avant publication par l'app, après coup sinon | M | `src/core/outbound.ts`<br>`src/core/outbound-rate.ts`<br>`src/core/catalog/outbound.ts` | `src/core/outbound.test.ts`<br>`src/core/outbound-rate.test.ts` | — |
| TP-14 | File des suspects et verdict humain | M | `src/core/suspicion.ts`<br>`src/core/scores.ts`<br>`src/resolvers/queue.ts`<br>`src/resolvers/review.ts`<br>`src/ui/suspect-queue.tsx` | `src/core/suspicion.test.ts`<br>`src/resolvers/queue.test.ts`<br>`src/resolvers/review.test.ts` | — |
| TP-15 | Exercice d'alerte avec ticket témoin | M | `src/core/canary.ts`<br>`src/core/canary-chain.ts`<br>`src/core/canary-schedule.ts`<br>`src/core/catalog/canary.ts`<br>`src/platform/db-canaries.ts` | `src/core/canary.test.ts`<br>`src/core/canary-chain.test.ts`<br>`src/core/canary-schedule.test.ts` | — |
| TP-16 | Journal et rapport d'exposition | M | `src/core/exposure.ts`<br>`src/core/precision.ts`<br>`src/platform/log.ts`<br>`src/core/catalog/exposition.ts` | `src/core/exposure.test.ts`<br>`src/core/precision.test.ts`<br>`src/platform/log.test.ts` | — |
| TP-17 | Outils MCP du § 16 | M | `src/mcp/actions.ts`<br>`src/mcp/read.ts`<br>`src/mcp/write.ts`<br>`src/mcp/result.ts` | `src/mcp/actions.test.ts` | — |
| TP-18 | Jeu d'essai intégré : demandes d'exemple pour la démonstration et la recette | M | `src/sample/dataset.ts`<br>`src/sample/to-segments.ts`<br>`data/sample/requests-fr.json`<br>`data/sample/requests-en.json`<br>`tools/replay.mjs` | `src/sample/dataset.test.ts`<br>`src/replay/engine.test.ts` | — |
| TP-19 | Hook : réécriture des lectures, confirmation des écritures publiques | S | `src/hook/inbound.ts`<br>`src/hook/outbound.ts`<br>`src/hook/config.ts`<br>`src/hook/token.ts`<br>`src/jobs/webhook.ts`<br>`src/core/catalog/hook.ts` | `src/hook/inbound.test.ts`<br>`src/hook/outbound.test.ts`<br>`src/hook/config.test.ts`<br>`src/hook/token.test.ts` | — |
| TP-20 | Session contaminée | S | `src/core/session.ts`<br>`src/core/session-policy.ts`<br>`src/core/session-audit.ts`<br>`src/core/session-token.ts`<br>`src/core/catalog/session.ts` | `src/core/session.test.ts`<br>`src/core/session-policy.test.ts`<br>`src/core/session-audit.test.ts`<br>`src/core/session-token.test.ts` | — |
| TP-21 | Hérédité vers les tickets liés ou clonés | S | `src/core/inheritance.ts` | `src/core/inheritance.test.ts` | — |
| TP-22 | Pièces jointes : texte des PDF analysé, autres formats marqués « non analysés » | S | `src/platform/attachments.ts`<br>`src/platform/extract.ts`<br>`src/platform/extract-pdf.ts`<br>`src/core/unanalyzed.ts` | `src/core/unanalyzed.test.ts`<br>`src/platform/extract.test.ts`<br>`src/platform/extract-pdf.test.ts` | La lecture d'une pièce jointe réelle dépend du runtime Forge : le test couvre l'extraction injectée, pas le fichier stocké par Jira. |
| TP-23 | Campagnes : regroupement des charges identiques | S | `src/core/campaigns.ts`<br>`src/core/fingerprint.ts` | `src/core/campaigns.test.ts`<br>`src/core/fingerprint.test.ts` | — |
| TP-24 | Repasser en interne une réponse publique suspecte | S | `src/core/outbound.ts`<br>`src/core/outbound-notify.ts`<br>`src/core/catalog/outbound-ops.ts` | `src/core/outbound.test.ts`<br>`src/core/outbound-notify.test.ts` | — |
| TP-25 | Recopie d'un texte externe par un interne | S | `src/core/fingerprint.ts`<br>`src/core/self-write.ts`<br>`src/core/session-policy.ts` | `src/core/fingerprint.test.ts`<br>`src/core/self-write.test.ts` | — |
| TP-26 | Confluence : pages et commentaires d'invités | C | `src/jobs/confluence.ts`<br>`src/platform/confluence.ts` | `src/jobs/confluence.test.ts`<br>`src/platform/confluence.test.ts` | — |
| TP-27 | Texte caché dans les documents bureautiques | C | `src/platform/extract-ooxml.ts`<br>`src/core/decode.ts`<br>`src/core/rich-text.ts` | `src/platform/extract-ooxml.test.ts`<br>`src/core/decode.test.ts` | — |
| TP-28 | Partage anonymisé des motifs entre organisations | C | `src/core/hashing.ts`<br>`src/core/fingerprint.ts`<br>`src/platform/db-repos.ts` | `src/core/hashing.test.ts`<br>`src/core/fingerprint.test.ts` | Le registre inter-organisation lui-même n'est pas branché (planifié) : seuls les briques d'empreinte existent. |
<!-- END:GENERATED -->

## For judges (EN)

The specification lists **28 functional requirements** (`TP-01` … `TP-28`).
Each one declares, in `data/requirements.json`, the implementation files and the
test files that cover it, by path. A gate (`tools/check-traceability.mjs`) fails
when a cited path no longer exists, when a requirement has neither a module nor
a test left, or when the table in this document is out of date.

Read it in ten minutes: open the JSON, open the table below (the **Gap** column
says what is missing), then run `node tools/check-traceability.mjs` — exit code
`0` means every requirement still points at code and tests that exist.

Honest limits: the gate checks **presence**, not **content**; and the
requirements that declare a gap (`TP-07`, `TP-11`, `TP-22`, `TP-28`) say so in
the table rather than pretending to be complete.