/**
 * Rétention — politique de conservation, décision de purge, registre des
 * traitements et contrat d'export/restauration (domaine pur).
 *
 * Aucune importation de `@forge/*`, aucune entrée-sortie, aucune lecture de
 * l'heure : les dates sont injectées. Tout ce qui est décidé ici est testable
 * sans site Jira (le glue `src/jobs/retention.ts` fait le reste).
 *
 * Références : §8.3 (original neutralisé conservé hors du ticket), §19
 * (modèle de données), §22 (export avant désinstallation, contrôle du DPO).
 */

import type { FindingStatus } from './types';

// ------------------------------------------------------------------ politique

/** Famille de conservation : ce qui détermine la durée. */
export type RetentionCategory = 'default' | 'neutralized' | 'exercise' | 'campaign';

export const RETENTION_CATEGORIES: readonly RetentionCategory[] = [
  'default',
  'neutralized',
  'exercise',
  'campaign',
];

/**
 * Politique de conservation, en jours. Elle est injectée (aucune valeur n'est
 * figée dans la décision) : le glue peut la lire d'un réglage par projet.
 */
export interface RetentionPolicy {
  /** Ticket analysé sans charge bloquée : conservation par défaut. */
  defaultDays: number;
  /** Charge neutralisée : le litige se juge plus tard, on garde plus longtemps. */
  neutralizedDays: number;
  /** Exercice (ticket témoin) : éphémère, fermé puis purgé vite. */
  exerciseDays: number;
  /** Campagne (charges répétées) : conservée pour la revue. */
  campaignDays: number;
}

/** Valeurs de départ (§8.3, §13, §14) ; remplaçables par projet. */
export const DEFAULT_RETENTION: RetentionPolicy = {
  defaultDays: 90,
  neutralizedDays: 365,
  exerciseDays: 7,
  campaignDays: 180,
};

/** Durée de conservation (jours) pour une famille donnée. */
export function horizonDays(policy: RetentionPolicy, category: RetentionCategory): number {
  switch (category) {
    case 'neutralized':
      return policy.neutralizedDays;
    case 'exercise':
      return policy.exerciseDays;
    case 'campaign':
      return policy.campaignDays;
    default:
      return policy.defaultDays;
  }
}

/** Une charge neutralisée se conserve plus longtemps ; le reste suit la règle par défaut. */
export function categoryForFinding(status: FindingStatus): RetentionCategory {
  return status === 'neutralized' ? 'neutralized' : 'default';
}

// ------------------------------------------------------------------ purge

/** Un élément conservé, tel que le glue le présente à la décision. */
export interface RetainedRecord {
  id: string;
  category: RetentionCategory;
  /** Date de référence (stockage ou dernière activité), ISO 8601. */
  at: string;
}

/** La décision pour un élément : purger ou garder, et pourquoi (chiffres). */
export interface PurgeDecision {
  id: string;
  category: RetentionCategory;
  ageDays: number;
  horizonDays: number;
  purge: boolean;
}

const DAY_MS = 86_400_000;

/** Âge entier d'une date par rapport à `now`, en jours ; 0 si inconnu ou futur. */
export function ageDays(at: string, now: string): number {
  const a = Date.parse(at);
  const n = Date.parse(now);
  if (Number.isNaN(a) || Number.isNaN(n)) return 0;
  const elapsed = n - a;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / DAY_MS);
}

/**
 * Décision de purge, pure et déterministe : un élément est purgé quand son âge
 * dépasse l'horizon de sa famille. Aucune écriture ici — juste la décision.
 */
export function decidePurge(
  records: readonly RetainedRecord[],
  now: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): PurgeDecision[] {
  return records.map((record) => {
    const days = horizonDays(policy, record.category);
    const age = ageDays(record.at, now);
    return { id: record.id, category: record.category, ageDays: age, horizonDays: days, purge: age > days };
  });
}

