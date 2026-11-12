# Corpus légitime et seuil de faux positifs (lot 7)

## Le corpus

Deux fichiers, en miroir :

- `data/corpus/legitimate-fr.json` — 49 textes légitimes en français ;
- `data/corpus/legitimate-en.json` — 47 textes légitimes en anglais.

Aucun ne porte de charge. Ils couvrent les textes ordinaires qui entrent
vraiment dans un service de support : **support** (demande de dépannage, de
compte, de quota), **facture**, **RGPD** (demande d'effacement), **devis**,
**logs**, **code**, **courriel interne** et **contrat**.

### Les « pièges » (`trap: true`)

Un sous-ensemble (10 en français, 8 en anglais) regroupe les cas limites :
des textes légitimes qui **ressemblent à une charge** sans en être une —
mentions légales, politique de confidentialité, documentation qui cite une
consigne (« ignorez les remarques précédentes » n'a pas sa place dans un
billet), code qui parle d'injection de prompt ou d'injection SQL. Ils servent
à **mesurer le bruit** : un détecteur naïf y verrait une attaque, le produit ne
doit rien relever.

**Provenance** : textes rédigés pour le jeu d'essai (`synthetic`/`documentation`),
jamais de données client.

## Le seuil

La mesure (`src/bench/legitimate.ts`, domaine pur, détecteur injecté) sépare
deux exigences :

| Population              | Seuil                                        |
| ----------------------- | -------------------------------------------- |
| Textes **ordinaires**   | 0 faux positif, et **0 motif C2**            |
| Corpus **piège**        | bruit plafonné à 50 % (tolérance explicite)  |

Un texte de support ordinaire ne doit **jamais** être relevé : c'est le contrat
qui protège l'utilisateur contre un sas qui retiendrait à tort. Le corpus piège,
lui, tolère du bruit parce qu'il est précisément fait de cas limites ; le
plafond n'est pas là pour être atteint, il borne la dérive d'une règle devenue
trop large.

## La porte

`tools/check-fp-threshold.mjs` assemble le domaine avec esbuild, mesure, compare
au seuil, et rend un message chiffré. Code de sortie 1 quand le seuil est
dépassé (ou quand une langue retombe sous 40 textes). Le workflow
`.github/workflows/corpus.yml` joue la porte à chaque PR et chaque nuit
(`runs-on` self-hosted, `timeout-minutes: 5`, `concurrency` annulante,
`fetch-depth: 1`).

La porte est testée de bout en bout : `src/bench/legitimate.test.ts` abaisse le
seuil sous la mesure et vérifie que la sortie échoue.

## Le taux mesuré

Chiffres réels, pas des intentions (rejouables : mêmes entrées, mêmes chiffres) :

- corpus légitime : **96 textes** (78 ordinaires, 18 pièges ; fr 49 / en 47) ;
- faux positifs ordinaires : **0 / 78** (taux 0 %) ;
- motifs C2 sur billet de support : **0** ;
- bruit du corpus piège : **0 / 18** (taux 0 %).

Le détecteur actuel résiste à la totalité des 18 pièges : le bruit mesuré est
nul. La tolérance de 50 % sur les pièges est donc un plafond de sécurité, pas
un constat — c'est dit, pas sous-entendu (§21). Si une future règle devenait
bruyante sur ces cas, la porte nocturne la signalerait avant qu'un texte
ordinaire ne soit touché.