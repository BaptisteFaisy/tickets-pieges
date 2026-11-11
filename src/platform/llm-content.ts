/**
 * Normalisation de la réponse d'un modèle — partie **pure** de l'adaptateur.
 *
 * Séparée de `src/platform/llm.ts` pour une raison mesurée : importer `@forge/llm`
 * hors du runtime Forge lève une erreur (`__getRuntime`), donc tout fichier qui
 * l'importe est impossible à tester. Ici, rien de Forge : la normalisation et la
 * construction du port se testent sans réseau.
 *
 * Pourquoi c'est nécessaire (`docs/FORGE.md` §4) : un vrai modèle renvoie
 * `content` en **blocs** `[{ type: 'text', text }]` et pas seulement en chaîne ;
 * un code qui ne gère que la chaîne lit du vide et jette une réponse juste.
 */

import type { ModelPort } from './schema';

/** Ce que l'appel au modèle rend : une chaîne, des blocs, ou autre chose. */
export type RawContent = unknown;

/**
 * Texte d'une réponse de modèle, quelle que soit sa forme. Un bloc sans texte,
 * une forme inconnue ou une valeur absente rendent une chaîne vide — jamais une
 * exception : c'est le domaine qui décide quoi faire d'une réponse inutilisable
 * (§6 : une réponse non conforme vaut « suspect »).
 */
export function textOfContent(content: RawContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(textOfBlock).join('');
  }
  if (content && typeof content === 'object') {
    const nested = (content as { content?: unknown }).content;
    if (nested !== undefined && nested !== content) return textOfContent(nested);
  }
  return '';
}

/** Texte d'un bloc : chaîne, partie `text`, ou rien. */
function textOfBlock(block: unknown): string {
  if (typeof block === 'string') return block;
  if (block && typeof block === 'object') {
    const text = (block as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** Fonction d'appel du modèle : injectée en test, réelle en production. */
export type ModelInvoker = (prompt: string, maxTokens: number) => Promise<RawContent>;

/** Construit un `ModelPort` à partir d'une fonction d'appel (testable sans réseau). */
export function createModelPort(invoke: ModelInvoker, maxTokens = 800): ModelPort {
  return {
    async classify(prompt: string): Promise<string> {
      return textOfContent(await invoke(prompt, maxTokens));
    },
  };
}
