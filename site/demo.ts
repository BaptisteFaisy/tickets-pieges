/**
 * Site de démonstration — le vrai code de l'app, dans le navigateur.
 *
 * Ce fichier n'implémente **aucune** règle : il appelle le domaine fusionné
 * (`src/replay/engine.ts`, qui enchaîne origine → C1 → C2 → C4 → constats →
 * suspicion → mode → encadrement) et affiche son rapport. Une seule
 * implémentation, deux surfaces : le banc en ligne de commande et cette page.
 *
 * Deux règles de sécurité propres à la page :
 *  - tout texte venu du visiteur ou du rapport est **échappé** avant d'être
 *    injecté (une page qui parle d'injection ne doit pas être injectable) ;
 *  - aucun appel réseau : la page ne fait que calculer localement.
 */

import { replaySample, type ReplayReport } from '../src/replay/engine';
import { loadDataset } from '../src/sample/dataset';
import { defaultSettings } from '../src/core/trust-rules';
import type {
  AccountType,
  Finding,
  Language,
  ProtectionMode,
  RequestChannel,
  SampleRequest,
  SegmentOrigin,
} from '../src/core/types';

/** Injecté par esbuild au moment de la construction (`tools/build-site.mjs`). */
declare const __BUILD__: string;

const SAMPLES: readonly SampleRequest[] = loadDataset();
let language: Language = 'en';

/** Échappement HTML : jamais de texte brut injecté dans la page. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function byId<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`élément absent de la page : #${id}`);
  return node as unknown as T;
}

/** Applique la langue choisie à tous les textes portant `data-en` / `data-fr`. */
export function applyLanguage(next: Language): void {
  language = next;
  document.documentElement.setAttribute('lang', next);
  document.documentElement.setAttribute('data-lang', next);
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-en][data-fr]'))) {
    const text = node.getAttribute(`data-${next}`);
    if (text !== null && node.children.length === 0) node.textContent = text;
  }
  const button = byId<HTMLButtonElement>('lang');
  button.textContent = next === 'en' ? 'FR' : 'EN';
  button.setAttribute('aria-label', next === 'en' ? 'Français' : 'English');
  fillSamples();
}

/** Libellé court d'une demande d'exemple, dans la langue de la page. */
function sampleLabel(sample: SampleRequest): string {
  const text = sample.summary || sample.description;
  return `${sample.id} — ${text.length > 58 ? `${text.slice(0, 57)}…` : text}`;
}

/** Remplit la liste des demandes d'exemple (38 cas intégrés, §22). */
export function fillSamples(): void {
  const select = byId<HTMLSelectElement>('sample');
  const keep = select.value;
  select.innerHTML = SAMPLES.map(
    (sample) => `<option value="${esc(sample.id)}">${esc(sampleLabel(sample))}</option>`,
  ).join('');
  if (Array.from(select.options).some((option) => option.value === keep)) select.value = keep;
}

/** La demande à analyser : celle du visiteur s'il a écrit, celle de l'exemple sinon. */
export function readRequest(): SampleRequest {
  const custom = byId<HTMLTextAreaElement>('custom').value.trim();
  const channel = byId<HTMLSelectElement>('channel').value as RequestChannel;
  const accountType = byId<HTMLSelectElement>('account').value as AccountType;
  if (custom.length > 0) {
    return {
      id: 'custom',
      language,
      summary: custom.split('\n')[0]?.slice(0, 80) ?? 'custom',
      description: custom,
      comments: [],
      channel,
      accountType,
      expected: { trustLevel: 'T1', suspicion: 'clean', kinds: [] },
    };
  }
  const id = byId<HTMLSelectElement>('sample').value;
  const sample = SAMPLES.find((item) => item.id === id) ?? SAMPLES[0];
  if (!sample) throw new Error('jeu d’essai vide');
  return { ...sample, channel, accountType };
}

/** Réglages du projet : ceux par défaut, avec le mode choisi à l'écran (§8.1). */
export function readSettings(): ReturnType<typeof defaultSettings> {
  const mode = byId<HTMLSelectElement>('mode').value as ProtectionMode;
  return { ...defaultSettings('BANC'), mode };
}

/** Ligne de verdict : origine, suspicion, mode, et ce qui n'a pas été joué. */
function verdictOf(report: ReplayReport): string {
  const labels = {
    clean: { en: 'clean', fr: 'sain' },
    review: { en: 'to review', fr: 'à vérifier' },
    suspect: { en: 'suspect', fr: 'suspect' },
    trapped: { en: 'trapped', fr: 'piégé' },
  } as const;
  const suspicion = labels[report.suspicion][language];
  const modes = { report: { en: 'report', fr: 'signaler' }, label: { en: 'label', fr: 'étiqueter' }, neutralize: { en: 'neutralize', fr: 'neutraliser' } } as const;
  return `
    <div class="verdict">
      <span class="badge ${esc(report.trustLevel.toLowerCase())}">${esc(report.trustLevel)}</span>
      <span class="badge ${esc(report.suspicion)}">${esc(suspicion)}</span>
      <span class="badge">${esc(modes[report.modeDecision.mode][language])}</span>
      <span class="badge">${report.findings.length} ${language === 'fr' ? 'constat(s)' : 'finding(s)'}</span>
      ${report.gaps.map((gap) => `<span class="badge" title="${esc(gap.reason)}">${esc(gap.layer)} ${language === 'fr' ? 'non jouée' : 'not played'}</span>`).join('')}
    </div>`;
}

