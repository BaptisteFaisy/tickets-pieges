/**
 * Matrice exigence ↔ module ↔ test — domaine pur (aucune E/S, aucune horloge).
 *
 * Le cahier des charges (§15) liste vingt-huit exigences TP-01 à TP-28. Cette
 * vague les rend **vérifiables** : chaque exigence déclare, dans
 * `data/requirements.json`, les fichiers qui l'implémentent et les tests qui la
 * couvrent, par chemin.
 *
 * Le module fait deux choses, et rien d'autre :
 *  - **valider** le document des exigences (forme, identifiants, doublons) ;
 *  - **contrôler** que chaque chemin cité existe, l'existence étant **injectée**
 *    (un oracle `path -> boolean`) : le domaine ne touche pas le disque.
 *
 * Règle d'honnêteté (§21) : une exigence sans implémentation ou sans test est
 * **signalée** comme un trou, jamais comptée comme couverte. Le tableau porte
 * une colonne « écart » qui dit ce qui reste à faire — y compris les écarts que
 * le document déclare lui-même (`reste`).
 *
 * Le rendu markdown est produit ici aussi : la porte (`tools/check-traceability.mjs`)
 * n'assemble que ce module, aucune règle n'est écrite deux fois.
 */

/** Priorité d'une exigence (§15) : indispensable, souhaitable, après le hackathon. */
export type Priority = 'M' | 'S' | 'C';

/** Une exigence telle que déclarée dans `data/requirements.json`. */
export interface RequirementRef {
  readonly id: string;
  readonly title: string;
  readonly priorite: Priority;
  readonly modules: readonly string[];
  readonly tests: readonly string[];
  /** Écart connu, déclaré : ce qui reste à faire même si tout existe. */
  readonly reste?: string;
}

/** Le document des exigences, complet. */
export interface RequirementsDoc {
  readonly version: number;
  readonly source: string;
  readonly requirements: readonly RequirementRef[];
}

/** Oracle d'existence d'un chemin — injecté, jamais lu sur le disque ici. */
export type PathOracle = (path: string) => boolean;

/** État d'une exigence : `couvert` (module et test existent) ou `trou`. */
export type RequirementStatus = 'couvert' | 'trou';

/** Verdict d'une exigence après contrôle. */
export interface RequirementVerdict {
  readonly id: string;
  readonly title: string;
  readonly priorite: Priority;
  readonly status: RequirementStatus;
  /** Modules cités **et** présents. */
  readonly modules: readonly string[];
  /** Modules cités **absents** du dépôt. */
  readonly missingModules: readonly string[];
  /** Tests cités **et** présents. */
  readonly tests: readonly string[];
  /** Tests cités **absents** du dépôt. */
  readonly missingTests: readonly string[];
  /** Ce qui reste à faire — vide si rien à signaler. */
  readonly ecart: string | null;
  /** Écart déclaré par le document des exigences, s'il y en a un. */
  readonly reste?: string;
}

/** Le rapport complet, calculé à partir du document et d'un oracle. */
export interface TraceabilityReport {
  readonly requirements: readonly RequirementVerdict[];
  readonly covered: number;
  readonly holes: number;
  /** Tous les chemins absents, uniques et triés. */
  readonly missingPaths: readonly string[];
  /** Vrai quand aucune exigence n'est en trou. */
  readonly ok: boolean;
}

/** Identifiants attendus : TP-01 à TP-28, dans l'ordre du cahier. */
export function expectedRequirementIds(count = 28): string[] {
  return Array.from({ length: count }, (_unused, index) => `TP-${String(index + 1).padStart(2, '0')}`);
}

const PRIORITIES: readonly Priority[] = ['M', 'S', 'C'];

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} : liste de chemins attendue (vide ou absente)`);
  }
  return value.map((item, index) => {
    if (!isString(item)) throw new Error(`${label}[${index}] : chemin attendu`);
    return item;
  });
}

/** Valide une exigence et la rend sous sa forme normalisée. */
export function parseRequirement(raw: unknown, index: number): RequirementRef {
  const label = `exigence #${index}`;
  if (typeof raw !== 'object' || raw === null) throw new Error(`${label} : objet attendu`);
  const record = raw as Record<string, unknown>;
  if (!isString(record.id)) throw new Error(`${label} : identifiant manquant`);
  if (!isString(record.title)) throw new Error(`${record.id} : titre manquant`);
  if (!PRIORITIES.includes(record.priorite as Priority)) {
    throw new Error(`${record.id} : priorité attendue (M, S ou C)`);
  }
  const reste = record.reste;
  if (reste !== undefined && !isString(reste)) throw new Error(`${record.id} : « reste » doit être du texte`);
  return {
    id: record.id,
    title: record.title,
    priorite: record.priorite as Priority,
    modules: readStringArray(record.modules, `${record.id}.modules`),
    tests: readStringArray(record.tests, `${record.id}.tests`),
    ...(isString(reste) ? { reste } : {}),
  };
}

