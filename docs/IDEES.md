# 100 idées pour pousser le projet — et où elles en sont

> Liste arrêtée le 11 novembre 2026 au soir, mise en chantier la nuit suivante.
> **Mise à jour du 12 novembre 2026, 02 h** : quatorze lots fusionnés sur `main`
> (pression, sas-dlp, canary-appat, decode, langues, sessions, sas-ops, clients,
> exposition, benchmark, reglages, confluence, fichiers, plus cette feuille de route).
> 951 tests verts, 224 fichiers, `forge lint` sans erreur, site public reconstruit.
> Chaque idée porte un numéro ; les lots (une branche, une PR, un propriétaire de
> fichiers) les regroupent. Statut : **fait** (fusionné sur `main`), **en cours**
> (PR ouverte ou agent au travail), **planifié** (vague suivante), **hors dépôt**
> (geste humain ou excluded). Rien n'est coché par optimisme : un lot n'est « fait »
> que fusionné et vert.
>
> **Exclu explicitement** : tout ce qui touche la vidéo de démonstration
> (`docs/VIDEO.md` n'est pas modifié, aucune capture ni montage produit).

## A. Détection — couverture et précision

| # | Idée | Lot | Statut |
|---|---|---|---|
| 1 | Décoder prudemment les blocs encodés puis réanalyser le décodé | decode | **fait** |
| 2 | Lexiques es, de, pt, it, nl | langues | **fait** |
| 3 | Homoglyphes, punycode, domaines lookalike | langues | **fait** |
| 4 | Recoller une charge répartie sur plusieurs commentaires | détection n-grammes | planifié |
| 5 | Détecter le « many-shot » (longues listes qui conditionnent) | pression | **fait** |
| 6 | Roleplay indirect (« dans un roman », « en mode DAN ») | langues | **fait** |
| 7 | Stéganographie lexicale : acrostiche d'action | pression | **fait** |
| 8 | OCR des captures, ou marquage « non analysé » chiffré | fichiers | **fait** |
| 9 | Extraire le texte des PDF (TP-22) | fichiers | **fait** |
| 10 | Texte caché et commentaires dans DOCX/XLSX, EXIF (TP-27) | fichiers | **fait** |
| 11 | Réducteurs de lien : URL réelle extraite, jamais consultée | decode | **fait** |
| 12 | Auto-calibrage des seuils de similarité par projet | reglages | **fait** |
| 13 | Densité d'impératifs par 100 mots, hors lexique | pression | **fait** |
| 14 | Consignes différées (« plus tard », « quand tu auras fini ») | pression | **fait** |
| 15 | Corpus étiqueté + rappel/faux positifs par règle | benchmark | **fait** |
| 16 | Fuzzing du détecteur par mutations | benchmark | **fait** |
| 17 | Mode shadow : calculer sans agir, comparer aux verdicts | benchmark | **fait** |
| 18 | Seuils auto par projet nourris par les verdicts humains | reglages | **fait** |
| 19 | Registre inter-orgs d'empreintes, anonymisé (TP-28) | publications | planifié |
| 20 | Constat « tentative de corrompre le détecteur » | reglages | **fait** |

## B. Portée, sessions, agents

| # | Idée | Lot | Statut |
|---|---|---|---|
| 21 | Contamination propagée à tous les outils, pas seulement Atlassian | sessions | **fait** |
| 22 | Configs générées pour Claude Code, Cursor, Copilot, Cline, ZeroClaw | clients | **fait** |
| 23 | Jeton de session signé HMAC (prouver sans stocker) | sessions | **fait** |
| 24 | Extinction automatique par inactivité (TTL) | sessions | **fait** |
| 25 | Croiser avec « Permis d'agir » (spec 06) | — | planifié (autre dépôt) |
| 26 | Budget de gestes sensibles par session | sessions | **fait** |
| 27 | Quarantaine : au-delà d'un seuil, lecture seule | sessions | **fait** |
| 28 | Audit exportable par session | sessions | **fait** |
| 29 | Politique exposée en MCP pour un agent externe | clients | **fait** |
| 30 | Détection d'agent en boucle (même outil, N tickets) | sessions | **fait** |

## C. Sortie — le sas

| # | Idée | Lot | Statut |
|---|---|---|---|
| 31 | Mesurer et dire la fenêtre du courriel de notification | sas-ops | **fait** |
| 32 | Sas sur les pièces jointes sortantes | sas-ops | **fait** |
| 33 | Domaines hors liste autorisée retenus | sas-dlp | **fait** |
| 34 | DLP léger : IBAN, cartes (Luhn), SIRET, NIR, jetons | sas-dlp | **fait** |
| 35 | Masquage réversible des entités sensibles | sas-dlp | **fait** |
| 36 | Diff visuel brouillon / texte publié | ui-2 | planifié |
| 37 | Double validation vers domaine inconnu ou donnée DLP | sas-dlp | **fait** |
| 38 | Débit limité des réponses publiques par agent | sas-ops | **fait** |
| 39 | Contrôler aussi les commentaires internes recopiés | sas-ops | **fait** |
| 40 | Mode « red team » avec marqueur et rapport | sas-ops | **fait** |

## D. Exercice d'alerte et mesure

| # | Idée | Lot | Statut |
|---|---|---|---|
| 41 | Exercices permanents hebdomadaires, jetons en rotation | canary-appat | **fait** |
| 42 | Taux d'obéissance par assistant (Rovo, Claude, Copilot) | exposition | **fait** |
| 43 | Canary **appât** : fausse donnée sensible marquée | canary-appat | **fait** |
| 44 | Canary multi-étapes : profondeur d'obéissance | canary-appat | **fait** |
| 45 | Rapport avant/après exportable (CSV, JSON) | exposition | **fait** |
| 46 | Alerte temps réel à la sécurité quand un appât est touché | canary-appat | **fait** |
| 47 | Score d'exposition 0-100, pondérations écrites | exposition | **fait** |
| 48 | Médiane anonymisée inter-organisations (empreintes seules) | exposition | **fait** |
| 49 | Exercice de réversibilité d'une neutralisation | terrain | planifié |
| 50 | Journal d'exercice à hash chaîné, vérifiable | canary-appat | **fait** |

## E. Produit et UX

| # | Idée | Lot | Statut |
|---|---|---|---|
| 51 | Glance natif Jira (niveau visible sans ouvrir le panneau) | jira-avance | planifié |
| 52 | Raccourci « analyser ce texte » dans le panneau | ui-2 | planifié |
| 53 | Filtres JQL sauvegardés + alerte par campagne | ui-2 | planifié |
| 54 | Revue en masse : un verdict pour toute une campagne | ui-2 | planifié |
| 55 | Mode formation : pourquoi ce passage a été relevé | ui-2 | planifié |
| 56 | Notification Slack/Teams sur constat piégé | jira-avance | planifié |
| 57 | Digest hebdomadaire par courriel | jira-avance | planifié |
| 58 | Gadget de tableau de bord : exposition du jour | jira-avance | planifié |
| 59 | Vue « ce qui n'a pas été analysé » par projet | exposition, ui-2 | partiel : exposition fait, ui-2 planifié |
| 60 | Libellés personnalisables par organisation | ui-2 | planifié |

## F. Plateforme et intégrations

| # | Idée | Lot | Statut |
|---|---|---|---|
| 61 | Confluence : pages et commentaires d'invités (TP-26) | confluence | **fait** |
| 62 | L'origine survit hors Jira (bug Git/Bitbucket) | siem | planifié |
| 63 | Import Slack/Teams en conservant l'origine | siem | planifié |
| 64 | Importeurs Zendesk/Freshdesk pour les migrations | siem | planifié |
| 65 | API REST en lecture (empreintes et métadonnées, jamais le texte) | siem | planifié |
| 66 | Sortie SIEM : Splunk HEC, Sentinel, QRadar | siem | planifié |
| 67 | Règles Automation for Jira prêtes à l'emploi | jira-avance | planifié |
| 68 | Champ personnalisé triable en plus de la propriété | jira-avance | planifié |
| 69 | Interface es/de/pt | langues (détection), ui-2 (écrans) | en cours |
| 70 | Viser « Runs on Atlassian » (`forge eligibility`) | marketplace | planifié |

## G. Marketplace et distribution

| # | Idée | Lot | Statut |
|---|---|---|---|
| 71 | Dossier de listing Marketplace | marketplace | planifié |
| 72 | Palier gratuit (signaler + bandeau), le reste payant | marketplace | planifié |
| 73 | Prix par agent de support, argumenté | marketplace | planifié |
| 74 | Page « sécurité » du listing : rien ne sort | marketplace | planifié |
| 75 | Guide d'installation pour admin non technique | marketplace | planifié |
| 76 | Kit de démo avec vidéo | — | **hors périmètre** (vidéo exclue) |
| 77 | Traductions du listing (ja, de) | marketplace | planifié |
| 78 | Trois sites pilotes avec chiffres avant/après | marketplace | planifié (protocole) / hors dépôt (signature) |
| 79 | Badge « analysé par Tickets piégés » et ses règles | publications | planifié |
| 80 | Bug bounty sur l'app elle-même | publications | planifié (politique) / hors dépôt (ouverture) |

## H. Ingénierie et qualité

| # | Idée | Lot | Statut |
|---|---|---|---|
| 81 | Couverture mesurée en CI avec seuil | qualite | planifié |
| 82 | Tests de propriété sur les invariants du produit | qualite | planifié |
| 83 | Accessibilité des écrans (contrastes, libellés, focus) | qualite | planifié |
| 84 | 5 000 tickets analysés en moins de 15 minutes | terrain | planifié |
| 85 | Charge de la file C3 : 500 messages, délai mesuré | terrain | planifié |
| 86 | Mutation testing du domaine pur | qualite | planifié |
| 87 | Audit de dépendances | qualite | planifié |
| 88 | Journalisation structurée filtrable par `kind` | qualite | planifié |
| 89 | Feature flags par projet, sans redéploiement | reglages | **fait** |
| 90 | Migrations SQL versionnées, originaux jamais perdus | qualite | planifié |

## I. Recherche, preuve, écosystème

| # | Idée | Lot | Statut |
|---|---|---|---|
| 91 | Note de recherche : taux d'obéissance mesuré, anonymisé | publications | planifié |
| 92 | Proposition upstream : drapeau natif « non fiable » | publications | planifié (texte) / hors dépôt (envoi) |
| 93 | Corpus de charges inoffensives publié | publications | planifié |
| 94 | Comparaison écrite avec les filtres de prompt existants | atlas | en cours |
| 95 | Rejouer l'attaque Cato de 2025 dans le corpus | benchmark | **fait** |
| 96 | Chaque `ruleId` mappé à une technique MITRE ATLAS | atlas | en cours |
| 97 | Whitepaper « trois verrous » et modèle de menace | atlas | en cours |
| 98 | Kit CTF défendu avec l'app | publications | planifié |
| 99 | Partage inter-orgs par empreintes avec tiers de confiance | publications | planifié |
| 100 | `donnee-<id>` proposé comme format ouvert | publications | planifié |

## Les dix priorités retenues

1. **Mesurer la fenêtre d'exposition réelle** (lot terrain, #84/#85) — remplacer une intuition par un chiffre.
2. **Corpus + faux positifs par règle rejoués en CI** (benchmark, #15/#16/#17) — répondre à l'objection n°1 du support.
3. **Canary appât et exercices permanents** (canary-appat, #41/#43/#44) — passer de l'obéissance mesurée à l'exfiltration détectée. **Fait.**
4. **Configs générées pour les autres clients d'agent** (clients, #22) — la politique devient portable.
5. **Mapping MITRE ATLAS** (atlas, #96) — grille de lecture immédiate pour la sécurité.
6. **PDF, DOCX, images** (fichiers, #8/#9/#10) — réduire la part « non analysée », le plus gros trou mesurable.
7. **DLP et masquage réversible en sortie** (sas-dlp, #34/#35) — **fait.**
8. **Confluence** (confluence, #61) — même moteur, autre surface : preuve que l'architecture tient.
9. **Tests de propriété et mutation testing** (qualite, #82/#86) — prouver les invariants qui font le produit.
10. **Corpus ouvert et format de balise standardisé** (publications, #93/#100) — rendre le projet citable.

## Ce qui ne sera jamais dans ce dépôt

- La **vidéo** de démonstration et ses captures (exclue par décision du 11 novembre 2026).
- Les **actes** de publication : soumission Devpost, dépôt Marketplace, ouverture du programme de
  bounty, signature de sites pilotes, envoi de la proposition à Atlassian. Le dépôt porte les
  artefacts (textes, protocoles, politiques) ; l'acte reste humain.
