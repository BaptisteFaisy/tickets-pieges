/**
 * Couche C2 — « adresse à une IA » (§6). Déterministe : aucun modèle, aucune E/S.
 *
 * Cinq familles, un `ruleId` stable par famille :
 *  - C2-01 consigne impérative adressée à l'assistant ;
 *  - C2-02 changement de rôle ou de mode ;
 *  - C2-03 faux marqueur de système ;
 *  - C2-04 verbe d'outil (Atlassian, recherche, export) ;
 *  - C2-05 adresse web jointe à un envoi de données (§10).
 *
 * Un seul moteur, sept tables de motifs (`lexicon-fr.ts`, `lexicon-en.ts`,
 * `lexicon-es.ts`, `lexicon-de.ts`, `lexicon-pt.ts`, `lexicon-it.ts`,
 * `lexicon-nl.ts`) : la logique ne se duplique pas par langue. Les familles
 * universelles (marqueur de système, adresse web, identifiants d'outils) sont
 * exportées depuis `lexicon-es.ts` et **réutilisées** par les autres lexiques.
 * Les motifs sont évalués sur un texte **plié** (minuscules, diacritiques
 * retirés, guillemets typographiques ramenés à l'ASCII), avec une table de
 * correspondance qui restitue les positions d'origine — d'où `startPos` /
 * `endPos` exacts sur le texte reçu.
 *
 * Le résumé (`askSummary`) n'est jamais recopié du texte : il vient du
 * catalogue (`catalog/detection-c2.ts`), donc neutre par construction.
 */
import { t } from './i18n';
import { DE_REPORT_WORDS, DE_SEND_VERBS, lexiconDe } from './lexicon-de';
import { EN_REPORT_WORDS, EN_SEND_VERBS, lexiconEn } from './lexicon-en';
import { ES_REPORT_WORDS, ES_SEND_VERBS, lexiconEs } from './lexicon-es';
import { FR_REPORT_WORDS, FR_SEND_VERBS, lexiconFr } from './lexicon-fr';
import { IT_REPORT_WORDS, IT_SEND_VERBS, lexiconIt } from './lexicon-it';
import { NL_REPORT_WORDS, NL_SEND_VERBS, lexiconNl } from './lexicon-nl';
import { PT_REPORT_WORDS, PT_SEND_VERBS, lexiconPt } from './lexicon-pt';
import { detectLanguage } from './langues';
import type { LexiconLanguage } from './langues';
import type { FindingKind, Language, LayerHit } from './types';

/** Langues scannables par C2 : fr/en du tronc + les cinq lexiques de ce lot. */
type ScanLanguage = Language | LexiconLanguage;

// ------------------------------------------------------------------- contrats

/** Un motif : une donnée, évaluée telle quelle sur le texte plié. */
export interface HitPattern {
  /** `C2-01` à `C2-05` — stable, distinct par famille. */
  ruleId: string;
  kind: FindingKind;
  /** Confiance de base du motif, avant mesure de précision (§14). */
  confidence: number;
  /**
   * `true` : le motif seul ne suffit pas (une URL banale n'est pas une fuite) ;
   * il faut un verbe d'envoi à proximité ou des paramètres portant des données.
   */
  needsContext?: boolean;
  /** Source de l'expression régulière, compilée avec les drapeaux `gi`. */
  source: string;
}

/** Table de motifs d'une langue. */
export interface C2Lexicon {
  language: ScanLanguage;
  patterns: readonly HitPattern[];
}

/** Réglages d'appel — tout est facultatif : le détecteur marche sans réglage. */
export interface C2Options {
  /** Restreint la détection à une langue (par défaut : français **et** anglais). */
  language?: Language;
  /** Idem, sous forme de liste (peut inclure es/de/pt/it/nl). */
  languages?: readonly ScanLanguage[];
  /** Détecte la langue du texte et scanne ce seul lexique (§2, §3). */
  autoLanguage?: boolean;
  /** Formules à ignorer du projet (§14) : un passage couvert ne lève rien. */
  ignoredPhrases?: readonly string[];
  /** Variante branchée sur `trust-rules.ts` du lot Origine, si fusionné. */
  isIgnoredPhrase?: (excerpt: string, startPos: number, endPos: number) => boolean;
  /** Précision mesurée par règle (§14) : multiplie la confiance, de 0 à 1. */
  precisionByRule?: Readonly<Record<string, number>>;
  /** Plafond de constats rendus (bruit maîtrisé, §21). */
  maxHits?: number;
}

