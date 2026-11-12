# Traçabilité — exigence → module → test

> Généré par `tools/check-traceability.mjs`. Ne pas éditer à la main.

**28 exigences** — 25 couvertes, 2 partielles, 1 à faire. **3 écart(s)** à regarder.

| Exigence | Priorité | Titre | État | Modules | Tests | Écart |
|---|---|---|---|---|---|---|
| TP-01 | M | Origine de chaque segment, à la création et à chaque commentaire | complet | src/core/origin.ts, src/jobs/pipeline.ts | src/core/origin.test.ts, src/jobs/pipeline.test.ts | aucun |
| TP-02 | M | Niveaux T0 a T3 réglables : domaines, organisations, intégrations | complet | src/core/trust-rules.ts, src/core/origin.ts | src/core/trust-rules.test.ts, src/core/origin.test.ts | aucun |
| TP-03 | M | Couches C1 et C2 sur résumé, description, commentaires, champs, noms de fichiers | complet | src/core/c1-concealment.ts, src/core/c2-addressing.ts | src/core/c1-concealment.test.ts, src/core/c2-addressing.test.ts | aucun |
| TP-04 | M | Couche C3 par le modèle de Forge, avec les précautions du §6 | complet | src/core/c3-model.ts, src/platform/llm.ts, src/jobs/c3.ts | src/core/c3-model.test.ts, src/platform/llm.test.ts | aucun |
| TP-05 | M | Constats avec extrait, position, couche et demande résumée | complet | src/core/findings.ts | src/core/findings.test.ts | aucun |
| TP-06 | M | Bandeau sur le ticket, visible avant toute action d'IA | complet | src/core/modes.ts, src/ui/issue-panel.tsx, src/resolvers/panel.ts | src/core/modes.test.ts, src/resolvers/panel.test.ts | aucun |
| TP-07 | M | Propriété indexée (confiance, suspicion) pour les files, le JQL, l'automatisation | complet | src/platform/properties.ts, src/jobs/pipeline.ts | src/platform/properties.test.ts, src/jobs/pipeline.test.ts | aucun |
| TP-08 | M | Outil get-request-safe : contenu encadré, balises à identifiant aléatoire | complet | src/mcp/read.ts, src/core/framing.ts | src/core/framing.test.ts, src/mcp/actions.test.ts | aucun |
| TP-09 | M | Mode « étiqueter » | complet | src/core/modes.ts | src/core/modes.test.ts | aucun |
| TP-10 | M | Mode « neutraliser » : original conservé, restauration, journal | complet | src/core/neutralize.ts | src/core/neutralize.test.ts | aucun |
| TP-11 | M | Agent Rovo « Lecteur prudent », limité au ticket en cours | complet | manifest.yml, src/jobs/pipeline.ts | src/jobs/pipeline.test.ts | aucun |
| TP-12 | M | Brouillon de réponse en note interne, publié par un humain | complet | src/core/drafts.ts, src/mcp/write.ts | src/core/drafts.test.ts | aucun |
| TP-13 | M | Contrôle des réponses publiques : avant publication par l'app, après coup sinon | complet | src/core/outbound.ts, src/core/dlp.ts | src/core/outbound.test.ts, src/core/dlp.test.ts | aucun |
| TP-14 | M | File des suspects et verdict humain | complet | src/core/precision.ts, src/resolvers/queue.ts, src/resolvers/review.ts | src/core/precision.test.ts, src/resolvers/queue.test.ts | aucun |
| TP-15 | M | Exercice d'alerte avec ticket témoin | complet | src/core/canary.ts, src/core/lure.ts, src/core/canary-schedule.ts | src/core/canary.test.ts, src/core/lure.test.ts | aucun |
| TP-16 | M | Journal et rapport d'exposition | complet | src/core/exposure.ts, src/platform/log.ts, src/core/scores.ts | src/core/exposure.test.ts, src/platform/log.test.ts | aucun |
| TP-17 | M | Outils MCP du §16 | complet | src/mcp/actions.ts, src/mcp/read.ts, src/mcp/write.ts, src/mcp/service.ts | src/mcp/actions.test.ts | aucun |
| TP-18 | M | Jeu d'essai intégré : demandes d'exemple pour la démonstration et la recette | complet | src/sample/dataset.ts, src/sample/to-segments.ts | src/sample/dataset.test.ts | aucun |
| TP-19 | S | Hook : réécriture des lectures, confirmation des écritures publiques | complet | src/hook/inbound.ts, src/hook/outbound.ts, src/hook/config.ts, src/core/self-write.ts | src/hook/inbound.test.ts, src/hook/outbound.test.ts, src/hook/config.test.ts | aucun |
| TP-20 | S | Session contaminée | complet | src/core/session.ts, src/core/session-policy.ts, src/core/session-token.ts, src/core/session-audit.ts | src/core/session.test.ts, src/core/session-policy.test.ts, src/core/session-token.test.ts | aucun |
| TP-21 | S | Hérédité vers les tickets liés ou clonés | complet | src/core/inheritance.ts | src/core/inheritance.test.ts | aucun |
| TP-22 | S | Pièces jointes : texte des PDF analysé, autres formats marqués « non analysés » | partiel | src/core/unanalyzed.ts, src/platform/extract.ts, src/platform/extract-pdf.ts | src/core/unanalyzed.test.ts, src/platform/extract.test.ts | **partiel** |
| TP-23 | S | Campagnes : regroupement des charges identiques | complet | src/core/campaigns.ts | src/core/campaigns.test.ts | aucun |
| TP-24 | S | Repasser en interne une réponse publique suspecte | complet | src/core/outbound.ts, src/core/outbound-notify.ts | src/core/outbound.test.ts, src/core/outbound-notify.test.ts | aucun |
| TP-25 | S | Recopie d'un texte externe par un interne | complet | src/core/fingerprint.ts | src/core/fingerprint.test.ts | aucun |
| TP-26 | C | Confluence : pages et commentaires d'invités | complet | src/platform/confluence.ts, src/jobs/confluence.ts | src/jobs/confluence.test.ts, src/platform/confluence.test.ts | aucun |
| TP-27 | C | Texte caché dans les documents bureautiques | partiel | src/platform/extract-ooxml.ts | src/platform/extract-ooxml.test.ts | **partiel** |
| TP-28 | C | Partage anonymisé des motifs entre organisations | a-faire | src/core/atlas.ts, src/core/exports.ts | src/core/atlas.test.ts | **a-faire** |

## Remarques

- **TP-11** — L'agent Rovo est déclaré dans le manifeste ; ses outils sont les dix du §16.
- **TP-22** — L'extraction réelle dépend des limites de Forge (le PDF n'est pas toujours lisible) : le repli « non analysé » est mesuré, pas supposé.
- **TP-24** — Le retour en interne dépend d'une API JSM défectueuse (JSDCLOUD-6050) : le repli « alerte seule » est actif.
- **TP-27** — Le texte caché des DOCX/XLSX est relevé ; les images et les macros ne le sont pas encore.
- **TP-28** — Le format d'empreinte et l'export existent ; le partage entre organisations (tiers de confiance) reste à construire.

## Ce que ce tableau ne dit pas

- La présence d'un test ne dit pas qu'il couvre l'exigence : c'est une **trace**, à relire.
- Une exigence marquée « partiel » ou « à faire » est un **écart assumé**, pas un oubli.
- Les exigences de priorité C (26 à 28) sont livrées au-delà du minimum : leur état est
  voluntary et daté.
