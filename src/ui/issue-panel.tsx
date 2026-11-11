/**
 * Bandeau et panneau du ticket — squelette posé par le tronc, implémenté par le lot UI.
 * Référence : docs/CAHIER-DES-CHARGES.md §17.1.
 */
import ForgeReconciler from '@forge/react';
import { Text } from '@forge/react';

export default function IssuePanel(): JSX.Element {
  return <Text>Bandeau et panneau du ticket — écran à venir (lot UI).</Text>;
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  ForgeReconciler.render(<IssuePanel />);
}
