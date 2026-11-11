/**
 * Adaptateur Forge du modèle hébergé (§6, §18 : « rien ne sort »).
 *
 * Aucune clé d'API ici : `@forge/llm` authentifie l'app côté plateforme. Le
 * modèle est résolu à l'exécution par `list()` (Claude en priorité) — jamais
 * codé en dur, il change selon l'installation (`docs/FORGE.md` §4).
 *
 * Ce fichier importe `@forge/llm` : il n'est donc **jamais** importé par un test.
 * La partie pure (normalisation de la réponse, construction du port) vit dans
 * `src/platform/llm-content.ts`.
 *
 * Seule la couche C3 s'en sert, et elle n'envoie que le passage encadré : aucun
 * outil, aucune donnée d'un autre ticket, aucun contexte (§6, précaution 1).
 */

import { chat, list } from '@forge/llm';
import type { ModelPort } from './schema';
import { createModelPort, textOfContent, type ModelInvoker } from './llm-content';

/** Le manifeste déclare `llm: { model: [claude] }` : on cherche Claude d'abord. */
const MODEL_HINTS: readonly string[] = ['claude', 'anthropic'];
const FALLBACK_MODEL = 'claude';

/** Température nulle : le même texte doit donner le même verdict. */
const TEMPERATURE = 0;

/** Modèle résolu une fois par invocation de fonction Forge. */
let resolvedModel: string | null = null;

/** Nom du modèle à utiliser, lu dans le catalogue de l'installation. */
async function resolveModel(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  try {
    const catalog = await list();
    const active = catalog.models.filter((entry) => entry.status === 'active');
    const wanted = active.find((entry) =>
      MODEL_HINTS.some((hint) => entry.model.toLowerCase().includes(hint)),
    );
    resolvedModel = wanted?.model ?? active[0]?.model ?? FALLBACK_MODEL;
  } catch {
    resolvedModel = FALLBACK_MODEL;
  }
  return resolvedModel;
}

/**
 * Appel réel : le prompt entier est envoyé comme message utilisateur, la réponse
 * est normalisée par `textOfContent` (chaîne ou blocs). Une erreur remonte : le
 * domaine (`classifyPassage`) la traduit en « C1/C2 seules », jamais en « sain ».
 */
export const forgeInvoker: ModelInvoker = async (prompt: string, maxTokens: number) => {
  const model = await resolveModel();
  const response = await chat({
    model,
    temperature: TEMPERATURE,
    max_completion_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const first = response.choices?.[0];
  return textOfContent(first ? first.message?.content : '');
};

/** Le port utilisé par la couche C3 en production. */
export function forgeModelPort(maxTokens = 800): ModelPort {
  return createModelPort(forgeInvoker, maxTokens);
}

export { createModelPort, textOfContent };
