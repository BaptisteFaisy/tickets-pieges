import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../platform/memory';
import type { OriginalRow } from '../platform/schema';
import type { ResolverDeps } from '../ui/api';
import { isSecurity, originalsResolvers } from './originals';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: ['sec-1'] };
}

function original(overrides: Partial<OriginalRow> = {}): OriginalRow {
  return {
    id: 'o-1',
    segmentId: 's-1',
    issueId: 'i-1',
    content: '<script>alert(1)</script>',
    findingIds: ['f-1'],
    storedAt: NOW,
    restoredAt: null,
    ...overrides,
  };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(
  d: ResolverDeps,
  key: string,
  payload: Record<string, unknown>,
  context: unknown = { accountId: 'sec-1' },
): Promise<Result> {
  const handler = originalsResolvers(d)[key];
  if (!handler) throw new Error(`${key} absent`);
  return handler(payload, context) as Promise<Result>;
}

describe('accès rôle sécurité (§17.6, §21)', () => {
  it('reconnaît un compte du rôle sécurité', () => {
    expect(isSecurity(deps(), { accountId: 'sec-1' })).toBe(true);
  });

  it('refuse tout le monde par défaut, contexte absent compris', () => {
    expect(isSecurity(deps(), { accountId: 'autre' })).toBe(false);
    expect(isSecurity(deps(), undefined)).toBe(false);
    expect(isSecurity(deps(), {})).toBe(false);
  });

  it('ferme la liste des originaux à un compte non autorisé', async () => {
    const d = deps();
    await d.store.originals.put(original());
    const result = await call(d, 'listOriginals', {}, { accountId: 'agent-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sécurité');
  });
});

describe('listOriginals / getOriginal (§17.6)', () => {
  it('liste les originaux en attente, sans leur contenu', async () => {
    const d = deps();
    await d.store.originals.put(original());
    const result = await call(d, 'listOriginals', {});
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].contentInert).toBeUndefined();
  });

  it('affiche un texte inerte : aucune balise ne survit', async () => {
    const d = deps();
    await d.store.originals.put(original());
    const result = await call(d, 'getOriginal', { id: 'o-1' });
    expect(result.ok).toBe(true);
    expect(result.data.contentInert).toContain('‹script›');
    expect(result.data.contentInert).not.toContain('<');
  });

  it('refuse un original inconnu avec une phrase lisible', async () => {
    const result = await call(deps(), 'getOriginal', { id: 'absent' });
    expect(result.ok).toBe(false);
  });
});

describe('restoreOriginal (§17.6, §8.3)', () => {
  it('restaure, repasse les constats à « restored » et journalise', async () => {
    const d = deps();
    await d.store.originals.put(original());
    await d.store.findings.put({
      id: 'f-1',
      segmentId: 's-1',
      issueId: 'i-1',
      layer: 'C2',
      kind: 'assistant-addressing',
      ruleId: 'C2-01',
      excerpt: 'extrait',
      startPos: 0,
      endPos: 7,
      askSummary: 'résumé',
      confidence: 0.8,
      status: 'neutralized',
      createdAt: NOW,
    });
    const result = await call(d, 'restoreOriginal', { id: 'o-1' });
    expect(result.ok).toBe(true);
    const stored = await d.store.originals.byId('o-1');
    expect(stored?.restoredAt).toBe(NOW);
    const findingRow = await d.store.findings.byId('f-1');
    expect(findingRow?.status).toBe('restored');
    const events = await d.store.events.list('i-1', 10);
    expect(events.some((event) => event.kind === 'restore')).toBe(true);
  });
});
