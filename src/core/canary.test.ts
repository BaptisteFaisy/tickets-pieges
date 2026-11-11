import { describe, expect, it } from 'vitest';
import type { Canary } from './types';
import {
  CANARY_TTL_HOURS,
  SECURITY_ROLE,
  canaryInstruction,
  closeCanary,
  createCanary,
  detectHit,
  isExpired,
  labelNameFor,
  obedienceRate,
  summarizeCanary,
} from './canary';

const NOW = '2026-11-11T10:00:00.000Z';

function canary(overrides: Partial<Canary> = {}): Canary {
  return {
    id: 'canary-abc',
    issueId: '10001',
    issueKey: 'SUP-900',
    token: 'abc',
    instruction: canaryInstruction('abc', 'fr'),
    labelName: labelNameFor('abc'),
    createdBy: 'acc-secu',
    createdAt: NOW,
    status: 'open',
    ...overrides,
  };
}

describe('ticket témoin (§13)', () => {
  it('seul le rôle sécurité lance un exercice', () => {
    const refused = createCanary({ issueId: '1', issueKey: 'SUP-900', createdBy: 'acc-agent', role: 'agent', now: NOW });
    expect(refused.ok).toBe(false);
    const allowed = createCanary({ issueId: '1', issueKey: 'SUP-900', createdBy: 'acc-secu', role: SECURITY_ROLE, now: NOW });
    expect(allowed.ok).toBe(true);
  });

  it('la consigne est unique, inoffensive et ne vise que ce ticket', () => {
    const created = createCanary({ issueId: '1', issueKey: 'SUP-900', createdBy: 's', role: SECURITY_ROLE, now: NOW, token: 'abcd1234' });
    if (!created.ok) throw new Error('attendu ok');
    expect(created.labelName).toBe('temoin-abcd1234');
    expect(created.instruction).toContain('temoin-abcd1234');
    expect(created.instruction).toContain('essai');
    expect(created.instruction.toLowerCase()).not.toContain('supprime');
    expect(created.canary.status).toBe('open');
  });

  it('deux exercices ne partagent jamais le même jeton', () => {
    const a = createCanary({ issueId: '1', issueKey: 'SUP-900', createdBy: 's', role: SECURITY_ROLE, now: NOW });
    const b = createCanary({ issueId: '2', issueKey: 'SUP-901', createdBy: 's', role: SECURITY_ROLE, now: NOW });
    if (!a.ok || !b.ok) throw new Error('attendu ok');
    expect(a.canary.token).not.toBe(b.canary.token);
  });

  it('sans ticket, l’exercice est refusé', () => {
    expect(createCanary({ issueId: '', issueKey: '', createdBy: 's', role: SECURITY_ROLE, now: NOW }).ok).toBe(false);
  });

  it('la consigne existe dans les deux langues', () => {
    expect(canaryInstruction('abc', 'en')).toContain('label `temoin-abc`');
    expect(canaryInstruction('abc', 'fr')).toContain('étiquette');
  });
});

describe('coup et clôture', () => {
  it('l’étiquette de l’exercice qui apparaît produit un coup, avec le type d’acteur', () => {
    const hit = detectHit({
      canary: canary(),
      labelsAdded: ['urgent', 'temoin-abc'],
      actorAccountId: 'acc-rovo',
      actorType: 'ai-agent',
      requestedBy: 'acc-agent',
      now: NOW,
    });
    expect(hit?.canaryId).toBe('canary-abc');
    expect(hit?.actorType).toBe('ai-agent');
    expect(hit?.action).toBe('label:temoin-abc');
  });

  it('une autre étiquette ne produit rien', () => {
    expect(detectHit({ canary: canary(), labelsAdded: ['urgent'], actorAccountId: 'a', actorType: 'human', now: NOW })).toBeNull();
  });

  it('un exercice clos ne peut plus être touché', () => {
    const closed = closeCanary(canary(), NOW);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe(NOW);
    expect(detectHit({ canary: closed, labelsAdded: ['temoin-abc'], actorAccountId: 'a', actorType: 'human', now: NOW })).toBeNull();
  });

  it('l’étiquette est reconnue quelle que soit sa casse', () => {
    expect(detectHit({ canary: canary(), labelsAdded: ['TEMOIN-ABC'], actorAccountId: 'a', actorType: 'automation', now: NOW })?.actorType)
      .toBe('automation');
  });

  it('le ticket témoin se ferme seul après son délai', () => {
    const later = '2026-11-15T10:00:00.000Z';
    expect(isExpired(canary(), later, CANARY_TTL_HOURS)).toBe(true);
    expect(isExpired(canary(), '2026-11-11T11:00:00.000Z')).toBe(false);
    expect(isExpired(canary({ createdAt: 'illisible' }), later)).toBe(false);
  });

  it('le taux d’obéissance est un chiffre borné : « deux sur cinq »', () => {
    expect(obedienceRate(5, 2)).toBe(0.4);
    expect(obedienceRate(0, 0)).toBe(0);
    expect(obedienceRate(3, 9)).toBe(1);
  });

  it('le résumé d’un exercice ne nomme aucune personne, seulement des types d’acteur', () => {
    const summary = summarizeCanary(canary(), [
      { canaryId: 'canary-abc', actorAccountId: 'acc-1', actorType: 'ai-agent', action: 'label', at: NOW },
      { canaryId: 'canary-abc', actorAccountId: 'acc-2', actorType: 'ai-agent', action: 'label', at: NOW },
    ]);
    expect(summary.obeyed).toBe(true);
    expect(summary.actorTypes).toEqual(['ai-agent']);
    expect(JSON.stringify(summary.actorTypes)).not.toContain('acc-1');
  });
});
