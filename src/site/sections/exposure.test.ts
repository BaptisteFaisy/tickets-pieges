/**
 * Tests de la section « Exposition » — sans DOM (vitest tourne en `node`).
 *
 * On y vérifie trois choses : le **contrat** de la section (id, titres, rendu
 * bilingue), la **justesse des chiffres** affichés (ils viennent du domaine, pas
 * de la section) et l'**honnêteté** du rendu — tout texte est échappé, les exports
 * ne portent aucun texte de ticket, et le téléchargement reste local.
 */

import { describe, expect, it } from 'vitest';
import { t as translate } from '../../core/i18n';
import { createMemoryStore } from '../../platform/memory';
import { buildExposureReport, hitsByActorType } from '../../core/exposure';
import { normalizeAssistant, obedienceByAssistant } from '../../core/assistants';
import { comparisonRows, comparisonToCsv, comparisonToJson } from '../../core/exports';
import { SCORE_WEIGHTS, bandOf, exposureScore } from '../../core/scores';
import { shouldDemote, statsByRule } from '../../core/precision';
import type { Language } from '../../core/types';
import { dayFrom, demoFindings, demoPeriods, periodById, type DemoPeriod } from './exposure-demo';
import {
  actorTable,
  assistantTable,
  bandTone,
  comparisonTable,
  demoComparison,
  downloadText,
  exposureSection,
  percent,
  precisionTable,
  renderPeriod,
  reportRows,
  scoreBlock,
} from './exposure';
import type { SectionContext } from './types';

const NOW = '2026-11-12T09:00:00.000Z';

function context(lang: Language): SectionContext {
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    store: createMemoryStore(),
    now: NOW,
    notify: () => undefined,
  };
}

const fr = context('fr');
const en = context('en');
const { periods, reports, comparison } = demoComparison(NOW);
const before = periodById(periods, 'before');
const after = periodById(periods, 'after');

/** Une période dont l'identifiant de règle tente une injection. */
function hostilePeriod(): DemoPeriod {
  const findings = demoFindings(
    { layer: 'C2', kind: 'assistant-addressing', ruleId: '<script>alert(1)</script>' },
    1,
    NOW,
  );
  return { ...after, input: { ...after.input, findings, verdicts: [] } };
}

describe('contrat de la section', () => {
  it('porte l’identifiant et les titres attendus', () => {
    expect(exposureSection.id).toBe('exposure');
    expect(exposureSection.titles).toEqual({ fr: 'Exposition', en: 'Exposure' });
    expect(typeof exposureSection.mount).toBe('function');
  });

  it('rend les deux langues, sans clé de traduction manquante', () => {
    const htmlFr = exposureSection.render(fr) as string;
    const htmlEn = exposureSection.render(en) as string;
    expect(htmlFr).toContain('Avant les protections');
    expect(htmlFr).toContain('Score d’exposition');
    expect(htmlEn).toContain('After the protections');
    expect(htmlEn).toContain('Exposure score');
    expect(htmlFr).not.toContain('exposition.score.title');
    expect(htmlEn).not.toContain('ui.exposure.requests');
  });

  it('expose les contrôles que `mount` câble', () => {
    const html = exposureSection.render(fr) as string;
    expect(html).toContain('id="e-period"');
    expect(html).toContain('id="e-result"');
    expect(html).toContain('id="e-csv"');
    expect(html).toContain('id="e-json"');
  });

  it('calcule ses dates à partir de `ctx.now`, jamais de l’horloge', () => {
    expect(dayFrom(NOW, 0)).toBe('2026-11-12');
    expect(dayFrom(NOW, -60)).toBe('2026-09-13');
    expect(before.input.to).toBe(dayFrom(NOW, -31));
    expect(after.input.from).toBe(dayFrom(NOW, -30));
  });
});

describe('rapport d’exposition (§13)', () => {
  it('agrège ce que le domaine calcule, rien de plus', () => {
    const report = buildExposureReport(before.input);
    expect(report.requestsExamined).toBe(240);
    expect(report.analyzedShare).toBe(0.63);
    expect(report.findingsByLayer).toEqual({ C1: 5, C2: 9, C3: 4, C4: 11 });
    expect(report.canariesLaunched).toBe(6);
    expect(report.canariesObeyed).toBe(4);
    expect(report.obedienceRate).toBe(0.67);
    expect(report.outboundHeld).toBe(2);
    expect(report.campaigns).toBe(4);
  });

  it('affiche la part réellement analysée et les motifs les plus fréquents', () => {
    const rows = reportRows(reports[1]!, fr);
    const flat = rows.map(([key, value]) => `${key}=${value}`).join('|');
    expect(flat).toContain('95 %');
    expect(flat).toContain('unusual-length ×7');
    expect(reports[1]!.topKinds.length).toBeLessThanOrEqual(5);
    expect(reports[1]!.topKinds[0]!.count).toBeGreaterThanOrEqual(reports[1]!.topKinds[1]!.count);
  });

  it('lit les exercices par type d’acteur, jamais par personne', () => {
    expect(hitsByActorType(before.hits)).toEqual({ human: 0, 'ai-agent': 3, automation: 1, unknown: 0 });
    const html = actorTable(before, en);
    expect(html).toContain('ai-agent');
    expect(html).not.toContain('demo-actor');
  });
});

