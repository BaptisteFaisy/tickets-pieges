/**
 * Banc d'essai — squelette posé par le tronc, implémenté par le lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.7.
 */
import ForgeReconciler from '@forge/react';
import { Text } from '@forge/react';

export default function PlaygroundPage(): JSX.Element {
  return <Text>Banc d'essai — écran à venir (lot UI).</Text>;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<PlaygroundPage />);
}
