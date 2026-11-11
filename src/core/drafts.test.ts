import { describe, expect, it } from 'vitest';
import type { OutboundVerdict } from './types';
import { createDraft, decidePublication, isPending, markPublished, pendingDrafts } from './drafts';

const NOW = '2026-11-11T10:00:00.000Z';

function draft(id = 'd1') {
  return createDraft({ id, issueId: '10001', issueKey: 'SUP-482', text: 'Bonjour,', authorAccountId: 'acc-agent', now: NOW });
}

function verdict(overrides: Partial<OutboundVerdict> = {}): OutboundVerdict {
  return { issueKey: 'SUP-482', allowed: true, action: 'allow', hits: [], checkedAt: NOW, ...overrides };
}

describe('brouillon en note interne (§10, TP-12)', () => {
  it('un brouillon naît en attente, jamais publié', () => {
    const row = draft();
    expect(row.publishedAt).toBeNull();
    expect(isPending(row)).toBe(true);
    expect(row.issueKey).toBe('SUP-482');
  });

  it('les brouillons en attente sont triés du plus ancien au plus récent', () => {
    const a = { ...draft('a'), createdAt: '2026-11-11T09:00:00.000Z' };
    const b = { ...draft('b'), createdAt: '2026-11-11T08:00:00.000Z' };
    const c = { ...draft('c'), createdAt: NOW, publishedAt: NOW };
    expect(pendingDrafts([a, b, c]).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('sans relecture humaine, rien ne devient public (§23.10)', () => {
    const decision = decidePublication(draft(), verdict(), false, { now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.visibility).toBe('internal');
    expect(decision.journal[0]?.kind).toBe('draft-held');
  });

  it('un sas défavorable bloque la publication même après relecture', () => {
    const held = verdict({ allowed: false, action: 'hold-for-review' });
    const decision = decidePublication(draft(), held, true, { now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.journal[0]?.kind).toBe('draft-blocked');
  });

  it('relecture humaine et sas favorable : la publication est tracée', () => {
    const decision = decidePublication(draft(), verdict(), true, { now: NOW, reviewerAccountId: 'acc-humain' });
    expect(decision.allowed).toBe(true);
    expect(decision.visibility).toBe('public');
    expect(decision.journal[0]?.detail.by).toBe('acc-humain');
  });

  it('la publication pose la date et journalise le geste', () => {
    const res = markPublished(draft(), NOW, 'acc-humain');
    expect(res.row.publishedAt).toBe(NOW);
    expect(isPending(res.row)).toBe(false);
    expect(res.journal).toHaveLength(1);
  });
});
