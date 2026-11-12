import { describe, expect, it } from 'vitest';
import {
  applyFlags,
  BASE_KNOBS,
  defaultFlagState,
  describeFlags,
  enabledFlags,
  FLAG_NAMES,
  flagEffect,
  isFlagEnabled,
  projectFlags,
  setFlag,
  type FlagChangeContext,
  type FlagName,
  type PipelineKnobs,
} from './flags';

const CTX: FlagChangeContext = {
  actor: 'admin-1',
  at: '2026-11-12T10:00:00.000Z',
  reason: 'incident en cours',
};

function knobsWith(flag: FlagName): PipelineKnobs {
  return applyFlags(BASE_KNOBS, projectFlags('P1', { [flag]: true } as never));
}

describe('flags — état par défaut', () => {
  it('tous les drapeaux sont éteints par défaut', () => {
    const state = defaultFlagState();
    for (const flag of FLAG_NAMES) {
      expect(state[flag]).toBe(false);
    }
    expect(enabledFlags(projectFlags('P1'))).toEqual([]);
  });

  it('sans drapeau actif, les boutons du pipeline ne changent pas', () => {
    expect(applyFlags(BASE_KNOBS, projectFlags('P1'))).toEqual(BASE_KNOBS);
  });
});

describe('flags — un drapeau coupe exactement ce qu’il annonce (#89)', () => {
  it('chaque drapeau ne touche que son propre bouton', () => {
    for (const flag of FLAG_NAMES) {
      const next = knobsWith(flag);
      const knob = flagEffect(flag);
      for (const key of Object.keys(BASE_KNOBS) as (keyof PipelineKnobs)[]) {
        if (key === knob) {
          expect(next[key], flag).not.toBe(BASE_KNOBS[key]);
        } else {
          expect(next[key], flag).toBe(BASE_KNOBS[key]);
        }
      }
    }
  });

  it('coupe-c3 éteint C3 et laisse le sas actif', () => {
    const next = knobsWith('coupe-c3');
    expect(next.c3Enabled).toBe(false);
    expect(next.sasEnabled).toBe(true);
  });

  it('coupe-sas éteint le sas et laisse C3 actif', () => {
    const next = knobsWith('coupe-sas');
    expect(next.sasEnabled).toBe(false);
    expect(next.c3Enabled).toBe(true);
  });

  it('force-report force le mode report', () => {
    expect(knobsWith('force-report').forcedReport).toBe(true);
  });

  it('mode-shadow bascule en shadow', () => {
    expect(knobsWith('mode-shadow').shadow).toBe(true);
  });

  it('applyFlags ne modifie jamais son entrée', () => {
    const base = { ...BASE_KNOBS };
    knobsWith('coupe-c3');
    expect(base).toEqual(BASE_KNOBS);
  });
});

describe('flags — journalisation de tout changement', () => {
  it('un changement produit une entrée de journal complète', () => {
    const result = setFlag(projectFlags('P1'), 'coupe-c3', true, CTX);
    expect(result.entry).not.toBeNull();
    expect(result.entry).toMatchObject({
      kind: 'flag-change',
      projectId: 'P1',
      flag: 'coupe-c3',
      before: false,
      after: true,
      actor: 'admin-1',
      at: CTX.at,
      reason: 'incident en cours',
    });
    expect(isFlagEnabled(result.project, 'coupe-c3')).toBe(true);
  });

  it('sans changement réel, aucune entrée de journal', () => {
    const result = setFlag(projectFlags('P1'), 'coupe-c3', false, CTX);
    expect(result.entry).toBeNull();
  });

  it('une suite de changements est entièrement journalisée', () => {
    let project = projectFlags('P1');
    const entries = [];
    for (const flag of FLAG_NAMES) {
      const result = setFlag(project, flag, true, CTX);
      if (result.entry) {
        entries.push(result.entry);
      }
      project = result.project;
    }
    expect(entries).toHaveLength(FLAG_NAMES.length);
    expect(enabledFlags(project)).toEqual([...FLAG_NAMES]);
  });

  it('les drapeaux actifs se décrivent dans les deux langues', () => {
    const project = projectFlags('P1', { 'coupe-sas': true });
    const fr = describeFlags(project, 'fr');
    const en = describeFlags(project, 'en');
    expect(fr).toHaveLength(1);
    expect(en).toHaveLength(1);
    expect(fr[0]).toContain('sas');
    expect(en[0]).toContain('outbound gate');
    expect(fr[0]).not.toContain('reglages.flag');
  });
});