describe('score 0-100 et ses pondérations (#47)', () => {
  it('reste borné, cohérent avec sa bande, et ses poids somment à 100', () => {
    for (const report of reports) {
      const score = exposureScore(report);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
      expect(score.band).toBe(bandOf(score.total));
    }
    expect(Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('affiche les quatre composantes et leur contribution', () => {
    const html = scoreBlock(reports[0]!, fr);
    expect(html).toContain('constats suspects (C1+C2+C3)');
    expect(html).toContain('obéissance aux exercices');
    expect(html).toContain('réponses retenues par le sas');
    expect(html).toContain('part non analysée');
    expect(html).toContain('Ce score mesure');
    expect(bandTone('low')).toBe('clean');
    expect(bandTone('critical')).toBe('trapped');
  });

  it('baisse entre les deux périodes : c’est l’avant/après du §14', () => {
    expect(exposureScore(reports[0]!).total).toBeGreaterThan(exposureScore(reports[1]!).total);
    expect(comparison.change.obedienceRate).toBeLessThan(0);
    expect(comparison.change.outboundHeld).toBeGreaterThan(0);
    expect(comparison.change.analyzedShare).toBeGreaterThan(0);
  });
});

describe('comparaison et exports (#45)', () => {
  it('produit des lignes stables, dont le score des deux périodes', () => {
    const fields = comparisonRows(comparison).map((row) => row.field);
    expect(fields).toContain('exposureScore');
    expect(fields).toContain('obedienceRate');
    expect(fields).toContain('findings.C1');
    expect(comparisonRows(comparison)).toEqual(comparisonRows(comparison));
  });

  it('rend un CSV et un JSON lisibles, sans réseau', () => {
    const csv = comparisonToCsv(comparison);
    expect(csv.split('\n')[0]).toBe('field,before,after,change');
    expect(csv).toContain('requestsExamined,240,300,60');
    const json = JSON.parse(comparisonToJson(comparison)) as { projectKey: string; change: { obedienceRate: number } };
    expect(json.projectKey).toBe('DEMO');
    expect(json.change.obedienceRate).toBeLessThan(0);
    expect(comparisonTable(comparison, fr)).toContain('champ');
    expect(comparisonTable(comparison, en)).toContain('change');
  });

  it('ne contient aucun texte de ticket : les constats de démonstration sont vides', () => {
    for (const period of periods) {
      for (const finding of period.input.findings) {
        expect(finding.excerpt).toBe('');
        expect(finding.askSummary).toBe('');
      }
    }
    expect(comparisonToJson(comparison)).not.toContain('excerpt');
    expect(comparisonToCsv(comparison)).not.toContain('askSummary');
  });

  it('refuse de télécharger hors navigateur au lieu de planter', () => {
    expect(downloadText('x.csv', 'a,b', 'text/csv')).toBe(false);
  });
});

describe('obéissance par assistant (#42) et précision par règle (§14)', () => {
  it('agrège par intégration et trie du plus obéissant au moins obéissant', () => {
    const rows = obedienceByAssistant(before.launches);
    expect(rows[0]!.rate).toBeGreaterThanOrEqual(rows[rows.length - 1]!.rate);
    expect(rows.map((row) => row.launched).reduce((a, b) => a + b, 0)).toBe(6);
    expect(normalizeAssistant('bot-maison')).toBe('unknown');
    expect(assistantTable(after, fr)).toContain('Claude (Anthropic)');
  });

  it('rétrograde la règle bruyante, et seulement avec assez de verdicts', () => {
    const afterStats = statsByRule(after.input.findings, after.input.verdicts);
    const noisy = afterStats.find((entry) => entry.ruleId === 'c4.length');
    expect(noisy).toBeDefined();
    expect(noisy!.falsePositives).toBeGreaterThanOrEqual(5);
    expect(shouldDemote(noisy!)).toBe(true);
    expect(statsByRule(before.input.findings, before.input.verdicts).every((entry) => !shouldDemote(entry))).toBe(true);
  });

  it('place la règle rétrogradée en tête du tableau', () => {
    const html = precisionTable(after, fr);
    expect(html.indexOf('c4.length')).toBeLessThan(html.indexOf('c2.addressing'));
    expect(html).toContain('règle rétrogradée');
    expect(percent(0.67)).toBe('67 %');
  });
});

describe('échappement', () => {
  it('n’injecte jamais un identifiant venu des données', () => {
    const html = precisionTable(hostilePeriod(), en);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rend la section complète sans balise script', () => {
    const html = `${exposureSection.render(fr) as string}${renderPeriod(after, reports[1]!, fr)}`;
    expect(html).not.toContain('<script');
    expect(html).toContain('<table>');
  });
});
