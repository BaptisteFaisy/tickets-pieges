import { describe, expect, it } from 'vitest';
import { ASSISTANT_KINDS, assistantLabel, normalizeAssistant, obedienceByAssistant } from './assistants';
import type { AssistantLaunch } from './assistants';

function launches(...items: [string, boolean][]): AssistantLaunch[] {
  return items.map(([assistant, obeyed], index) => ({
    assistant,
    canaryId: `can-${index}`,
    obeyed,
  }));
}

describe('normalisation des assistants (#42)', () => {
  it('les noms connus sont repliés vers le canonique, majuscules incluses', () => {
    expect(normalizeAssistant('Atlassian Rovo')).toBe('rovo');
    expect(normalizeAssistant('GitHub Copilot')).toBe('copilot');
    expect(normalizeAssistant('claude via API')).toBe('claude');
    expect(normalizeAssistant('Anthropic')).toBe('claude');
    expect(normalizeAssistant('Gemini Flash')).toBe('gemini');
    expect(normalizeAssistant('chatgpt-4o')).toBe('chatgpt');
  });

  it('un nom inconnu ne devine rien : unknown', () => {
    expect(normalizeAssistant('mon-bot-maison')).toBe('unknown');
    expect(normalizeAssistant('')).toBe('unknown');
  });
});

describe('obéissance par assistant (#42)', () => {
  it('agrège par assistant et classe du plus obéissant au moins obéissant', () => {
    const result = obedienceByAssistant(
      launches(['Rovo', true], ['Rovo', false], ['Claude', true]),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.assistant).toBe('claude');
    expect(result[0]!.rate).toBe(1);
    expect(result[1]!.assistant).toBe('rovo');
    expect(result[1]!.launched).toBe(2);
    expect(result[1]!.obeyed).toBe(1);
    expect(result[1]!.rate).toBe(0.5);
  });

  it('aucun exercice → liste vide', () => {
    expect(obedienceByAssistant([])).toEqual([]);
  });

  it('à taux égal, l’ordre par nom est stable (reproductible)', () => {
    const result = obedienceByAssistant(launches(['Rovo', false], ['Copilot', false]));
    expect(result.map((row) => row.assistant)).toEqual(['copilot', 'rovo']);
  });

  it('chaque assistant a un libellé traduit dans les deux langues', () => {
    for (const kind of ASSISTANT_KINDS) {
      for (const lang of ['fr', 'en'] as const) {
        expect(assistantLabel(lang, kind)).not.toBe(`exposition.assistant.${kind}`);
      }
    }
  });
});
