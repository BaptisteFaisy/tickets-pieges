/**
 * Garde anti-écho : ne pas réanalyser ce que l'app vient d'écrire elle-même.
 *
 * Sur Jira, le manifeste filtre nos propres écritures (`ignoreSelf`). Sur
 * Confluence, la plateforme le refuse (« Trigger filtering with ignoreSelf works
 * only with Jira events », mesuré par `forge lint` le 12 novembre 2026) : sans
 * garde, poser un bandeau ou neutraliser un passage déclencherait
 * `avi:confluence:updated:page`, donc une nouvelle analyse, donc une nouvelle
 * écriture — une boucle.
 *
 * La garde est **dans le domaine** (pure, testable) : elle lit le journal que
 * l'app tient déjà (§18, étape 5) et dit si une écriture à nous précède
 * l'événement de moins de `windowMs`.
 */

/** Une entrée de journal, réduite à ce dont la garde a besoin. */
export interface JournalMark {
  kind: string;
  at: string;
}

/** Fenêtre pendant laquelle un événement suivant une de nos écritures est un écho. */
export const SELF_WRITE_WINDOW_MS = 120_000;

/** Nombre d'entrées de journal relues pour décider (le journal est trié par date). */
export const SELF_WRITE_LOOKBACK = 20;

/**
 * Gestes que l'app écrit elle-même et qui produisent un événement en retour.
 * Un `scan` (lecture seule) n'en fait **pas** partie : il ne modifie rien.
 */
export const SELF_WRITE_KINDS: readonly string[] = [
  'label-applied',
  'neutralize',
  'restore',
  'confluence-write',
  'prepend-banner',
  'replace-segment',
  'internal-note',
  'public-comment',
];

/** Une de nos écritures précède-t-elle cet instant de moins de `windowMs` ? */
export function isSelfEcho(
  marks: JournalMark[],
  now: string,
  windowMs: number = SELF_WRITE_WINDOW_MS,
  kinds: readonly string[] = SELF_WRITE_KINDS,
): boolean {
  const current = Date.parse(now);
  if (Number.isNaN(current)) return false;
  const allowed = new Set(kinds);
  return marks.some((mark) => {
    if (!allowed.has(mark.kind)) return false;
    const at = Date.parse(mark.at);
    if (Number.isNaN(at)) return false;
    const age = current - at;
    return age >= 0 && age <= windowMs;
  });
}

/** Âge de la dernière écriture à nous, en ms ; `null` s'il n'y en a aucune. */
export function lastSelfWriteAge(marks: JournalMark[], now: string): number | null {
  const current = Date.parse(now);
  if (Number.isNaN(current)) return null;
  const allowed = new Set(SELF_WRITE_KINDS);
  let latest: number | null = null;
  for (const mark of marks) {
    if (!allowed.has(mark.kind)) continue;
    const at = Date.parse(mark.at);
    if (Number.isNaN(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : current - latest;
}
