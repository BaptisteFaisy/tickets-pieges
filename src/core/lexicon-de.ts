/**
 * Lexique C2 — allemand (données pures, §6).
 *
 * Même contrat que `lexicon-fr.ts` : motifs évalués sur le texte plié
 * (minuscules, diacritiques retirés — ici ä/ö/ü/ß ramenés à a/o/u/ss). Les
 * familles universelles (marqueur système, adresse web, identifiants d'outils)
 * sont **réutilisées** depuis `lexicon-es.ts` : zéro recopie entre langues.
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';
import { EXFILTRATION_PATTERNS, SYSTEM_MARKER_PATTERNS, TOOL_NAME_PATTERNS } from './lexicon-es';

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignoriere|vergiss|ubergehe|verwerfe)\s+(?:alle\s+)?(?:deine|eure|meine|die)\s+(?:anweisungen|anleitung|regeln|vorgaben|befehle)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:ab\s+jetzt|von\s+jetzt\s+an|ab\s+sofort)\s*,?\s*(?:du|du\s+bist)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\bdu\s+(?:musst|sollst|wirst)\b[^.!?\n]{0,40}\b(?:meine|diese|folgende[ns]?)\s+(?:anweisungen|regeln|befehle)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:lieber|hallo|achtung)\s+(?:assistent|ki|chatbot|modell|agent)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:neue|echte|wahren|letzte[n]?)\s+anweisungen\s*(?:fur\s+(?:dich|die\s+ki|den\s+assistenten))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\bdu\s+bist\s+(?:jetzt|ab\s+sofort|ab\s+jetzt)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\bneue[sr]?\s+(?:rolle|personlichkeit|profil|identitat)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmodus\s+(?:entwickler|developer|dan|ohne\s+einschrankungen|ohne\s+filter)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:tu\s+so|verhalte\s+dich|agiere|spiele)\s+(?:als|wie)\s+(?:ein[en]?\s+)?(?:assistent|ki|modell|agent|entwickler|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:du\s+hast|ohne)\s+(?:keine\s+)?(?:regeln|grenzen|einschrankungen|limits|filter)\b`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian localisées en allemand). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:fuge|schreibe|setze|poste)\s+ein[en]?\s+kommentar\s+(?:zu|bei|auf|an)\s+(?:alle[n]?|jede[n]?|samtiche[n]?)\s+(?:tickets?|anfragen|vorgange)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:suche|finde|liste|rufe\s+ab|hole)\s+(?:alle\s+)?(?:die\s+)?(?:tickets|anfragen|vorgange)\s+(?:des|vom|von)\s+(?:kunden|clients?)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:exportiere|kopiere|ubertrage|sende\s+mir)\s+(?:alle\s+)?(?:die\s+|meine\s+)?(?:tickets|anfragen|daten|informationen)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:nutze|rufe|fuhre\s+aus|verwende)\s+(?:das\s+)?(?:mcp|werkzeug|mcp-server|tool)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:setze|fuge\s+hinzu|weise\s+zu)\s+(?:das\s+)?(?:label|etikett)\b`,
  },
];

/** Verbes d'envoi (contexte de la famille C2-05). */
export const DE_SEND_VERBS: RegExp =
  /\b(?:sende|schicke|ubertrage|lade|hochladen|exportiere|kopiere|rufe|fordere|versende|fetch|curl|wget)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const DE_REPORT_WORDS: RegExp =
  /\b(?:melde|gemeldet|beispiel|zitat|schwachstelle|angriff|injektion|bericht|dokumentation|beweis|fund|fundstelle)\b/;

/** Allemand : familles localisées + familles universelles réutilisées. */
export const lexiconDe: C2Lexicon = {
  language: 'de',
  patterns: [
    ...imperatives,
    ...roleSwitches,
    ...SYSTEM_MARKER_PATTERNS,
    ...toolCommands,
    ...TOOL_NAME_PATTERNS,
    ...EXFILTRATION_PATTERNS,
  ],
};