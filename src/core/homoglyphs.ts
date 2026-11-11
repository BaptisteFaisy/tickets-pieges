/**
 * Normalisation des confusables et domaines lookalike (§2, §3).
 *
 * Deux défenses complémentaires, sans aucun appel réseau :
 *  - `foldConfusables` ramène les lettres cyrilliques/grecques qui ressemblent
 *    à du latin vers leur homologue ASCII — un domaine devient comparable ;
 *  - `decodePunycode` déplie un hôte IDN (`xn--...`) pour exposer ce que
 *    l'œil humain verra, avant comparaison.
 *
 * Le référentiel est **réduit et documenté** : il couvre les confusables les
 * plus courants cités par Unicode TR39, pas l'intégralité du répertoire.
 * Aucune E/S, aucune résolution DNS (un domaine ne sort jamais du lot).
 */

/** Nombre de confusables reconnus — documenté, borné, volontairement restreint. */
export const CONFUSABLE_COUNT = 24;

/**
 * Table cyrillique/grec → latin (référentiel réduit, Unicode TR39).
 * Chaque entrée : `code point non-ASCII : homologue ASCII`.
 */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // cyrillique
  '\u0430': 'a', // а
  '\u0435': 'e', // е
  '\u043E': 'o', // о
  '\u0440': 'p', // р
  '\u0441': 'c', // с
  '\u0445': 'x', // х
  '\u0443': 'y', // у
  '\u043A': 'k', // к
  '\u043C': 'm', // м
  '\u0442': 't', // т
  '\u043D': 'h', // н (ressemble au h latin)
  '\u0432': 'b', // в
  '\u0456': 'i', // і
  '\u0458': 'j', // ј
  // grec
  '\u03B1': 'a', // α
  '\u03BF': 'o', // ο
  '\u03C1': 'p', // ρ
  '\u03BD': 'v', // ν
  '\u03C4': 't', // τ
  '\u03BA': 'k', // κ
  '\u03B5': 'e', // ε
  '\u03B9': 'i', // ι
  '\u03B7': 'n', // η
  '\u03C7': 'x', // χ
};

/** Ramène chaque confusable vers son homologue ASCII, laisse le reste intact. */
export function foldConfusables(text: string): string {
  let out = '';
  for (const char of text) {
    out += CONFUSABLES[char] ?? char;
  }
  return out;
}

/** Le texte contient-il au moins un caractère confusable ? */
export function hasConfusable(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (CONFUSABLES[text.charAt(i)] !== undefined) return true;
  }
  return false;
}

/** Valeur d'un digit punycode (base 36) ; `-1` hors alphabet. */
function punyDigit(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 97 && code <= 122) return code - 97;
  if (code >= 65 && code <= 90) return code - 65;
  return -1;
}

/** Adaptation du biais (RFC 3492, §6.1). */
function punyAdapt(delta: number, points: number, first: boolean): number {
  let value = first ? Math.floor(delta / 700) : delta >> 1;
  value += Math.floor(value / points);
  let k = 0;
  while (value > 455) {
    value = Math.floor(value / 35);
    k += 36;
  }
  return k + Math.floor((36 * value) / (value + 38));
}

/** Déplie un label `xn--...` ; `null` si le flux est invalide. */
function decodeLabel(input: string): string | null {
  const output: string[] = [];
  let b = input.lastIndexOf('-');
  if (b > 0) {
    for (let j = 0; j < b; j += 1) {
      if (input.charCodeAt(j) >= 128) return null;
      output.push(input.charAt(j));
    }
    b += 1;
  } else {
    b = 0;
  }
  let n = 128;
  let i = 0;
  let bias = 72;
  while (b < input.length) {
    const old = i;
    let w = 1;
    let k = 36;
    for (;;) {
      const digit = punyDigit(input.charAt(b));
      b += 1;
      if (digit < 0) return null;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= 36 - t;
      k += 36;
    }
    bias = punyAdapt(i - old, output.length + 1, old === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, String.fromCodePoint(n));
    i += 1;
  }
  return output.join('');
}

/**
 * Déplie un hôte IDN complet (séparé par `.`) ; `null` si un label échoue.
 * Les labels sans préfixe `xn--` sont rendus tels quels.
 */
export function decodePunycode(host: string): string | null {
  const labels = host.split('.');
  const parts: string[] = [];
  for (const label of labels) {
    if (label.toLowerCase().startsWith('xn--')) {
      const decoded = decodeLabel(label.slice(4));
      if (decoded === null) return null;
      parts.push(foldedAscii(decoded));
    } else {
      parts.push(label);
    }
  }
  return parts.join('.');
}

/** Un hôte décodé reste en ASCII visible (la partie IDN est dépliée). */
function foldedAscii(text: string): string {
  return foldConfusables(text);
}

/** Un hôte lookalike repéré dans un texte. */
export interface Lookalike {
  /** Le nom d'hôte tel que trouvé. */
  host: string;
  /** Sa forme normalisée (confusables pliés + punycode déplié). */
  normalized: string;
  /** Pourquoi il est retenu. */
  kind: 'confusable' | 'punycode';
}

const HOST_RE = /\b(?:xn--)?[a-z0-9\u0080-\uFFFF][a-z0-9\u0080-\uFFFF.-]*\.[a-z\u0080-\uFFFF]{2,}\b/gi;

/**
 * Domaines d'un texte dont la forme visible dévie de la forme ASCII lue :
 * confusables (cyrillique/grec) ou punycode. Aucun domaine n'est résolu.
 */
export function findLookalikes(text: string): Lookalike[] {
  const found: Lookalike[] = [];
  for (const [raw] of text.matchAll(HOST_RE)) {
    const host = raw.toLowerCase();
    if (hasConfusable(host)) {
      found.push({ host, normalized: foldConfusables(host), kind: 'confusable' });
    } else if (host.includes('xn--')) {
      const normalized = decodePunycode(host);
      if (normalized !== null) {
        found.push({ host, normalized, kind: 'punycode' });
      }
    }
  }
  return found;
}