/** Décompte lisible par famille : ce que la purge ferait. */
export interface PurgeSummary {
  examined: number;
  keep: number;
  purge: number;
  byCategory: Record<RetentionCategory, { keep: number; purge: number }>;
}

export function summarizePurge(decisions: readonly PurgeDecision[]): PurgeSummary {
  const byCategory: PurgeSummary['byCategory'] = {
    default: { keep: 0, purge: 0 },
    neutralized: { keep: 0, purge: 0 },
    exercise: { keep: 0, purge: 0 },
    campaign: { keep: 0, purge: 0 },
  };
  for (const decision of decisions) {
    const bucket = byCategory[decision.category];
    if (decision.purge) bucket.purge += 1;
    else bucket.keep += 1;
  }
  const keep = decisions.reduce((sum, d) => sum + (d.purge ? 0 : 1), 0);
  return { examined: decisions.length, keep, purge: decisions.length - keep, byCategory };
}

// ------------------------------------------------------------------ registre

/** Une ligne du registre des traitements : ce que l'app fait des données. */
export interface Treatment {
  /** Nom court du traitement. */
  purpose: string;
  /** Ce que l'app lit. */
  reads: string[];
  /** Ce qu'elle écrit, et où (table `src/platform/schema.ts` ou propriété Jira). */
  writes: string[];
  /** Durée de conservation, lisible par une personne qui n'est pas développeuse. */
  retention: string;
  /** Ce qui le justifie (règle du cahier des charges). */
  justification: string;
}

/**
 * Registre des traitements. Un DPO doit pouvoir le lire d'un coup : ce qui est
 * lu, écrit, où, combien de temps. Tenir ce registre à jour est une charge :
 * toute nouvelle table y entre.
 */
export const TREATMENT_REGISTER: readonly Treatment[] = [
  {
    purpose: 'Origine et indexation du ticket (texte reçu, champ, auteur, canal).',
    reads: ['segment.source', 'segment.author'],
    writes: ['segment', 'issue_state', 'propriété Jira indexée'],
    retention: 'Durée par défaut de la politique, puis purge.',
    justification: '§5 (origine), §8.1 (propriété indexée), §19.',
  },
  {
    purpose: 'Détection de la charge et constats (C1 à C4), avis humain.',
    reads: ['segment.text'],
    writes: ['finding', 'verdict'],
    retention: 'Durée par défaut ; charge neutralisée : neutralizedDays.',
    justification: '§6 (détection), §14 (revue humaine).',
  },
  {
    purpose: 'Original neutralisé, retiré du ticket et conservé hors ligne.',
    reads: ['segment.text'],
    writes: ['original'],
    retention: 'Tant que le constat est ouvert ; restauré ou purgé. Chiffré au repos.',
    justification: '§8.3 (réversibilité), §22.',
  },
  {
    purpose: 'Journal d\'audit : ce qui a été décidé et quand.',
    reads: ['décisions internes'],
    writes: ['event'],
    retention: 'Durée par défaut, puis purge.',
    justification: '§18 (journal), §21 (honnêteté).',
  },
  {
    purpose: 'Exercice d\'alerte (ticket témoin et ses observations).',
    reads: ['canary.instruction'],
    writes: ['canary', 'canary_hit'],
    retention: 'exerciseDays après fermeture, puis purge.',
    justification: '§13 (exercice d\'alerte).',
  },
  {
    purpose: 'Campagnes : regrouper des charges répétées pour la revue.',
    reads: ['finding.campaignHash'],
    writes: ['campaign'],
    retention: 'campaignDays après dernier signalement, puis purge.',
    justification: '§14 (campagnes).',
  },
  {
    purpose: 'Session contaminée de l\'acteur (sas sortant, §10).',
    reads: ['sessionRef', 'accountId'],
    writes: ['tainted_session'],
    retention: 'Le temps du sas, purgé à la levée.',
    justification: '§10 (sas), §9 (portée).',
  },
  {
    purpose: 'Contrôle après coup des sorties (commentaires, champs).',
    reads: ['commentaire/champ sortant'],
    writes: ['outbound_check'],
    retention: 'Durée par défaut, puis purge.',
    justification: '§10.4 (contrôle après coup).',
  },
  {
    purpose: 'Brouillon interne avant publication d\'une réponse.',
    reads: ['texte du brouillon'],
    writes: ['draft'],
    retention: 'Durée par défaut après publication, puis purge.',
    justification: '§10.3 (brouillon interne).',
  },
  {
    purpose: 'Jeton d\'accès au hook (authentification).',
    reads: ['tokenHash'],
    writes: ['hook_token'],
    retention: 'Conservé tant que le jeton est actif. Chiffré au repos.',
    justification: '§11 (hook).',
  },
];

