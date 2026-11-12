/**
 * Budget de requêtes et **dégradation propre** (quota Forge SQL).
 *
 * Mesuré le 12 novembre 2026 sur le site de démonstration : Forge SQL a répondu
 * « Limits for the current installation have been exceeded », et la couche C3 a
 * cessé de fonctionner. Un quota qu'on ne voit pas est un quota qui casse en
 * silence.
 *
 * La règle du produit : **le risque ne doit pas dépendre du quota**. Passé le
 * plafond, les *lectures* continuent (la détection, elle, ne demande aucune
 * écriture) et seules les *écritures* sont sautées — avec un relevé qui le dit.
 * Une analyse dégradée rend un résultat ; une analyse qui n'écrit rien, sans le
 * dire, est un bug.
 */

/** Plafond par défaut : nombre d'écritures SQL par invocation. */
export const DEFAULT_WRITE_LIMIT = 120;

/** Part du plafond à partir de laquelle on se croit proche du quota (alerte). */
export const DEFAULT_WARN_RATIO = 0.8;

/** Ce que le produit sait de son propre budget. */
export interface BudgetReading {
  /** Écritures demandées. */
  writes: number;
  /** Lectures effectuées. */
  reads: number;
  /** Total des requêtes parties vers la base. */
  queries: number;
  /** Écritures **sautées** parce que le plafond était atteint. */
  skippedWrites: number;
  /** Plafond d'écritures. */
  limit: number;
  /** Vrai quand le plafond est atteint : le produit tourne en mode dégradé. */
  degraded: boolean;
  /** Vrai quand on approche du plafond (à surveiller). */
  nearLimit: boolean;
  /** Instant de début de l'invocation. */
  startedAt: string;
}

export interface BudgetOptions {
  limit?: number;
  warnRatio?: number;
  startedAt?: string;
  now?: () => string;
}

/**
 * Le compteur d'une invocation. Il n'a aucun état global : c'est le job qui en
 * crée un et le branche sur les ports (le runtime Forge donne une instance par
 * invocation, donc le compteur est naturally par invocation).
 */
export class SqlBudget {
  private readonly limit: number;
  private readonly warnRatio: number;
  private readonly startedAt: string;
  private readonly clock: () => string;
  private writes = 0;
  private reads = 0;
  private skipped = 0;

  constructor(options: BudgetOptions = {}) {
    this.limit = options.limit ?? DEFAULT_WRITE_LIMIT;
    this.warnRatio = options.warnRatio ?? DEFAULT_WARN_RATIO;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.startedAt = options.startedAt ?? this.clock();
  }

  /** Une lecture est partie : elle ne coûte pas de quota d'écriture. */
  countRead(): void {
    this.reads += 1;
  }

  /** Une écriture est partie. */
  countWrite(): void {
    this.writes += 1;
  }

  /** L'écriture est-elle sautée ? Vrai une fois le plafond atteint. */
  shouldSkipWrite(): boolean {
    return this.writes >= this.limit;
  }

  /** Une écriture a été sautée : elle est comptée et journalisée. */
  markSkipped(): void {
    this.skipped += 1;
  }

  /** Le relevé, tel qu'il est journalisé et affiché par le diagnostic. */
  get reading(): BudgetReading {
    return {
      writes: this.writes,
      reads: this.reads,
      queries: this.writes + this.reads,
      skippedWrites: this.skipped,
      limit: this.limit,
      degraded: this.skipped > 0 || this.writes >= this.limit,
      nearLimit: this.limit > 0 && this.writes >= this.limit * this.warnRatio,
      startedAt: this.startedAt,
    };
  }

  /** Le plafond, pour l'afficher. */
  get max(): number {
    return this.limit;
  }
}

/** Représentation lisible d'un relevé (journal, console de diagnostic). */
export function describeBudget(reading: BudgetReading): string {
  const parts = [
    `${reading.writes}/${reading.limit} écritures`,
    `${reading.reads} lectures`,
    `${reading.queries} requêtes`,
  ];
  if (reading.skippedWrites > 0) parts.push(`${reading.skippedWrites} écriture(s) sautée(s)`);
  if (reading.degraded) parts.push('mode dégradé');
  if (reading.nearLimit && !reading.degraded) parts.push('proche du plafond');
  return parts.join(' · ');
}
