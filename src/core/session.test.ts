/**
 * Tests — session contaminée (§9, §11, lot S).
 *
 * Couvre : marquage sur lecture T0/T1 uniquement, confirmation des trois
 * gestes de sortie avec le motif lisible (`permissionDecisionReason`), et
 * fin de session qui libère les gestes.
 */

import { describe, expect, it } from 'vitest';
import type { TaintedSession } from './types';
import {
  GUARDED_ACTIONS,
  endSession,
  isSessionTainted,
  mergeTaint,
  requiresConfirmation,
  taint,
  type TaintInput,
} from './session';

const NOW = '2026-11-11T10:00:00.000Z';

function taintInput(overrides: Partial<TaintInput> = {}): TaintInput {
  return {
    sessionRef: 'sess-1',
    accountId: 'acc-agent',
    issueId: '10001',
    trustLevel: 'T1',
    now: NOW,
    ...overrides,
  };
}

const TAINTED: TaintedSession = {
  sessionRef: 'sess-1',
  accountId: 'acc-agent',
  issueId: '10001',
  since: NOW,
};

describe('taint', () => {
  it('lecture T1 : la session est marquée, avec la date injectée', () => {
    expect(taint(taintInput())).toEqual(TAINTED);
  });

  it('lecture T0 (anonyme) : marquée aussi', () => {
    expect(taint(taintInput({ trustLevel: 'T0' })))?.toMatchObject({ sessionRef: 'sess-1' });
  });

  it('lecture T2 ou T3 : rien — un contenu vérifié ne contamine pas', () => {
    expect(taint(taintInput({ trustLevel: 'T2' }))).toBeNull();
    expect(taint(taintInput({ trustLevel: 'T3' }))).toBeNull();
  });
});

describe('requiresConfirmation', () => {
  it('session saine : les trois gestes passent sans confirmation', () => {
    for (const action of GUARDED_ACTIONS) {
      const decision = requiresConfirmation(null, action);
      expect(decision).toEqual({ required: false, decision: 'allow', reason: '' });
    }
  });

  it('réponse publique en session contaminée : ask, motif lisible (§11)', () => {
    const decision = requiresConfirmation(TAINTED, 'public-reply');
    expect(decision.required).toBe(true);
    expect(decision.decision).toBe('ask');
    expect(decision.reason).toContain('Réponse publique');
    expect(decision.reason).toContain('contenu non vérifié');
    expect(decision.reason).toContain('10001');
  });

  it('recherche étendue : ask, motif lisible', () => {
    const decision = requiresConfirmation(TAINTED, 'broad-search');
    expect(decision.decision).toBe('ask');
    expect(decision.reason).toContain('Recherche étendue');
  });

  it('consultation d’une adresse web : ask, motif lisible', () => {
    const decision = requiresConfirmation(TAINTED, 'fetch-url');
    expect(decision.decision).toBe('ask');
    expect(decision.reason).toContain('adresse web');
  });

  it('les trois gestes de §9 sont gardés, et rien d’autre', () => {
    expect(GUARDED_ACTIONS).toEqual(['broad-search', 'public-reply', 'fetch-url']);
  });

  it('langue anglaise : motif traduit avec le ticket', () => {
    const decision = requiresConfirmation(TAINTED, 'public-reply', 'en');
    expect(decision.reason).toContain('Public reply');
    expect(decision.reason).toContain('10001');
  });
});

describe('mergeTaint / isSessionTainted / endSession', () => {
  it('fusionne une nouvelle marque', () => {
    const sessions = mergeTaint([], TAINTED);
    expect(sessions).toEqual([TAINTED]);
    expect(isSessionTainted(sessions, 'sess-1')).toBe(true);
  });

  it('marque nulle : la liste ne change pas', () => {
    expect(mergeTaint([TAINTED], null)).toEqual([TAINTED]);
  });

  it('première contamination gagne : since n’est pas rajeuni', () => {
    const older = { ...TAINTED, since: '2026-11-11T08:00:00.000Z' };
    const sessions = mergeTaint([older], TAINTED);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.since).toBe('2026-11-11T08:00:00.000Z');
  });

  it('deux sessions distinctes coexistent', () => {
    const other = { ...TAINTED, sessionRef: 'sess-2' };
    const sessions = mergeTaint([TAINTED], other);
    expect(sessions).toHaveLength(2);
    expect(isSessionTainted(sessions, 'sess-2')).toBe(true);
    expect(isSessionTainted(sessions, 'sess-3')).toBe(false);
  });

  it('fin de session : la marque tombe, les gestes redeviennent libres (§9)', () => {
    const sessions = endSession([TAINTED], 'sess-1');
    expect(sessions).toEqual([]);
    expect(isSessionTainted(sessions, 'sess-1')).toBe(false);
    const decision = requiresConfirmation(
      sessions.find((s) => s.sessionRef === 'sess-1'),
      'public-reply',
    );
    expect(decision.required).toBe(false);
  });

  it('fin d’une session inconnue : la liste ne bouge pas', () => {
    expect(endSession([TAINTED], 'sess-x')).toEqual([TAINTED]);
  });

  it('ne mute jamais la liste reçue', () => {
    const sessions = [TAINTED];
    endSession(sessions, 'sess-1');
    mergeTaint(sessions, { ...TAINTED, sessionRef: 'sess-9' });
    expect(sessions).toEqual([TAINTED]);
  });
});
