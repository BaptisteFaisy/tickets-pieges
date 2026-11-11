/**
 * Page globale à trois routes (§17.5, §17.6, §17.7) — squelette, lot UI.
 *
 * Forge n'accepte qu'une entrée `jira:globalPage` par app : les trois pages
 * (Exposition, Originaux conservés, Banc d'essai) sont des routes d'un même
 * module, et c'est cet écran qui aiguille.
 */
import ForgeReconciler from '@forge/react';
import ExposurePage from './exposure-page';
import OriginalsPage from './originals-page';
import PlaygroundPage from './playground-page';

/** Route demandée, lue dans l'URL du navigateur (posée par le lot UI). */
function currentRoute(): string {
  if (typeof (globalThis as { window?: { location?: { pathname?: string } } }).window === 'undefined') {
    return 'exposition';
  }
  const path = globalThis.window?.location?.pathname ?? '';
  if (path.includes('originaux')) return 'originaux';
  if (path.includes('banc')) return 'banc';
  return 'exposition';
}

export default function GlobalPages(): JSX.Element {
  const route = currentRoute();
  if (route === 'originaux') return <OriginalsPage />;
  if (route === 'banc') return <PlaygroundPage />;
  return <ExposurePage />;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<GlobalPages />);
}
