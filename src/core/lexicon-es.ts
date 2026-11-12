/**
 * Lexique C2 — espagnol (données pures, §6).
 *
 * Même contrat que `lexicon-fr.ts` / `lexicon-en.ts` : un `HitPattern` =
 * `ruleId` stable + famille + expression régulière évaluée sur le texte
 * **plié** (minuscules, diacritiques retirés). Le moteur vit dans
 * `c2-addressing.ts` et n'existe qu'en un exemplaire ; seule cette table de
 * motifs change d'une langue à l'autre.
 *
 * Les familles **universelles** — faux marqueur de système (C2-03), adresse
 * web jointe à un envoi (C2-05) et identifiants d'outils Atlassian (C2-04) —
 * ne dépendent pas de la langue de rédaction : elles sont exportées d'ici et
 * **réutilisées** par les quatre autres lexiques plutôt que recopiées.
 */
import type { C2Lexicon, HitPattern } from './c2-addressing';

/** Famille C2-03 — faux marqueur de système (jetons universels). */
export const SYSTEM_MARKER_PATTERNS: readonly HitPattern[] = [
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
    source: String.raw`-+\s*(?:begin|end|start|stop)\s+(?:system|admin|prompt|instruction)s?\s*-+`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.85, source: String.raw`#+\s*(?:system|admin|prompt|instructions?)\b` },
  {
    ruleId: 'C2-03',
    kind: 'fake-system-marker',
    confidence: 0.85,
    source: String.raw`\b(?:tool\s*_?\s*(?:call|use|result)|tool_call|function_call)\s*[:(]`,
  },
  { ruleId: 'C2-03', kind: 'fake-system-marker', confidence: 0.7, source: String.raw`\b(?:BEGIN|END)\s+(?:SYSTEM|ADMIN|PROMPT|INSTRUCTION)` },
];

/** Clé d'outil Atlassian (C2-04) — identifiants universels, indépendants de la langue. */
export const TOOL_NAME_PATTERNS: readonly HitPattern[] = [
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

/** Famille C2-05 — adresse web jointe à un envoi de données (universel). */
export const EXFILTRATION_PATTERNS: readonly HitPattern[] = [
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

/** Famille C2-01 — consigne impérative adressée à l'assistant. */
const imperatives: HitPattern[] = [
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.9,
    source: String.raw`\b(?:ignora|olvida|olvide)\s+(?:todas\s+)?(?:tus|vuestras|mis|las)\s+(?:instrucciones|consignas|directivas|reglas|ordenes)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:a\s+partir\s+de\s+ahora|desde\s+ahora|de\s+ahora\s+en\s+adelante)\s*,?\s*(?:tu|usted|vosotros)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\b(?:debes|tienes\s+que|vas\s+a|obedece)\b[^.!?\n]{0,40}\b(?:mis|estas|las\s+siguientes)\s+(?:instrucciones|ordenes|reglas)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:querido|hla|atencion)\s+(?:asistente|ia|chatbot|modelo|agente)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:nuevas|verdaderas|reales|ultimas)\s+instrucciones\s*(?:para\s+(?:ti|la\s+ia|el\s+asistente))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\b(?:ahora\s+eres|eres\s+ahora|a\s+partir\s+de\s+ahora\s+eres)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\b(?:nuevo|nueva)\s+(?:rol|papel|personaje|personalidad|perfil)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmodo\s+(?:desarrollador|developer|dan|sin\s+restricciones|sin\s+filtro|libre)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:actua|comportate|hazte|fingete)\s+(?:como|de)\s+(?:un|una)?\s*(?:asistente|ia|modelo|agente|desarrollador|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:no\s+tienes|sin)\s+(?:mas\s+)?(?:reglas|limites|restricciones|filtros)\b`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian localisées en espagnol). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:anade|agrega|pon|escribe)\s+un\s+comentario\s+(?:en|a|sobre)\s+(?:todos|toda|cada)\s+(?:los\s)?(?:tickets|solicitudes|incidencias)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:busca|encuentra|lista|recupera|consulta)\s+(?:todos\s+)?(?:los\s)?(?:tickets|solicitudes|incidencias)\s+(?:del|de|del\s+cliente)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:exporta|copia|transfiere|envia\s+me)\s+(?:todos\s+)?(?:los\s+|mis\s+)?(?:tickets|solicitudes|datos|informacion)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:usa|llama|ejecuta|invoca)\s+(?:la\s+)?(?:herramienta|mcp|servidor\s+mcp)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:pon|anade|aplica)\s+(?:la\s+)?(?:etiqueta|label)\b`,
  },
];

/** Verbes d'envoi (contexte de la famille C2-05). */
export const ES_SEND_VERBS: RegExp =
  /\b(?:envia|enviar|envio|publica|sube|transfiere|exporta|copia|llama|solicita|pide|fetch|curl|wget)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const ES_REPORT_WORDS: RegExp =
  /\b(?:senala|senalado|reporta|reportado|ejemplo|cita|fuga|vulnerabilidad|inyeccion|ataque|informe|documentacion|prueba)\b/;

/** Espagnol : familles localisées + familles universelles réutilisées. */
export const lexiconEs: C2Lexicon = {
  language: 'es',
  patterns: [
    ...imperatives,
    ...roleSwitches,
    ...SYSTEM_MARKER_PATTERNS,
    ...toolCommands,
    ...TOOL_NAME_PATTERNS,
    ...EXFILTRATION_PATTERNS,
  ],
};