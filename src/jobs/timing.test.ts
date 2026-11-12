/**
 * Tests de l'instrumentation plateforme : ce que le journal prouve, ce qu'il ne
 * prouve pas, et l'absence de texte de ticket dans la charge utile rendue.
 */

import { describe, expect, it } from 'vitest';
import { throughput } from '../core/timing';
import { createMemoryStore, fixedClock } from '../platform/memory';
import type { EventRow, JiraIssueView, JiraPort, Store } from '../platform/schema';
import {
  EVENT_STAGES,
  measureSite,
  queueSamplesFromEvents,
  stagesOfEvent,
  timingPayload,
  throughputFromEvents,
  traceForIssue,
  traceFromEvents,
} from './timing';

const T0 = Date.parse('2026-11-11T10:00:00.000Z');
const CREATED = new Date(T0).toISOString();

/** Une entrée de journal, telle que le tiroir `events` la conserve. */
function row(kind: string, atMs: number, issueId: string | null = '10001', payload = '{}'): EventRow {
  return { seq: atMs, at: new Date(atMs).toISOString(), kind, issueId, payload };
}

const ISSUE: JiraIssueView = {
  id: '10001',
  key: 'SUP-482',
  projectKey: 'SUP',
  summary: 'Export de factures en échec',
  description: 'Bonjour, mon export échoue.',
  reporter: { accountId: 'acc-client', accountType: 'customer' },
  channel: 'portal',
  createdAt: CREATED,
  labels: [],
};

/** Un `JiraPort` faux : seules les lectures servent à la mesure. */
function fakeJira(issue: JiraIssueView = ISSUE): JiraPort {
  const refusé = async (): Promise<never> => {
    throw new Error('geste Jira interdit en test de mesure');
  };
  return {
    async getIssue() {
      return issue;
    },
    async listComments() {
      return [];
    },
    async listAttachments() {
      return [];
    },
    async listLinked() {
      return [];
    },
    async searchByJql() {
      return [];
    },
    addInternalNote: refusé,
    addPublicComment: refusé,
    setCommentVisibility: refusé,
    updateField: refusé,
    prependToField: refusé,
    replaceSegmentText: refusé,
    setEntityProperty: refusé,
    addLabel: refusé,
  } as JiraPort;
}

/** Le store mémoire, avec un tiroir `events` qui rend les fixtures du test. */
function storeWith(rows: EventRow[]): Store {
  const store = createMemoryStore();
  return {
    ...store,
    events: {
      append: store.events.append,
      async list(issueId: string | null, limit: number) {
        const selected = issueId === null ? rows : rows.filter((entry) => entry.issueId === issueId);
        return selected.slice(-limit);
      },
    },
  };
}

describe('cartographie du journal', () => {
  it('date ce que le journal prouve, et rien d’autre', () => {
    expect(stagesOfEvent(row('scan', T0))).toEqual(['c2', 'mode-applied']);
    expect(stagesOfEvent(row('c3', T0))).toEqual(['c3']);
    expect(stagesOfEvent(row('label-applied', T0))).toEqual(['mode-applied']);
    expect(stagesOfEvent(row('verdict', T0))).toEqual([]);
    expect(EVENT_STAGES.every((entry) => entry.kind.length > 0)).toBe(true);
  });
});

