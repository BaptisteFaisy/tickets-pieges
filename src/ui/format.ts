import type { Language } from '../core/types';

/**
 * Helpers purs de mise en forme — aucune logique métier, testables sans DOM
 * (`src/ui/format.test.ts`). Utilisés par les écrans et par les résolveurs.
 */

/** Langue de l'interface à partir de la locale Forge (§21 : fr et en). */
export function languageOf(locale: string | null): Language {
  if (locale && locale.toLowerCase().startsWith('fr')) return 'fr';
  return locale && locale.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/** Part (0..1) en pourcentage arrondi : « 42 % ». */
export function percent(value: number): string {
  if (!Number.isFinite(value)) return '0 %';
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)} %`;
}

/** Date courte lisible (YYYY-MM-DD) à partir d'un ISO ; repli sur l'entrée. */
export function shortDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

/** Mois (YYYY-MM) d'un ISO ; chaîne vide si l'entrée n'est pas une date. */
export function monthOf(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '';
}

/** Compte des dates par mois, du plus ancien au plus récent (§17.5). */
export function byMonth(dates: string[]): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const month = monthOf(date);
    if (!month) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));
}

/** Liste saisie (virgules, points-virgules ou sauts de ligne) → valeurs propres. */
export function splitList(raw: string): string[] {
  const values = raw
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(values)];
}

/** Tronque proprement un texte long pour un affichage borné. */
export function truncate(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Confiance d'un constat en pourcentage. */
export function confidenceLabel(value: number): string {
  return percent(value);
}
