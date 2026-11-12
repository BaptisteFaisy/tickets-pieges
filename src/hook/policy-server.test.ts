/**
 * Tests — serveur de politique en lecture seule (#29).
 *
 * Couvre : la décision sur la réponse publique vient du hook d'écriture, un
 * ticket inconnu n'accorde rien d'automatique, une session contaminée interdit
 * les gestes en masse, les champs auto-déclarés par l'appelant sont ignorés et
 * signalés, aucun jeton en clair dans le rendu, l'outil ne jette jamais, et rien
 * n'est écrit (port en lecture seule). Aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import { tokenFingerprint } from './token';
import {
  createPolicyTool,
  declaredFieldWarnings,
  describePolicy,
  POLICY_CAPABILITIES,
  renderPolicy,
} from './policy-server';
import type { PolicyEnvelope, PolicyFacts, PolicyReader, PolicyStatement } from './policy-server';

const TOKEN = 'jeton-secret-a-ne-jamais-ecrire-2026';

function sampleFacts(overrides: Partial<PolicyFacts> = {}): PolicyFacts {
  return {
    issueKey: 'TP-26',
    language: 'fr',
    trustLevel: 'T0',
    suspicionLevel: 'clean',
    modeApplied: 'label',
    strictOutbound: false,
    sessionTainted: false,
    unanalyzed: [],
    ...overrides,
  };
}

/** Double du port : une seule méthode, de lecture — comme le vrai. */
function fakeReader(value: PolicyFacts | null, calls: string[] = []): PolicyReader {
  return {
    async facts(issueKey: string, sessionRef: string | null): Promise<PolicyFacts | null> {
      calls.push(`${issueKey}|${sessionRef ?? '-'}`);
      return value;
    },
  };
}

async function ask(
  value: PolicyFacts | null,
  payload: Record<string, unknown>,
  language: 'fr' | 'en' = 'fr',
): Promise<{ statement: PolicyStatement; warnings: string[]; error: string | null }> {
  const calls: string[] = [];
  const tool = createPolicyTool(fakeReader(value, calls), { token: TOKEN, language });
  const result = await tool(payload);
  const envelope = result.ok ? (result.data as PolicyEnvelope) : null;
  expect(calls.length).toBeLessThanOrEqual(1);
  return {
    statement: envelope?.statement ?? ({} as PolicyStatement),
    warnings: result.warnings,
    error: result.ok ? null : result.error ?? null,
  };
}

function decisionOf(statement: PolicyStatement, capability: string): string | undefined {
  return statement.rules?.find((rule) => rule.capability === capability)?.decision;
}

