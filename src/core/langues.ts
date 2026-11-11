/**
 * Détection de langue d'un segment, pour choisir le lexique C2 (§2, §3).
 *
 * Le type `Language` du tronc (`types.ts`) reste `'fr' | 'en'` : rien n'est
 * modifié ailleurs. Ce fichier définit un type **propre à ce lot** —
 * `LexiconLanguage`, les cinq lexiques ajoutés, et `DetectionLanguage`, l'union
 * des sept — ainsi qu'un détecteur déterministe par mots vides.
 *
 * Aucune E/S, aucun modèle : un score de mots vides suffit à distinguer sept
 * langues, pas à traduire (même contrat que `guessLanguage` de `context.ts`,
 * qui n'est pas modifié).
 */
import type { Language } from './types';

/** Les cinq langues ajoutées par ce lot. */
export type LexiconLanguage = 'es' | 'de' | 'pt' | 'it' | 'nl';

/** Langues de détection : fr/en du tronc + les cinq lexiques ajoutés. */
export type DetectionLanguage = Language | LexiconLanguage;

/** Mots vides distinctifs par langue : assez pour départager, pas pour traduire. */
const STOPWORDS: Record<DetectionLanguage, readonly string[]> = {
  fr: ['le', 'la', 'les', 'des', 'une', 'et', 'pour', 'vous', 'nous', 'merci', 'bonjour', 'mon', 'avec', 'dans', 'sur', 'est'],
  en: ['the', 'and', 'you', 'for', 'with', 'please', 'hello', 'my', 'our', 'this', 'that', 'is', 'are', 'have', 'not'],
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'y', 'para', 'por', 'con', 'gracias', 'hola', 'mi', 'no', 'que', 'es', 'como'],
  de: ['der', 'die', 'das', 'und', 'ich', 'du', 'sie', 'wir', 'mit', 'fuer', 'bitte', 'hallo', 'mein', 'nicht', 'ist', 'ein', 'eine'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'e', 'para', 'por', 'com', 'obrigado', 'ola', 'meu', 'nao', 'que', 'de', 'voce'],
  it: ['il', 'lo', 'la', 'i', 'le', 'un', 'una', 'e', 'per', 'con', 'grazie', 'ciao', 'mio', 'non', 'che', 'di', 'sono'],
  nl: ['de', 'het', 'een', 'en', 'ik', 'je', 'u', 'we', 'met', 'voor', 'dank', 'hallo', 'mijn', 'niet', 'is', 'van', 'om'],
};

/** Référentiel réduit de lettres propres à une langue (indice faible, facultatif). */
const LETTER_MARKS: Record<string, RegExp> = {
  es: /[ñ¿¡]/,
  de: /[ßäöü]/,
  pt: /[ãõ]/,
  nl: /ij/,
};

/** Découpe un texte en mots pliés et minuscules. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zà-ÿ']+/)
    .filter((word) => word.length > 1);
}

/** Score d'une langue sur un texte : nombre de mots vides + indice de lettres. */
function score(language: DetectionLanguage, words: string[]): number {
  const stop = new Set(STOPWORDS[language]);
  let total = 0;
  for (const word of words) {
    if (stop.has(word)) total += 1;
  }
  if (language !== 'fr' && language !== 'en') {
    const mark = LETTER_MARKS[language];
    if (mark?.test(words.join(' '))) total += 1;
  }
  return total;
}

/**
 * Langue probable d'un texte parmi les sept ; `other` quand rien ne tranche.
 * Retourne `fr`/`en` en préférence, puis les cinq lexiques ajoutés.
 */
export function detectLanguage(text: string): DetectionLanguage | 'other' {
  const words = wordsOf(text);
  if (words.length === 0) return 'other';
  const order: DetectionLanguage[] = ['fr', 'en', 'es', 'de', 'pt', 'it', 'nl'];
  let best: DetectionLanguage = 'fr';
  let bestScore = 0;
  for (const language of order) {
    const value = score(language, words);
    if (value > bestScore) {
      best = language;
      bestScore = value;
    }
  }
  return bestScore === 0 ? 'other' : best;
}