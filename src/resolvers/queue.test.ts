import { describe, expect, it } from 'vitest';
import type { Finding, SuspicionLevel } from '../core/types';
import { createMemoryStore } from '../platform/memory';
import type { IssueStateRow } from '../platform/schema';
import type { ResolverDeps } from '../ui/api';
import { queueResolvers } from './queue';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

function stateRow(issueId: string, suspicion: SuspicionLevel, overrides: Partial<IssueStateRow> = {}): IssueStateRow {
  return {
    issueId,
    issueKey: `SUP-${issueId}`,
    projectKey: 'SUP',
    trustLevel: 'T1',
    suspicionLevel: suspicion,
    modeApplied: 'report',
    unanalyzed: [],
    inheritedFrom: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function finding(id: string, issueId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    segmentId: `seg-${id}`,
    issueId,
    layer: 'C2',
    kind: 'assistant-addressing',
    ruleId: 'C2-01',
    excerpt: 'extrait',
    startPos: 0,
    endPos: 7,
    askSummary: 'Le passage s’adresse à une IA.',
    confidence: 0.8,
    status: 'open',
    createdAt: NOW,
    ...overrides,
  };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(d: ResolverDeps, key: string, payload: Record<string, unknown>): Promise<Result> {
  const handler = queueResolvers(d)[key];
  if (!handler) throw new Error(`${key} absent`);
  return handler(payload, {}) as Promise<Result>;
}

describe('listSuspects (§17.2)', () => {
  it('trie par niveau de suspicion décroissant', async () => {
    const d = deps();
    await d.store.states.put(stateRow('1', 'review'));
    await d.store.states.put(stateRow('2', 'trapped'));
    await d.store.findings.put(finding('f-1', '1'));
    await d.store.findings.put(finding('f-2', '2'));
    const result = await call(d, 'listSuspects', {});
    expect(result.ok).toBe(true);
    expect(result.data[0].issueKey).toBe('SUP-2');
    expect(result.data[0].suspicion).toBe('trapped');
  });

  it('regroupe les constats d’une même campagne (§14)', async () => {
    const d = deps();
    await d.store.states.put(stateRow('1', 'suspect'));
    await d.store.states.put(stateRow('2', 'suspect'));
    await d.store.findings.put(finding('f-1', '1', { campaignHash: 'abc' }));
    await d.store.findings.put(finding('f-2', '2', { campaignHash: 'abc' }));
    const result = await call(d, 'listSuspects', {});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].campaignHash).toBe('abc');
  });

  it('filtre par projet quand la clé est donnée', async () => {
    const d = deps();
    await d.store.states.put(stateRow('1', 'suspect', { projectKey: 'SUP' }));
    await d.store.states.put(stateRow('2', 'suspect', { projectKey: 'AUT' }));
    await d.store.findings.put(finding('f-1', '1'));
    await d.store.findings.put(finding('f-2', '2'));
    const result = await call(d, 'listSuspects', { projectKey: 'SUP' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].issueKey).toBe('SUP-1');
  });
});

describe('setVerdict (§17.2, §14)', () => {
  it('enregistre un verdict en un clic et le journalise', async () => {
    const d = deps();
    await d.store.findings.put(finding('f-1', '1'));
    const result = await call(d, 'setVerdict', { findingId: 'f-1', decision: 'trapped', reviewerAccountId: 'a-1' });
    expect(result.ok).toBe(true);
    const verdicts = await d.store.verdicts.byFinding('f-1');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.decision).toBe('trapped');
    const events = await d.store.events.list('1', 10);
    expect(events.some((event) => event.kind === 'verdict')).toBe(true);
  });

  it('refuse un verdict qui n’existe pas au contrat', async () => {
    const d = deps();
    await d.store.findings.put(finding('f-1', '1'));
    const result = await call(d, 'setVerdict', { findingId: 'f-1', decision: 'nimporte', reviewerAccountId: 'a-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('decision');
  });

  it('refuse un constat inconnu avec une phrase lisible', async () => {
    const result = await call(deps(), 'setVerdict', { findingId: 'absent', decision: 'trapped' });
    expect(result.ok).toBe(false);
  });

  it('place les constats déjà jugés en dernier', async () => {
    const d = deps();
    await d.store.states.put(stateRow('1', 'suspect'));
    await d.store.findings.put(finding('f-1', '1'));
    await d.store.findings.put(finding('f-2', '1', { createdAt: '2026-11-10T12:00:00.000Z' }));
    await d.store.verdicts.put({ findingId: 'f-2', reviewerAccountId: 'a-1', decision: 'false-positive', reason: null, at: NOW });
    const result = await call(d, 'listSuspects', {});
    expect(result.data[0].findingId).toBe('f-1');
    expect(result.data[1].findingId).toBe('f-2');
    expect(result.data[1].verdict).toBe('false-positive');
  });
});
