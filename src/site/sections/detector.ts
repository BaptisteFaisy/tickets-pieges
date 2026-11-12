/**
 * Section « Détecteur » — l'analyse complète d'une demande, du début à la fin.
 *
 * C'est la chaîne du produit (§18) rejouée dans le navigateur : origine → C1 →
 * C2 → C4 → constats → suspicion → mode → encadrement. Aucune règle n'est
 * recopiée ici : la section appelle `replaySample()` de `src/replay/engine.ts`,
 * exactement comme le banc d'essai en ligne de commande (`node tools/replay.mjs`).
 */

import { replaySample, type ReplayReport } from '../../replay/engine';
import { loadDataset } from '../../sample/dataset';
import { defaultSettings } from '../../core/trust-rules';
import type {
  AccountType,
  Finding,
  ProtectionMode,
  RequestChannel,
  SampleRequest,
  SegmentOrigin,
} from '../../core/types';
import { badge, buttonHtml, esc, field, grid, note, panel, pre, selectHtml, table, textareaHtml } from '../dom';
import type { Section, SectionContext } from './types';

const SAMPLES: readonly SampleRequest[] = loadDataset();

const CHANNELS: RequestChannel[] = ['portal', 'anonymousportal', 'email', 'API', 'jira', 'deployment'];
const ACCOUNTS: AccountType[] = ['customer', 'atlassian', 'app', 'unknown'];
const MODES: ProtectionMode[] = ['report', 'label', 'neutralize'];

/** Libellés courts des listes déroulantes, dans les deux langues. */
const LABELS = {
  sample: { fr: 'Demande du jeu d’essai (38 cas)', en: 'Sample request (38 cases)' },
  custom: { fr: '…ou collez votre propre texte', en: '…or paste your own text' },
  channel: { fr: 'Canal', en: 'Channel' },
  account: { fr: 'Compte de l’auteur', en: 'Author account' },
  mode: { fr: 'Mode du projet', en: 'Project mode' },
  run: { fr: 'Analyser', en: 'Analyse' },
  steps: { fr: 'Les cinq étapes (§18)', en: 'The five steps (§18)' },
  origins: { fr: 'Origine de chaque segment (§5)', en: 'Origin of each segment (§5)' },
  findings: { fr: 'Constats (§6)', en: 'Findings (§6)' },
  framed: { fr: 'Ce que reçoit un agent (§8.2)', en: 'What an agent receives (§8.2)' },
  banner: { fr: 'Encart ajouté en tête du ticket', en: 'Banner added at the top of the ticket' },
  none: { fr: 'Aucun constat : rien de suspect relevé par les couches jouées.', en: 'No finding: nothing suspicious was raised.' },
  empty: { fr: 'Choisissez une demande ou collez un texte, puis lancez l’analyse.', en: 'Pick a sample or paste a text, then run the analysis.' },
  hint: {
    fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, rien ne quitte la page.',
    en: 'Everything runs in your browser: no network call, nothing leaves this page.',
  },
  unanalyzed: { fr: 'Non analysé : ', en: 'Not analysed: ' },
} as const;

function label(ctx: SectionContext, key: keyof typeof LABELS): string {
  return LABELS[key][ctx.lang];
}

/** Libellé court d'une demande d'exemple. */
export function sampleLabel(sample: SampleRequest): string {
  const text = sample.summary || sample.description;
  return `${sample.id} — ${text.length > 52 ? `${text.slice(0, 51)}…` : text}`;
}

/** La demande à analyser : celle du visiteur s'il a écrit, celle du jeu sinon. */
export function readRequest(root: HTMLElement, lang: 'fr' | 'en'): SampleRequest {
  const custom = (root.querySelector<HTMLTextAreaElement>('#d-custom')?.value ?? '').trim();
  const channel = (root.querySelector<HTMLSelectElement>('#d-channel')?.value ?? 'portal') as RequestChannel;
  const accountType = (root.querySelector<HTMLSelectElement>('#d-account')?.value ?? 'customer') as AccountType;
  if (custom.length > 0) {
    return {
      id: 'custom',
      language: lang,
      summary: custom.split('\n')[0]?.slice(0, 80) ?? 'custom',
      description: custom,
      comments: [],
      channel,
      accountType,
      expected: { trustLevel: 'T1', suspicion: 'clean', kinds: [] },
    };
  }
  const id = root.querySelector<HTMLSelectElement>('#d-sample')?.value ?? '';
  const sample = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  if (!sample) throw new Error('jeu d’essai vide');
  return { ...sample, channel, accountType };
}

/** Ligne de verdict : origine, suspicion, mode, couches non jouées. */
export function verdictLine(report: ReplayReport, ctx: SectionContext): string {
  const gaps = report.gaps
    .map((gap) => badge(`${gap.layer} ${ctx.lang === 'fr' ? 'non jouée' : 'not played'}`, 'warn'))
    .join(' ');
  return [
    badge(report.trustLevel, report.trustLevel.toLowerCase()),
    badge(ctx.t(`suspicion.${report.suspicion}`), report.suspicion),
    badge(ctx.t(`mode.${report.modeDecision.mode}`)),
    badge(`${report.findings.length} ${ctx.lang === 'fr' ? 'constat(s)' : 'finding(s)'}`),
    gaps,
  ].join(' ');
}

