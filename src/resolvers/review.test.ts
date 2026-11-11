import { describe, expect, it } from 'vitest';
import type { Finding } from '../core/types';
import { createMemoryStore } from '../platform/memory';
import type { OriginalRow, PatternRow, SegmentRow } from '../platform/schema';
import type { ResolverDeps } from '../ui/api';
import { contextAround, reviewResolvers } from './review';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    segmentId: 's-1',
    issueId: 'i-1',
    layer: 'C2',
    kind: 'assistant-addressing',
    ruleId: 'C2-01',
    excerpt: '<script>alert(1)</script>',
    startPos: 4,
    endPos: 29,
    askSummary: 'Le passage s’adresse à une IA.',
    confidence: 0.8,
    status: 'neutralized',
    createdAt: NOW,
    ...overrides,
  };
}

function segment(): SegmentRow {
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
    text: 'Bonjour <script>alert(1)</script> merci',
    scannedAt: NOW,
  };
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

function pattern(): PatternRow {
  return {
    id: 'C2-01',
    layer: 'C2',
    kind: 'assistant-addressing',
    expression: '.*',
    language: 'fr',
    precision: 0.7,
    enabled: true,
    demoted: true,
  };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(d: ResolverDeps, key: string, payload: Record<string, unknown>): Promise<Result> {
  const handler = reviewResolvers(d)[key];
  if (!handler) throw new Error(`${key} absent`);
  return handler(payload, {}) as Promise<Result>;
}

describe('contextAround (helper pur, §17.3)', () => {
  it('rend le contexte inerte : aucune balise ne survit', () => {
    const context = contextAround('Avant <script>alert(1)</script> après', 6, 31);
    expect(context).not.toContain('<');
    expect(context).not.toContain('>');
    expect(context).toContain('‹script›');
  });
});

describe('getFinding (§17.3)', () => {
  it('rend la revue complète : contexte, règle, précision, verdicts', async () => {
    const d = deps();
    await d.store.findings.put(finding());
    await d.store.segments.put(segment());
    await d.store.patterns.put(pattern());
    await d.store.verdicts.put({ findingId: 'f-1', reviewerAccountId: 'a-9', decision: 'trapped', reason: 'vu', at: NOW });
    const result = await call(d, 'getFinding', { findingId: 'f-1' });
    expect(result.ok).toBe(true);
    expect(result.data.rulePrecision).toBe(0.7);
    expect(result.data.ruleDemoted).toBe(true);
    expect(result.data.context).toContain('‹script›');
    expect(result.data.excerpt).not.toContain('<');
    expect(result.data.verdicts).toHaveLength(1);
    expect(result.data.originalId).toBeNull();
  });

  it('refuse un constat inconnu avec une phrase lisible', async () => {
    const result = await call(deps(), 'getFinding', { findingId: 'absent' });
    expect(result.ok).toBe(false);
  });
});

describe('restoreFinding (§17.3, §8.3)', () => {
  it('refuse quand aucun original n’est conservé', async () => {
    const d = deps();
    await d.store.findings.put(finding());
    const result = await call(d, 'restoreFinding', { findingId: 'f-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('original');
  });

  it('restaure, marque le constat « restored » et journalise', async () => {
    const d = deps();
    await d.store.findings.put(finding());
    await d.store.originals.put(original());
    const result = await call(d, 'restoreFinding', { findingId: 'f-1', reason: 'faux positif' });
    expect(result.ok).toBe(true);
    const restored = await d.store.findings.byId('f-1');
    expect(restored?.status).toBe('restored');
    const stored = await d.store.originals.byId('o-1');
    expect(stored?.restoredAt).toBe(NOW);
    const events = await d.store.events.list('i-1', 10);
    expect(events.some((event) => event.kind === 'restore')).toBe(true);
  });
});
