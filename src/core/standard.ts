/**
 * `standard.ts` — grammaire ouverte du format d'encadrement `donnee-<id>` (LOT 9).
 *
 * Ce module expose la **spécification** du format proposé comme standard ouvert :
 * une balise d'encadrement `donnee-<id>` (identifiant aléatoire de 6 caractères
 * hexadécimaux), trois attributs (`origine`, `champ`, `suspicion`), un corps, une
 * balise de fermeture. Il fournit l'**analyseur** et le **générateur** qui
 * respectent cette grammaire, plus la règle de sécurité du format (§22) :
 *
 *  - une balise imitée dans le contenu est **inerte** : le générateur neutralise
 *    toute occurrence d'une balise du produit avant d'encadrer, et l'analyseur
 *    restitue le corps **tel quel** sans jamais le réinterpréter.
 *
 * La neutralisation est celle du produit : on réutilise `defuseTags` de
 * `./framing` (zéro duplication), et `randomBlockId` de `./hashing` pour
 * l'identifiant par défaut.
 */

import { defuseTags } from './framing';
import { randomBlockId } from './hashing';

/** Nom de la balise d'encadrement. */
export const STANDARD_NAME = 'donnee';

/** Version de la grammaire (entier, pour un format versionné). */
export const STANDARD_VERSION = 1;

/** Longueur en caractères d'un identifiant de bloc. */
export const STANDARD_ID_LENGTH = 6;

/** Alphabet d'un identifiant de bloc : hexadécimal minuscule. */
export const STANDARD_ID_ALPHABET = '0123456789abcdef';

/** Attributs du format, dans l'ordre canonique du rendu. */
export const STANDARD_ATTRIBUTES = ['origine', 'champ', 'suspicion'] as const;

export type StandardAttribute = (typeof STANDARD_ATTRIBUTES)[number];

/** Les trois attributs d'une balise `donnee-<id>`. */
export interface DonneeAttributes {
  origine: string;
  champ: string;
  suspicion: string;
}

/** Un bloc encadré, avec son identifiant. */
export interface DonneeBlock {
  id: string;
  attributes: DonneeAttributes;
  body: string;
}

export type ParseDonneeResult =
  | { ok: true; block: DonneeBlock }
  | { ok: false; reason: string };

/** Un identifiant valide fait exactement 6 caractères hexadécimaux minuscules. */
export function isValidBlockId(id: string): boolean {
  return new RegExp(`^[0-9a-f]{${STANDARD_ID_LENGTH}}$`).test(id);
}

/** Échappe un texte destiné à une valeur d'attribut XML. */
export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Vérifie qu'une chaîne ne contient pas de caractère de contrôle XML. */
export function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

/**
 * Générateur : produit un bloc `donnee-<id>` à partir des attributs et du corps.
 * Le corps est neutralisé (`defuseTags`) : toute balise du produit écrite dans le
 * contenu devient inerte avant l'encadrement. Identifiant injectable (les tests
 * veulent des valeurs stables) ; par défaut un identifiant aléatoire de 6 hexadécimaux.
 */
export function generateDonnee(
  attributes: DonneeAttributes,
  body: string,
  id: string = randomBlockId(),
): DonneeBlock {
  const defused = defuseTags(body);
  return { id, attributes, body: defused.text };
}

/**
 * Rendu texte d'un bloc : `<donnee-<id> origine="…" champ="…" suspicion="…">`,
 * le corps, puis `</donnee-<id>>`. Les valeurs d'attributs sont échappées.
 */
export function renderDonnee(block: DonneeBlock): string {
  const a = block.attributes;
  const opening =
    `<${STANDARD_NAME}-${block.id}` +
    ` origine="${escapeXmlAttr(a.origine)}"` +
    ` champ="${escapeXmlAttr(a.champ)}"` +
    ` suspicion="${escapeXmlAttr(a.suspicion)}">`;
  return `${opening}\n${block.body}\n</${STANDARD_NAME}-${block.id}>`;
}

/** Échappement des métacaractères XML pour un motif RegExp. */
function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyseur : lit un bloc `donnee-<id>` et restitue identifiant, attributs et
 * corps **tel quel** (jamais réinterprété). Exige un identifiant valide et la
 * balise de fermeture portant le même identifiant avant la fin du texte.
 */
export function parseDonnee(text: string): ParseDonneeResult {
  const name = regexEscape(STANDARD_NAME);
  const open = new RegExp(`<${name}-([0-9a-f]{${STANDARD_ID_LENGTH}})\\b([^>]*)>`);
  const match = open.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return { ok: false, reason: 'no-opening-tag' };
  }
  const id = match[1];
  const rest = text.slice(match.index + match[0].length);
  const close = new RegExp(`</${name}-${id}>`);
  const closeMatch = close.exec(rest);
  if (!closeMatch) {
    return { ok: false, reason: 'no-closing-tag' };
  }
  const attributes = parseAttributes(match[2]);
  if (!attributes) {
    return { ok: false, reason: 'bad-attributes' };
  }
  let body = rest.slice(0, closeMatch.index);
  // Le rendu encadre le corps d'un saut de ligne de chaque côté ; on retire
  // ces deux délimiteurs, le reste est restitué tel quel.
  if (body.startsWith('\n')) body = body.slice(1);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  return {
    ok: true,
    block: { id, attributes, body },
  };
}

function parseAttributes(raw: string): DonneeAttributes | null {
  const pick = (name: string): string | null => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(raw);
    return m ? (m[1] ?? null) : null;
  };
  const origine = pick('origine');
  const champ = pick('champ');
  const suspicion = pick('suspicion');
  if (origine === null || champ === null || suspicion === null) return null;
  return { origine, champ, suspicion };
}

/**
 * Analyseur multi-blocs : rends tous les blocs valides d'un texte encadré. Le
 * corps de chaque bloc est jeté, jamais réinterprété. Les blocs invalides sont
 * ignorés (une balise imitée ou mal formée ne produit pas de structure).
 */
export function parseAllDonnee(text: string): DonneeBlock[] {
  const blocks: DonneeBlock[] = [];
  let remaining = text;
  for (;;) {
    const result = parseDonnee(remaining);
    if (!result.ok) return blocks;
    blocks.push(result.block);
    const name = regexEscape(STANDARD_NAME);
    const closeAt = new RegExp(`</${name}-${result.block.id}>`).exec(
      remaining,
    );
    if (!closeAt) return blocks;
    remaining = remaining.slice(closeAt.index + closeAt[0].length);
  }
}