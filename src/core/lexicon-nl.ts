/**
 * Lexique C2 — néerlandais (données pures, §6).
 *
 * Même contrat : motifs évalués sur le texte plié. Familles universelles
 * réutilisées depuis `lexicon-es.ts` — aucune recopie des règles entre langues.
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';
import { EXFILTRATION_PATTERNS, SYSTEM_MARKER_PATTERNS, TOOL_NAME_PATTERNS } from './lexicon-es';

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:negeer|vergeet|laat\s+links|schrap)\s+(?:alle\s+)?(?:je|jouw|uw|mijn|de)\s+(?:instructies|richtlijnen|regels|opdrachten|voorschriften)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:vanaf\s+nu|van\s+nu\s+af\s+aan|voortaan)\s*,?\s*(?:je|jij|u)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\b(?:je\s+(?:moet|dient|zult)|u\s+(?:moet|dient))\b[^.!?\n]{0,40}\b(?:mijn|deze|de\s+volgende)\s+(?:instructies|regels|opdrachten)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:beste|hallo|let\s+op)\s+(?:assistent|ai|chatbot|model|agent)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:nieuwe|echte|ware|laatste)\s+instructies\s*(?:voor\s+(?:jou|de\s+ai|de\s+assistent))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\bje\s+bent\s+(?:nu|voortaan|vanaf\s+nu)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\b(?:nieuwe|nieuw)\s+(?:rol|persoonlijkheid|persona|profiel|identiteit)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmodus\s+(?:ontwikkelaar|developer|dan|zonder\s+beperkingen|zonder\s+filter)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:doe\s+alsof|gedraag\s+je|handel\s+als)\s+(?:als|een)\s+(?:assistent|ai|model|agent|ontwikkelaar|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:je\s+hebt\s+geen|zonder)\s+(?:meer\s+)?(?:regels|limieten|beperkingen|filters)\b`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian localisées en néerlandais). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:voeg|schrijf|plaats|zet)\s+een\s+opmerking\s+(?:toe\s+)?(?:bij|op|aan)\s+(?:alle|elke|iedere)\s+(?:tickets?|verzoeken|meldingen)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:zoek|vind|lijst|haal\s+op|raadpleeg)\s+(?:alle\s+)?(?:de\s+)?(?:tickets|verzoeken|meldingen)\s+(?:van|voor)\s+(?:de\s+)?(?:klant|client)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:exporteer|kopieer|verplaats|stuur\s+me)\s+(?:alle\s+)?(?:de\s+|mijn\s+)?(?:tickets|verzoeken|gegevens|informatie)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:gebruik|roep|voer\s+uit|activeer)\s+(?:de\s+)?(?:mcp|tool|mcp-server)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:zet|voeg\s+toe|pas\s+toe)\s+(?:het\s+)?(?:label|etiket)\b`,
  },
];

/** Verbes d'envoi (contexte de la famille C2-05). */
export const NL_SEND_VERBS: RegExp =
  /\b(?:stuur|verstuur|publiceer|upload|verplaats|exporteer|kopieer|roep|vraag|verzoek|fetch|curl|wget)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const NL_REPORT_WORDS: RegExp =
  /\b(?:meldt|gemeld|voorbeeld|citaat|kwetsbaarheid|injectie|aanval|rapport|documentatie|bewijs|bevinding)\b/;

/** Néerlandais : familles localisées + familles universelles réutilisées. */
export const lexiconNl: C2Lexicon = {
  language: 'nl',
  patterns: [
    ...imperatives,
    ...roleSwitches,
    ...SYSTEM_MARKER_PATTERNS,
    ...toolCommands,
    ...TOOL_NAME_PATTERNS,
    ...EXFILTRATION_PATTERNS,
  ],
};