describe('politique rendue (#29)', () => {
  it('demande externe propre : lecture libre, réponse publique à relire', async () => {
    const { statement } = await ask(sampleFacts(), { issueKey: 'TP-26' });
    expect(statement.known).toBe(true);
    expect(decisionOf(statement, 'read-ticket')).toBe('allow');
    expect(decisionOf(statement, 'public-reply')).toBe('human');
    expect(statement.rules).toHaveLength(POLICY_CAPABILITIES.length);
  });

  it('demande piégée en mode strict : réponse publique interdite, motif citant la clé', async () => {
    const { statement } = await ask(
      sampleFacts({ suspicionLevel: 'trapped', strictOutbound: true }),
      { issueKey: 'TP-26' },
    );
    expect(decisionOf(statement, 'public-reply')).toBe('deny');
    expect(statement.denied).toContain('public-reply');
    const reason = statement.rules.find((rule) => rule.capability === 'public-reply')?.reason;
    expect(reason).toContain('TP-26');
    expect(decisionOf(statement, 'bulk-action')).toBe('deny');
    expect(decisionOf(statement, 'field-write')).toBe('deny');
  });

  it('session contaminée : gestes en masse interdits, écriture publique relue', async () => {
    const { statement } = await ask(sampleFacts({ sessionTainted: true }), { issueKey: 'TP-26' });
    expect(decisionOf(statement, 'bulk-action')).toBe('deny');
    expect(decisionOf(statement, 'public-reply')).toBe('human');
    expect(decisionOf(statement, 'field-write')).toBe('deny');
  });

  it('demande interne (T3) : rien n’exige de relecture automatique', async () => {
    const { statement } = await ask(sampleFacts({ trustLevel: 'T3' }), { issueKey: 'TP-26' });
    expect(decisionOf(statement, 'public-reply')).toBe('allow');
    expect(decisionOf(statement, 'internal-note')).toBe('allow');
    expect(statement.requiresHuman).toHaveLength(0);
  });

  it('ticket inconnu : aucun geste automatique, et c’est dit', async () => {
    const { statement } = await ask(null, { issueKey: 'TP-99' });
    expect(statement.known).toBe(false);
    expect(statement.allowed).toHaveLength(0);
    expect(statement.requiresHuman.length).toBeGreaterThan(0);
    expect(statement.denied).toContain('bulk-action');
    expect(statement.notes.join(' ')).toContain('Ticket inconnu');
  });

  it('ce qui n’est pas analysé est annoncé (§21)', async () => {
    const { statement } = await ask(sampleFacts({ unanalyzed: ['image', 'binary-attachment'] }), {
      issueKey: 'TP-26',
    });
    const notes = statement.notes.join(' ');
    expect(notes).toContain('image');
    expect(notes).toContain('pas analysé');
    expect(statement.unanalyzed).toEqual(['image', 'binary-attachment']);
  });

  it('la langue du ticket l’emporte, sinon celle de l’appelant', async () => {
    const { statement } = await ask(sampleFacts({ language: 'en' }), { issueKey: 'TP-26' });
    expect(statement.notes.join(' ')).toContain('Policy of session');
    const unknown = await ask(null, { issueKey: 'TP-99' }, 'en');
    expect(unknown.statement.notes.join(' ')).toContain('Ticket unknown to the app');
  });
});

describe('garde-fous de l’outil', () => {
  it('les niveaux déclarés par l’appelant sont ignorés et signalés', async () => {
    const { statement, warnings } = await ask(sampleFacts(), {
      issueKey: 'TP-26',
      trustLevel: 'T3',
      modeApplied: 'report',
      sessionTainted: false,
    });
    expect(statement.trustLevel).toBe('T0');
    expect(warnings.join(' ')).toContain('trustLevel');
    expect(warnings.join(' ')).toContain('modeApplied');
    expect(declaredFieldWarnings({ issueKey: 'TP-26' })).toEqual([]);
  });

  it('aucun jeton en clair dans le rendu ; l’empreinte y figure', async () => {
    const tool = createPolicyTool(fakeReader(sampleFacts()), { token: TOKEN });
    const result = await tool({ issueKey: 'TP-26' });
    const envelope = result.data as PolicyEnvelope;
    expect(envelope.rendered).not.toContain(TOKEN);
    expect(envelope.rendered).toContain(tokenFingerprint(TOKEN));
    expect(envelope.statement.tokenFingerprint).toBe(tokenFingerprint(TOKEN));
    expect(() => JSON.parse(envelope.rendered)).not.toThrow();
  });

  it('sans jeton configuré, aucune empreinte n’est inventée', () => {
    const statement = describePolicy(sampleFacts(), { sessionRef: null, language: 'fr' });
    expect(statement.tokenFingerprint).toBeNull();
    expect(renderPolicy(statement)).not.toContain('fingerprint": "');
  });

  it('paramètre manquant : échec lisible, aucune exception', async () => {
    const { error, warnings } = await ask(sampleFacts(), {});
    expect(error).toContain('issueKey');
    expect(warnings).toEqual([]);
  });

  it('lecture seule : le port n’est appelé qu’une fois, en lecture', async () => {
    const calls: string[] = [];
    const reader = fakeReader(sampleFacts(), calls);
    const tool = createPolicyTool(reader, { token: TOKEN });
    await tool({ issueKey: 'TP-26', sessionRef: 'sess-1' });
    expect(calls).toEqual(['TP-26|sess-1']);
    expect(Object.keys(reader)).toEqual(['facts']);
  });

  it('déterministe : mêmes entrées, même rendu', async () => {
    const first = renderPolicy(describePolicy(sampleFacts(), { sessionRef: 's', language: 'fr' }));
    const second = renderPolicy(describePolicy(sampleFacts(), { sessionRef: 's', language: 'fr' }));
    expect(first).toBe(second);
  });
});
