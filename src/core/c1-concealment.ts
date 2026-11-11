/**
 * Couche C1 — dissimulation (§6, TP-03). Déterministe, sans modèle.
 *
 * Ce que C1 cherche : caractères invisibles, inversions du sens d'écriture,
 * texte de la couleur du fond, texte alternatif d'image, lien dont le libellé ne
 * correspond pas à l'adresse, longs blocs encodés.
 *
 * Deux entrées possibles : du texte brut, ou un document riche (ADF / HTML) réduit
 * par `src/core/rich-text.ts`, qui apporte ce que le texte brut ne dit pas
 * (couleurs, destinations de liens, textes alternatifs).
 *
 * Faux positifs évités volontairement (§22) : un extrait de code (marqué `code`
 * par le format riche), un hash cité par un développeur, du texte en arabe ou en
 * hébreu dont les marques bidi sont l'usage normal — une marque bidi isolée au
 * milieu d'un texte de ces langues n'est pas une charge.
 */

import type { Language, LayerHit } from './types';
import { clamp01 } from './findings';
import { t } from './i18n';
import type { RichTextDocument, RichTextNode } from './rich-text';
import { colorDistance, flattenAdf, flattenHtml, isWhiteish } from './rich-text';

/** Ce que la couche reçoit : texte brut et/ou document riche. */
export interface C1Input {
  text?: string;
  adf?: RichTextNode;
  html?: string;
  language?: Language;
  /** Hôtes connus du site : un lien vers un hôte absent de la liste est signalé. */
  knownHosts?: string[];
}

/** Longueur minimale d'un bloc encodé signalé. */
export const MIN_ENCODED_RUN = 60;

/** Longueur d'un texte alternatif au-delà de laquelle il porte du contenu. */
export const MIN_ALT_LENGTH = 30;

/** Distance de couleur en deçà de laquelle texte et fond se confondent. */
export const COLOR_COLLAPSE_DISTANCE = 12;

/** Un texte bidi légitime : assez de caractères arabes ou hébreux. */
const RTL_LETTER = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const NBSP = /\u00A0/g;
const SOFT_HYPHEN = /\u00AD/g;
const ENCODED_RUN = /[A-Za-z0-9+/=_-]{60,}/g;

/** Un coup de C1, avec sa règle stable (la précision se suit motif par motif, §14). */
function c1(
  ruleId: string,
  kind: LayerHit['kind'],
  askKey: string,
  start: number,
  end: number,
  excerpt: string,
  confidence: number,
  language: Language,
): LayerHit {
  return {
    layer: 'C1',
    kind,
    ruleId,
    startPos: start,
    endPos: Math.max(start, end - 1),
    excerpt: excerpt.slice(0, 80),
    askSummary: t(language, askKey),
    confidence: clamp01(confidence),
  };
}

/** Réduit l'entrée en document riche : ADF, HTML, ou texte brut seul. */
export function toRichText(input: C1Input): RichTextDocument {
  if (input.adf) return flattenAdf(input.adf);
  if (input.html) return flattenHtml(input.html);
  return { text: input.text ?? '', spans: [] };
}

/** Caractères invisibles : largeur nulle, marques tag, insécables, traits conditionnels. */
export function invisibleHits(text: string, language: Language): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const match of text.matchAll(TAG_CHARS)) {
    const start = match.index ?? 0;
    hits.push(c1('C1-02', 'invisible-chars', 'c1.ask.tag-chars', start, start + match[0].length, '[caractère tag]', 0.95, language));
  }
  for (const match of text.matchAll(ZERO_WIDTH)) {
    const start = match.index ?? 0;
    hits.push(c1('C1-01', 'invisible-chars', 'c1.ask.invisible-chars', start, start + 1, '[caractère invisible]', 0.9, language));
  }
  const joiners = [...text.matchAll(/[\u200C\u200D]{3,}/g)];
  for (const match of joiners) {
    const start = match.index ?? 0;
    hits.push(c1('C1-04', 'invisible-chars', 'c1.ask.joiners', start, start + match[0].length, '[série de liantes]', 0.8, language));
  }
  const nbsp = (text.match(NBSP) ?? []).length;
  if (nbsp >= 8) hits.push(c1('C1-03', 'invisible-chars', 'c1.ask.nbsp', 0, 0, `${nbsp} espaces insécables`, 0.4, language));
  const hyphens = (text.match(SOFT_HYPHEN) ?? []).length;
  if (hyphens >= 4) hits.push(c1('C1-07', 'invisible-chars', 'c1.ask.invisible-chars', 0, 0, `${hyphens} traits conditionnels`, 0.7, language));
  return hits;
}

/**
 * Inversions du sens d'écriture. Une marque bidi seule dans un texte qui écrit
 * vraiment de droite à gauche est l'usage normal : elle n'est signalée que si le
 * texte alentour est majoritairement latin (§22).
 */
