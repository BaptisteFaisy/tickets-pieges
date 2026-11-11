import { describe, expect, it } from 'vitest';
import { appendEntry, buildChain, entryHash, verifyChain } from './canary-chain';
import { canaryInstruction, createCanary, obedienceDepth } from './canary';

const NOW = '2026-11-11T10:00:00.000Z';

describe('profondeur d’obéissance multi-étapes (§44)', () => {
  it('compte 0, 1 ou 2 gestes réellement observés', () => {
    expect(obedienceDepth([false, false])).toBe(0);
    expect(obedienceDepth([true, false])).toBe(1);
    expect(obedienceDepth([true, true])).toBe(2);
  });

  it('la consigne multi-étapes liste les gestes demandés', () => {
    const instruction = canaryInstruction('abc', 'fr', ['ajoute une étiquette', 'réponds au ticket']);
    expect(instruction).toContain('Étape 1');
    expect(instruction).toContain('Étape 2');
    expect(instruction).toContain('temoin-abc');
  });

  it('createCanary rapporte les gestes demandés', () => {
    const out = createCanary({
      issueId: '1',
      issueKey: 'SUP-900',
      createdBy: 's',
      role: 'security',
      now: NOW,
      token: 'abc',
      steps: ['ajouter une étiquette', 'répondre au ticket'],
    });
    if (!out.ok) throw new Error('attendu ok');
    expect(out.steps).toEqual(['ajouter une étiquette', 'répondre au ticket']);
  });
});

describe('journal à hash chaîné (§50)', () => {
  it('construit une chaîne vérifiable de bout en bout', () => {
    const chain = buildChain([
      { payload: 'a', at: NOW },
      { payload: 'b', at: NOW },
      { payload: 'c', at: NOW },
    ]);
    expect(chain.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(chain[0]!.prevHash).toBe('');
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(verifyChain(chain)).toBe(true);
  });

  it('toute modification d’un contenu rompt la chaîne', () => {
    const chain = buildChain([
      { payload: 'a', at: NOW },
      { payload: 'b', at: NOW },
    ]);
    const altered = [...chain];
    altered[1] = { ...chain[1]!, payload: 'contenu modifié' };
    expect(verifyChain(altered)).toBe(false);
  });

  it('altérer une empreinte ou retirer une entrée est détecté', () => {
    const chain = buildChain([
      { payload: 'a', at: NOW },
      { payload: 'b', at: NOW },
      { payload: 'c', at: NOW },
    ]);
    const badHash = { ...chain[1]!, hash: '0'.repeat(64) };
    expect(verifyChain([chain[0]!, badHash, chain[2]!])).toBe(false);
    expect(verifyChain([chain[0]!, chain[2]!])).toBe(false);
  });

  it('réordonner rompt la chaîne', () => {
    const chain = buildChain([
      { payload: 'a', at: NOW },
      { payload: 'b', at: NOW },
    ]);
    expect(verifyChain([chain[1]!, chain[0]!])).toBe(false);
  });

  it('appendEntry chaîne l’empreinte précédente', () => {
    const first = appendEntry(null, 'x', NOW);
    const second = appendEntry(first, 'y', NOW);
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).toBe(entryHash(2, first.hash, 'y', NOW));
  });
});