import { describe, expect, it } from 'vitest';
import {
  buildRedTeamAttempts,
  countForAgent,
  createRateState,
  PUBLIC_REPLY_HOURLY_LIMIT,
  recordPublicReply,
  runRedTeam,
} from './outbound-rate';
import { checkOutbound } from './outbound';
import type { OutboundContext } from './types';

const context: OutboundContext = {
  issueKey: 'TP-1',
  requestText: 'statut de ma commande',
  strict: true,
  taintedSession: false,
};

describe('débit des réponses publiques (#38)', () => {
  it('compte les réponses par agent et par heure', () => {
    let state = createRateState();
    for (let i = 0; i < PUBLIC_REPLY_HOURLY_LIMIT; i += 1) {
      const res = recordPublicReply(state, 'agent-1', '2026-11-12T09:00:00.000Z');
      state = res.state;
      expect(res.decision.allowed).toBe(true);
    }
    expect(countForAgent(state, 'agent-1', '2026-11-12T09:30:00.000Z')).toBe(PUBLIC_REPLY_HOURLY_LIMIT);
  });

  it('alerte au-delà du débit', () => {
    let state = createRateState();
    for (let i = 0; i < PUBLIC_REPLY_HOURLY_LIMIT; i += 1) {
      state = recordPublicReply(state, 'agent-1', '2026-11-12T09:00:00.000Z').state;
    }
    const res = recordPublicReply(state, 'agent-1', '2026-11-12T09:10:00.000Z');
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.alert).toBe(true);
    expect(res.decision.count).toBe(PUBLIC_REPLY_HOURLY_LIMIT + 1);
    expect(res.decision.message).toContain('agent-1');
  });

  it('ne compte pas les réponses d’une heure plus tôt', () => {
    let state = createRateState();
    for (let i = 0; i < PUBLIC_REPLY_HOURLY_LIMIT; i += 1) {
      state = recordPublicReply(state, 'agent-1', '2026-11-12T09:00:00.000Z').state;
    }
    const res = recordPublicReply(state, 'agent-1', '2026-11-12T10:30:00.000Z');
    expect(res.decision.allowed).toBe(true);
    expect(res.decision.count).toBe(1);
  });

  it('compte chaque agent séparément', () => {
    let state = createRateState();
    for (let i = 0; i < PUBLIC_REPLY_HOURLY_LIMIT; i += 1) {
      state = recordPublicReply(state, 'agent-1', '2026-11-12T09:00:00.000Z').state;
    }
    const res = recordPublicReply(state, 'agent-2', '2026-11-12T09:05:00.000Z');
    expect(res.decision.allowed).toBe(true);
    expect(res.decision.count).toBe(1);
  });

  it('ne jette pas sur une date illisible', () => {
    const res = recordPublicReply(createRateState(), 'agent-1', 'pas-une-date');
    expect(res.decision.count).toBe(1);
    expect(res.decision.allowed).toBe(true);
  });
});

describe('mode red team (#40)', () => {
  const marker = 'MARQUEUR-TEST';

  it('construit des tentatives déterministes', () => {
    const attempts = buildRedTeamAttempts(marker);
    expect(attempts.length).toBeGreaterThan(2);
    expect(attempts.map((a) => a.id)).toEqual(buildRedTeamAttempts(marker).map((a) => a.id));
  });

  it('rapporte un taux de réussite quand tout passe', () => {
    const report = runRedTeam(marker, (text) => text);
    expect(report.total).toBe(5);
    expect(report.passed).toBe(5);
    expect(report.successRate).toBe(1);
    expect(report.summary).toContain('5');
  });

  it('rapporte qu’aucune tentative n’est sortie', () => {
    const report = runRedTeam(marker, () => null);
    expect(report.passed).toBe(0);
    expect(report.successRate).toBe(0);
    expect(report.summary).toContain('aucune tentative');
  });

  it('mesure ce qui passe réellement le sas', () => {
    const gate = (text: string): string | null => {
      const verdict = checkOutbound(text, context, { language: 'fr' });
      return verdict.allowed ? text : null;
    };
    const report = runRedTeam(marker, gate);
    expect(report.passedAttempts).toContain('direct');
    expect(report.passedAttempts).not.toContain('url');
    expect(report.successRate).toBe(report.passed / report.total);
  });
});