/** Tableau des origines : qui a écrit chaque segment, et pourquoi ce niveau. */
function originsTable(origins: SegmentOrigin[]): string {
  const rows = origins.map((origin) => `
    <tr>
      <td><code>${esc(origin.field)}${origin.refId ? `#${esc(origin.refId)}` : ''}</code></td>
      <td><span class="badge ${esc(origin.trustLevel.toLowerCase())}">${esc(origin.trustLevel)}</span></td>
      <td>${esc(origin.accountType)} · ${esc(origin.channel)}</td>
      <td class="note">${esc(origin.reasons.map((reason) => reason.code).join(', '))}</td>
    </tr>`).join('');
  return `<table><thead><tr>
      <th>${language === 'fr' ? 'Segment' : 'Segment'}</th>
      <th>${language === 'fr' ? 'Origine' : 'Origin'}</th>
      <th>${language === 'fr' ? 'Auteur · canal' : 'Author · channel'}</th>
      <th>${language === 'fr' ? 'Raisons (codes stables)' : 'Reasons (stable codes)'}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/** Un constat : couche, règle, extrait court, et ce qu'il demande en clair. */
function findingBlock(finding: Finding): string {
  return `<div class="finding ${esc(finding.layer)}">
    <div class="meta">${esc(finding.layer)} · ${esc(finding.ruleId)} · ${esc(finding.kind)} ·
      ${Math.round(finding.confidence * 100)}% · [${esc(finding.startPos)}–${esc(finding.endPos)}]</div>
    <div class="excerpt">${esc(finding.excerpt)}</div>
    <div class="ask">${esc(finding.askSummary)}</div>
  </div>`;
}

/** Ce que reçoit un agent : le contenu encadré du §8.2. */
function framedBlock(report: ReplayReport): string {
  const warnings = report.framed.warnings.length
    ? `<p class="note">${report.framed.warnings.map(esc).join(' · ')}</p>`
    : '';
  return `${warnings}<pre>${esc(report.framedText)}</pre>`;
}

/** Les cinq étapes du §18, telles que le moteur les a jouées. */
function stepsBlock(report: ReplayReport): string {
  return `<ol>${report.steps
    .map((step) => `<li><strong>${esc(step.title)}</strong><div class="note">${esc(step.outputs.join(' · '))}</div></li>`)
    .join('')}</ol>`;
}

/** Rendu complet d'un rapport. */
export function renderReport(report: ReplayReport): string {
  const findings = report.findings.length
    ? report.findings.map(findingBlock).join('')
    : `<p class="note">${language === 'fr' ? 'Aucun constat : rien de suspect n’a été relevé par les couches jouées.' : 'No finding: nothing suspicious was raised by the layers played.'}</p>`;
  const unanalyzed = report.unanalyzed.length
    ? `<p class="note">${language === 'fr' ? 'Non analysé : ' : 'Not analysed: '}${report.unanalyzed.map(esc).join(', ')}</p>`
    : '';
  const banner = report.modeDecision.banner
    ? `<div class="block"><h4>${language === 'fr' ? 'Encart ajouté en tête du ticket' : 'Banner added at the top of the ticket'}</h4><pre>${esc(report.modeDecision.banner)}</pre></div>`
    : '';
  const headings = language === 'fr'
    ? { steps: 'Les cinq étapes (§18)', origins: 'Origine de chaque segment (§5)', found: 'Constats (§6)', framed: 'Ce que reçoit un agent (§8.2)' }
    : { steps: 'The five steps (§18)', origins: 'Origin of each segment (§5)', found: 'Findings (§6)', framed: 'What an agent receives (§8.2)' };
  return `${verdictOf(report)}${unanalyzed}
    <div class="block"><h4>${esc(headings.steps)}</h4>${stepsBlock(report)}</div>
    <div class="block"><h4>${esc(headings.origins)}</h4>${originsTable(report.origins)}</div>
    <div class="block"><h4>${esc(headings.found)}</h4>${findings}</div>
    ${banner}
    <div class="block"><h4>${esc(headings.framed)}</h4>${framedBlock(report)}</div>`;
}

/** Analyse demandée par le visiteur : une seule fonction, aucun réseau. */
async function analyse(event: Event): Promise<void> {
  event.preventDefault();
  const target = byId<HTMLDivElement>('result');
  target.innerHTML = `<p class="empty">${language === 'fr' ? 'Analyse en cours…' : 'Analysing…'}</p>`;
  try {
    const report = await replaySample(readRequest(), {
      language,
      settings: readSettings(),
      now: '2026-11-11T12:00:00.000Z',
      blockId: () => Math.random().toString(16).slice(2, 8),
    });
    target.innerHTML = renderReport(report);
  } catch (error) {
    target.innerHTML = `<p class="note">${esc(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

/** Démarrage : langue, liste des exemples, écouteurs. */
function start(): void {
  applyLanguage('en');
  byId<HTMLButtonElement>('lang').addEventListener('click', () => {
    applyLanguage(language === 'en' ? 'fr' : 'en');
  });
  byId<HTMLFormElement>('form').addEventListener('submit', (event) => {
    void analyse(event);
  });
  byId<HTMLSelectElement>('sample').addEventListener('change', () => {
    byId<HTMLTextAreaElement>('custom').value = '';
  });
  byId<HTMLElement>('build').textContent = __BUILD__;
  // La première demande d'exemple est analysée au chargement : un visiteur
  // (ou un juge) voit le produit fonctionner sans avoir à cliquer.
  const first = SAMPLES[0];
  if (first) {
    byId<HTMLSelectElement>('sample').value = first.id;
    void analyse(new Event('submit'));
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
