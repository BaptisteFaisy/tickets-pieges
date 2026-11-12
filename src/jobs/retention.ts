/**
 * Rétention côté glue : purge planifiée et export/restauration.
 *
 * Ce fichier parle au `Store` (`src/platform/schema.ts`) mais n'importe pas
 * `@forge/*` : il est testable avec `createMemoryStore()` et une horloge
 * injectée. Il est câblé sur le `dailyMaintenance` existant — aucun module de
 * manifeste n'est ajouté (le câblage vit dans `src/jobs/scheduled.ts`, hors de
 * la propriété de ce lot ; voir le corps de la PR).
 *
 * Limite honnête : le contrat `Store` n'expose pas de suppression de lignes
 * (seuls `trust.remove` et `sessions.clear` existent). La purge rend donc la
 * **décision** (quoi purger, quand) et la journalise ; la suppression physique
 * des lignes exige un `remove` par tiroir, changement de contrat hors de portée.
 */

import {
  DEFAULT_RETENTION,
  RETENTION_EXPORT_SCHEMA,
  RETENTION_EXPORT_VERSION,
  categoryForFinding,
  categoryOfRecord,
  decidePurge,
  summarizePurge,
  validateRetentionExport,
  type PurgeDecision,
  type PurgeSummary,
  type RetentionExport,
  type RetentionPolicy,
  type RetainedRecord,
} from '../core/retention';
import { decryptSecret, encryptSecret } from '../platform/crypto';
import type { Clock, Store } from '../platform/schema';

/** Les dépendances dont ce job a besoin : le stockage et l'horloge. */
export interface RetentionDeps {
  store: Store;
  clock: Clock;
}

/** Résultat de la purge planifiée : le décompte et chaque décision. */
export interface PurgeRun {
  summary: PurgeSummary;
  decisions: PurgeDecision[];
}

function daysAgo(now: string, days: number): string {
  return new Date(Date.parse(now) - days * 86_400_000).toISOString();
}

/**
 * Rassemble les éléments conservés que le `Store` sait énumérer, avec leur
 * catégorie et leur date de référence. Les tiroirs sans énumération globale
 * (segments, états, sessions) sont hors de cette première passe.
 */
export async function collectPurgeRecords(store: Store, now: string): Promise<RetainedRecord[]> {
  const records: RetainedRecord[] = [];

  const originals = await store.originals.pending();
  for (const row of originals) {
    records.push({ id: row.id, category: categoryOfRecord('finding', 'neutralized'), at: row.storedAt });
  }

  const campaigns = await store.campaigns.list();
  for (const row of campaigns) {
    records.push({ id: row.id, category: categoryOfRecord('campaign'), at: row.lastSeen });
  }

  const canaries = await store.canaries.open();
  for (const row of canaries) {
    records.push({ id: row.id, category: categoryOfRecord('canary'), at: row.createdAt });
  }

  const findings = await store.findings.since(daysAgo(now, 365 * 10));
  for (const row of findings) {
    records.push({ id: row.id, category: categoryForFinding(row.status), at: row.createdAt });
  }

  return records;
}

/** Purge planifiée : décide quoi purger, journalise, rend le décompte. */
export async function runRetentionPurge(
  deps: RetentionDeps,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<PurgeRun> {
  const now = deps.clock.now();
  const records = await collectPurgeRecords(deps.store, now);
  const decisions = decidePurge(records, now, policy);
  const summary = summarizePurge(decisions);
  await deps.store.events.append('retention-purge', null, summary);
  return { summary, decisions };
}

/** Export chiffré des originaux conservés : le texte n'apparaît jamais en clair. */
export async function exportRetention(deps: RetentionDeps, secret: string): Promise<RetentionExport> {
  const now = deps.clock.now();
  const originals = await deps.store.originals.pending();
  const exportDoc: RetentionExport = {
    schema: RETENTION_EXPORT_SCHEMA,
    version: RETENTION_EXPORT_VERSION,
    exportedAt: now,
    originals: originals.map((row) => ({
      id: row.id,
      segmentId: row.segmentId,
      issueId: row.issueId,
      findingIds: row.findingIds,
      ciphertext: encryptSecret(row.content, secret),
      storedAt: row.storedAt,
      restoredAt: row.restoredAt,
    })),
    tokens: [],
  };
  await deps.store.events.append('retention-export', null, { originals: originals.length });
  return exportDoc;
}

/** Résultat d'une restauration : ce qui a été réécrit, ce qui existait déjà. */
export interface RestoreResult {
  restored: number;
  skipped: number;
  failed: number;
}

/**
 * Restauration idempotente : déchiffre chaque original et ne réécrit que ce qui
 * n'existe pas déjà. Rejouer l'import deux fois ne crée aucun doublon.
 */
export async function restoreRetention(
  deps: RetentionDeps,
  secret: string,
  raw: unknown,
): Promise<RestoreResult> {
  const validation = validateRetentionExport(raw);
  if (!validation.ok) {
    throw new Error('export invalide : ' + validation.errors.join(', '));
  }
  const exportDoc = validation.value;
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of exportDoc.originals) {
    const existing = await deps.store.originals.byId(item.id);
    if (existing) {
      skipped += 1;
      continue;
    }
    try {
      const content = decryptSecret(item.ciphertext, secret);
      await deps.store.originals.put({
        id: item.id,
        segmentId: item.segmentId,
        issueId: item.issueId,
        content,
        findingIds: item.findingIds,
        storedAt: item.storedAt,
        restoredAt: item.restoredAt,
      });
      restored += 1;
    } catch {
      failed += 1;
    }
  }

  await deps.store.events.append('retention-restore', null, { restored, skipped, failed });
  return { restored, skipped, failed };
}