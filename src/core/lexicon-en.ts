/**
 * Lexique C2 — anglais (données pures, §6).
 *
 * Même contrat que `lexicon-fr.ts` : `ruleId` stable + expression régulière
 * évaluée sur le texte **plié** (minuscules, diacritiques retirés). Aucune
 * logique ici : le moteur vit dans `c2-addressing.ts` et n'existe qu'en un
 * exemplaire.
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:of\s+)?(?:(?:your|the|any|my)\s+)?(?:previous\s+|prior\s+|above\s+|earlier\s+)?(?:instructions?|prompts?|directives?|rules?|guidelines?|orders?)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignore|forget|disregard)\s+(?:everything|all|anything)\s+(?:above|before|you\s+were\s+told)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:from\s+now\s+on|starting\s+now|henceforth)\s*,?\s*(?:you|thou|your)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\byou\s+(?:will|must|shall|should)\s+(?:now\s+)?(?:follow|obey|comply\s+with)\s+(?:my|these|the\s+following)\s+(?:instructions?|rules?|commands?)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:dear|hey|attention|listen)\s+(?:assistant|ai|a\.i\.|chatbot|model|agent|llm|language\s+model)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:new|updated|real|true|actual)\s+instructions?\s*(?:for\s+the\s+(?:ai|assistant|model))?\s*:`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.72,
    source: String.raw`\bdo\s+not\s+(?:tell|inform|mention\s+to)\s+(?:the\s+)?(?:user|human|operator|customer)\b`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\byou\s+are\s+(?:now|henceforth)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\bnew\s+(?:role|persona|profile|identity|behaviou?r)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\b(?:switch|enter|enable|activate)\s+(?:to\s+)?(?:the\s+)?\w+\s+mode\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.88,
    source: String.raw`\b(?:developer|dev|dan|jailbreak|god|unrestricted|unfiltered|no[- ]restriction)\s+mode\b`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:act|behave|pretend|roleplay)\s+(?:as|like)\s+(?:an?\s+)?(?:assistant|ai|model|agent|developer|admin|root)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:you\s+have\s+no|without)\s+(?:more\s+)?(?:rules|limits|restrictions|filters|guidelines)\b`,
  },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.8, source: String.raw`\balter\s+ego\b|\bdual\s+persona\b|\bsecond\s+personality\b` },
];

/** Famille C2-03 — faux marqueur de système. */
const systemMarkers: HitPattern[] = [
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.9,
    source: String.raw`(?:^|\n)\s*(?:system|sys|admin|administrator|root|developer|assistant)\s*:`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.92, source: String.raw`\[\s*(?:system|sys|admin|instruction|prompt|inst)\s*\]` },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.9, source: String.raw`<\s*(?:system|sys|admin|prompt|instruction)\s*>` },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.9,
    source: String.raw`-{2,}\s*(?:begin|end|start|stop)\s+(?:system|admin|prompt|instruction)s?\s*-{2,}`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.85, source: String.raw`#{1,6}\s*(?:system|admin|prompt|instructions?)\b` },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.85,
    source: String.raw`\b(?:tool\s*_?\s*(?:call|use|result)|tool_call|function_call)\s*[:(]`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.7, source: String.raw`\b(?:BEGIN|END)\s+(?:SYSTEM|ADMIN|PROMPT|INSTRUCTION)` },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian / recherche / export). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:add|post|create|write)\s+(?:a\s+)?comment\s+(?:on|to|in)\s+(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?(?:tickets?|issues?|requests?)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:search|find|list|fetch|retrieve|get|look\s+up)\s+(?:all\s+)?(?:the\s+)?(?:tickets?|issues?|requests?)\s+(?:of|from|for)\s+(?:the\s+)?(?:client|customer|other\s+project)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:export|copy|dump|send\s+me)\s+(?:all\s+)?(?:the\s+|my\s+)?(?:requests?|tickets?|issues?|data|information)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.72,
    source: String.raw`\b(?:use|call|invoke|run)\s+(?:the\s+)?(?:mcp|tool|server)\b[^.\n]{0,30}\b(addComment|editIssue|searchIssues|createIssue|getIssue|addWorklog|transitionIssue)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:use|call|invoke|run)\s+(?:the\s+)?(?:mcp|atlassian\s+mcp|tool|tools)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:add|set|apply|attach)\s+(?:the\s+)?(?:label|tag)\b`,
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

/** Verbes d'envoi (contexte de la famille C2-05). */
export const EN_SEND_VERBS: RegExp =
  /\b(?:send|post|upload|forward|submit|push|export|fetch|curl|wget|request|deliver|leak|exfiltrate)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const EN_REPORT_WORDS: RegExp =
  /\b(?:report|reported|quote|quoted|example|sample|vulnerability|injection|attack|security|documentation|proof|payload|pentest|found|disclosed?)\b/;

export const lexiconEn: C2Lexicon = {
  language: 'en',
  patterns: [...imperatives, ...roleSwitches, ...systemMarkers, ...toolCommands, ...exfiltration],
};
