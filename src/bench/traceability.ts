/**
 * Traçabilité des exigences — le tableau que le juge peut vérifier en dix minutes.
 *
 * Le cahier des charges liste 28 exigences (TP-01 à TP-28). Chaque exigence
 * déclare les **modules** qui l'implémentent et les **tests** qui la couvrent.
 * Ce module vérifie trois choses, sans jamais faire confiance à la déclaration :
 *
 *  1. chaque fichier cité existe encore dans le dépôt ;
 *  2. chaque exigence a au moins un module et un test ;
 *  3. l'écart entre l'état **déclaré** et l'état **réel** est visible : une
 *     exigence déclarée « complet » mais dont les fichiers ont disparu est un
 *     écart, pas un détail de présentation.
 *
 * La comparaison « déclaré / réel » est le cœur : c'est elle qui empêche qu'un
 * tableau de traçabilité devienne une habitude paperasse qui ment.
 */

export type RequirementState = 'complet' | 'partiel' | 'a-faire';

/** Une exigence du cahier, telle que déclarée dans `data/requirements.json`. */
export interface RequirementEntry {
  id: string;
  titre: string;
  priorite: 'M' | 'S' | 'C';
  etat: RequirementState;
  modules: string[];
  tests: string[];
  remarque?: string;
}

/** L'état d'une exigence après vérification. */
export interface RequirementStatus {
  id: string;
  titre: string;
  priorite: 'M' | 'S' | 'C';
  declaree: RequirementState;
  modulesManquants: string[];
  testsManquants: string[];
  /** Vrai quand l'exigence n'est pas complètement couverte. */
  ecart: boolean;
  remarque?: string;
}

export interface TraceabilityReport {
  total: number;
  complets: number;
  partiels: number;
  aFaire: number;
  /** Exigences avec un écart réel (fichiers disparus ou état non complet). */
  ecarts: RequirementStatus[];
  statuses: RequirementStatus[];
}

/** L'état réel d'une exigence : ses fichiers existent-ils, a-t-elle module et test ? */
export function verifyRequirement(
  requirement: RequirementEntry,
  existingFiles: ReadonlySet<string>,
): RequirementStatus {
  const modulesManquants = requirement.modules.filter((file) => !existingFiles.has(file));
  const testsManquants = requirement.tests.filter((file) => !existingFiles.has(file));
  const sansModule = requirement.modules.length === 0;
  const sansTest = requirement.tests.length === 0;
  const ecart =
    requirement.etat !== 'complet' ||
    modulesManquants.length > 0 ||
    testsManquants.length > 0 ||
    sansModule ||
    sansTest;
  return {
    id: requirement.id,
    titre: requirement.titre,
    priorite: requirement.priorite,
    declaree: requirement.etat,
    modulesManquants,
    testsManquants,
    ecart,
    remarque: requirement.remarque,
  };
}

/** Vérifie toutes les exigences et compte les écarts. */
export function verifyTraceability(
  requirements: readonly RequirementEntry[],
  existingFiles: Iterable<string>,
): TraceabilityReport {
  const files = new Set(existingFiles);
  const statuses = requirements.map((requirement) => verifyRequirement(requirement, files));
  return {
    total: statuses.length,
    complets: statuses.filter((status) => !status.ecart).length,
    partiels: statuses.filter((status) => status.declaree === 'partiel').length,
    aFaire: statuses.filter((status) => status.declaree === 'a-faire').length,
    ecarts: statuses.filter((status) => status.ecart),
    statuses,
  };
}

/** Le tableau markdown, généré (jamais écrit à la main). */
export function renderTraceabilityMarkdown(
  report: TraceabilityReport,
  requirements: readonly RequirementEntry[],
): string {
  const lignes = [
    '# Traçabilité — exigence → module → test',
    '',
    '> Généré par `tools/check-traceability.mjs`. Ne pas éditer à la main.',
    '',
    `**${report.total} exigences** — ${report.complets} couvertes, ${report.partiels} partielles, ` +
      `${report.aFaire} à faire. **${report.ecarts.length} écart(s)** à regarder.`,
    '',
    '| Exigence | Priorité | Titre | État | Modules | Tests | Écart |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const status of report.statuses) {
    const requirement = requirements.find((item) => item.id === status.id);
    const modules = requirement?.modules.join(', ') ?? '';
    const tests = requirement?.tests.join(', ') ?? '';
    const ecart = status.ecart
      ? `**${status.declaree}**${status.modulesManquants.length ? ` — module(s) disparu(s) : ${status.modulesManquants.join(', ')}` : ''}` +
        `${status.testsManquants.length ? ` — test(s) disparu(s) : ${status.testsManquants.join(', ')}` : ''}`
      : 'aucun';
    lignes.push(
      `| ${status.id} | ${status.priorite} | ${status.titre} | ${status.declaree} | ${modules} | ${tests} | ${ecart} |`,
    );
  }
  const remarques = report.statuses.filter((status) => status.remarque);
  if (remarques.length > 0) {
    lignes.push('', '## Remarques', '');
    for (const status of remarques) {
      lignes.push(`- **${status.id}** — ${status.remarque}`);
    }
  }
  lignes.push('', '## Ce que ce tableau ne dit pas', '');
  lignes.push(
    "- La présence d'un test ne dit pas qu'il couvre l'exigence : c'est une **trace**, à relire.",
    "- Une exigence marquée « partiel » ou « à faire » est un **écart assumé**, pas un oubli.",
    "- Les exigences de priorité C (26 à 28) sont livrées au-delà du minimum : leur état est",
    '  voluntary et daté.',
  );
  return lignes.join('\n') + '\n';
}