// ------------------------------------------------------------------ constantes

const LEXICONS: Record<ScanLanguage, C2Lexicon> = {
  fr: lexiconFr,
  en: lexiconEn,
  es: lexiconEs,
  de: lexiconDe,
  pt: lexiconPt,
  it: lexiconIt,
  nl: lexiconNl,
};
const SEND_VERBS: Record<ScanLanguage, RegExp> = {
  fr: FR_SEND_VERBS,
  en: EN_SEND_VERBS,
  es: ES_SEND_VERBS,
  de: DE_SEND_VERBS,
  pt: PT_SEND_VERBS,
  it: IT_SEND_VERBS,
  nl: NL_SEND_VERBS,
};
const REPORT_WORDS: Record<ScanLanguage, RegExp> = {
  fr: FR_REPORT_WORDS,
  en: EN_REPORT_WORDS,
  es: ES_REPORT_WORDS,
  de: DE_REPORT_WORDS,
  pt: PT_REPORT_WORDS,
  it: IT_REPORT_WORDS,
  nl: NL_REPORT_WORDS,
};

const MAX_TEXT = 20_000;
const MAX_HITS = 40;
const EXCERPT_MAX = 120;
const SENTENCE_WINDOW = 160;
const SEND_VERB_WINDOW = 140;
/** Confiance d'un passage qui cite une charge dans un signalement (§22). */
const REPORT_FACTOR = 0.6;
/** Une demande polie s'adresse à un humain, pas à un assistant (§22). */
const POLITE = /\b(?:pouvez-vous|pourriez-vous|peux-tu|pourrais-tu|merci\s+d[eu]|could\s+you|can\s+you|would\s+you|please)\b/;
/** Paramètres d'URL qui trahissent des données de ticket recopiées. */
const DATA_PARAM =
  /[?&](?:issue|issuekey|key|ticket|ticketkey|jql|token|secret|text|data|body|comment|description|email|emailaddress|summary|payload|content)=/;

// --------------------------------------------------------------------- pliage

interface Folded {
  text: string;
  /** Pour chaque caractère plié, son index dans le texte d'origine. */
  index: number[];
}

/** Ramène un caractère à sa forme pliée (une chaîne : `…` en rend trois). */
function foldChar(char: string): string {
  if (char === '\u00A0' || char === '\u202F' || char === '\u2009') return ' ';
  if (char === '’' || char === '‘' || char === '‛') return "'";
  if (char === '“' || char === '”') return '"';
  if (char === '–' || char === '—' || char === '−') return '-';
  if (char === '…') return '...';
  if (char === 'œ') return 'oe';
  if (char === 'æ') return 'ae';
  return char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Plie le texte et garde la correspondance vers les positions d'origine. */
export function foldText(raw: string): Folded {
  const chars: string[] = [];
  const index: number[] = [];
  const source = raw.length > MAX_TEXT ? raw.slice(0, MAX_TEXT) : raw;
  for (let i = 0; i < source.length; i += 1) {
    for (const folded of foldChar(source.charAt(i))) {
      chars.push(folded);
      index.push(i);
    }
  }
  return { text: chars.join(''), index };
}

/** Position d'origine d'un index plié, bornée au texte. */
function originalPos(folded: Folded, position: number, fallback: number): number {
  return folded.index[position] ?? fallback;
}

// ------------------------------------------------------------------ candidats

interface Candidate {
  ruleId: string;
  kind: FindingKind;
  language: ScanLanguage;
  startPos: number;
  endPos: number;
  confidence: number;
  needsContext: boolean;
  reported: boolean;
}

/** Fenêtre de phrase autour d'un intervalle (garde-fou des heuristiques). */
function sentenceAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SENTENCE_WINDOW);
  const to = Math.min(text.length, end + SENTENCE_WINDOW);
  const slice = text.slice(from, to);
  const cutLeft = Math.max(slice.lastIndexOf('\n', start - from), 0);
  const cutRight = slice.indexOf('\n', end - from);
  return slice.slice(cutLeft, cutRight === -1 ? slice.length : cutRight);
}

/**
 * Le passage est-il cité dans un signalement ou une documentation (§22) ?
 *
 * On regarde la phrase, puis le texte entier : un titre « Documentation » ou
 * « Je vous signale une faille » en tête de message vaut pour tout le message.
 * Le signalement ne supprime pas le constat — il en mesure la confiance.
 */
