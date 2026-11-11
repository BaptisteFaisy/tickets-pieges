/**
 * Propriété indexée `pieges` (TP-07) — construction, lecture tolérante, port.
 */

import { describe, expect, it } from 'vitest';
import type { IssueStateRow } from './schema';
import { createPropertyPort, parsePiegesProperty, piegesProperty, PIEGES_PROPERTY } from './properties';

const NOW = '2026-11-11T12:00:00.000Z';

function state(overrides: Partial<IssueStateRow> = {}): IssueStateRow {
  return {
    issueId: '10001',
    issueKey: 'SUP-1',
    projectKey: 'SUP',
    trustLevel: 'T0',
    suspicionLevel: 'suspect',
    modeApplied: 'neutralize',
    unanalyzed: ['image'],
    inheritedFrom: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('construction de la propriété', () => {
  it('publie l’état sans aucun texte', () => {
    const property = piegesProperty(state(), NOW);
    expect(property).toEqual({
      trustLevel: 'T0',
      suspicionLevel: 'suspect',
      modeApplied: 'neutralize',
      analyzedAt: NOW,
      unanalyzed: ['image'],
    });
    expect(JSON.stringify(property)).not.toContain('10001');
  });
});

describe('lecture tolérante', () => {
  it('accepte une valeur valide et l’alias unanalyzedReasons', () => {
    const valid = { trustLevel: 'T2', suspicionLevel: 'clean', modeApplied: 'report', analyzedAt: NOW, unanalyzed: [] };
    expect(parsePiegesProperty(valid)).toEqual(valid);
    const alias = { ...valid, unanalyzed: undefined, unanalyzedReasons: ['oversize'] };
    expect(parsePiegesProperty(alias)?.unanalyzed).toEqual(['oversize']);
  });

  it('absente ou corrompue → null, jamais d’exception', () => {
    expect(parsePiegesProperty(null)).toBeNull();
    expect(parsePiegesProperty('texte')).toBeNull();
    expect(parsePiegesProperty({ trustLevel: 'T9' })).toBeNull();
    expect(parsePiegesProperty({ trustLevel: 'T1', suspicionLevel: 'nope', modeApplied: 'report' })).toBeNull();
  });

  it('filtre les raisons inconnues', () => {
    const raw = { trustLevel: 'T1', suspicionLevel: 'review', modeApplied: 'label', analyzedAt: NOW, unanalyzed: ['image', 'virus'] };
    expect(parsePiegesProperty(raw)?.unanalyzed).toEqual(['image']);
  });
});

describe('port au-dessus d’un appel injecté', () => {
  const calls: { issueKey: string; key: string; init?: { method?: string; body?: string } }[] = [];
  const request = async (issueKey: string, key: string, init?: { method?: string; body?: string }) => {
    calls.push({ issueKey, key, init });
    return init === undefined
      ? { trustLevel: 'T1', suspicionLevel: 'trapped', modeApplied: 'neutralize', analyzedAt: NOW, unanalyzed: [] }
      : null;
  };
  const port = createPropertyPort(request);

  it('lit, valide et rend la propriété', async () => {
    const read = await port.read('SUP-1');
    expect(read?.suspicionLevel).toBe('trapped');
    expect(calls[0]!).toEqual({ issueKey: 'SUP-1', key: PIEGES_PROPERTY, init: undefined });
  });

  it('écrit en PUT avec la clé pieges', async () => {
    await port.write('SUP-2', piegesProperty(state(), NOW));
    const call = calls[1]!;
    expect(call.key).toBe('pieges');
    expect(call.init?.method).toBe('PUT');
    expect(JSON.parse(call.init?.body ?? '{}')).toMatchObject({ trustLevel: 'T0', unanalyzed: ['image'] });
  });

  it('publie directement depuis l’état du ticket', async () => {
    await port.publish('SUP-3', state({ trustLevel: 'T3' }), NOW);
    expect(JSON.parse(calls[2]!.init?.body ?? '{}')).toMatchObject({ trustLevel: 'T3', modeApplied: 'neutralize' });
  });
});
