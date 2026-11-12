/**
 * Tests du handler de diagnostic — sans réseau, sans Forge, sans site.
 *
 * Tout est injecté : le test vérifie l'assemblage (faits → rapport), la
 * lecture des incidents, la détection du mode dégradé et le refus sans jeton.
 */

import { describe, expect, it } from 'vitest';
import type { EventRow } from '../platform/schema';
import type { WebTriggerRequest } from '../platform/http';
import {
  diagnosis,
  errorEntriesFromEvents,
  errorMessage,
  isErrorKind,
  latenciesFromEvents,
  parsePayload,
  pendingFromEvents,
  queuedSegments,
  toDiagnosticInput,
  type DiagnosticDeps,
} from './diagnostic';

const T0 = '2026-11-12T18:00:00.000Z';

/** Une entrée de journal, telle que le tiroir `events` la conserve. */
function row(kind: string, payload = '{}', at: string = T0): EventRow {
  return { seq: 1, at, kind, issueId: '10001', payload };
}

/** Un jeton de requête minimal. */
const REQUEST: WebTriggerRequest = { headers: { authorization: ['Bearer jeton'] } };

/** Des dépendances factices, qui ne parlent à rien. */
function deps(overrides: Partial<DiagnosticDeps> = {}): DiagnosticDeps {
  return {
    now: () => T0,
    lang: () => 'fr',
    authorized: async () => true,
    listTables: async () => [
      { name: 'issue_state', rows: 38 },
      { name: 'finding', rows: 41 },
    ],
    budget: () => null,
    recentEvents: async () => [],
    ...overrides,
  };
}

describe('lecture du journal', () => {
  it('reconnaît les genres qui signalent un incident', () => {
    expect(isErrorKind('c3-enqueue-failed')).toBe(true);
    expect(isErrorKind('hook.auth.refused')).toBe(true);
    expect(isErrorKind('storage-budget-exceeded')).toBe(true);
    expect(isErrorKind('scan')).toBe(false);
    expect(isErrorKind('c3')).toBe(false);
  });

  it('lit une charge utile illisible sans échouer', () => {
    expect(parsePayload('pas du json')).toBeNull();
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
    expect(errorMessage('pas du json')).toBe('');
  });

  it('garde les dernières erreurs, les plus récentes en dernier', () => {
    const events = [
      row('scan', '{"queued":2}'),
      row('c3-enqueue-failed', '{"reason":"file pleine"}', '2026-11-12T18:01:00.000Z'),
      row('c3', '{}', '2026-11-12T18:02:00.000Z'),
      row('hook.auth.refused', '{"reason":"absent"}', '2026-11-12T18:03:00.000Z'),
    ];
    const entries = errorEntriesFromEvents(events);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'c3-enqueue-failed',
      'hook.auth.refused',
    ]);
    expect(entries[0]?.message).toBe('reason=file pleine');
  });
});

describe('latences et file', () => {
  it('mesure l’attente C3 à partir du journal', () => {
    const events = [
      row('scan', '{"queued":1}', '2026-11-12T18:00:00.000Z'),
      row('c3', '{}', '2026-11-12T18:00:20.000Z'),
    ];
    const stages = latenciesFromEvents(events);
    const c3 = stages.find((stage) => stage.id === 'c3-wait');
    expect(c3?.ms.source).toBe('measured');
    expect(c3?.ms.value).toBe(20_000);
  });

  it('ne mesure rien quand le journal est muet', () => {
    const stages = latenciesFromEvents([]);
    expect(stages.every((stage) => stage.ms.source === 'assumed')).toBe(true);
    expect(pendingFromEvents([]).source).toBe('assumed');
  });

  it('compte les segments en attente comme une borne basse', () => {
    const events = [
      row('scan', '{"queued":3}'),
      row('scan', '{"queued":2}'),
      row('c3', '{}'),
    ];
    expect(queuedSegments(events)).toBe(5);
    expect(pendingFromEvents(events).value).toBe(4);
  });
});

describe('assemblage du rapport', () => {
  it('déduit les tickets traités de l’état des tickets', () => {
    const input = toDiagnosticInput({
      generatedAt: T0,
      lang: 'fr',
      tables: [{ name: 'issue_state', rows: 38 }],
      budget: null,
      events: [],
      caveats: [],
    });
    expect(input.ticketsProcessed.value).toBe(38);
    expect(input.ticketsProcessed.source).toBe('measured');
  });

  it('ne suppose rien quand l’état des tickets est illisible', () => {
    const input = toDiagnosticInput({
      generatedAt: T0,
      lang: 'fr',
      tables: [{ name: 'issue_state', rows: null }],
      budget: null,
      events: [],
      caveats: [],
    });
    expect(input.ticketsProcessed.source).toBe('assumed');
  });
});

describe('handler', () => {
  it('rend le rapport assemblé et son texte lisible', async () => {
    const response = await diagnosis(
      REQUEST,
      deps({
        budget: () => ({
          writes: 98,
          reads: 41,
          queries: 139,
          skippedWrites: 0,
          limit: 120,
          degraded: false,
          nearLimit: true,
          startedAt: T0,
        }),
        recentEvents: async () => [row('c3-enqueue-failed', '{"reason":"file pleine"}')],
      }),
    );
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as {
      ok: boolean;
      report: { summary: { tablesListed: number }; recentErrors: unknown[] };
      text: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.report.summary.tablesListed).toBe(2);
    expect(payload.report.recentErrors).toHaveLength(1);
    expect(payload.text).toContain('Diagnostic');
    expect(payload.text).toContain('c3-enqueue-failed');
  });

  it('refuse sans jeton, sans dire pourquoi', async () => {
    const response = await diagnosis(REQUEST, deps({ authorized: async () => false }));
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rend un rapport malgré un journal illisible', async () => {
    const response = await diagnosis(
      REQUEST,
      deps({
        recentEvents: async () => {
          throw new Error('base muette');
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as { report: { caveats: string[] } };
    expect(payload.report.caveats.length).toBeGreaterThan(0);
  });
});
