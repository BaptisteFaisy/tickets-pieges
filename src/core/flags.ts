/**
 * Drapeaux fonctionnels par projet (#89) — lot auto-reglages.
 *
 * Domaine pur : aucun import `@forge/*`, aucune E/S, aucune lecture de
 * l'heure (l'horodatage est passé en paramètre). Tout changement de réglage
 * produit une entrée de journal que l'appelant persiste — « toujours
 * journalisé » est une propriété du modèle, pas de la plateforme.
 *
 * Un drapeau coupe exactement ce qu'il annonce : `flagEffect` associe chaque
 * drapeau à un unique bouton du pipeline, et `applyFlags` ne modifie jamais
 * les autres boutons.
 */
import type { Language } from './types';
import { t } from './i18n';

/** Les quatre drapeaux de #89 : couper C3, forcer `report`, désactiver le sas, basculer en shadow. */
export type FlagName = 'coupe-c3' | 'force-report' | 'coupe-sas' | 'mode-shadow';

export const FLAG_NAMES: readonly FlagName[] = [
  'coupe-c3',
  'force-report',
  'coupe-sas',
  'mode-shadow',
];

export type FlagState = Record<FlagName, boolean>;

export interface ProjectFlags {
  projectId: string;
  flags: FlagState;
}

export interface FlagChangeContext {
  /** Identifiant du compte qui opère le changement. */
  actor: string;
  /** Horodatage ISO fourni par l'appelant (le domaine ne lit jamais l'heure). */
  at: string;
  /** Motif du changement — obligatoire, il figure dans le journal. */
  reason: string;
}

export interface FlagJournalEntry {
  kind: 'flag-change';
  projectId: string;
  flag: FlagName;
  before: boolean;
  after: boolean;
  actor: string;
  at: string;
  reason: string;
}

/** Boutons du pipeline sur lesquels les drapeaux agissent — rien d'autre. */
export interface PipelineKnobs {
  c3Enabled: boolean;
  sasEnabled: boolean;
  forcedReport: boolean;
  shadow: boolean;
}

export const BASE_KNOBS: PipelineKnobs = {
  c3Enabled: true,
  sasEnabled: true,
  forcedReport: false,
  shadow: false,
};

/** Chaque drapeau pilote exactement un bouton : ce qu'il annonce, pas plus. */
const FLAG_EFFECTS: Record<FlagName, keyof PipelineKnobs> = {
  'coupe-c3': 'c3Enabled',
  'force-report': 'forcedReport',
  'coupe-sas': 'sasEnabled',
  'mode-shadow': 'shadow',
};

/** Drapeaux qui coupent leur bouton (les autres le mettent à vrai). */
const DISABLES: readonly FlagName[] = ['coupe-c3', 'coupe-sas'];

/** État par défaut : aucun drapeau actif, le pipeline tourne complet. */
export function defaultFlagState(): FlagState {
  return { 'coupe-c3': false, 'force-report': false, 'coupe-sas': false, 'mode-shadow': false };
}

/** Construit les drapeaux d'un projet, tous éteints sauf ceux fournis. */
export function projectFlags(projectId: string, partial: Partial<FlagState> = {}): ProjectFlags {
  return { projectId, flags: { ...defaultFlagState(), ...partial } };
}

export function isFlagEnabled(project: ProjectFlags, flag: FlagName): boolean {
  return project.flags[flag] === true;
}

/** Le bouton piloté par un drapeau — utile pour vérifier l'effet annoncé. */
export function flagEffect(flag: FlagName): keyof PipelineKnobs {
  return FLAG_EFFECTS[flag];
}

export function enabledFlags(project: ProjectFlags): FlagName[] {
  return FLAG_NAMES.filter((flag) => project.flags[flag]);
}

/**
 * Change un drapeau. Rend le nouvel état et l'entrée de journal à persister.
 * Sans changement réel, l'état est rendu tel quel et `entry` vaut `null`
 * (le journal ne se remplit que des changements effectifs). Ne jette jamais.
 */
export function setFlag(
  project: ProjectFlags,
  flag: FlagName,
  enabled: boolean,
  ctx: FlagChangeContext,
): { project: ProjectFlags; entry: FlagJournalEntry | null } {
  const before = project.flags[flag] === true;
  if (before === enabled) {
    return { project, entry: null };
  }
  const flags: FlagState = { ...project.flags, [flag]: enabled };
  const entry: FlagJournalEntry = {
    kind: 'flag-change',
    projectId: project.projectId,
    flag,
    before,
    after: enabled,
    actor: ctx.actor,
    at: ctx.at,
    reason: ctx.reason,
  };
  return { project: { projectId: project.projectId, flags }, entry };
}

/**
 * Applique les drapeaux actifs aux boutons du pipeline. Chaque drapeau ne
 * touche que son propre bouton : couper C3 laisse le sas intact, et ainsi de
 * suite. L'entrée n'est jamais modifiée (copie).
 */
export function applyFlags(knobs: PipelineKnobs, project: ProjectFlags): PipelineKnobs {
  const next: PipelineKnobs = { ...knobs };
  for (const flag of FLAG_NAMES) {
    if (!project.flags[flag]) {
      continue;
    }
    const knob = FLAG_EFFECTS[flag];
    next[knob] = DISABLES.indexOf(flag) < 0;
  }
  return next;
}

/** Libellés visibles des drapeaux actifs (catalogue `reglages`, fr/en). */
export function describeFlags(project: ProjectFlags, lang: Language): string[] {
  return enabledFlags(project).map((flag) => t(lang, 'reglages.flag.' + flag));
}
