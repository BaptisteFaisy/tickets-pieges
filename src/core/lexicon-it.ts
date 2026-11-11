/**
 * Lexique C2 — italien (données pures, §6).
 *
 * Même contrat : motifs évalués sur le texte plié (à/è/ì/ò/ù ramenés à a/e/i/
 * o/u). Familles universelles réutilisées depuis `lexicon-es.ts` — aucune
 * recopie des règles entre langues.
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';
import { EXFILTRATION_PATTERNS, SYSTEM_MARKER_PATTERNS, TOOL_NAME_PATTERNS } from './lexicon-es';

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignora|dimentica|scarta|elimina)\s+(?:tutte\s+)?(?:le|i|tue|vostre|mie)\s+(?:istruzioni|regole|direttive|ordini|comandi)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:da\s+ora\s+in\s+poi|a\s+partire\s+da\s+ora|d'ora\s+in\s+avanti)\s*,?\s*(?:tu|lei|voi)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\b(?:devi|dovrai|sei\s+tenuto\s+a|obbedisci)\b[^.!?\n]{0,40}\b(?:le\s+mie|queste|le\s+seguenti)\s+(?:istruzioni|regole|ordini)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:caro|cara|ciao|attenzione)\s+(?:assistente|ia|chatbot|modello|agente)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:nuove|vere|reali|ultime)\s+istruzioni\s*(?:per\s+(?:te|la\s+ia|il\s+assistente))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\b(?:ora\s+sei|sei\s+ora|d'ora\s+in\s+poi|sei\s+adesso)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\b(?:nuovo|nuova)\s+(?:ruolo|personaggio|personalita|profilo|identita)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmodalita\s+(?:sviluppatore|developer|dan|senza\s+restrizioni|senza\s+filtro)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:agisci|fingi|comportati)\s+(?:come|da)\s+(?:un|uno|una)?\s*(?:assistente|ia|modello|agente|sviluppatore|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:non\s+hai|senza)\s+(?:piu\s+)?(?:regole|limiti|restrizioni|filtri)\b`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian localisées en italien). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:aggiungi|scrivi|inserisci|pubblica)\s+un\s+commento\s+(?:su|a|in)\s+(?:tutti|tutto|ogni)\s+(?:i\s+)?(?:ticket|richieste|segnalazioni)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:cerca|trova|elenca|recupera|consulta)\s+(?:tutti\s+)?(?:i\s+)?(?:ticket|richieste|segnalazioni)\s+(?:del|dei|del\s+cliente)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:esporta|copia|trasferisci|invia\s+mi)\s+(?:tutti\s+)?(?:i\s+|miei\s+)?(?:ticket|richieste|dati|informazioni)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:usa|chiama|esegui|invoca)\s+(?:lo\s+)?(?:strumento|mcp|server\s+mcp)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:metti|aggiungi|applica)\s+(?:l'etichetta|il\s+label)\b`,
  },
];

/** Verbes d'envoi (contexte de la famille C2-05). */
export const IT_SEND_VERBS: RegExp =
  /\b(?:invia|invio|manda|pubblica|carica|trasferisci|esporta|copia|chiama|richiedi|fetch|curl|wget)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const IT_REPORT_WORDS: RegExp =
  /\b(?:segnala|segnalato|esempio|citazione|vulnerabilita|iniezione|attacco|rapporto|documentazione|prova)\b/;

/** Italien : familles localisées + familles universelles réutilisées. */
export const lexiconIt: C2Lexicon = {
  language: 'it',
  patterns: [
    ...imperatives,
    ...roleSwitches,
    ...SYSTEM_MARKER_PATTERNS,
    ...toolCommands,
    ...TOOL_NAME_PATTERNS,
    ...EXFILTRATION_PATTERNS,
  ],
};