/** Valide le document entier : forme, identifiants attendus, pas de doublon. */
export function parseRequirements(raw: unknown): RequirementsDoc {
  if (typeof raw !== 'object' || raw === null) throw new Error('document des exigences : objet attendu');
  const record = raw as Record<string, unknown>;
  if (!Number.isInteger(record.version)) throw new Error('document des exigences : « version » attendue');
  if (!isString(record.source)) throw new Error('document des exigences : « source » attendue');
  if (!Array.isArray(record.requirements)) throw new Error('document des exigences : « requirements » attendu');
  const requirements = record.requirements.map(parseRequirement);
  const ids = requirements.map((requirement) => requirement.id);
  const duplicates = ids.filter((id, position) => ids.indexOf(id) !== position);
  if (duplicates.length > 0) throw new Error(`identifiants en double : ${[...new Set(duplicates)].join(', ')}`);
  const expected = expectedRequirementIds(requirements.length);
  const missing = expected.filter((id) => !ids.includes(id));
  if (missing.length > 0) throw new Error(`exigences manquantes : ${missing.join(', ')}`);
  return { version: record.version as number, source: record.source, requirements };
}

/** Ce qu'il faut pour décrire un trou — le verdict et le document des exigences. */
export interface GapView {
  readonly modules: readonly string[];
  readonly tests: readonly string[];
  readonly missingModules: readonly string[];
  readonly missingTests: readonly string[];
  readonly reste?: string;
}

/** Décrit un trou en une phrase courte (français). */
export function describeGap(view: GapView): string {
  const parts: string[] = [];
  if (view.missingModules.length > 0) {
    parts.push(`module(s) absent(s) : ${view.missingModules.join(', ')}`);
  }
  if (view.missingTests.length > 0) {
    parts.push(`test(s) absent(s) : ${view.missingTests.join(', ')}`);
  }
  if (parts.length === 0 && view.modules.length === 0) parts.push('aucun module cité');
  if (parts.length === 0 && view.tests.length === 0) parts.push('aucun test cité');
  if (view.reste) parts.push(view.reste);
  return parts.join(' ; ');
}

/** Contrôle une exigence contre l'oracle d'existence. */
export function verifyRequirement(requirement: RequirementRef, exists: PathOracle): RequirementVerdict {
  const modules = requirement.modules.filter(exists);
  const tests = requirement.tests.filter(exists);
  const missingModules = requirement.modules.filter((path) => !exists(path));
  const missingTests = requirement.tests.filter((path) => !exists(path));
  const status: RequirementStatus = missingModules.length > 0 || missingTests.length > 0 ? 'trou' : 'couvert';
  const base = {
    id: requirement.id,
    title: requirement.title,
    priorite: requirement.priorite,
    status,
    modules,
    missingModules,
    tests,
    missingTests,
    ...(requirement.reste ? { reste: requirement.reste } : {}),
  };
  const ecart = status === 'trou' || requirement.reste ? describeGap(base) : null;
  return { ...base, ecart };
}

/** Contrôle tout le document et rend le rapport. */
export function checkTraceability(doc: RequirementsDoc, exists: PathOracle): TraceabilityReport {
  const requirements = doc.requirements.map((requirement) => verifyRequirement(requirement, exists));
  const missingPaths = [
    ...new Set(requirements.flatMap((verdict) => [...verdict.missingModules, ...verdict.missingTests])),
  ].sort();
  const holes = requirements.filter((verdict) => verdict.status === 'trou').length;
  return {
    requirements,
    covered: requirements.length - holes,
    holes,
    missingPaths,
    ok: holes === 0,
  };
}

/** Une ligne de tableau markdown, sans accents exotiques ni `|` dans le texte. */
export function renderRow(verdict: RequirementVerdict): string {
  const cell = (items: readonly string[]): string => (items.length > 0 ? items.map((item) => `\`${item}\``).join('<br>') : '—');
  const ecart = verdict.ecart ?? '—';
  return `| ${verdict.id} | ${verdict.title} | ${verdict.priorite} | ${cell(verdict.modules)} | ${cell(verdict.tests)} | ${ecart} |`;
}

/** Entête du tableau markdown — le même partout, écrit une fois. */
export const TABLE_HEADER = [
  '| Exigence | Titre | Prio | Modules | Tests | Écart |',
  '|---|---|---|---|---|---|',
].join('\n');

/** Le tableau markdown complet du rapport. */
export function renderMarkdownTable(report: TraceabilityReport): string {
  return [TABLE_HEADER, ...report.requirements.map(renderRow)].join('\n');
}

/** Le rapport console : les trous d'abord, le compte ensuite. */
export function formatGapReport(report: TraceabilityReport): string {
  const lines: string[] = [];
  const holes = report.requirements.filter((verdict) => verdict.status === 'trou');
  if (holes.length === 0) {
    lines.push('Aucun trou : chaque exigence a un module et un test existants.');
  } else {
    lines.push(`${holes.length} exigence(s) en trou :`);
    for (const hole of holes) lines.push(`  - ${hole.id} : ${hole.ecart ?? 'écart non décrit'}`);
  }
  lines.push(`${report.covered}/${report.requirements.length} exigences couvertes.`);
  return lines.join('\n');
}
