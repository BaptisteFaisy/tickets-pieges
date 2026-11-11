import { describe, expect, it } from 'vitest';
import type { IssueState, ProjectSettings } from './types';
import { defaultSettings } from './trust-rules';
import { decideMode, hasSomethingToSay, labelBanner, modeExplanation, prependBanner, shouldNeutralize } from './modes';

const NOW = '2026-11-11T10:00:00.000Z';

function state(overrides: Partial<IssueState> = {}): IssueState {
  return {
    issueId: '10001',
    issueKey: 'SUP-482',
    projectKey: 'SUP',
    trustLevel: 'T1',
    suspicionLevel: 'suspect',
    modeApplied: 'report',
    analyzedSegments: 2,
    unanalyzed: [],
    updatedAt: NOW,
    ...overrides,
  };
}

function settings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { ...defaultSettings('SUP'), ...overrides };
}

describe('les trois modes (§8.1)', () => {
  it('rien à dire : aucun mode ne modifie le ticket (§21 peu de bruit)', () => {
    const decision = decideMode(state({ suspicionLevel: 'clean' }), settings({ mode: 'neutralize' }), 'fr');
    expect(decision.mode).toBe('report');
    expect(decision.silent).toBe(true);
    expect(decision.banner).toBeNull();
    expect(decision.neutralize).toBe(false);
  });

  it('mode « signaler » : silencieux envers le demandeur', () => {
    const decision = decideMode(state(), settings({ mode: 'report' }), 'fr');
    expect(decision.mode).toBe('report');
    expect(decision.silent).toBe(true);
    expect(decision.banner).toBeNull();
    expect(decision.reasons).toContain('mode.report-default');
  });

  it('mode « étiqueter » : un encart en tête, par ajout seulement', () => {
    const decision = decideMode(state(), settings({ mode: 'label' }), 'fr');
    expect(decision.mode).toBe('label');
    expect(decision.silent).toBe(false);
    expect(decision.neutralize).toBe(false);
    expect(decision.banner).toContain('Contenu externe non vérifié');
    expect(decision.banner).toContain('T1');
    expect(decision.banner).toContain('suspect');
  });

  it('l’encart ne révèle aucune règle : il ne dit pas ce qui a été détecté', () => {
    const banner = labelBanner(state(), 'fr');
    expect(banner.toLowerCase()).not.toContain('c2-');
    expect(banner.toLowerCase()).not.toContain('règle');
    expect(banner).toContain('réduit');
  });

  it('l’encart annonce ce qui n’a pas été analysé (§21)', () => {
    const banner = labelBanner(state({ unanalyzed: ['image'] }), 'fr');
    expect(banner).toContain('image');
  });

  it('l’ajout de l’encart est idempotent', () => {
    const banner = labelBanner(state(), 'fr');
    const once = prependBanner('Texte du client.', banner);
    expect(prependBanner(once, banner)).toBe(once);
    expect(prependBanner('', banner)).toBe(banner);
  });

  it('mode « neutraliser » : appliqué au seuil et sur les origines réglées', () => {
    const decision = decideMode(state(), settings({ mode: 'neutralize' }), 'fr');
    expect(decision.mode).toBe('neutralize');
    expect(decision.neutralize).toBe(true);
    expect(decision.silent).toBe(false);
  });

  it('mode « neutraliser » : un texte interne (T3) n’est pas neutralisé', () => {
    const decision = decideMode(state({ trustLevel: 'T3' }), settings({ mode: 'neutralize' }), 'fr');
    expect(decision.neutralize).toBe(false);
    expect(decision.mode).toBe('report');
    expect(decision.silent).toBe(true);
    expect(decision.reasons).toContain('mode.threshold-not-met');
  });

  it('mode « neutraliser » : sous le seuil, rien ne se passe', () => {
    const decision = decideMode(state({ suspicionLevel: 'review' }), settings({ mode: 'neutralize' }), 'fr');
    expect(decision.neutralize).toBe(false);
    expect(shouldNeutralize(state({ suspicionLevel: 'review' }), settings({ mode: 'neutralize' }))).toBe(false);
    expect(shouldNeutralize(state({ suspicionLevel: 'trapped' }), settings({ mode: 'neutralize' }))).toBe(true);
  });

  it('les réglages par défaut sont « signaler » et neutralisation à partir de « suspect » sur T0/T1', () => {
    const defaults = defaultSettings('SUP');
    expect(defaults.mode).toBe('report');
    expect(defaults.neutralizeFrom).toBe('suspect');
    expect(defaults.neutralizeOrigins).toEqual(['T0', 'T1']);
  });

  it('l’explication du mode est traduite et honnête', () => {
    const decision = decideMode(state(), settings({ mode: 'neutralize' }), 'fr');
    expect(modeExplanation(decision, 'fr')).toContain('restaurable');
    expect(modeExplanation(decision, 'en')).toContain('restored');
    expect(modeExplanation(decision, 'fr')).not.toContain('protégé');
  });

  it('quelque chose à dire : un constat ou une partie non analysée suffit', () => {
    expect(hasSomethingToSay(state({ suspicionLevel: 'clean' }))).toBe(false);
    expect(hasSomethingToSay(state({ suspicionLevel: 'review' }))).toBe(true);
    expect(hasSomethingToSay(state({ suspicionLevel: 'clean', unanalyzed: ['binary-attachment'] }))).toBe(true);
  });
});
