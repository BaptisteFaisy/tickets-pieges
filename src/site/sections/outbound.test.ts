import { describe, expect, it } from 'vitest';
import { t as translate } from '../../core/i18n';
import { createMemoryStore } from '../../platform/memory';
import { outboundSection, buildOutboundContext, sampleReply, makeGate } from './outbound';
import type { SectionContext } from './types';

const NOW = '2026-11-11T12:00:00.000Z';

function ctx(lang: 'fr' | 'en'): SectionContext {
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    store: createMemoryStore(),
    now: NOW,
    notify: () => undefined,
  };
}

const base = {
  issueKey: 'DEMO-42',
  stage: 'before',
  strict: false,
  taintedSession: false,
  externalRequest: true,
  orgs: 'Globex, Initech',
  keys: 'GLOBEX-12',
  urls: 'https://acme.example.com',
};

describe('section outbound — contrat', () => {
  it('a l’id et les titres attendus', () => {
    expect(outboundSection.id).toBe('outbound');
    expect(outboundSection.titles).toEqual({ fr: 'Sas de sortie', en: 'Outbound gate' });
    expect(typeof outboundSection.render).toBe('function');
    expect(typeof outboundSection.mount).toBe('function');
  });
});

describe('section outbound — rendu', () => {
  it('rend un formulaire complet en français', async () => {
    const html = String(await outboundSection.render(ctx('fr')));
    for (const id of ['ob-text', 'ob-stage', 'ob-issue', 'ob-run', 'ob-file', 'ob-redteam', 'ob-result']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('Contrôler la sortie');
  });

  it('rend en anglais sans clé de traduction brute', async () => {
    const html = String(await outboundSection.render(ctx('en')));
    expect(html).toContain('Run the outbound gate');
    expect(html).not.toContain('outbound.');
  });

  it('n’injecte aucun HTML brut et pose une zone de saisie bien formée', async () => {
    const html = String(await outboundSection.render(ctx('fr')));
    expect(html).toContain('https://exfil.example.net/?d=abc');
    expect(html).toContain('<textarea id="ob-text"');
    expect(html).toContain('</textarea>');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
  });
});

describe('section outbound — contexte', () => {
  it('découpe listes et lignes, et pose le ticket par défaut', () => {
    const context = buildOutboundContext('fr', base);
    expect(context.issueKey).toBe('DEMO-42');
    expect(context.otherOrganizations).toEqual(['Globex', 'Initech']);
    expect(context.otherIssueKeys).toEqual(['GLOBEX-12']);
    expect(context.knownUrls).toEqual(['https://acme.example.com']);
    expect(context.strict).toBe(false);
    expect(context.requesterOrganization).toBe('Acme');
  });

  it('n’ajoute de demande externe que si le contexte le dit', () => {
    expect(buildOutboundContext('fr', base).requestText).toBeTypeOf('string');
    expect(buildOutboundContext('fr', { ...base, externalRequest: false }).requestText).toBeUndefined();
  });

  it('tombe sur DEMO-42 quand la clé est vide', () => {
    expect(buildOutboundContext('fr', { ...base, issueKey: '' }).issueKey).toBe('DEMO-42');
  });
});

describe('section outbound — texte d’exemple et sas', () => {
  it('fournit un exemple identique dans les deux langues', () => {
    expect(sampleReply('fr')).toBe(sampleReply('en'));
    expect(sampleReply('fr').length).toBeGreaterThan(80);
  });

  it('le sas joué par makeGate retient un texte à donnée personnelle', () => {
    const context = buildOutboundContext('fr', base);
    const gate = makeGate(context, 'fr', NOW);
    expect(gate('Voici votre IBAN FR1420041010050500013M02606, cordialement.')).toBeNull();
  });

  it('le sas joué par makeGate laisse passer un texte sain', () => {
    const context = buildOutboundContext('fr', { ...base, externalRequest: false });
    const gate = makeGate(context, 'fr', NOW);
    expect(gate('Votre accès est rétabli, bonne journée.')).toBe('Votre accès est rétabli, bonne journée.');
  });
});
