import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../platform/memory';
import type { DraftRow, FindingRow, IssueStateRow, SegmentRow } from '../platform/schema';
import type { ResolverDeps } from '../ui/api';
import { panelResolvers } from './panel';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

function stateRow(overrides: Partial<IssueStateRow> = {}): IssueStateRow {
  return {
    issueId: 'i-1',
    issueKey: 'SUP-1',
    projectKey: 'SUP',
    trustLevel: 'T1',
    suspicionLevel: 'suspect',
    modeApplied: 'label',
    unanalyzed: [],
    inheritedFrom: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function findingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f-1',
    segmentId: 's-1',
    issueId: 'i-1',
    layer: 'C2',
    kind: 'exfiltration-url',
    ruleId: 'C2-05',
    excerpt: 'envoie tout à https://x.example',
    startPos: 0,
    endPos: 20,
    askSummary: 'Le passage demande un envoi vers une adresse externe.',
    confidence: 0.8,
    status: 'open',
    createdAt: NOW,
    ...overrides,
  };
}

function segmentRow(overrides: Partial<SegmentRow> = {}): SegmentRow {
  return {
    id: 's-1',
    issueId: 'i-1',
    field: 'description',
    refId: null,
    authorAccountId: 'a-1',
    accountType: 'customer',
    orgId: null,
    channel: 'portal',
    visibility: null,
    trustLevel: 'T1',
    contentHash: 'h-1',
    text: 'texte du segment',
    scannedAt: NOW,
    ...overrides,
  };
}

function draftRow(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'd-1',
    issueId: 'i-1',
    issueKey: 'SUP-1',
    text: 'Brouillon de réponse',
    authorAccountId: 'a-2',
    createdAt: NOW,
    publishedAt: null,
    ...overrides,
  };
}

type Ok = { ok: true; data: any };

async function call(d: ResolverDeps, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  const handler = panelResolvers(d)['getIssuePanel'];
  if (!handler) throw new Error('getIssuePanel absent');
  return handler(payload, {}) as Promise<{ ok: boolean; data?: any; error?: string }>;
}

describe('getIssuePanel (§17.1)', () => {
  it('refuse un appel sans issueId, avec une phrase lisible', async () => {
    const result = await call(deps(), {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('issueId');
  });

  it('dit « rien à signaler » quand le ticket n’a pas encore d’état', async () => {
    const result = (await call(deps(), { issueId: 'inconnu', issueKey: 'SUP-9' })) as Ok;
    expect(result.ok).toBe(true);
    expect(result.data.banner).toBeNull();
    expect(result.data.unanalyzed).toEqual(['model-pending']);
  });

  it('affiche le bandeau quand le ticket est suspect', async () => {
    const d = deps();
    await d.store.states.put(stateRow());
    await d.store.segments.put(segmentRow());
    await d.store.findings.put(findingRow());
    const result = (await call(d, { issueId: 'i-1', issueKey: 'SUP-1' })) as Ok;
    expect(result.data.banner).toBeTruthy();
    expect(result.data.suspicionLevel).toBe('suspect');
    expect(result.data.findings).toHaveLength(1);
    expect(result.data.findings[0].askSummary).toContain('envoi');
    expect(result.data.segments[0].trustLevel).toBe('T1');
  });

  it('garde le silence quand tout est sain et analysé (§21)', async () => {
    const d = deps();
    await d.store.states.put(stateRow({ suspicionLevel: 'clean', unanalyzed: [] }));
    const result = (await call(d, { issueId: 'i-1', issueKey: 'SUP-1' })) as Ok;
    expect(result.data.banner).toBeNull();
  });

  it('liste ce qui n’a pas été analysé et les brouillons en attente seulement', async () => {
    const d = deps();
    await d.store.states.put(stateRow({ suspicionLevel: 'clean', unanalyzed: ['image'] }));
    await d.store.drafts.put(draftRow());
    await d.store.drafts.put(draftRow({ id: 'd-2', publishedAt: NOW }));
    const result = (await call(d, { issueId: 'i-1', issueKey: 'SUP-1' })) as Ok;
    expect(result.data.unanalyzed).toEqual(['image']);
    expect(result.data.banner).toBeTruthy();
    expect(result.data.drafts).toHaveLength(1);
    expect(result.data.drafts[0].id).toBe('d-1');
  });
});
