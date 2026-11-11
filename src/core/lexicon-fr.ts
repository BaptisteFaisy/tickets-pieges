/**
 * Lexique C2 — français (données pures, §6).
 *
 * Un `HitPattern` = `ruleId` stable + famille + expression régulière évaluée sur
 * le texte **plié** (minuscules, diacritiques retirés, voir `fold` dans
 * `c2-addressing.ts`). L'expression est une donnée : elle ne code aucune logique.
 * Le moteur est unique ; seule cette table change d'une langue à l'autre.
 *
 * `askSummary` n'est PAS recopié du texte : il vient du catalogue
 * (`catalog/detection-c2.ts`, clé `c2.summary.<ruleId>`), donc neutre par
 * construction (§6 : « résume ce qu'elle demande »).
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignore|ignorez|ignorer|oublie|oubliez|oublier|abandonne|abandonnez)\s+(?:toutes?\s+)?(?:(?:tes|vos|les|mes)\s+)?(?:instructions?|consignes?|directives?|regles?|ordres?)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\bignore\s+(?:tout\s+)?ce\s+qui\s+(?:precede|suit|est\s+au-dessus)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.88,
    source: String.raw`\bn[’']?\s*oublie\s+(?:pas\s+)?(?:tout\s+)?(?:ce\s+qui\s+precede|tes\s+instructions?|les\s+instructions?\s+precedentes?)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:a\s+partir\s+de\s+(?:maintenant|ce\s+message|ici)|desormais|dorenavant|a\s+present)\s*,?\s*(?:tu|vous)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\b(?:tu|vous)\s+(?:ne\s+)?(?:dois|devez|peux|pouvez|reponds|repondez|suivras|suivez)\b[^.!?\n]{0,40}\b(?:instructions?|consignes?|directives?)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:cher|chere|attention|a\s+l[’']attention\s+de)\s+(?:assistant|ia|intelligence\s+artificielle|chatbot|modele|agent)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:nouvelle|nouvelles|ultimes?|vraies?)\s+instructions?\s*(?:pour\s+(?:toi|l[’']?ia|l[’']?assistant))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\btu\s+es\s+(?:desormais|maintenant|a\s+present)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.82,
    source: String.raw`\bnouveau\s+(?:role|personnage|profil|modele|comportement)\b`,
  },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\bpasse(?:z)?\s+en\s+mode\s+\w+` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmode\s+(?:developpeur|developer|dan|jailbreak|sans\s+restriction|sans\s+filtre)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:fais|faites|joue[z]?|agis|agissez|comporte(?:z)?-toi)\s+(?:comme|en\s+tant\s+que)\s+(?:un\s+|une\s+)?(?:assistant|ia|model|agent|developpeur|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:alter\s+ego|double\s+personnalite|personnalite\s+alternee|tu\s+n[’']?as\s+plus\s+de\s+(?:regles|limites|restrictions))`,
  },
];

/** Famille C2-03 — faux marqueur de système. */
const systemMarkers: HitPattern[] = [
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.9,
    source: String.raw`(?:^|\n)\s*(?:system|systeme|système|admin|administrateur|root|developer)\s*:`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.92, source: String.raw`\[\s*(?:system|systeme|sys|admin|instruction|prompt)\s*\]` },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.9, source: String.raw`<\s*(?:system|sys|admin|prompt|instruction)\s*>` },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.9,
    source: String.raw`-{2,}\s*(?:begin|debut|end|fin)\s+(?:system|admin|prompt|instruction)s?\s*-{2,}`,
  },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.85,
    source: String.raw`#{1,6}\s*(?:instructions?\s+)?(?:systeme|system|admin|prompt)\b`,
  },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.85,
    source: String.raw`\b(?:tool\s*_?\s*(?:call|use|result)|tool_call|function_call)\s*[:(]`,
  },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.7,
    source: String.raw`\b(?:BEGIN|END)\s+(?:SYSTEM|ADMIN|PROMPT|INSTRUCTION)`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian / recherche / export). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:ajoute[z]?|mets?|mettez|poste[z]?|ecris|ecrivez)\s+un\s+commentaire\s+(?:a|dans|sur|au)\s+(?:tous?\s+les\s+tickets?|chaque\s+ticket|chacun\s+des\s+tickets?|toutes?\s+les\s+demandes?)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:recherche[z]?|cherche[z]?|trouve[z]?|liste[z]?|recupere[z]?|extrais|extrayez)\s+(?:tous\s+)?(?:les\s+)?(?:tickets|demandes|issues)\s+(?:du|de|des|du\s+client)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:exporte[z]?|copie[z]?|recopie[z]?|transfere[z]?)\s+(?:toutes?\s+)?(?:les\s+|mes\s+|des\s+)?(?:demandes|tickets|donnees|informations)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.72,
    source: String.raw`\b(?:verbe|outil|tool)\b[^.\n]{0,20}\b(?:du|atlassian|mcp)\b[^.\n]{0,20}\b(addComment|editIssue|searchIssues|createIssue|getIssue|addWorklog|transitionIssue)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:appelle[z]?|invoke[z]?|utilise[z]?|execute[z]?)\s+(?:le\s+)?(?:mcp|outil|tool|serveur\s+mcp)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:ajoute|mets|pose)\s+(?:l[’']?etiquette|le\s+label)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.75,
    source: String.raw`\b(?:addComment|editIssue|searchIssues|createIssue|getIssue|addWorklog|transitionIssue)\s*\(`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.62,
    source: String.raw`\b(?:addComment|editIssue|searchIssues|createIssue|getIssue|addWorklog|transitionIssue)\b`,
  },
];

/** Famille C2-05 — adresse web jointe à un envoi de données. */
const exfiltration: HitPattern[] = [
  {
    ruleId: 'C2-05',
    kind: 'exfiltration-url',
    confidence: 0.8,
    needsContext: true,
    source: String.raw`https?://[^\s<>"'\])]+`,
  },
  {
    ruleId: 'C2-05',
    kind: 'exfiltration-url',
    confidence: 0.6,
    needsContext: true,
    source: String.raw`\bwww\.[a-z0-9.-]+\.[a-z]{2,}\b[^\s<>"'\])]*`,
  },
  { ruleId: 'C2-05', kind: 'exfiltration-url', confidence: 0.85, source: String.raw`\b(?:curl|wget|fetch)\b[^\n]*https?://` },
];

/**
 * Verbes d'envoi (contexte de la famille C2-05) : proches d'une adresse, ils
 * transforment une simple URL en demande d'exfiltration (§10).
 */
export const FR_SEND_VERBS: RegExp = /\b(?:envoie[z]?|poste[z]?|transfere[z]?|pousse[z]?|exporte[z]?|recopie[z]?|appelle[z]?|requete[z]?|fetch|curl|wget|charge[z]?|televerse[z]?)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const FR_REPORT_WORDS: RegExp =
  /\b(?:signale|signalee|signalement|cite|citation|exemple|faille|vulnerabilite|injection|attaque|rapport|documentation|preuve)\b/;

export const lexiconFr: C2Lexicon = {
  language: 'fr',
  patterns: [...imperatives, ...roleSwitches, ...systemMarkers, ...toolCommands, ...exfiltration],
};
