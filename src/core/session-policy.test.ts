/**
 * Tests — politique de session étendue : budget (#26), quarantaine (#27),
 * extinction (#24) et capacités produit-agnostiques (#21).
 *
 * Couvre aussi le pont avec le jeton signé (#23) : un état se réduit à des
 * affirmations signables et se reconstruit à l'identique.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_POLICY,
  SESSION_CAPABILITIES,
  actionOf,
  applyGesture,
  capabilityOf,
  capabilityPolicy,
  claimsOf,
  decide,
  recordSignal,
  releaseQuarantine,
  remainingBudget,
  startSession,
  stateFrom,
  type PolicyAction,
  type SessionPolicySettings,
} from './session-policy';
import { signSessionToken, verifySessionToken } from './session-token';

const KEY = 'cle-de-signature-fournie-par-l-appelant';
const NOW = '2026-11-12T10:00:00.000Z';
const LATER = '2026-11-12T10:05:00.000Z';
const STALE = '2026-11-12T11:00:00.000Z';

const OUT_ACTIONS: readonly PolicyAction[] = [
  'broad-search',
  'public-reply',
  'fetch-url',
  'write-internal',
  'export-data',
];

function settings(overrides: Partial<SessionPolicySettings> = {}): SessionPolicySettings {
  return { ...DEFAULT_SESSION_POLICY, ...overrides };
}

describe('session marquée — gestes de sortie (§9)', () => {
  it('la lecture est toujours libre, même en quarantaine', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    expect(decide(state, 'read', NOW).decision).toBe('allow');
    const locked = recordSignal(recordSignal(state, NOW), NOW);
    expect(locked.quarantine).toBe(true);
    expect(decide(locked, 'read', NOW).decision).toBe('allow');
  });

  it('les cinq gestes de sortie demandent une confirmation, motif lisible inclus', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    for (const action of OUT_ACTIONS) {
      const decision = decide(state, action, NOW);
      expect(decision.decision).toBe('ask');
      expect(decision.humanReview).toBe(false);
      expect(decision.reason).toContain('10001');
    }
  });

  it('le motif des trois gestes du §9 vient de session.ts (une seule source)', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    expect(decide(state, 'public-reply', NOW, DEFAULT_SESSION_POLICY, 'en').reason)
      .toContain('Public reply');
    expect(decide(state, 'export-data', NOW, DEFAULT_SESSION_POLICY, 'en').reason)
      .toContain('Data export');
  });
});

describe('budget de gestes sensibles (#26)', () => {
  const RULES = settings({ publicReplyBudget: 2 });

  function spent(count: number) {
    let state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    for (let index = 0; index < count; index += 1) {
      state = applyGesture(state, 'public-reply', LATER);
    }
    return state;
  }

  it('le budget décroît, puis le refus tombe avec validation humaine', () => {
    expect(remainingBudget(spent(0), RULES)).toBe(2);
    expect(decide(spent(0), 'public-reply', NOW, RULES).decision).toBe('ask');
    expect(remainingBudget(spent(1), RULES)).toBe(1);
    expect(decide(spent(1), 'public-reply', NOW, RULES).decision).toBe('ask');
    const exhausted = decide(spent(2), 'public-reply', NOW, RULES);
    expect(exhausted.decision).toBe('deny');
    expect(exhausted.humanReview).toBe(true);
    expect(exhausted.reason).toContain('2');
    expect(remainingBudget(spent(5), RULES)).toBe(0);
  });

  it('le budget ne porte que sur la réponse publique', () => {
    const state = spent(3);
    expect(decide(state, 'fetch-url', NOW, RULES).decision).toBe('ask');
    expect(decide(state, 'broad-search', NOW, RULES).decision).toBe('ask');
    expect(decide(state, 'export-data', NOW, RULES).decision).toBe('ask');
  });

  it('un geste refusé ne consomme rien et ne rajeunit pas la session', () => {
    const state = spent(2);
    const after = applyGesture(state, 'read', LATER);
    expect(after.publicRepliesUsed).toBe(2);
    expect(after.lastActivityAt).toBe(LATER);
  });
});

describe('quarantaine (#27)', () => {
  const RULES = settings({ quarantineThreshold: 2 });

  it('au seuil, la session ne peut plus que lire', () => {
    let state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    state = recordSignal(state, NOW, RULES);
    expect(state.quarantine).toBe(false);
    state = recordSignal(state, NOW, RULES);
    expect(state.quarantine).toBe(true);
    expect(state.signals).toBe(2);
    for (const action of OUT_ACTIONS) {
      const decision = decide(state, action, NOW, RULES);
      expect(decision.decision).toBe('deny');
      expect(decision.humanReview).toBe(true);
      expect(decision.capability).toBe(capabilityOf(action));
    }
  });

  it('la quarantaine est collante, seul un humain la lève', () => {
    let state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    state = recordSignal(recordSignal(state, NOW, RULES), NOW, RULES);
    expect(state.quarantine).toBe(true);
    expect(recordSignal(state, NOW, RULES).signals).toBe(3);
    const released = releaseQuarantine(state, LATER);
    expect(released.quarantine).toBe(false);
    expect(released.signals).toBe(0);
    expect(decide(released, 'public-reply', LATER, RULES).decision).toBe('ask');
  });

  it('le motif de quarantaine cite le ticket et le nombre de signaux', () => {
    const state = recordSignal(
      recordSignal(startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW }), NOW, RULES),
      NOW,
      RULES,
    );
    const reason = decide(state, 'public-reply', NOW, RULES).reason;
    expect(reason).toContain('10001');
    expect(reason).toContain('2');
    expect(decide(state, 'public-reply', NOW, RULES, 'en').reason).toContain('quarantine');
  });
});

describe('extinction par inactivité (#24)', () => {
  it('une session inactive ne refuse plus rien, et le dit', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    const decision = decide(state, 'public-reply', STALE);
    expect(decision.decision).toBe('allow');
    expect(decision.expired).toBe(true);
    expect(decision.reason).toContain('30');
    expect(decide(state, 'read', STALE).reason).toBe('');
  });

  it('l’extinction ne blanchit pas : une session neuve est re-marquée', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    const fresh = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10002', now: STALE });
    expect(decide(fresh, 'public-reply', STALE).decision).toBe('ask');
    expect(decide(state, 'public-reply', STALE).decision).toBe('allow');
  });
});

describe('capacités produit-agnostiques (#21)', () => {
  it('chaque capacité correspond à un geste, et réciproquement', () => {
    for (const capability of SESSION_CAPABILITIES) {
      expect(capabilityOf(actionOf(capability))).toBe(capability);
    }
    expect(SESSION_CAPABILITIES).toHaveLength(6);
  });

  it('le rendu répartit les six capacités sans trou ni doublon', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    const policy = capabilityPolicy(state, NOW);
    const all = [...policy.denied, ...policy.confirmation, ...policy.allowed].sort();
    expect(all).toEqual([...SESSION_CAPABILITIES].sort());
    expect(policy.version).toBe(1);
    expect(policy.publicRepliesLeft).toBe(DEFAULT_SESSION_POLICY.publicReplyBudget);
    expect(policy.allowed).toEqual(['read']);
    expect(policy.denied).toEqual([]);
    expect(policy.expiresAt).toBe('2026-11-12T10:30:00.000Z');
  });

  it('en quarantaine tout est refusé sauf la lecture', () => {
    const state = recordSignal(
      recordSignal(startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW }), NOW, DEFAULT_SESSION_POLICY),
      NOW,
      DEFAULT_SESSION_POLICY,
    );
    const policy = capabilityPolicy(state, NOW);
    expect(policy.quarantine).toBe(true);
    expect(policy.denied).toHaveLength(5);
    expect(policy.allowed).toEqual(['read']);
    expect(policy.confirmation).toEqual([]);
  });

  it('session éteinte : plus rien n’est refusé, la quarantaine tombe du rendu', () => {
    const state = recordSignal(
      recordSignal(startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW }), NOW, DEFAULT_SESSION_POLICY),
      NOW,
      DEFAULT_SESSION_POLICY,
    );
    const policy = capabilityPolicy(state, STALE);
    expect(policy.quarantine).toBe(false);
    expect(policy.denied).toEqual([]);
    expect(policy.allowed).toHaveLength(6);
  });

  it('le rendu ne cite aucun produit et ne contient aucun texte de ticket', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    const rendered = JSON.stringify(capabilityPolicy(state, NOW)).toLowerCase();
    for (const product of ['jira', 'atlassian', 'confluence', 'jsm']) {
      expect(rendered).not.toContain(product);
    }
    expect(capabilityPolicy(state, NOW).limits).toHaveLength(2);
  });
});

describe('pont avec le jeton signé (#23)', () => {
  it('un état se signe, se vérifie et se reconstruit à l’identique', () => {
    let state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    state = applyGesture(state, 'public-reply', LATER);
    state = recordSignal(state, LATER);
    const token = signSessionToken(claimsOf(state), KEY);
    const checked = verifySessionToken(token, KEY, LATER);
    expect(checked.ok).toBe(true);
    const restored = stateFrom(checked.claims ?? claimsOf(state), state.signals);
    expect(restored).toEqual(state);
    expect(decide(restored, 'public-reply', LATER).decision)
      .toBe(decide(state, 'public-reply', LATER).decision);
  });
});