export function bidiHits(text: string, language: Language): LayerHit[] {
  const matches = [...text.matchAll(BIDI_CONTROLS)];
  if (matches.length === 0) return [];
  const rtl = (text.match(RTL_LETTER) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (rtl > latin) return [];
  return matches.slice(0, 5).map((match) => {
    const start = match.index ?? 0;
    return c1('C1-05', 'bidi-override', 'c1.ask.bidi', start, start + 1, '[marque bidi]', 0.85, language);
  });
}

/** Texte dont la couleur se confond avec le fond, ou blanc sur blanc (§6). */
export function colorHits(document: RichTextDocument, language: Language): LayerHit[] {
  return document.spans
    .filter((span) => span.kind === 'color' && span.fgColor)
    .filter((span) => {
      if (span.bgColor) return colorDistance(span.fgColor as string, span.bgColor) <= COLOR_COLLAPSE_DISTANCE;
      return isWhiteish(span.fgColor as string);
    })
    .map((span) =>
      c1(
        span.bgColor ? 'C1-06' : 'C1-08',
        'background-colored-text',
        span.bgColor ? 'c1.ask.color-bg' : 'c1.ask.white-on-white',
        span.start,
        span.end,
        document.text.slice(span.start, span.end),
        0.9,
        language,
      ),
    );
}

/** Texte alternatif d'image porteur de contenu (§6, §22). */
export function altTextHits(document: RichTextDocument, language: Language): LayerHit[] {
  return document.spans
    .filter((span) => span.kind === 'image' && (span.alt ?? '').trim().length >= MIN_ALT_LENGTH)
    .map((span) =>
      c1('C1-09', 'image-alt-text', 'c1.ask.alt-instruction', span.start, span.end, span.alt ?? '', 0.5, language),
    );
}

/** Hôte d'une adresse, sans schéma ni chemin. */
function hostOf(value: string): string | null {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[a-z][a-z0-9+.-]*:/i, '');
  const host = withoutScheme.split(/[/?#]/)[0]?.toLowerCase();
  return host && host.includes('.') ? host : null;
}

/**
 * Liens trompeurs (§6) : libellé affichant un autre domaine que la destination,
 * schéma dangereux (`javascript:`, `data:`), ou hôte absent de la liste connue.
 */
export function linkHits(document: RichTextDocument, language: Language, knownHosts: string[] = []): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const span of document.spans.filter((item) => item.kind === 'link' && item.href)) {
    const href = span.href as string;
    const labelHost = hostOf(span.label ?? '');
    const hrefHost = hostOf(href);
    const scheme = href.split(':')[0]?.toLowerCase() ?? '';
    if (!['http', 'https', 'mailto'].includes(scheme)) {
      hits.push(c1('C1-11', 'link-label-mismatch', 'c1.ask.link-scheme', span.start, span.end, href, 0.95, language));
      continue;
    }
    if (labelHost && hrefHost && labelHost !== hrefHost && !labelHost.endsWith(`.${hrefHost}`)) {
      hits.push(c1('C1-10', 'link-label-mismatch', 'c1.ask.link-domain', span.start, span.end, `${span.label} → ${href}`, 0.9, language));
      continue;
    }
    if (knownHosts.length > 0 && hrefHost && !knownHosts.some((host) => hrefHost === host || hrefHost.endsWith(`.${host}`))) {
      hits.push(c1('C1-12', 'link-label-mismatch', 'c1.ask.link-unknown-host', span.start, span.end, href, 0.6, language));
    }
  }
  return hits;
}

/**
 * Longs blocs encodés (§6, §22) : signalés, jamais décodés ici. Le relevé est
 * autonome de celui du sas de sortie (`src/core/outbound.ts`) : le sas doit
 * fonctionner même quand la détection d'entrée n'a rien vu (§7).
 */
export function encodedHits(text: string, language: Language): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const match of text.matchAll(ENCODED_RUN)) {
    const run = match[0];
    if (run.length < MIN_ENCODED_RUN || !looksEncoded(run)) continue;
    const start = match.index ?? 0;
    hits.push(c1('C1-13', 'encoded-block', 'c1.ask.encoded-block', start, start + run.length, `${run.slice(0, 24)}…`, 0.7, language));
  }
  return hits;
}

/** Un long jeton alphanumérique n'est pas du texte : très peu de voyelles. */
export function looksEncoded(run: string): boolean {
  const vowels = (run.match(/[aeiouy]/gi) ?? []).length;
  return vowels / run.length < 0.15;
}

/** Un extrait de code n'est pas une dissimulation : il est écarté (§22). */
function withoutCodeSpans(text: string, document: RichTextDocument): string {
  if (document.spans.length === 0) return text;
  const code = document.spans.filter((span) => span.kind === 'code');
  if (code.length === 0) return text;
  let out = text;
  for (const span of [...code].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + ' '.repeat(Math.max(0, span.end - span.start)) + out.slice(span.end);
  }
  return out;
}

/**
 * Détection C1 complète. Rend une liste de `LayerHit` : le lot Constats les
 * assemble, les déduplique et en fait des constats (§6).
 */
export function detectConcealment(input: C1Input): LayerHit[] {
  const language = input.language ?? 'fr';
  const document = toRichText(input);
  const text = document.text.length > 0 ? document.text : (input.text ?? '');
  const scannable = withoutCodeSpans(text, document);
  return [
    ...invisibleHits(scannable, language),
    ...bidiHits(scannable, language),
    ...colorHits(document, language),
    ...altTextHits(document, language),
    ...linkHits(document, language, input.knownHosts),
    ...encodedHits(scannable, language),
  ];
}
