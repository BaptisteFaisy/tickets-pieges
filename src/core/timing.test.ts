/**
 * Tests du domaine de mesure (#84, #85) : durées bornées et monotones,
 * dépassement d'objectif signalé, rapport qui distingue mesuré et supposé.
 */

import { describe, expect, it } from 'vitest';
import {
  C3_OBJECTIVE_MS,
  MAX_DURATION_MS,
  assumed,
  buildTimingReport,
  checkObjective,
  demote,
  durationMs,
  emptyTrace,
  exposureWindowMs,
  formatMs,
  intervalsOf,
  markStage,
  measured,
  queueStats,
  queueWaitMs,
  renderReportMarkdown,
  summarizeObjectives,
  throughput,
  TIMING_INTERVALS,
  type QueueSample,
  type ThroughputSample,
  type TimingTrace,
} from './timing';

const T0 = Date.parse('2026-11-11T10:00:00.000Z');

/** Une trace complète, dans l'ordre réel : chaque étape 200 ms après la précédente. */
function fullTrace(step = 200): TimingTrace {
  let trace = markStage(emptyTrace('SUP-1'), 'created', T0);
  trace = markStage(trace, 'origin', T0 + step);
  trace = markStage(trace, 'c1', T0 + step * 2);
  trace = markStage(trace, 'c2', T0 + step * 3);
  trace = markStage(trace, 'mode-applied', T0 + step * 4);
  return markStage(trace, 'c3', T0 + step * 5);
}

describe('marques d’étape', () => {
  it('reste monotone même si une étape arrive en désordre', () => {
    let trace = markStage(emptyTrace('SUP-1'), 'created', T0);
    trace = markStage(trace, 'mode-applied', T0 + 5000);
    trace = markStage(trace, 'c1', T0 + 100);
    expect(trace.marks.map((mark) => mark.atMs)).toEqual([T0, T0 + 5000, T0 + 5000]);
    expect(durationMs(trace, 'created', 'c1')).toBe(5000);
    expect(durationMs(trace, 'c1', 'mode-applied')).toBe(0);
  });

  it('remplace une étape déjà marquée sans dupliquer', () => {
    let trace = markStage(emptyTrace('SUP-1'), 'created', T0);
    trace = markStage(trace, 'origin', T0 + 10);
    trace = markStage(trace, 'origin', T0 + 40);
    expect(trace.marks.filter((mark) => mark.stage === 'origin')).toHaveLength(1);
    expect(durationMs(trace, 'created', 'origin')).toBe(40);
  });

  it('ignore un horodatage non fini sans casser la trace', () => {
    let trace = markStage(emptyTrace('SUP-1'), 'created', T0);
    trace = markStage(trace, 'origin', Number.NaN);
    expect(durationMs(trace, 'created', 'origin')).toBe(0);
  });
});

describe('durées', () => {
  it('rend null quand une étape n’a pas été observée', () => {
    const trace = markStage(emptyTrace('SUP-1'), 'created', T0);
    expect(durationMs(trace, 'created', 'c3')).toBeNull();
    expect(exposureWindowMs(trace)).toBeNull();
  });

  it('borne une durée délirante à la borne haute', () => {
    let trace = markStage(emptyTrace('SUP-1'), 'created', T0);
    trace = markStage(trace, 'mode-applied', T0 + MAX_DURATION_MS * 10);
    expect(exposureWindowMs(trace)).toBe(MAX_DURATION_MS);
  });

  it('donne les cinq intervalles, monotones de la création au verdict C3', () => {
    const intervals = intervalsOf(fullTrace());
    expect(Object.keys(intervals)).toHaveLength(TIMING_INTERVALS.length);
    const values = TIMING_INTERVALS.map((spec) => intervals[spec.name]) as number[];
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] as number);
    }
    expect(intervals.mode).toBe(800);
    expect(intervals.c3).toBe(1000);
  });
});

describe('objectifs', () => {
  it('signale un dépassement au lieu de le masquer', () => {
    const check = checkObjective('c3', 'file C3', C3_OBJECTIVE_MS + 4200, C3_OBJECTIVE_MS);
    expect(check.status).toBe('late');
    expect(check.overshootMs).toBe(4200);
  });

  it('reste « inconnu » sans mesure, jamais « atteint »', () => {
    const check = checkObjective('c3', 'file C3', null, C3_OBJECTIVE_MS);
    expect(check.status).toBe('unknown');
    expect(check.overshootMs).toBe(0);
  });

  it('résume les dépassements et les identifiants en retard', () => {
    const summary = summarizeObjectives([
      checkObjective('mode', 'mode appliqué', 1200, 5000),
      checkObjective('c3', 'file C3', 40_000, C3_OBJECTIVE_MS),
      checkObjective('debit', 'débit 5000', null, 1),
    ]);
    expect(summary).toMatchObject({ total: 3, ok: 1, late: 1, unknown: 1 });
    expect(summary.lateIds).toEqual(['c3']);
    expect(summary.worstOvershootMs).toBe(40_000 - C3_OBJECTIVE_MS);
  });
});

