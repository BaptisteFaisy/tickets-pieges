import { describe, expect, it } from 'vitest';
import { createModelPort, textOfContent } from './llm-content';

describe('normalisation de la réponse du modèle (docs/FORGE.md §4)', () => {
  it('accepte une chaîne simple', () => {
    expect(textOfContent('{"verdict":"benign"}')).toBe('{"verdict":"benign"}');
  });

  it('accepte des blocs, et les recolle', () => {
    const blocks = [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }];
    expect(textOfContent(blocks)).toBe('{"a":1}');
  });

  it('ignore un bloc sans texte et une forme inconnue', () => {
    expect(textOfContent([{ type: 'tool_use', id: 'x' }])).toBe('');
    expect(textOfContent(undefined)).toBe('');
    expect(textOfContent(42)).toBe('');
  });

  it('déballe une réponse enveloppée', () => {
    expect(textOfContent({ content: [{ type: 'text', text: 'ok' }] })).toBe('ok');
  });
});

describe('port du modèle', () => {
  it('rend du texte quelle que soit la forme de la réponse', async () => {
    const port = createModelPort(async () => [{ type: 'text', text: 'réponse' }]);
    expect(await port.classify('prompt')).toBe('réponse');
  });

  it('transmet le prompt et le budget de jetons', async () => {
    let seen = '';
    let tokens = 0;
    const port = createModelPort(async (prompt, maxTokens) => {
      seen = prompt;
      tokens = maxTokens;
      return 'ok';
    }, 250);
    await port.classify('mon prompt');
    expect(seen).toBe('mon prompt');
    expect(tokens).toBe(250);
  });

  it('laisse remonter l’erreur d’appel : c’est le domaine qui décide', async () => {
    const port = createModelPort(async () => {
      throw new Error('quota');
    });
    await expect(port.classify('x')).rejects.toThrow('quota');
  });
});
