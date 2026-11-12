/**
 * Corpus étiqueté du banc de détection (#15, #95) — domaine pur.
 *
 * Le corpus est la matière première des métriques (`metrics.ts`), du fuzzing
 * (`fuzz.ts`) et du mode shadow (`shadow.ts`). Il est stocké en JSON dans
 * `data/corpus/*.json` ; ce module ne fait **aucune** E/S : il décrit le format,
 * le valide et le manipule. L'honnêteté (§21) s'applique aussi ici : une entrée
 * dont l'étiquette ou la langue est douteuse est signalée, jamais ignorée.
 *
 * Deux étiquettes seulement :
 * - `attack`      : texte qui porte une tentative (charge) — doit être relevé ;
 * - `legitimate`  : texte de support ordinaire — ne doit **rien** déclencher.
 *
 * Un `scenario` (#95, « Cato 2025 ») regroupe plusieurs segments rejouables dans
 * l'ordre : la campagne réelle était multi-messages, le corpus la conserve telle
 * quelle, segment par segment, avec l'étape attendue.
 */

import type { Language } from '../core/types';

/** Étiquette attendue d'une entrée du corpus. */
export type ExpectedLabel = 'attack' | 'legitimate';

export const EXPECTED_LABELS: readonly ExpectedLabel[] = ['attack', 'legitimate'];

/** Taille minimale du corpus publié (brief lot benchmark). */
export const MIN_CORPUS_ENTRIES = 120;

/** Familles de charges — servent au regroupement des métriques. */
export type AttackFamily =
  | 'role-switch'
  | 'system-marker'
  | 'tool-command'
  | 'exfiltration'
  | 'concealment'
  | 'encoded'
  | 'pressure'
  | 'detector-attack'
  | 'scenario';

export const ATTACK_FAMILIES: readonly AttackFamily[] = [
  'role-switch',
  'system-marker',
  'tool-command',
  'exfiltration',
  'concealment',
  'encoded',
  'pressure',
  'detector-attack',
  'scenario',
];

/** Une entrée du corpus : texte + ce qu'on en attend. */
export interface CorpusEntry {
  /** Identifiant stable et unique (`atk-fr-001`, `leg-en-014`, `cato-03`…). */
  readonly id: string;
  readonly lang: Language;
  readonly label: ExpectedLabel;
  readonly text: string;
  /** Famille de la charge (obligatoire pour `attack`, absent pour `legitimate`). */
  readonly family?: AttackFamily;
  /** `ruleId` attendus : si présents, la détection doit en toucher au moins un. */
  readonly expectedRuleIds?: readonly string[];
  /** Identifiant de scénario (#95) et rang du segment dans ce scénario. */
  readonly scenario?: string;
  readonly scenarioStep?: number;
  /** Provenance : `cato-2025`, `support`, `synthetic`… jamais une donnée client. */
  readonly source?: string;
  /** Note courte expliquant pourquoi c'est une charge (ou pourquoi ça ne l'est pas). */
  readonly note?: string;
}

/** Un fichier de corpus (`data/corpus/<nom>.json`). */
export interface CorpusFile {
  readonly name: string;
  readonly version: number;
  readonly entries: readonly CorpusEntry[];
}

/** Anomalie de validation : le corpus publié doit en être exempt. */
export interface CorpusIssue {
  readonly entryId: string;
  readonly file: string;
  readonly code: 'duplicate-id' | 'bad-lang' | 'bad-label' | 'empty-text' | 'missing-family' | 'bad-scenario' | 'oversized';
  readonly detail: string;
}

/** Longueur maximale d'un segment du corpus (au-delà : c'est un ticket, pas un test). */
export const MAX_ENTRY_CHARS = 4000;

export function isAttack(entry: CorpusEntry): boolean {
  return entry.label === 'attack';
}

export function attackEntries(entries: readonly CorpusEntry[]): CorpusEntry[] {
  return entries.filter(isAttack);
}

export function legitimateEntries(entries: readonly CorpusEntry[]): CorpusEntry[] {
  return entries.filter((entry) => entry.label === 'legitimate');
}

export function byLanguage(entries: readonly CorpusEntry[], lang: Language): CorpusEntry[] {
  return entries.filter((entry) => entry.lang === lang);
}

/** Regroupe les entrées par famille ; `legitimate` forme la famille `none`. */
export function groupByFamily(entries: readonly CorpusEntry[]): Record<string, CorpusEntry[]> {
  const groups: Record<string, CorpusEntry[]> = {};
  for (const entry of entries) {
    const key = entry.family ?? 'none';
    const bucket = groups[key];
    if (bucket) bucket.push(entry);
    else groups[key] = [entry];
  }
  return groups;
}

