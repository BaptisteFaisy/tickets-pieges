/**
 * Masquage réversible des données personnelles avant publication (§35).
 *
 * Le texte rendu ne contient jamais la valeur en clair : il la remplace par un
 * jeton `[masqué:IBAN:1]`. La table de correspondance (jeton → valeur claire)
 * est conservée **hors du ticket** ; un humain autorisé restaure le texte à la
 * publication. La réversibilité est volontaire : c'est elle qui sépare le
 * masquage de la destruction.
 *
 * Domaine pur : aucune E/S, aucune lecture d'horloge, aucun `@forge/*`.
 */
import type { DlpFinding, DlpRuleId } from './dlp';

/** Libellé humain d'un jeton de masquage. */
export type RedactionMask = 'IBAN' | 'CARD' | 'SIRET' | 'SIREN' | 'NIR' | 'TOKEN' | 'JWT' | 'EMAIL' | 'PHONE';

/** Une entrée de la table : jeton → valeur claire, conservée hors du ticket. */
export interface RedactionEntry {
  token: string;
  ruleId: DlpRuleId;
  value: string;
}

/** Table de correspondance des masques, à garder hors du ticket. */
export interface RedactionTable {
  entries: RedactionEntry[];
}

export interface RedactionResult {
  /** Texte rendu : aucune valeur en claire, uniquement des jetons. */
  text: string;
  table: RedactionTable;
}

/** Nom du libellé visible du masque pour un motif (#35 : `[masqué:IBAN:1]`). */
export function maskFor(ruleId: DlpRuleId): RedactionMask {
  switch (ruleId) {
    case 'iban':
      return 'IBAN';
    case 'card':
      return 'CARD';
    case 'siret':
      return 'SIRET';
    case 'siren':
      return 'SIREN';
    case 'nir':
      return 'NIR';
    case 'jwt':
      return 'JWT';
    case 'email':
      return 'EMAIL';
    case 'phone':
      return 'PHONE';
    default:
      return 'TOKEN';
  }
}

/** Le jeton `[masqué:KIND:n]` d'une occurrence. */
function tokenOf(mask: RedactionMask, n: number): string {
  return `[masqué:${mask}:${n}]`;
}

/**
 * Masque les motifs relevés. Les chevauchements sont écartés, les remplacements
 * sont faits de la fin vers le début pour préserver les positions.
 */
export function redact(text: string, findings: DlpFinding[]): RedactionResult {
  const kept = [...findings]
    .filter((f) => f.start >= 0 && f.end <= text.length && f.start < f.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: DlpFinding[] = [];
  let lastEnd = -1;
  for (const f of kept) {
    if (f.start < lastEnd) continue;
    nonOverlapping.push(f);
    lastEnd = f.end;
  }
  const counters = new Map<RedactionMask, number>();
  const entries: RedactionEntry[] = [];
  let out = text;
  for (let i = nonOverlapping.length - 1; i >= 0; i--) {
    const finding = nonOverlapping[i] as DlpFinding;
    const mask = maskFor(finding.ruleId);
    const n = (counters.get(mask) ?? 0) + 1;
    counters.set(mask, n);
    const token = tokenOf(mask, n);
    entries.push({ token, ruleId: finding.ruleId, value: finding.value });
    out = out.slice(0, finding.start) + token + out.slice(finding.end);
  }
  entries.reverse();
  return { text: out, table: { entries } };
}

/** Restaure le texte original à partir d'un texte masqué et de sa table. */
export function restore(text: string, table: RedactionTable): string {
  let out = text;
  for (const entry of table.entries) {
    out = out.split(entry.token).join(entry.value);
  }
  return out;
}

/** Valeur claire d'un jeton, ou `undefined` s'il est inconnu. */
export function lookup(table: RedactionTable, token: string): string | undefined {
  return table.entries.find((entry) => entry.token === token)?.value;
}