/**
 * Couche C4 — contexte (§6) : une **pondération**, jamais un verdict.
 *
 * Le cahier est explicite : « C4 Contexte — premier ticket d'un compte créé il
 * y a une heure, canal anonyme, longueur inhabituelle, langue différente du
 * reste, pièce jointe non analysable — Pondération ». Ces signaux ne lèvent donc
 * pas de constat décisif : ils pèsent dans le calcul du niveau de suspicion
 * (`suspicion.ts`), sans jamais dépasser « à vérifier » à eux seuls.
 */

import type { Language, LayerHit, SegmentSource } from './types';
import { t } from './i18n';

/** Ce que le ticket apporte autour du segment, sans accès à d'autres tickets. */
export interface IssueContext {
  /** Longueur médiane des segments du projet, en caractères (facultatif). */
  medianLength?: number;
  /** Langue dominante du ticket, quand elle a été mesurée. */
  dominantLanguage?: string;
  /** Une pièce jointe du ticket n'a pas pu être analysée (§22). */
  unparseableAttachment?: boolean;
}

/** Réglages de la couche, tous facultatifs : les défauts suivent le cahier. */
export interface ContextOptions {
  /** Instant de référence (ISO) pour l'âge du compte. */
  now: string;
  /** Compte « frais » en deçà de ce nombre d'heures (défaut : 24 h). */
  freshAccountHours?: number;
  language?: Language;
}

/** Mots vides : assez pour distinguer deux langues, pas pour traduire. */
const STOPWORDS: Record<'fr' | 'en', string[]> = {
  fr: ['le', 'la', 'les', 'des', 'une', 'et', 'pour', 'vous', 'nous', 'merci', 'bonjour', 'mon'],
  en: ['the', 'and', 'you', 'for', 'with', 'please', 'hello', 'my', 'our', 'this', 'that'],
};

/** Langue probable d'un texte : `fr`, `en`, ou `other` quand rien ne tranche. */
export function guessLanguage(text: string): 'fr' | 'en' | 'other' {
  const words = text
    .toLowerCase()
    .split(/[^a-zà-ÿ']+/)
    .filter((word) => word.length > 1);
  if (words.length === 0) return 'other';
  let fr = 0;
  let en = 0;
  for (const word of words) {
    if (STOPWORDS.fr.includes(word)) fr += 1;
    if (STOPWORDS.en.includes(word)) en += 1;
  }
  if (fr === 0 && en === 0) return 'other';
  return fr >= en ? 'fr' : 'en';
}

/** Heures écoulées entre deux dates ISO ; `null` si l'une est illisible. */
export function hoursBetween(fromIso: string | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.abs(to - from) / 3_600_000;
}

/** Un signal de contexte : couche C4, confiance basse, jamais décisif seul. */
function signal(
  kind: LayerHit['kind'],
  ruleId: string,
  confidence: number,
  language: Language,
  askKey: string,
  excerpt: string,
): LayerHit {
  return {
    layer: 'C4',
    kind,
    ruleId,
    startPos: 0,
    endPos: 0,
    excerpt,
    askSummary: t(language, askKey),
    confidence,
  };
}

/**
 * Signaux de contexte d'un segment. Chacun est rendu comme un `LayerHit` de
 * couche C4 — positions à zéro, extrait court, confiance basse — pour que le
 * bandeau puisse dire *pourquoi* un ticket est signalé sans accuser personne.
 */
export function contextHits(
  segment: SegmentSource,
  context: IssueContext = {},
  options: ContextOptions = { now: new Date(0).toISOString() },
): LayerHit[] {
  const language = options.language ?? 'fr';
  const hits: LayerHit[] = [];

  const age = hoursBetween(segment.author.accountCreatedAt, options.now);
  const freshHours = options.freshAccountHours ?? 24;
  if (age !== null && age < freshHours) {
    hits.push(signal('fresh-account', 'C4-01', 0.3, language, 'ask.fresh-account',
      t(language, 'c4.fresh-account.detail', { hours: Math.round(age) })));
  }

  if (segment.channel === 'anonymousportal') {
    hits.push(signal('anonymous-channel', 'C4-02', 0.3, language, 'ask.anonymous-channel',
      t(language, 'c4.anonymous-channel.detail')));
  }

  const length = segment.text.trim().length;
  const median = context.medianLength ?? 0;
  if (median > 0 && length > median * 3 && length >= 400) {
    hits.push(signal('unusual-length', 'C4-03', 0.2, language, 'ask.unusual-length',
      t(language, 'c4.unusual-length.detail', { length, median })));
  }

  const dominant = context.dominantLanguage;
  if (dominant && dominant !== 'other') {
    const guessed = guessLanguage(segment.text);
    if (guessed !== 'other' && guessed !== dominant) {
      hits.push(signal('language-shift', 'C4-04', 0.25, language, 'ask.language-shift',
        t(language, 'c4.language-shift.detail', { found: guessed, expected: dominant })));
    }
  }

  const attachmentUnreadable = Boolean(segment.attachment && !segment.attachment.parseable);
  if (attachmentUnreadable || context.unparseableAttachment) {
    hits.push(signal('unparseable-attachment', 'C4-05', 0.3, language, 'ask.unparseable-attachment',
      t(language, 'c4.unparseable-attachment.detail')));
  }

  return hits;
}

/**
 * Score de contexte, borné à 1. La somme des confiances ne peut pas dépasser
 * ce que vaut une preuve déterministe : c'est ce qui garantit qu'un contexte
 * seul ne passe jamais au-dessus de « à vérifier ».
 */
export function contextScore(hits: LayerHit[]): number {
  const total = hits
    .filter((hit) => hit.layer === 'C4')
    .reduce((sum, hit) => sum + Math.max(0, hit.confidence), 0);
  return Math.min(1, Number(total.toFixed(2)));
}
