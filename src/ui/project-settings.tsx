/**
 * Réglages du projet — squelette posé par le tronc, implémenté par le lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.4.
 */
import ForgeReconciler from '@forge/react';
import { Text } from '@forge/react';

export default function ProjectSettings(): JSX.Element {
  return <Text>Réglages du projet — écran à venir (lot UI).</Text>;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<ProjectSettings />);
}
