/**
 * Formules à ignorer (§14) — les intervalles qu'elles couvrent.
 *
 * Une formule à ignorer (mention légale, signature, formule de politesse pleine
 * d'impératifs) ne doit lever aucun constat. Deux couches s'en servent :
 *  - **C2** écarte un constat dont l'intervalle est entièrement couvert ;
 *  - **C3** ne soumet pas au modèle le passage couvert — la comparaison est
 *    normalisée (casse, accents, typographie), comme le pliage de C2.
 *
 * La comparaison passe par `foldText` : une même formule écrite en capitales ou
 * avec des apostrophes typographiques est reconnue. Une formule vide ou de
 * moins de `MIN_PHRASE_CHARS` caractères ne couvre rien (une entrée vide dans
 * une liste de réglages ne doit pas tout ignorer).
 */

import { foldText, originalPos } from './fold';

/** En deçà, une entrée de liste est considérée comme vide. */
export const MIN_PHRASE_CHARS = 4;

/** Un intervalle couvert, en positions du texte d'origine. */
export interface IgnoredSpan {
  start: number;
  end: number;
}

/**
 * Intervalles du texte couverts par les formules à ignorer, triés et fusionnés.
 * Les positions sont celles du texte d'origine (pas du texte plié).
 */
export function ignoredSpans(text: string, phrases: readonly string[]): IgnoredSpan[] {
  if (text.length === 0 || phrases.length === 0) return [];
  const folded = foldText(text);
  const spans: IgnoredSpan[] = [];
  for (const phrase of phrases) {
    const needle = foldText(String(phrase)).text.trim().replace(/\s+/g, ' ');
    if (needle.length < MIN_PHRASE_CHARS) continue;
    let from = folded.text.indexOf(needle);
    while (from !== -1) {
      spans.push({
        start: originalPos(folded, from, 0),
        end: originalPos(folded, from + needle.length - 1, text.length) + 1,
      });
      from = folded.text.indexOf(needle, from + 1);
    }
  }
  return mergeSpans(spans);
}

/** Intervalles triés, dont les voisins qui se touchent sont réunis. */
function mergeSpans(spans: IgnoredSpan[]): IgnoredSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: IgnoredSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Cet intervalle est-il entièrement couvert par une formule à ignorer ? */
export function isCovered(start: number, end: number, spans: readonly IgnoredSpan[]): boolean {
  return spans.some((span) => start >= span.start && end <= span.end);
}

/** Marque laissée à la place d'un passage ignoré : le modèle sait qu'il manque. */
export const IGNORED_MARKER = '[passage ignoré]';

/**
 * Le texte sans ses passages couverts. Ce qui reste est ce que les couches ont
 * le droit de juger : une mention légale retirée, la consigne d'à côté demeure.
 */
export function withoutIgnoredPhrases(text: string, phrases: readonly string[]): string {
  const spans = ignoredSpans(text, phrases);
  if (spans.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    parts.push(text.slice(cursor, span.start), IGNORED_MARKER);
    cursor = span.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('').replace(/\n{3,}/g, '\n\n');
}

/**
 * Ce qu'il reste à juger une fois les passages ignorés retirés : les marques,
 * la ponctuation et les blancs ne comptent pas. Une chaîne vide signifie que le
 * texte n'était **que** des formules à ignorer — il n'y a rien à soumettre au
 * modèle, et rien à constater.
 */
export function readableRemainder(text: string, phrases: readonly string[]): string {
  const kept = withoutIgnoredPhrases(text, phrases).split(IGNORED_MARKER).join(' ');
  return kept.replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
}
