import { describe, expect, it } from 'vitest';
import { t as translate } from '../../core/i18n';
import { createMemoryStore } from '../../platform/memory';
import { createCanary, detectHit, summarizeCanary } from '../../core/canary';
import { createLure } from '../../core/lure';
import { buildChain, verifyChain } from '../../core/canary-chain';
import { weekToken } from '../../core/canary-schedule';
import type { SectionContext } from './types';
import {
  canaryCard,
  canarySection,
  chainTable,
  chainVerdictHtml,
  depthFlags,
  expiryInstant,
  hitHtml,
  leakHtml,
  leakSampleText,
  lureHtml,
  outcomeHtml,
  scheduleHtml,
  tamperedChain,
  weekStarts,
} from './canary';

const NOW = '2026-11-11T12:00:00.000Z';

function context(lang: 'fr' | 'en'): SectionContext {
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

function securityCanary(issueKey = 'DEMO-42') {
  const outcome = createCanary({
    issueId: issueKey.toLowerCase(),
    issueKey,
    createdBy: 'demo-visiteur',
    role: 'security',
    now: NOW,
    language: 'fr',
    token: 'abc123',
    steps: ['Poser l’étiquette', 'Transférer'],
  });
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome;
}

describe('section canary : contrat et rendu', () => {
  it('exporte l’id et les titres attendus', () => {
    expect(canarySection.id).toBe('canary');
    expect(canarySection.titles).toEqual({ fr: 'Exercice d’alerte', en: 'Alert exercise' });
  });

  it('render pose les contrôles, le journal et le planning', () => {
    const html = canarySection.render(fr) as string;
    for (const id of ['c-role', 'c-launch', 'c-simulate', 'c-close', 'c-chain-verify', 'c-chain-tamper', 'c-schedule']) {
      expect(html).toContain(id);
    }
  });

  it('est bilingue : français et anglais dans le rendu', () => {
    expect(canarySection.render(fr) as string).toContain('Lancer un exercice');
    expect(canarySection.render(en) as string).toContain('Run an exercise');
    expect(canarySection.render(en) as string).toContain('Verify the chain');
  });
});

describe('section canary : création et rôle sécurité', () => {
  it('montre le refus du domaine quand le rôle est agent', () => {
    const denied = createCanary({
      issueId: 'demo-42',
      issueKey: 'DEMO-42',
      createdBy: 'demo-visiteur',
      role: 'agent',
      now: NOW,
      language: 'fr',
    });
    const html = outcomeHtml(denied, fr);
    expect(denied.ok).toBe(false);
    expect(html).toContain('badge bad');
    expect(html).toContain('sécurité');
  });

  it('montre la consigne inoffensive et l’étiquette unique', () => {
    const html = outcomeHtml(securityCanary(), fr);
    expect(html).toContain('temoin-abc123');
    expect(html).toContain('Exercice créé');
    expect(html).toContain('<pre>');
  });

  it('échappe une clé de ticket hostile', () => {
    const html = outcomeHtml(securityCanary('<script>alert(1)</script>'), fr);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(canaryCard(securityCanary('<img onerror=x>').canary, fr)).not.toContain('<img');
  });
});

describe('section canary : coup, profondeur, échéance', () => {
  it('depthFlags traduit le nombre de gestes observés', () => {
    expect(depthFlags(0)).toEqual([false, false]);
    expect(depthFlags(1)).toEqual([true, false]);
    expect(depthFlags(2)).toEqual([true, true]);
  });

  it('expiryInstant dépasse le délai de vie (§13)', () => {
    expect(expiryInstant(NOW)).toBe('2026-11-14T13:00:00.000Z');
  });

  it('affiche le coup avec type d’acteur et profondeur', () => {
    const { canary } = securityCanary();
    const hit = detectHit({
      canary,
      labelsAdded: [canary.labelName],
      actorAccountId: 'compte-demo',
      actorType: 'ai-agent',
      now: NOW,
    });
    expect(hit).not.toBeNull();
    const html = hitHtml(summarizeCanary(canary, [hit!]), 2, 1, fr);
    expect(html).toContain('ai-agent');
    expect(html).toContain('2 / 2');
    expect(html).toContain('Coup détecté');
  });

  it('sans étiquette posée, aucun coup', () => {
    const { canary } = securityCanary();
    const html = hitHtml(summarizeCanary(canary, []), 0, 1, fr);
    expect(html).toContain('Aucun coup');
  });
});

describe('section canary : appât et exfiltration', () => {
  const lure = createLure({
    issueId: 'demo-42',
    issueKey: 'DEMO-42',
    plantedBy: 'demo-visiteur',
    kind: 'fake-api-key',
    now: NOW,
    token: 'xyz789',
  });

  it('montre la fausse valeur marquée et sa gravité', () => {
    const html = lureHtml(lure, fr);
    expect(html).toContain('sk-appat-xyz789');
    expect(html).toContain('critical');
  });

  it('détecte l’appât dans un texte compromis et le décrit en incident', () => {
    const html = leakHtml(lure, leakSampleText(lure, 'fr'), 'export-csv', NOW, fr);
    expect(html).toContain('Incident d’exfiltration');
    expect(html).toContain('export-csv');
  });

  it('un texte sain ne déclenche rien ; sans appât, invite à en poser', () => {
    expect(leakHtml(lure, 'rien à voir', 'export-csv', NOW, fr)).toContain('Aucun appât');
    expect(leakHtml(null, 'sk-appat-xyz789', 'export-csv', NOW, fr)).toContain('Déposez d’abord');
  });
});

describe('section canary : journal à hash chaîné', () => {
  const chain = buildChain([
    { payload: 'exercice:temoin-abc123', at: NOW },
    { payload: 'coup:ai-agent', at: NOW },
    { payload: 'cloture:canary-abc123', at: NOW },
  ]);

  it('table du journal : séquence et empreintes courtes', () => {
    const html = chainTable(chain);
    expect(html).toContain('exercice:temoin-abc123');
    expect(html).toContain(chain[0]!.hash.slice(0, 12));
    expect(chainTable([])).toBe('');
  });

  it('une chaîne intacte est vérifiée', () => {
    expect(verifyChain(chain)).toBe(true);
    expect(chainVerdictHtml(chain, fr)).toContain('Chaîne intègre');
  });

  it('une modification rompt la chaîne — la démo le montre', () => {
    const tampered = tamperedChain(chain);
    expect(verifyChain(tampered)).toBe(false);
    expect(chainVerdictHtml(tampered, fr)).toContain('Chaîne rompue');
    expect(verifyChain(chain)).toBe(true);
  });

  it('journal vide : invitation à lancer un exercice', () => {
    expect(chainVerdictHtml([], en)).toContain('No entries yet');
  });
});

describe('section canary : planning hebdomadaire', () => {
  it('weekStarts dérive de ctx.now, jamais de l’horloge', () => {
    expect(weekStarts(NOW)).toEqual(['2026-11-11', '2026-11-18', '2026-11-25']);
  });

  it('les jetons tournent d’une semaine à l’autre', () => {
    const html = scheduleHtml(fr);
    expect(html).toContain(weekToken('demo-canary', 'support', '2026-11-11'));
    expect(html).toContain(weekToken('demo-canary', 'support', '2026-11-18'));
    expect(weekToken('demo-canary', 'support', '2026-11-11'))
      .not.toBe(weekToken('demo-canary', 'support', '2026-11-18'));
    expect(html).toContain('facturation');
  });
});
