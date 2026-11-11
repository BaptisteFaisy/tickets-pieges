/**
 * Propriété d'entité indexée (TP-07) — la clé `pieges` sur le ticket.
 *
 * La propriété porte l'état publié, sans aucun texte analysé (§21 : rien ne
 * sort) : `trustLevel`, `suspicionLevel`, `modeApplied`, `analyzedAt` et
 * `unanalyzed` (les raisons pour lesquelles du contenu n'a pas pu être
 * analysé). Le champ `unanalyzed` accepte l'alias `unanalyzedReasons` en
 * lecture — l'alias du manifeste n'est pas encore figé sur un site réel.
 *
 * Aucune dépendance Forge : l'appel REST est injecté (`EntityPropertyRequest`),
 * branché en production sur `requestJira` via `src/platform/jira.ts`.
 */

import { SUSPICION_RANK, TRUST_LEVELS, type ProtectionMode, type SuspicionLevel, type TrustLevel, type UnanalyzedReason } from '../core/types';
import type { IssueStateRow } from './schema';

/** Clé de la propriété d'entité indexée (TP-07). */
export const PIEGES_PROPERTY = 'pieges';

const PROTECTION_MODES: readonly ProtectionMode[] = ['report', 'label', 'neutralize'];
const UNANALYZED_REASONS: readonly UnanalyzedReason[] = [
  'image',
  'binary-attachment',
  'oversize',
  'unsupported-format',
  'model-pending',
];

/** Contenu publié sur le ticket — jamais de texte, jamais d'extrait. */
export interface PiegesProperty {
  trustLevel: TrustLevel;
  suspicionLevel: SuspicionLevel;
  modeApplied: ProtectionMode;
  analyzedAt: string;
  unanalyzed: UnanalyzedReason[];
}

/** Appel REST injecté : GET sans `init`, PUT avec `method` et `body`. */
export interface EntityPropertyRequest {
  (issueKey: string, propertyKey: string, init?: { method?: string; body?: string }): Promise<unknown>;
}

/** Construit la propriété publiée à partir de l'état du ticket (§19). */
export function piegesProperty(state: IssueStateRow, analyzedAt: string): PiegesProperty {
  return {
    trustLevel: state.trustLevel,
    suspicionLevel: state.suspicionLevel,
    modeApplied: state.modeApplied,
    analyzedAt,
    unanalyzed: [...state.unanalyzed],
  };
}

function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value);
}

function isSuspicionLevel(value: unknown): value is SuspicionLevel {
  return typeof value === 'string' && value in SUSPICION_RANK;
}

function isProtectionMode(value: unknown): value is ProtectionMode {
  return typeof value === 'string' && (PROTECTION_MODES as readonly string[]).includes(value);
}

function parseReasons(value: unknown): UnanalyzedReason[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is UnanalyzedReason =>
    typeof entry === 'string' && (UNANALYZED_REASONS as readonly string[]).includes(entry),
  );
}

/**
 * Valide la valeur lue sur le site : toute propriété absente ou corrompue
 * rend `null` (l'écran affichera « état inconnu », jamais une exception).
 */
export function parsePiegesProperty(raw: unknown): PiegesProperty | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!isTrustLevel(value.trustLevel)) return null;
  if (!isSuspicionLevel(value.suspicionLevel)) return null;
  if (!isProtectionMode(value.modeApplied)) return null;
  const analyzedAt = typeof value.analyzedAt === 'string' ? value.analyzedAt : '';
  const reasons = value.unanalyzed !== undefined ? value.unanalyzed : value.unanalyzedReasons;
  return {
    trustLevel: value.trustLevel,
    suspicionLevel: value.suspicionLevel,
    modeApplied: value.modeApplied,
    analyzedAt,
    unanalyzed: parseReasons(reasons),
  };
}

export interface PropertyPort {
  read(issueKey: string): Promise<PiegesProperty | null>;
  write(issueKey: string, property: PiegesProperty): Promise<void>;
  publish(issueKey: string, state: IssueStateRow, analyzedAt: string): Promise<void>;
}

/** Port de la propriété `pieges` au-dessus d'un appel REST injecté. */
export function createPropertyPort(request: EntityPropertyRequest): PropertyPort {
  return {
    async read(issueKey) {
      return parsePiegesProperty(await request(issueKey, PIEGES_PROPERTY));
    },
    async write(issueKey, property) {
      await request(issueKey, PIEGES_PROPERTY, { method: 'PUT', body: JSON.stringify(property) });
    },
    async publish(issueKey, state, analyzedAt) {
      await request(issueKey, PIEGES_PROPERTY, {
        method: 'PUT',
        body: JSON.stringify(piegesProperty(state, analyzedAt)),
      });
    },
  };
}