// ------------------------------------------------------- export / restauration

/** Version du format d'export : toute lecture future doit tolérer l'ancienne. */
export const RETENTION_EXPORT_VERSION = 1;

/** En-tête de schéma : distingue cet export d'un autre document JSON. */
export const RETENTION_EXPORT_SCHEMA = 'tickets-pieges/retention';

/** Un original chiffré dans l'export (le texte n'apparaît jamais en clair). */
export interface RetentionOriginalExport {
  id: string;
  segmentId: string;
  issueId: string;
  findingIds: string[];
  ciphertext: string;
  storedAt: string;
  restoredAt: string | null;
}

/** Un jeton chiffré dans l'export. */
export interface RetentionTokenExport {
  id: string;
  ciphertext: string;
  createdAt: string;
}

/** Le document complet versé (et rechargé à la restauration). */
export interface RetentionExport {
  schema: typeof RETENTION_EXPORT_SCHEMA;
  version: number;
  exportedAt: string;
  originals: RetentionOriginalExport[];
  tokens: RetentionTokenExport[];
}

/** Validation structurée : on n'importe jamais un JSON non reconnu. */
export type ExportValidation =
  | { ok: true; value: RetentionExport }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Vérifie le format d'export (version, schéma, champs requis). */
export function validateRetentionExport(raw: unknown): ExportValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['export : objet attendu'] };
  if (raw.schema !== RETENTION_EXPORT_SCHEMA) errors.push('schema inattendu');
  if (raw.version !== RETENTION_EXPORT_VERSION) errors.push('version non reconnue');
  if (typeof raw.exportedAt !== 'string') errors.push('exportedAt manquant');
  if (!Array.isArray(raw.originals)) errors.push('originals manquant');
  if (!Array.isArray(raw.tokens)) errors.push('tokens manquant');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: raw as unknown as RetentionExport };
}

/**
 * Plan de restauration idempotent : n'importe que ce qui n'existe pas déjà
 * (un identifiant déjà présent est sauté). Rejouer l'import deux fois produit
 * le même état, sans doublon.
 */
export function planRestore<T extends { id: string }>(
  existing: ReadonlySet<string>,
  incoming: readonly T[],
): T[] {
  return incoming.filter((item) => !existing.has(item.id));
}

/** Résumé du rejeu : ce qui sera écrit, ce qui existait déjà. */
export interface RestorePlan<T> {
  toWrite: T[];
  skipped: number;
}

export function planTokenRestore(
  existing: ReadonlySet<string>,
  incoming: readonly RetentionTokenExport[],
): RestorePlan<RetentionTokenExport> {
  const toWrite = planRestore(existing, incoming);
  return { toWrite, skipped: incoming.length - toWrite.length };
}

// --------------------------------------------------------------- classification

/** Un exercice (ticket témoin) et une campagne ont leur propre durée de vie. */
export function categoryOfRecord(kind: 'canary' | 'campaign' | 'finding', status?: FindingStatus): RetentionCategory {
  if (kind === 'canary') return 'exercise';
  if (kind === 'campaign') return 'campaign';
  return categoryForFinding(status ?? 'open');
}