describe('trace d’un ticket', () => {
  it('borne le mode appliqué au premier événement qui le prouve', () => {
    const events = [
      row('scan', T0 + 900),
      row('label-applied', T0 + 700),
      row('c3', T0 + 4000),
    ];
    const trace = traceFromEvents('SUP-482', CREATED, events);
    const marks = Object.fromEntries(trace.marks.map((mark) => [mark.stage, mark.atMs]));
    expect(marks['mode-applied']).toBe(T0 + 700);
    expect(marks.c2).toBe(T0 + 900);
    expect(marks.c3).toBe(T0 + 4000);
    expect(marks.origin).toBeUndefined();
    expect(marks.c1).toBeUndefined();
  });

  it('reste monotone même si le journal arrive en désordre', () => {
    const events = [row('c3', T0 + 5000), row('scan', T0 - 60_000)];
    const trace = traceFromEvents('SUP-482', CREATED, events);
    const times = trace.marks.map((mark) => mark.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(T0);
  });

  it('ignore une entrée illisible sans jeter', () => {
    const trace = traceFromEvents('SUP-482', CREATED, [
      { seq: 1, at: 'pas-une-date', kind: 'scan', issueId: '10001', payload: '{}' },
      row('c3', T0 + 1000),
    ]);
    expect(trace.marks.map((mark) => mark.stage)).toEqual(['created', 'c3']);
  });

  it('lit la date de création côté Jira', async () => {
    const deps = { store: storeWith([row('scan', T0 + 800)]), jira: fakeJira(), clock: fixedClock(CREATED) };
    const trace = await traceForIssue(deps, 'SUP-482');
    expect(trace.issueKey).toBe('SUP-482');
    expect(trace.marks[0]).toEqual({ stage: 'created', atMs: T0 });
  });
});

describe('file C3 et débit', () => {
  it('apparie chaque verdict au scan qui le précède', () => {
    const samples = queueSamplesFromEvents([
      row('scan', T0),
      row('c3', T0 + 1200),
      row('c3', T0 + 2600),
      row('scan', T0 + 3000),
      row('c3', T0 + 9000),
    ]);
    expect(samples).toEqual([
      { enqueuedAtMs: T0, dequeuedAtMs: T0 + 1200 },
      { enqueuedAtMs: T0, dequeuedAtMs: T0 + 2600 },
      { enqueuedAtMs: T0 + 3000, dequeuedAtMs: T0 + 9000 },
    ]);
  });

  it('ne rend aucun échantillon sans scan antérieur', () => {
    expect(queueSamplesFromEvents([row('c3', T0 + 10)])).toEqual([]);
  });

  it('compte les analyses par tranche d’une minute', () => {
    const samples = throughputFromEvents([
      row('scan', T0 + 100),
      row('scan', T0 + 200),
      row('scan', T0 + 300),
      row('scan', T0 + 61_000),
      row('scan', T0 + 62_000),
      row('verdict', T0 + 400),
    ]);
    expect(samples).toHaveLength(2);
    expect(samples[0]?.tickets).toBe(3);
    expect(throughput(samples)?.total).toBe(5);
  });
});

describe('mesure du site', () => {
  it('signale un dépassement de l’objectif de 30 s au lieu de le masquer', async () => {
    const events = [row('scan', T0), row('c3', T0 + 45_000), row('label-applied', T0 + 900)];
    const site = await measureSite({ store: storeWith(events), jira: fakeJira(), clock: fixedClock(CREATED) });
    expect(site.report.scope).toBe('site');
    expect(site.samples.queue).toBe(1);
    const late = site.report.objectives.find((check) => check.id === 'c3-p95');
    expect(late?.status).toBe('late');
    expect(late?.overshootMs).toBe(45_000 - 30_000);
    expect(site.report.objectiveSummary.late).toBeGreaterThan(0);
    expect(site.markdown).toContain('late');
  });

  it('dit « à mesurer sur site » ce qu’aucun ticket échantillonné ne prouve', async () => {
    const site = await measureSite({ store: storeWith([]), jira: fakeJira(), clock: fixedClock(CREATED) });
    expect(site.report.sampleSize).toBe(0);
    expect(site.report.intervals.mode?.source).toBe('assumed');
    expect(site.report.queue.value).toBeNull();
    expect(site.report.caveats.join(' ')).toContain('journal');
  });

  it('trace les tickets demandés et mesure la fenêtre d’exposition', async () => {
    const events = [row('scan', T0 + 1200), row('label-applied', T0 + 1100)];
    const deps = { store: storeWith(events), jira: fakeJira(), clock: fixedClock(CREATED) };
    const site = await measureSite(deps, { issueKeys: ['SUP-482'] });
    expect(site.report.sampleSize).toBe(1);
    expect(site.report.intervals.mode?.value).toBe(1100);
    expect(site.report.intervals.mode?.source).toBe('measured');
    expect(site.report.intervals.c1?.source).toBe('assumed');
  });

  it('hors site, rien n’est présenté comme mesuré', async () => {
    const events = [row('scan', T0 + 1200), row('c3', T0 + 5000)];
    const deps = { store: storeWith(events), jira: fakeJira(), clock: fixedClock(CREATED) };
    const site = await measureSite(deps, { scope: 'offline', issueKeys: ['SUP-482'] });
    expect(site.report.intervals.mode?.source).toBe('assumed');
    expect(site.report.queue.source).toBe('assumed');
    expect(site.report.throughput.source).toBe('assumed');
  });
});

describe('charge utile rendue', () => {
  it('ne contient jamais le texte d’un ticket présent dans le journal', async () => {
    const secret = 'FR1420041010050500013M02606-carte-4111111111111111';
    const events = [
      row('scan', T0 + 500, '10001', JSON.stringify({ issueKey: 'SUP-482', findings: 1 })),
      row('c3', T0 + 900, '10001', JSON.stringify({ segmentId: 's-1', texte: secret })),
    ];
    const site = await measureSite({ store: storeWith(events), jira: fakeJira(), clock: fixedClock(CREATED) });
    const serialized = JSON.stringify(timingPayload(site, CREATED));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).toContain('"ok":true');
  });
});
