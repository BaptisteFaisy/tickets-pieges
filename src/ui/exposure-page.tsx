/**
 * Page « Exposition » — squelette posé par le tronc, implémenté par le lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.5.
 */
import ForgeReconciler from '@forge/react';
import { Text } from '@forge/react';

export default function ExposurePage(): JSX.Element {
  return <Text>Page « Exposition » — écran à venir (lot UI).</Text>;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<ExposurePage />);
}
