/**
 * Section « tuning », bloc « drapeaux par projet » (#89) — `src/core/flags.ts`.
 *
 * Les quatre drapeaux fonctionnels (couper C3, forcer `report`, désactiver le
 * sas, mode shadow) sont basculables dans la page ; chaque changement passe par
 * `setFlag` (journal obligatoire avec motif) et l'effet sur les boutons du
 * pipeline est rendu immédiatement via `applyFlags`. Aucune logique recopiée :
 * le domaine décide, ce fichier ne fait qu'afficher.
 */

import { t } from '../../core/i18n';
import type { Language } from '../../core/types';
import {
  BASE_KNOBS,
  FLAG_NAMES,
  applyFlags,
  describeFlags,
  projectFlags,
  setFlag,
  type FlagChangeContext,
  type FlagJournalEntry,
  type FlagName,
  type PipelineKnobs,
  type ProjectFlags,
} from '../../core/flags';
import { byId, esc, heading, kv, list, note, panel, table } from '../dom';
import type { SectionContext } from './types';

const L = {
  title: { fr: 'Drapeaux par projet (#89)', en: 'Per-project flags (#89)' },
  intro: {
    fr: 'Chaque drapeau coupe exactement ce qu’il annonce — rien d’autre — et tout changement est journalisé avec son motif. L’effet sur les boutons du pipeline est immédiat.',
    en: 'Each flag disables exactly what it announces — nothing else — and every change is journaled with its reason. The effect on the pipeline knobs is immediate.',
  },
  none: { fr: 'Aucun drapeau actif : le pipeline tourne complet.', en: 'No flag enabled: the pipeline runs in full.' },
  active: { fr: 'Drapeaux actifs', en: 'Enabled flags' },
  knobs: { fr: 'Boutons du pipeline', en: 'Pipeline knobs' },
  journal: { fr: 'Journal des changements', en: 'Change journal' },
  flagCol: { fr: 'Drapeau', en: 'Flag' },
  change: { fr: 'Changement', en: 'Change' },
  reason: { fr: 'Motif', en: 'Reason' },
  at: { fr: 'Horodatage', en: 'Timestamp' },
  on: { fr: 'actif', en: 'on' },
  off: { fr: 'coupé', en: 'off' },
  enabledWord: { fr: 'activé', en: 'enabled' },
  disabledWord: { fr: 'désactivé', en: 'disabled' },
  demoReason: { fr: 'démonstration du site', en: 'site demonstration' },
  emptyJournal: {
    fr: 'Aucun changement encore — basculez un drapeau ci-dessus.',
    en: 'No change yet — flip a flag above.',
  },
} as const;

const KNOB_LABELS: Record<keyof PipelineKnobs, Record<Language, string>> = {
  c3Enabled: { fr: 'Couche C3 (lecture par modèle)', en: 'Layer C3 (model reading)' },
  sasEnabled: { fr: 'Sas de sortie', en: 'Outbound gate' },
  forcedReport: { fr: 'Mode report forcé', en: 'Forced report mode' },
  shadow: { fr: 'Mode shadow', en: 'Shadow mode' },
};

export const DEMO_PROJECT = 'DEMO';
export const DEMO_ACTOR = 'visiteur-demo';
export const FLAGS_RESULT_ID = 'tuning-flags-result';

function flagId(flag: FlagName): string {
  return `tuning-flag-${flag}`;
}

function flagLabel(lang: Language, flag: FlagName): string {
  return t(lang, `reglages.flag.${flag}`);
}

function demoReason(lang: Language): string {
  return L.demoReason[lang];
}

export interface FlagsDemoState {
  project: ProjectFlags;
  journal: FlagJournalEntry[];
}

/** État initial du projet de démonstration : aucun drapeau actif. */
export function initialFlags(projectId = DEMO_PROJECT): FlagsDemoState {
  return { project: projectFlags(projectId), journal: [] };
}

