import { defineConfig } from 'vitest/config';

// Les tests vivent à côté du code (`src/**/*.test.ts`). Aucun test ne touche
// le réseau : le domaine est pur, la plateforme est remplacée par
// `src/platform/memory.ts`, et le jeu d'essai (`src/sample/`) est local.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['dot'],
  },
});