describe('file C3 (#85)', () => {
  const samples: QueueSample[] = Array.from({ length: 500 }, (_, index) => ({
    enqueuedAtMs: T0 + index * 100,
    dequeuedAtMs: T0 + index * 100 + (index < 470 ? 900 : 45_000),
  }));

  it('rend une attente nulle plutôt que négative', () => {
    expect(queueWaitMs({ enqueuedAtMs: T0 + 10, dequeuedAtMs: T0 })).toBe(0);
  });

  it('mesure 500 messages : médiane, p95 et dépassements de l’objectif', () => {
    const stats = queueStats(samples);
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(500);
    expect(stats?.p50Ms).toBe(900);
    expect(stats?.p95Ms).toBe(45_000);
    expect(stats?.overObjective).toBe(30);
    expect(stats?.objectiveMs).toBe(C3_OBJECTIVE_MS);
  });

  it('rend null sans échantillon exploitable', () => {
    expect(queueStats([])).toBeNull();
  });
});

describe('débit (#84)', () => {
  const samples: ThroughputSample[] = [
    { atMs: T0, tickets: 2500 },
    { atMs: T0 + 60_000, tickets: 2500 },
  ];

  it('calcule le débit sur 5 000 tickets', () => {
    const flow = throughput(samples);
    expect(flow?.total).toBe(5000);
    expect(flow?.windowMs).toBe(60_000);
    expect(flow?.perMinute).toBe(5000);
    expect(flow?.perHour).toBe(300_000);
  });

  it('rend null sur une fenêtre nulle ou un seul point', () => {
    expect(throughput([{ atMs: T0, tickets: 10 }, { atMs: T0, tickets: 10 }])).toBeNull();
    expect(throughput([{ atMs: T0, tickets: 10 }])).toBeNull();
    expect(throughput([])).toBeNull();
  });
});

describe('rapport', () => {
  it('hors site : tout est supposé, aucun chiffre inventé', () => {
    const report = buildTimingReport({ scope: 'offline', traces: [] });
    expect(report.sampleSize).toBe(0);
    for (const spec of TIMING_INTERVALS) {
      expect(report.intervals[spec.name]?.source).toBe('assumed');
      expect(report.intervals[spec.name]?.value).toBeNull();
      expect(report.intervals[spec.name]?.note).toBe('à mesurer sur site');
    }
    expect(report.queue.source).toBe('assumed');
    expect(report.throughput.source).toBe('assumed');
    expect(report.caveats.join(' ')).toContain('site');
  });

  it('sur site : la mesure observée est dite mesurée, l’absente reste supposée', () => {
    const report = buildTimingReport({
      scope: 'site',
      traces: [fullTrace(), fullTrace(400)],
      queueSamples: [{ enqueuedAtMs: T0, dequeuedAtMs: T0 + 800 }],
      throughputSamples: [{ atMs: T0, tickets: 5000 }, { atMs: T0 + 60_000, tickets: 0 }],
    });
    expect(report.sampleSize).toBe(2);
    expect(report.intervals.mode?.source).toBe('measured');
    expect(report.intervals.mode?.value).toBe(1600);
    expect(report.intervals.c3?.value).toBe(2000);
    expect(report.intervals.origin?.value).toBe(400);
    expect(report.queue.source).toBe('measured');
    expect(report.queue.value?.count).toBe(1);
    expect(report.throughput.source).toBe('measured');
    expect(report.throughput.value?.total).toBe(5000);
  });

  it('sur site sans donnée : la valeur reste « à mesurer sur site »', () => {
    const report = buildTimingReport({ scope: 'site', traces: [] });
    expect(report.intervals.c3?.source).toBe('assumed');
    expect(report.queue.value).toBeNull();
  });

  it('rétrograde une mesure en supposé quand la source disparaît', () => {
    expect(demote(measured(12), 'perdu').source).toBe('assumed');
    expect(assumed<number>('à mesurer sur site').value).toBeNull();
  });

  it('rend un tableau markdown lisible, sans texte de ticket', () => {
    const markdown = renderReportMarkdown(
      buildTimingReport({
        scope: 'site',
        traces: [fullTrace()],
        objectives: [checkObjective('c3', 'file C3', 45_000, C3_OBJECTIVE_MS)],
      }),
    );
    expect(markdown).toContain('| Mesure | Valeur | Source |');
    expect(markdown).toContain('1.0 s');
    expect(markdown).toContain('45.0 s');
    expect(markdown).toContain('late');
    expect(markdown).not.toContain('SUP-1');
  });
});

describe('formatage', () => {
  it('rend les ordres de grandeur lisibles', () => {
    expect(formatMs(null)).toBe('à mesurer sur site');
    expect(formatMs(350)).toBe('350 ms');
    expect(formatMs(12_400)).toBe('12.4 s');
    expect(formatMs(125_000)).toBe('2 min 05 s');
  });
});