/** Bascule un drapeau via le domaine ; rend le nouvel état et l'entrée de journal. */
export function toggleFlag(
  state: FlagsDemoState,
  flag: FlagName,
  enabled: boolean,
  ctx: FlagChangeContext,
): { state: FlagsDemoState; entry: FlagJournalEntry | null } {
  const result = setFlag(state.project, flag, enabled, ctx);
  return {
    state: {
      project: result.project,
      journal: result.entry ? [...state.journal, result.entry] : state.journal,
    },
    entry: result.entry,
  };
}

/** Les boutons du pipeline après application des drapeaux — via `applyFlags`. */
export function demoKnobs(project: ProjectFlags): PipelineKnobs {
  return applyFlags(BASE_KNOBS, project);
}

function knobsKv(ctx: SectionContext, project: ProjectFlags): string {
  const knobs = demoKnobs(project);
  const pairs = (Object.keys(KNOB_LABELS) as (keyof PipelineKnobs)[]).map((knob) => [
    KNOB_LABELS[knob][ctx.lang],
    knobs[knob] ? L.on[ctx.lang] : L.off[ctx.lang],
  ] as [string, string]);
  return kv(pairs);
}

function journalTable(ctx: SectionContext, journal: readonly FlagJournalEntry[]): string {
  if (journal.length === 0) return note(L.emptyJournal[ctx.lang]);
  const rows = journal.map((entry) => [
    `<code>${entry.flag}</code>`,
    entry.after ? L.enabledWord[ctx.lang] : L.disabledWord[ctx.lang],
    esc(entry.reason),
    esc(entry.at),
  ]);
  return table(
    [L.flagCol[ctx.lang], L.change[ctx.lang], L.reason[ctx.lang], L.at[ctx.lang]],
    rows,
    true,
  );
}

/** Rendu complet du bloc d'état : drapeaux actifs, boutons, journal. */
export function flagsResult(ctx: SectionContext, state: FlagsDemoState): string {
  const active = describeFlags(state.project, ctx.lang);
  const activeHtml = active.length
    ? `<p>${L.active[ctx.lang]}</p>` + list(active)
    : note(L.none[ctx.lang]);
  return (
    activeHtml +
    `<p>${L.knobs[ctx.lang]}</p>` +
    knobsKv(ctx, state.project) +
    `<p>${L.journal[ctx.lang]}</p>` +
    journalTable(ctx, state.journal)
  );
}

function checkboxHtml(lang: Language, flag: FlagName): string {
  return (
    `<label class="field"><input type="checkbox" id="${flagId(flag)}">` +
    `<span>${esc(flagLabel(lang, flag))} (<code>${flag}</code>)</span></label>`
  );
}

/** HTML initial du bloc : quatre cases à cocher + état de départ. */
export function flagsBlock(ctx: SectionContext): string {
  const state = initialFlags();
  const boxes = FLAG_NAMES.map((flag) => checkboxHtml(ctx.lang, flag)).join('');
  return panel(
    heading(L.title[ctx.lang]) +
      `<p>${L.intro[ctx.lang]}</p>` +
      boxes +
      `<div id="${FLAGS_RESULT_ID}">${flagsResult(ctx, state)}</div>`,
  );
}

/** Câblage des cases à cocher : chaque bascule rejoue `setFlag` puis réaffiche. */
export function wireFlags(root: HTMLElement, ctx: SectionContext): void {
  const out = byId<HTMLElement>(root, FLAGS_RESULT_ID);
  if (!out) return;
  let state = initialFlags();
  for (const flag of FLAG_NAMES) {
    const box = byId<HTMLInputElement>(root, flagId(flag));
    if (!box) continue;
    box.addEventListener('change', () => {
      const step = toggleFlag(state, flag, box.checked, {
        actor: DEMO_ACTOR,
        at: ctx.now,
        reason: demoReason(ctx.lang),
      });
      state = step.state;
      out.innerHTML = flagsResult(ctx, state);
    });
  }
}
