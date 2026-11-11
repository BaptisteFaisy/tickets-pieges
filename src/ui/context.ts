import { view } from '@forge/bridge';
import { useEffect, useState } from 'react';
import { languageOf } from './format';
import type { Language } from '../core/types';

/**
 * Contexte Forge d'un écran — solution reprise de l'app sœur `laddition`
 * (déployée) : lecture sans jamais jeter, un champ manquant devient vide.
 */
export type ScreenContext = {
  projectId: string;
  projectKey: string;
  issueId: string | null;
  issueKey: string | null;
  /** Route de la page globale (`exposition`, `originaux`, `banc`) ou null. */
  route: string | null;
  language: Language;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Extrait le contexte sans jamais jeter : un champ manquant devient vide. */
export function readContext(raw: unknown): ScreenContext {
  const root = isRecord(raw) ? raw : {};
  const extension = isRecord(root['extension']) ? root['extension'] : {};
  const project = isRecord(extension['project']) ? extension['project'] : {};
  const issue = isRecord(extension['issue']) ? extension['issue'] : {};
  const locale = typeof root['locale'] === 'string' ? root['locale'] : null;
  return {
    projectId: textOf(project['id']),
    projectKey: textOf(project['key']),
    issueId: textOf(issue['id']) || null,
    issueKey: textOf(issue['key']) || null,
    route: textOf(root['route']) || null,
    language: languageOf(locale),
  };
}

/** État de chargement d'un écran : jamais d'exception affichée (§17). */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

/** Contexte de l'écran courant, avec ses états de chargement et d'erreur. */
export function useScreenContext(): AsyncState<ScreenContext> {
  const [state, setState] = useState<AsyncState<ScreenContext>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await view.getContext();
        if (!cancelled) setState({ status: 'ready', data: readContext(raw) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) setState({ status: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