/** Tableau des origines : qui a écrit chaque segment, et pourquoi ce niveau. */
export function originsTable(origins: SegmentOrigin[], ctx: SectionContext): string {
  const head = ctx.lang === 'fr'
    ? ['Segment', 'Origine', 'Auteur · canal', 'Raisons (codes stables)']
    : ['Segment', 'Origin', 'Author · channel', 'Reasons (stable codes)'];
  const rows = origins.map((origin) => [
    `${origin.field}${origin.refId ? `#${origin.refId}` : ''}`,
    origin.trustLevel,
    `${origin.accountType} · ${origin.channel}`,
    origin.reasons.map((reason) => reason.code).join(', '),
  ]);
  return table(head, rows);
}

/** Un constat : couche, règle, extrait court, et ce qu'il demande en clair. */
export function findingBlock(finding: Finding): string {
  return `<div class="finding ${esc(finding.layer)}">
    <div class="meta">${esc(finding.layer)} · ${esc(finding.ruleId)} · ${esc(finding.kind)} ·
      ${Math.round(finding.confidence * 100)}% · [${esc(finding.startPos)}–${esc(finding.endPos)}]</div>
    <div class="excerpt">${esc(finding.excerpt)}</div>
    <div class="ask">${esc(finding.askSummary)}</div>
  </div>`;
}

/** Rendu complet d'un rapport : verdict, étapes, origines, constats, encadrement. */
export function renderReport(report: ReplayReport, ctx: SectionContext): string {
  const unanalyzed = report.unanalyzed.length
    ? note(label(ctx, 'unanalyzed') + report.unanalyzed.join(', '))
    : '';
  const findings = report.findings.length
    ? report.findings.map(findingBlock).join('')
    : note(label(ctx, 'none'));
  const banner = report.modeDecision.banner
    ? `<div class="block"><h4>${esc(label(ctx, 'banner'))}</h4>${pre(report.modeDecision.banner)}</div>`
    : '';
  const steps = report.steps
    .map((step) => `<li><strong>${esc(step.title)}</strong><div class="note">${esc(step.outputs.join(' · '))}</div></li>`)
    .join('');
  return `<div class="verdict">${verdictLine(report, ctx)}</div>${unanalyzed}
    <div class="block"><h4>${esc(label(ctx, 'steps'))}</h4><ol>${steps}</ol></div>
    <div class="block"><h4>${esc(label(ctx, 'origins'))}</h4>${originsTable(report.origins, ctx)}</div>
    <div class="block"><h4>${esc(label(ctx, 'findings'))}</h4>${findings}</div>
    ${banner}
    <div class="block"><h4>${esc(label(ctx, 'framed'))}</h4>${pre(report.framedText)}</div>`;
}

/** Joue l'analyse et affiche le rapport dans la zone de résultat. */
async function run(root: HTMLElement, ctx: SectionContext): Promise<void> {
  const target = root.querySelector<HTMLDivElement>('#d-result');
  if (!target) return;
  try {
    const mode = (root.querySelector<HTMLSelectElement>('#d-mode')?.value ?? 'report') as ProtectionMode;
    const report = await replaySample(readRequest(root, ctx.lang), {
      language: ctx.lang,
      settings: { ...defaultSettings('BANC'), mode },
      now: ctx.now,
      blockId: () => Math.random().toString(16).slice(2, 8),
    });
    target.innerHTML = renderReport(report, ctx);
  } catch (error) {
    target.innerHTML = note(error instanceof Error ? error.message : String(error));
  }
}

/** Formulaire de la section. */
function form(ctx: SectionContext): string {
  const options = SAMPLES.map((sample) => [sample.id, sampleLabel(sample)] as [string, string]);
  return panel(
    field(label(ctx, 'sample'), selectHtml('d-sample', options, SAMPLES[0]?.id)) +
      field(label(ctx, 'custom'), textareaHtml('d-custom', 7, 'Bonjour, mon export échoue…')) +
      `<div class="row">` +
      field(label(ctx, 'channel'), selectHtml('d-channel', CHANNELS.map((c) => [c, c]))) +
      field(label(ctx, 'account'), selectHtml('d-account', ACCOUNTS.map((a) => [a, a]))) +
      field(label(ctx, 'mode'), selectHtml('d-mode', MODES.map((m) => [m, ctx.t(`mode.${m}`)]))) +
      `</div>` +
      buttonHtml('d-run', label(ctx, 'run')) +
      note(label(ctx, 'hint')),
  );
}

export const detectorSection: Section = {
  id: 'detector',
  titles: { fr: 'Détecteur', en: 'Detector' },
  render(ctx) {
    return grid(form(ctx), panel(note(label(ctx, 'empty')), 'd-result'));
  },
  mount(root, ctx) {
    root.querySelector<HTMLButtonElement>('#d-run')?.addEventListener('click', () => void run(root, ctx));
    root.querySelector<HTMLSelectElement>('#d-sample')?.addEventListener('change', () => {
      const custom = root.querySelector<HTMLTextAreaElement>('#d-custom');
      if (custom) custom.value = '';
    });
    void run(root, ctx);
  },
};
