/**
 * Pliage du texte — une seule implémentation pour toute la détection.
 *
 * Plier, c'est ramener un texte à une forme comparable sans perdre la position
 * d'origine : minuscules, diacritiques retirés, guillemets typographiques et
 * tirets ramenés à l'ASCII, ligatures décomposées. Trois couches s'en servent
 * (C2 pour ses motifs, l'auto-calibrage pour ses statistiques, et les formules
 * à ignorer du §14), d'où ce module séparé : une règle écrite une fois.
 *
 * Domaine pur : aucune E/S, aucune horloge.
 */

/** Longueur maximale pliée : au-delà, le texte est tronqué (coût borné). */
export const MAX_FOLD_CHARS = 20_000;

export interface Folded {
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
  const source = raw.length > MAX_FOLD_CHARS ? raw.slice(0, MAX_FOLD_CHARS) : raw;
  for (let i = 0; i < source.length; i += 1) {
    for (const folded of foldChar(source.charAt(i))) {
      chars.push(folded);
      index.push(i);
    }
  }
  return { text: chars.join(''), index };
}

/** Position d'origine d'un index plié, bornée au texte. */
export function originalPos(folded: Folded, position: number, fallback: number): number {
  return folded.index[position] ?? fallback;
}
