/**
 * Texte riche — réduction en texte brut + marquages (couche C1, §6).
 *
 * Jira Service Management rend le contenu dans le « Atlassian Document Format »
 * (ADF, un arbre JSON) ou, pour les champs texte et les courriels entrants, en
 * HTML simplifié. Le texte brut seul ne suffit pas à C1 : il faut aussi la
 * couleur du texte, la couleur du fond, la destination réelle des liens et le
 * texte alternatif des images (§20 : « lecture de la couleur du texte et du
 * texte alternatif dans le format de document d'Atlassian »).
 *
 * Ce module réduit les deux formes en un document unique :
 *   `text`  — le texte brut, tel qu'il sera stocké : les positions des constats
 *             C1 sont des index dans cette chaîne (elles restent donc stables
 *             même si le marquage est absent) ;
 *   `spans` — les marquages, repérés par leurs positions dans `text`.
 *
 * Domaine pur : aucune entrée-sortie, aucune importation `@forge/*`, aucune
 * lecture de l'heure.
 */

/** Marque ADF portée par un nœud texte (`textColor`, `link`, `highlight`…). */
export interface RichTextMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

/** Nœud ADF (ou fragment d'arbre compatible) — volontairement permissif. */
export interface RichTextNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: RichTextMark[];
  content?: RichTextNode[];
}

/** Nature d'un marquage relevé pendant la réduction. */
export type RichSpanKind = 'color' | 'link' | 'image' | 'code';

/** Un marquage : une région du texte brut, avec ce que le rendu y ajoute. */
export interface RichSpan {
  kind: RichSpanKind;
  /** Index de début dans `RichTextDocument.text` (inclus). */
  start: number;
  /** Index de fin dans `RichTextDocument.text` (exclus). */
  end: number;
  /** Couleur du texte, normalisée en `#rrggbb`. */
  fgColor?: string;
  /** Couleur du fond, normalisée en `#rrggbb`. */
  bgColor?: string;
  /** Destination réelle d'un lien. */
  href?: string;
  /** Ce que le lien affiche. */
  label?: string;
  /** Texte alternatif d'une image. */
  alt?: string;
}

/** Le texte brut réduit, et tout ce que le format riche disait de plus. */
export interface RichTextDocument {
  text: string;
  spans: RichSpan[];
}

/** Document vide : point de départ des deux réducteurs. */
export function emptyRichText(): RichTextDocument {
  return { text: '', spans: [] };
}

// ------------------------------------------------------------------- couleurs

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  maroon: '#800000',
  yellow: '#ffff00',
  olive: '#808000',
  lime: '#00ff00',
  green: '#008000',
  aqua: '#00ffff',
  teal: '#008080',
  blue: '#0000ff',
  navy: '#000080',
  fuchsia: '#ff00ff',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
};

/** Valeurs CSS qui ne disent rien de la couleur rendue. */
const OPAQUE_COLOR_VALUES = new Set(['auto', 'inherit', 'currentcolor', 'transparent', 'none', '']);

/**
 * Normalise une couleur (`#fff`, `#ffffff`, `rgb()`, `rgba()`, nom CSS) en
 * `#rrggbb` minuscule ; `undefined` si la valeur ne désigne aucune couleur.
 */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toLowerCase();
  if (OPAQUE_COLOR_VALUES.has(raw)) return undefined;
  if (raw.startsWith('#')) return normalizeHex(raw.slice(1));
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/.exec(raw);
  if (rgb) return toHex(Number(rgb[1] ?? 0), Number(rgb[2] ?? 0), Number(rgb[3] ?? 0));
  return NAMED_COLORS[raw];
}

