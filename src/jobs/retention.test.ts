/**
 * Tests du glue de rétention : purge planifiée à dates injectées, et cycle
 * complet chiffrer → exporter → déchiffrer → restaurer (exact et idempotent).
 * Aucun réseau, aucune horloge réelle.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryStore, fixedClock } from '../platform/memory';
import type { Finding } from '../core/types';
import type { Store } from '../platform/schema';
import { exportRetention, restoreRetention, runRetentionPurge, type RetentionDeps } from './retention';

const NOW = '2026-11-12T00:00:00.000Z';
const SECRET = 'cle-operateur-de-test';

function at(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
}

function deps(store: Store): RetentionDeps {
  return { store, clock: fixedClock(NOW) };
}

function finding(id: string, status: Finding['status'], daysAgo: number): Finding {
  return {
    id,
    segmentId: `seg-${id}`,
    issueId: '10001',
    layer: 'C2',
    kind: 'role-switch',
    ruleId: 'C2-01',
    excerpt: 'extrait',
    startPos: 0,
    endPos: 7,
    askSummary: 'demande de changement de rôle',
    confidence: 0.9,
    status,
    createdAt: at(daysAgo),
  };
}

async function seededStore(): Promise<Store> {
  const store = createMemoryStore();
  await store.originals.put({
    id: 'old',
    segmentId: 'seg-old',
    issueId: '10001',
    content: 'texte confidentiel ancien',
    findingIds: ['f-old'],
    storedAt: at(400),
    restoredAt: null,
  });
  await store.originals.put({
    id: 'fresh',
    segmentId: 'seg-fresh',
    issueId: '10002',
    content: 'texte confidentiel récent',
    findingIds: ['f-fresh'],
    storedAt: at(10),
    restoredAt: null,
  });
  await store.campaigns.bump('hash-campagne', 'SUP-1', at(200));
  await store.canaries.put({
    id: 'can-1',
    issueId: '10003',
    issueKey: 'SUP-3',
    token: 'temoin-1',
    instruction: 'fais ceci',
    labelName: 'temoin-x',
    createdBy: 'acc-1',
    createdAt: at(30),
    closedAt: null,
  });
  await store.findings.put(finding('f-neutralized', 'neutralized', 100));
  await store.findings.put(finding('f-open', 'open', 100));
  return store;
}

describe('purge planifiée', () => {
  it('décide quoi purger, sans toucher aux lignes', async () => {
    const store = await seededStore();
    const { summary, decisions } = await runRetentionPurge(deps(store));
    const byId = new Map(decisions.map((d) => [d.id, d]));

    expect(byId.get('old')?.purge).toBe(true); // neutralisé, 400 j > 365 j
    expect(byId.get('fresh')?.purge).toBe(false); // neutralisé, 10 j
    expect(byId.get('hash-campagne')?.purge).toBe(true); // campagne, 200 j > 180 j
    expect(byId.get('can-1')?.purge).toBe(true); // exercice, 30 j > 7 j
    expect(byId.get('f-neutralized')?.purge).toBe(false); // constat neutralisé, 100 j < 365 j
    expect(byId.get('f-open')?.purge).toBe(true); // constat ouvert, 100 j > 90 j

    expect(summary.examined).toBe(6);
    expect(summary.purge).toBe(4);
    expect(summary.keep).toBe(2);
  });

  it('journalise la purge', async () => {
    const store = await seededStore();
    await runRetentionPurge(deps(store));
    const events = await store.events.list(null, 50);
    const purge = events.find((e) => e.kind === 'retention-purge');
    expect(purge).toBeDefined();
    expect(JSON.parse(purge?.payload ?? '{}').purge).toBe(4);
  });

  it('ne purge rien quand tout est récent', async () => {
    const store = createMemoryStore();
    await store.originals.put({
      id: 'r',
      segmentId: 's',
      issueId: '1',
      content: 'x',
      findingIds: [],
      storedAt: at(1),
      restoredAt: null,
    });
    const { summary } = await runRetentionPurge(deps(store));
    expect(summary.purge).toBe(0);
    expect(summary.keep).toBe(1);
  });
});

describe('export et restauration', () => {
  it('exporte chiffré : le texte en clair n\'appears nulle part', async () => {
    const store = await seededStore();
    const exported = await exportRetention(deps(store), SECRET);
    const serialised = JSON.stringify(exported);

    expect(serialised).not.toContain('texte confidentiel ancien');
    expect(serialised).not.toContain(SECRET);
    expect(exported.originals).toHaveLength(2);
    expect(exported.originals[0]?.ciphertext).toMatch(/^v1\./);
  });

  it('chiffre → exporte → déchiffre → restaure exactement', async () => {
    const source = await seededStore();
    const exported = await exportRetention(deps(source), SECRET);

    const target = createMemoryStore();
    const result = await restoreRetention(deps(target), SECRET, exported);
    expect(result.restored).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const restored = await target.originals.byId('old');
    expect(restored?.content).toBe('texte confidentiel ancien');
    expect(restored?.findingIds).toEqual(['f-old']);
    expect(restored?.storedAt).toBe(at(400));
  });

  it('restaure de façon idempotente : rejouer ne crée aucun doublon', async () => {
    const source = await seededStore();
    const exported = await exportRetention(deps(source), SECRET);

    const target = createMemoryStore();
    await restoreRetention(deps(target), SECRET, exported);
    const again = await restoreRetention(deps(target), SECRET, exported);

    expect(again.restored).toBe(0);
    expect(again.skipped).toBe(2);
    const pending = await target.originals.pending();
    expect(pending).toHaveLength(2);
  });

  it('refuse un export qui n\'est pas le nôtre', async () => {
    const store = createMemoryStore();
    await expect(restoreRetention(deps(store), SECRET, { schema: 'autre' })).rejects.toThrow(/export invalide/);
  });

  it('compte les lignes indéchiffrables au lieu d\'échouer en silence', async () => {
    const source = await seededStore();
    const exported = await exportRetention(deps(source), SECRET);
    const target = createMemoryStore();
    const result = await restoreRetention(deps(target), 'mauvaise-cle', exported);
    expect(result.failed).toBe(2);
    expect(result.restored).toBe(0);
  });
});