function looksReported(text: string, start: number, end: number, language: ScanLanguage): boolean {
  const window = sentenceAround(text, start, end);
  if (/(?:^|\n)\s*>/.test(window)) return true;
  // Une adresse contient souvent « example » ou « doc » : elle ne dit rien du
  // propos de l'auteur, on la retire avant de chercher des mots de signalement.
  const prose = foldText(`${window} ${text}`).text.replace(/\S*:\/\/\S*|\bwww\.\S*|\S*@\S*/g, ' ');
  const langs: ScanLanguage[] =
    language === 'fr' ? ['fr', 'en'] : language === 'en' ? ['en', 'fr'] : [language, 'fr', 'en'];
  return langs.some((lang) => REPORT_WORDS[lang].test(prose));
}

/** Une URL banale n'est retenue que si quelque chose l'accompagne (§10). */
function keepsUrlHit(text: string, candidate: Candidate, excerpt: string): boolean {
  if (!candidate.needsContext) return true;
  if (DATA_PARAM.test(excerpt.split(' ')[0] ?? '')) return true;
  const before = text.slice(Math.max(0, candidate.startPos - SEND_VERB_WINDOW), candidate.startPos);
  return SEND_VERBS[candidate.language].test(foldText(before).text);
}

// ------------------------------------------------------------------ recherche

/** Applique une table de motifs et rend les candidats bruts. */
function scanLexicon(lexicon: C2Lexicon, folded: Folded): Candidate[] {
  const found: Candidate[] = [];
  for (const pattern of lexicon.patterns) {
    const re = new RegExp(pattern.source, 'gi');
    let match = re.exec(folded.text);
    while (match !== null) {
      if (match[0] === '') {
        re.lastIndex += 1;
      } else {
        found.push({
          ruleId: pattern.ruleId,
          kind: pattern.kind,
          language: lexicon.language,
          startPos: originalPos(folded, match.index, 0),
          endPos: originalPos(folded, match.index + match[0].length - 1, 0) + 1,
          confidence: pattern.confidence,
          needsContext: pattern.needsContext === true,
          reported: false,
        });
      }
      match = re.exec(folded.text);
    }
  }
  return found;
}

// ------------------------------------------------------------------- filtrage

interface IgnoredRanges {
  ranges: [number, number][];
  test: C2Options['isIgnoredPhrase'];
}

/** Intervalles des formules à ignorer, dans les positions d'origine. */
function ignoredRanges(options: C2Options, folded: Folded, raw: string): IgnoredRanges {
  const ranges: [number, number][] = [];
  for (const phrase of options.ignoredPhrases ?? []) {
    const needle = foldText(String(phrase)).text.trim().replace(/\s+/g, ' ');
    if (needle.length < 4) continue;
    let from = folded.text.indexOf(needle);
    while (from !== -1) {
      ranges.push([
        originalPos(folded, from, 0),
        originalPos(folded, from + needle.length - 1, raw.length) + 1,
      ]);
      from = folded.text.indexOf(needle, from + 1);
    }
  }
  return { ranges, test: options.isIgnoredPhrase };
}

/** Un candidat couvert par une formule ignorée ne lève aucun constat (§14). */
function isIgnored(candidate: Candidate, ignored: IgnoredRanges, raw: string): boolean {
  const covered = ignored.ranges.some(
    ([from, to]) => candidate.startPos >= from && candidate.endPos <= to,
  );
  if (covered) return true;
  if (!ignored.test) return false;
  return ignored.test(raw.slice(candidate.startPos, candidate.endPos), candidate.startPos, candidate.endPos);
}

/** Écarte les demandes polies adressées à un humain et les URL sans contexte. */
function keepsCandidate(candidate: Candidate, raw: string, excerpt: string): boolean {
  if (candidate.ruleId === 'C2-04') {
    return !POLITE.test(sentenceAround(raw, candidate.startPos, candidate.endPos).toLowerCase());
  }
  if (candidate.ruleId === 'C2-05') return keepsUrlHit(raw, candidate, excerpt);
  return true;
}

// -------------------------------------------------------------- fusion et sortie