function normalizeHex(hex: string): string | undefined {
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex.split('').map((digit) => digit + digit).join('')}`;
  }
  return undefined;
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const part = (value: number) => clamp(value).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Distance euclidienne dans l'espace RGB, de 0 (identiques) à ~441 (noir/blanc).
 * Sert à dire « quasi égale » pour deux couleurs (§6 C1).
 */
export function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

/** Blanc ou presque : les trois canaux au-dessus du seuil. */
export function isWhiteish(hex: string, threshold = 240): boolean {
  return channels(hex).every((value) => value >= threshold);
}

// ------------------------------------------------------- réduction d'un ADF

/** Types ADF qui ouvrent un nouveau paragraphe visuel (saut de ligne ajouté). */
const ADF_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'bulletList',
  'orderedList',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'blockquote',
  'codeBlock',
  'panel',
  'rule',
  'mediaSingle',
  'mediaGroup',
  'extension',
]);

interface WalkContext {
  fgColor?: string;
  bgColor?: string;
  href?: string;
  code: boolean;
}

type FlatState = RichTextDocument;

function stringAttr(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function blockBackground(node: RichTextNode, ctx: WalkContext): WalkContext {
  const raw = stringAttr(node.attrs, 'background') ?? stringAttr(node.attrs, 'backgroundColor');
  const bg = normalizeColor(raw);
  return bg ? { ...ctx, bgColor: bg } : ctx;
}

/** Réduit un arbre ADF en texte brut + marquages. */
export function flattenAdf(node: RichTextNode | undefined): RichTextDocument {
  const state: FlatState = { text: '', spans: [] };
  if (node) walkAdf(node, { code: false }, state);
  return state;
}

function walkAdf(node: RichTextNode, ctx: WalkContext, state: FlatState): void {
  const type = node.type ?? '';
  if (type === 'text') return walkText(node, ctx, state);
  if (type === 'hardBreak') {
    state.text += '\n';
    return;
  }
  if (type === 'image' || type === 'media') return walkImage(node, state);
  if (type === 'link') return walkLink(node, ctx, state);
  const childContext = childWalkContext(node, ctx);
  for (const child of node.content ?? []) walkAdf(child, childContext, state);
  if (ADF_BLOCK_TYPES.has(type)) state.text += '\n';
}

/** Contexte transmis aux enfants : fond d'une cellule, couleur d'un panneau, code. */
function childWalkContext(node: RichTextNode, ctx: WalkContext): WalkContext {
  const type = node.type ?? '';
  let next = ADF_BLOCK_TYPES.has(type) ? blockBackground(node, ctx) : ctx;
  if (type === 'codeBlock' || type === 'code') next = { ...next, code: true };
  return next;
}

function walkText(node: RichTextNode, ctx: WalkContext, state: FlatState): void {
  const text = node.text ?? '';
  if (text.length === 0) return;
  const start = state.text.length;
  let fg = ctx.fgColor;
  let bg = ctx.bgColor;
  let href = ctx.href;
  let code = ctx.code;
  for (const mark of node.marks ?? []) {
    const color = normalizeColor(mark.attrs?.color);
    if (mark.type === 'textColor' && color) fg = color;
    if (mark.type === 'highlight' && color) bg = color;
    if (mark.type === 'link') href = stringAttr(mark.attrs, 'href') ?? href;
    if (mark.type === 'code') code = true;
  }
  fg = normalizeColor(node.attrs?.color) ?? fg;
  bg = normalizeColor(node.attrs?.background) ?? bg;
  state.text += text;
  const end = state.text.length;
  if (fg || bg) state.spans.push({ kind: 'color', start, end, fgColor: fg, bgColor: bg });
  if (code) state.spans.push({ kind: 'code', start, end });
  if (href) state.spans.push({ kind: 'link', start, end, href, label: text });
}

function walkImage(node: RichTextNode, state: FlatState): void {
  const alt = stringAttr(node.attrs, 'alt');
  const pos = state.text.length;
  state.spans.push({ kind: 'image', start: pos, end: pos, alt });
}

function walkLink(node: RichTextNode, ctx: WalkContext, state: FlatState): void {
  const href = stringAttr(node.attrs, 'href');
  const start = state.text.length;
  for (const child of node.content ?? []) walkAdf(child, { ...ctx, href }, state);
  state.spans.push({
    kind: 'link',
    start,
    end: state.text.length,
    href,
    label: state.text.slice(start, state.text.length),
  });
}

// -------------------------------------------------- réduction d'un HTML simple

const HTML_VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base']);
const HTML_BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'tr',
  'td',
  'th',
  'table',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'figure',
  'figcaption',
  'form',
  'dl',
  'dd',
  'dt',
]);

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '\u00ad',
  zwj: '\u200d',
  zwnj: '\u200c',
};

interface HtmlTag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
}

interface HtmlFrame extends WalkContext {
  name: string;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return HTML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const HTML_TAG = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>$/;
const HTML_ATTR =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function parseTag(raw: string): HtmlTag | null {
  const match = HTML_TAG.exec(raw);
  if (!match) return null;
  const attrs: Record<string, string> = {};
  const attributeRe = new RegExp(HTML_ATTR.source, 'g');
  let attribute: RegExpExecArray | null;
  while ((attribute = attributeRe.exec(match[3] ?? '')) !== null) {
    const key = (attribute[1] ?? '').toLowerCase();
    attrs[key] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
  }
  return { name: (match[2] ?? '').toLowerCase(), attrs, closing: match[1] === '/' };
}

function parseStyle(style: string): { fgColor?: string; bgColor?: string } {
  let fgColor: string | undefined;
  let bgColor: string | undefined;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const color = normalizeColor(declaration.slice(colon + 1));
    if (property === 'color') fgColor = color ?? fgColor;
    else if (property === 'background-color' || property === 'background') bgColor = color ?? bgColor;
  }
  return { fgColor, bgColor };
}

function frameFor(tag: HtmlTag, parent: HtmlFrame): HtmlFrame {
  const style = parseStyle(tag.attrs.style ?? '');
  return {
    name: tag.name,
    fgColor: style.fgColor ?? parent.fgColor,
    bgColor: style.bgColor ?? parent.bgColor,
    href: tag.name === 'a' ? (tag.attrs.href ?? parent.href) : parent.href,
    code: parent.code || tag.name === 'code' || tag.name === 'pre',
  };
}

function htmlText(node: string, frame: HtmlFrame, state: FlatState): void {
  const text = decodeEntities(node);
  if (text.length === 0) return;
  const start = state.text.length;
  state.text += text;
  const end = state.text.length;
  if (frame.fgColor || frame.bgColor) {
    state.spans.push({
      kind: 'color',
      start,
      end,
      fgColor: frame.fgColor,
      bgColor: frame.bgColor,
    });
  }
  if (frame.code) state.spans.push({ kind: 'code', start, end });
  if (frame.href) state.spans.push({ kind: 'link', start, end, href: frame.href, label: text });
}

/**
 * Réduit un HTML simplifié en texte brut + marquages. Analyseur volontairement
 * petit : il ne vise pas la conformité HTML, seulement les formes produites par
 * Jira et par les courriels entrants. Ce qui n'est pas reconnu est ignoré, le
 * texte est toujours conservé.
 */
export function flattenHtml(html: string): RichTextDocument {
  const state: FlatState = { text: '', spans: [] };
  const root: HtmlFrame = { name: '#root', code: false };
  const frames: HtmlFrame[] = [root];
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith('<') || token.startsWith('<!--')) {
      htmlText(token, frames[frames.length - 1] ?? root, state);
      continue;
    }
    const tag = parseTag(token);
    if (!tag) continue;
    applyTag(tag, frames, state);
  }
  return state;
}

function applyTag(tag: HtmlTag, frames: HtmlFrame[], state: FlatState): void {
  const parent = frames[frames.length - 1] ?? { name: '#root', code: false };
  if (tag.closing) {
    for (let index = frames.length - 1; index > 0; index -= 1) {
      const frame = frames[index];
      if (!frame) continue;
      if (frame.name === tag.name) frames.length = index;
      if (HTML_BLOCK_TAGS.has(frame.name)) state.text += '\n';
      if (frame.name === tag.name) break;
    }
    return;
  }
  if (tag.name === 'br') {
    state.text += '\n';
    return;
  }
  if (tag.name === 'img') {
    const pos = state.text.length;
    state.spans.push({ kind: 'image', start: pos, end: pos, alt: tag.attrs.alt });
    return;
  }
  if (HTML_VOID_TAGS.has(tag.name)) return;
  frames.push(frameFor(tag, parent));
}
