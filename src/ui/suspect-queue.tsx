/**
 * File « Suspects » — squelette posé par le tronc, implémenté par le lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.2.
 */
import ForgeReconciler from '@forge/react';
import { Text } from '@forge/react';

export default function SuspectQueue(): JSX.Element {
  return <Text>File « Suspects » — écran à venir (lot UI).</Text>;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<SuspectQueue />);
}