/** Segments d'un scénario, dans l'ordre de rejeu (#95). */
export function scenarioSteps(entries: readonly CorpusEntry[], scenario: string): CorpusEntry[] {
  return entries
    .filter((entry) => entry.scenario === scenario)
    .slice()
    .sort((a, b) => (a.scenarioStep ?? 0) - (b.scenarioStep ?? 0));
}

export function scenarioNames(entries: readonly CorpusEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) if (entry.scenario) names.add(entry.scenario);
  return Array.from(names).sort();
}

function entryIssues(entry: CorpusEntry, file: string, seen: Set<string>): CorpusIssue[] {
  const issues: CorpusIssue[] = [];
  const push = (code: CorpusIssue['code'], detail: string): void => {
    issues.push({ entryId: entry.id, file, code, detail });
  };
  if (!entry.id || seen.has(entry.id)) push('duplicate-id', `identifiant absent ou déjà vu : « ${entry.id} »`);
  seen.add(entry.id);
  if (entry.lang !== 'fr' && entry.lang !== 'en') push('bad-lang', `langue inattendue : « ${String(entry.lang)} »`);
  if (!EXPECTED_LABELS.includes(entry.label)) push('bad-label', `étiquette inattendue : « ${String(entry.label)} »`);
  if (typeof entry.text !== 'string' || entry.text.trim().length === 0) push('empty-text', 'texte vide');
  else if (entry.text.length > MAX_ENTRY_CHARS) push('oversized', `${entry.text.length} caractères`);
  if (entry.label === 'attack' && !entry.family) push('missing-family', 'charge sans famille');
  if ((entry.scenario === undefined) !== (entry.scenarioStep === undefined)) {
    push('bad-scenario', 'scenario et scenarioStep doivent être présents ensemble');
  }
  return issues;
}

/** Valide un fichier de corpus ; rend la liste (vide = conforme). */
export function validateCorpusFile(file: CorpusFile): CorpusIssue[] {
  const seen = new Set<string>();
  const issues: CorpusIssue[] = [];
  for (const entry of file.entries) issues.push(...entryIssues(entry, file.name, seen));
  return issues;
}

/** Valide plusieurs fichiers ensemble (les doublons inter-fichiers comptent). */
export function validateCorpus(files: readonly CorpusFile[]): CorpusIssue[] {
  const seen = new Set<string>();
  const issues: CorpusIssue[] = [];
  for (const file of files) for (const entry of file.entries) issues.push(...entryIssues(entry, file.name, seen));
  return issues;
}

/** Fusionne les fichiers en un corpus unique, trié par identifiant (reproductible). */
export function mergeCorpus(files: readonly CorpusFile[]): CorpusEntry[] {
  const all: CorpusEntry[] = [];
  for (const file of files) all.push(...file.entries);
  return all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Comptes bruts du corpus — ce que le rapport affiche en tête. */
export interface CorpusStats {
  readonly total: number;
  readonly attacks: number;
  readonly legitimate: number;
  readonly byLang: Record<Language, number>;
  readonly byFamily: Record<string, number>;
  readonly scenarios: number;
}

export function corpusStats(entries: readonly CorpusEntry[]): CorpusStats {
  const byLang: Record<Language, number> = { fr: 0, en: 0 };
  const byFamily: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.lang === 'fr' || entry.lang === 'en') byLang[entry.lang] = (byLang[entry.lang] ?? 0) + 1;
    const key = entry.family ?? 'none';
    byFamily[key] = (byFamily[key] ?? 0) + 1;
  }
  const families = Object.keys(byFamily).sort();
  const ordered: Record<string, number> = {};
  for (const key of families) {
    const count = byFamily[key];
    if (count !== undefined) ordered[key] = count;
  }
  return {
    total: entries.length,
    attacks: attackEntries(entries).length,
    legitimate: legitimateEntries(entries).length,
    byLang,
    byFamily: ordered,
    scenarios: scenarioNames(entries).length,
  };
}

/** Le corpus est-il assez riche pour être publié ? (brief : ≥ 120 entrées) */
export function isPublishable(entries: readonly CorpusEntry[]): boolean {
  return entries.length >= MIN_CORPUS_ENTRIES && validateCorpus([
    { name: 'merged', version: 1, entries },
  ]).length === 0;
}

/**
 * Sélectionne un sous-corpus déterministe (échantillonnage sans aléa :
 * un pas fixe à partir d'une graine). Sert aux runs rapides en CI.
 */
export function sampleCorpus(entries: readonly CorpusEntry[], size: number, seed: number = 0): CorpusEntry[] {
  if (size <= 0 || entries.length === 0) return [];
  if (size >= entries.length) return entries.slice();
  const offset = ((seed % entries.length) + entries.length) % entries.length;
  const picked: CorpusEntry[] = [];
  const step = entries.length / size;
  for (let i = 0; i < size; i += 1) {
    const index = (offset + Math.floor(i * step)) % entries.length;
    const pickedEntry = entries[index];
    if (pickedEntry) picked.push(pickedEntry);
  }
  return picked;
}