/** Deux constats de même règle qui se touchent décrivent le même passage. */
function mergeByRule(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.startPos - b.startPos || a.endPos - b.endPos);
  const merged: Candidate[] = [];
  for (const candidate of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.ruleId === candidate.ruleId && candidate.startPos <= last.endPos + 2) {
      last.endPos = Math.max(last.endPos, candidate.endPos);
      last.confidence = Math.max(last.confidence, candidate.confidence);
      last.needsContext = last.needsContext && candidate.needsContext;
      last.reported = last.reported || candidate.reported;
      continue;
    }
    merged.push({ ...candidate });
  }
  return merged;
}

/** Confiance finale : base × précision mesurée × citation, bornée et arrondie. */
function finalConfidence(candidate: Candidate, options: C2Options): number {
  const precision = options.precisionByRule?.[candidate.ruleId] ?? 1;
  const factor = candidate.reported ? REPORT_FACTOR : 1;
  const value = candidate.confidence * Math.min(Math.max(precision, 0), 1) * factor;
  return Math.max(0.05, Math.min(0.99, Math.round(value * 100) / 100));
}

/** Extrait court, sans bavure de ponctuation finale. */
function excerptOf(raw: string, candidate: Candidate): string {
  const slice = raw.slice(candidate.startPos, candidate.endPos).replace(/\s+/g, ' ').trim();
  const clean = slice.replace(/[.,;:!?]+$/, '');
  const text = clean.length > 0 ? clean : slice;
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
}

/** Langue du catalogue pour un résumé : fr pour le français, en sinon (§21). */
function summaryLanguage(language: ScanLanguage): Language {
  return language === 'fr' ? 'fr' : 'en';
}

/** Résumé neutre, dans la langue du motif (§6, §21). */
function summaryOf(candidate: Candidate): string {
  const key = candidate.reported
    ? `c2.summary.reported.${candidate.ruleId}`
    : `c2.summary.${candidate.ruleId}`;
  return t(summaryLanguage(candidate.language), key);
}

/** Fabrique un `LayerHit` C2 à partir d'un candidat retenu. */
function toHit(raw: string, candidate: Candidate, options: C2Options): LayerHit {
  return {
    layer: 'C2',
    kind: candidate.kind,
    ruleId: candidate.ruleId,
    startPos: candidate.startPos,
    endPos: candidate.endPos,
    excerpt: excerptOf(raw, candidate),
    askSummary: summaryOf(candidate),
    confidence: finalConfidence(candidate, options),
  };
}

// -------------------------------------------------------------------- l'entrée

/** Langues effectivement interrogées (défaut : fr + en ; auto : langue détectée). */
function languagesOf(options: C2Options, text: string): ScanLanguage[] {
  if (options.languages && options.languages.length > 0) return [...options.languages];
  if (options.language) return [options.language];
  if (options.autoLanguage) {
    const detected = detectLanguage(text);
    if (detected !== 'other') return [detected];
  }
  return ['fr', 'en'];
}

/**
 * Détecte les passages adressés à une IA.
 *
 * @param text  le texte du segment (résumé, description, commentaire, champ…)
 * @param options  langue, formules à ignorer, précision par règle, plafond
 * @returns les constats C2, triés par position ; au plus `maxHits`
 */
export function detectAddressing(text: string, options: C2Options = {}): LayerHit[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const raw = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const folded = foldText(raw);
  const ignored = ignoredRanges(options, folded, raw);
  const raw_candidates = languagesOf(options, raw).flatMap((language) =>
    scanLexicon(LEXICONS[language], folded),
  );
  const kept: Candidate[] = [];
  for (const candidate of raw_candidates) {
    const excerpt = excerptOf(raw, candidate);
    if (isIgnored(candidate, ignored, raw)) continue;
    if (!keepsCandidate(candidate, raw, excerpt)) continue;
    candidate.reported = looksReported(raw, candidate.startPos, candidate.endPos, candidate.language);
    kept.push(candidate);
  }
  const limit = options.maxHits ?? MAX_HITS;
  return mergeByRule(kept)
    .slice(0, limit)
    .map((candidate) => toHit(raw, candidate, options));
}

/** Motifs d'une famille, pour l'écran de revue et la mesure de précision (§14). */
export function c2Patterns(language: ScanLanguage): readonly HitPattern[] {
  return LEXICONS[language].patterns;
}

/** Les cinq `ruleId` de la couche, dans l'ordre du cahier des charges. */
export const C2_RULE_IDS: readonly string[] = ['C2-01', 'C2-02', 'C2-03', 'C2-04', 'C2-05'];
