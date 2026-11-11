/**
 * Lexique C2 — portugais (données pures, §6).
 *
 * Même contrat : motifs évalués sur le texte plié (ã/õ/ç/accentuées ramenés à
 * l'ASCII). Familles universelles réutilisées depuis `lexicon-es.ts` — aucune
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
    source: String.raw`\b(?:ignore|esqueca|desconsidere|apague)\s+(?:todas\s+)?(?:suas|minhas|as)\s+(?:instrucoes|regras|diretrizes|ordens|comandos)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.82,
    source: String.raw`\b(?:a\s+partir\s+de\s+agora|de\s+agora\s+em\s+diante|daqui\s+em\s+diante)\s*,?\s*(?:voce|voces)\b`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.8,
    source: String.raw`\b(?:voce\s+(?:deve|tem\s+que|vai)|obedeca)\b[^.!?\n]{0,40}\b(?:minhas|estas|as\s+seguintes)\s+(?:instrucoes|regras|ordens)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.78,
    source: String.raw`\b(?:querido|ola|atencao)\s+(?:assistente|ia|chatbot|modelo|agente)`,
  },
  {
    ruleId: 'C2-01',
    kind: 'assistant-addressing',
    confidence: 0.75,
    source: String.raw`\b(?:novas|verdadeiras|reais|ultimas)\s+instrucoes\s*(?:para\s+(?:voce|a\s+ia|o\s+assistente))?\s*:`,
  },
];

/** Famille C2-02 — changement de rôle ou de mode. */
const roleSwitches: HitPattern[] = [
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.85, source: String.raw`\bvoce\s+(?:agora\s+e|e\s+agora|passa\s+a\s+ser)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.82, source: String.raw`\b(?:novo|nova)\s+(?:papel|funcao|personagem|personalidade|perfil)\b` },
  { ruleId: 'C2-02', kind: 'role-switch', confidence: 0.88, source: String.raw`\bmodo\s+(?:desenvolvedor|developer|dan|sem\s+restricoes|sem\s+filtro)\b` },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.75,
    source: String.raw`\b(?:aja|finja|comporte-se|haja)\s+(?:como|de)\s+(?:um|uma)?\s*(?:assistente|ia|modelo|agente|desenvolvedor|admin)`,
  },
  {
    ruleId: 'C2-02',
    kind: 'role-switch',
    confidence: 0.78,
    source: String.raw`\b(?:voce\s+nao\s+tem|sem)\s+(?:mais\s+)?(?:regras|limites|restricoes|filtros)\b`,
  },
];

/** Famille C2-04 — verbe d'outil (actions Atlassian localisées en portugais). */
const toolCommands: HitPattern[] = [
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:adicione|escreva|coloque|publique)\s+um\s+comentario\s+(?:em|a|sobre)\s+(?:todos|todo|cada)\s+(?:os\s+)?(?:tickets|solicitacoes|chamados)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.68,
    source: String.raw`\b(?:busque|encontre|liste|recupere|consulte)\s+(?:todos\s+)?(?:os\s+)?(?:tickets|solicitacoes|chamados)\s+(?:do|de|do\s+cliente)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:exporte|copie|transfira|envie\s+me)\s+(?:todos\s+)?(?:os\s+|meus\s+)?(?:tickets|solicitacoes|dados|informacoes)`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.7,
    source: String.raw`\b(?:use|chame|execute|invoque)\s+(?:a\s+)?(?:ferramenta|mcp|servidor\s+mcp)\b`,
  },
  {
    ruleId: 'C2-04',
    kind: 'tool-command',
    confidence: 0.65,
    source: String.raw`\b(?:coloque|adicione|aplique)\s+(?:a\s+)?(?:etiqueta|label)\b`,
  },
];

/** Verbes d'envoi (contexte de la famille C2-05). */
export const PT_SEND_VERBS: RegExp =
  /\b(?:envie|enviar|envia|publique|suba|transfira|exporte|copie|chame|solicite|peca|fetch|curl|wget)\b/;

/** Mots signalant que l'auteur décrit une attaque sans y obéir (§14, §22). */
export const PT_REPORT_WORDS: RegExp =
  /\b(?:sinaliza|sinalizado|reporta|reportado|exemplo|cita|vulnerabilidade|injecao|ataque|relatorio|documentacao|prova)\b/;

/** Portugais : familles localisées + familles universelles réutilisées. */
export const lexiconPt: C2Lexicon = {
  language: 'pt',
  patterns: [
    ...imperatives,
    ...roleSwitches,
    ...SYSTEM_MARKER_PATTERNS,
    ...toolCommands,
    ...TOOL_NAME_PATTERNS,
    ...EXFILTRATION_PATTERNS,
  ],
};