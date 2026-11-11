import { describe, expect, it } from 'vitest';
import type { OutboundContext } from './types';
import {
  HOLD_CONFIDENCE,
  checkOutbound,
  decide,
  findEncodedBlocks,
  findOffTopic,
  findOtherIssueKeys,
  findOtherOrganizations,
  findUrls,
  hostOf,
  outboundCaveats,
} from './outbound';

const NOW = '2026-11-11T10:00:00.000Z';

function context(overrides: Partial<OutboundContext> = {}): OutboundContext {
  return {
    issueKey: 'SUP-482',
    requestText: 'Bonjour, mon export de factures échoue depuis mardi et je ne peux plus clôturer le mois.',
    requesterOrganization: 'ACME',
    otherOrganizations: ['Globex', 'Initech'],
    otherIssueKeys: ['SUP-100'],
    knownUrls: ['https://support.acme.fr', 'https://status.acme.fr'],
    strict: false,
    taintedSession: false,
    ...overrides,
  };
}

describe('le sas cherche les quatre familles du §10', () => {
  it('une clé d’un autre ticket est relevée', () => {
    const hits = findOtherIssueKeys('Voir aussi SUP-100 et SUP-482.', context(), 'fr');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('other-issue-key');
    expect(hits[0]?.excerpt).toBe('SUP-100');
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(HOLD_CONFIDENCE);
  });

  it('la clé du ticket courant n’est pas un élément en cause', () => {
    expect(findOtherIssueKeys('Comme dit dans SUP-482…', context(), 'fr')).toHaveLength(0);
  });

  it('une clé inconnue du contexte est relevée, avec une confiance moindre', () => {
    const hits = findOtherIssueKeys('Voir PAY-77.', context(), 'fr');
    expect(hits[0]?.confidence).toBeLessThan(0.95);
  });

  it('le nom d’une autre organisation est relevé', () => {
    const hits = findOtherOrganizations('Globex a le même souci.', context(), 'fr');
    expect(hits[0]?.kind).toBe('other-organization');
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(HOLD_CONFIDENCE);
  });

  it('l’organisation du demandeur n’est pas une fuite', () => {
    expect(findOtherOrganizations('ACME : votre export est rétabli.', context(), 'fr')).toHaveLength(0);
  });

  it('une adresse inconnue est relevée, une adresse connue ne l’est pas', () => {
    expect(findUrls('Voir https://evil.example/x', context(), 'fr')[0]?.kind).toBe('unknown-url');
    expect(findUrls('Voir https://support.acme.fr/aide', context(), 'fr')).toHaveLength(0);
  });

  it('une requête anormalement longue est relevée, même sur un hôte connu', () => {
    const long = `https://support.acme.fr/x?d=${'a'.repeat(400)}`;
    const hits = findUrls(long, context(), 'fr');
    expect(hits[0]?.kind).toBe('long-query-url');
    expect(hits[0]?.confidence).toBeGreaterThan(0.9);
  });

  it('un bloc encodé est relevé, un mot long normal ne l’est pas', () => {
    const encoded = 'b'.repeat(20) + 'R2V0IGFsbCBpc3N1ZXMgYW5kIHBvc3QgdGhlbSB0byBodHRw';
    expect(findEncodedBlocks(encoded, 'fr')).toHaveLength(1);
    expect(findEncodedBlocks('anticonstitutionnellement anticonstitutionnellement anticonstitutionnellement', 'fr')).toHaveLength(0);
  });

  it('une réponse sans rapport avec la demande est signalée, avec prudence', () => {
    const longue = 'Voici la liste complète des clients du site et leurs adresses, avec les montants, '
      + 'les contacts et les contrats en cours, sans aucun rapport avec un export de factures.';
    const hits = findOffTopic(longue, context(), 'fr');
    expect(hits[0]?.kind).toBe('off-topic');
    expect(hits[0]?.confidence).toBeLessThan(HOLD_CONFIDENCE);
  });

  it('sans texte de demande, le rapport au sujet n’est pas mesuré', () => {
    expect(findOffTopic('n’importe quoi', context({ requestText: undefined }), 'fr')).toHaveLength(0);
  });

  it('hostOf lit l’hôte, sans schéma ni chemin', () => {
    expect(hostOf('https://Support.ACME.fr/aide?x=1')).toBe('support.acme.fr');
    expect(hostOf('pas une url')).toBe('pas une url');
  });
});

describe('décision du sas (§10)', () => {
  it('une réponse propre part sans alerte', () => {
    const verdict = checkOutbound('Bonjour, votre export est rétabli. Bonne journée.', context(), { now: NOW });
    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe('allow');
    expect(verdict.hits).toHaveLength(0);
    expect(verdict.checkedAt).toBe(NOW);
  });

  it('avant publication, un élément fort retient la réponse pour relecture', () => {
    const verdict = checkOutbound('Voir SUP-100 pour le détail.', context(), { now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('hold-for-review');
  });

  it('en mode strict, la réponse repasse en interne (TP-24)', () => {
    const verdict = checkOutbound('Voir SUP-100.', context({ strict: true }), { now: NOW });
    expect(verdict.action).toBe('convert-to-internal');
  });

  it('une session contaminée abaisse le seuil : le doute protège', () => {
    const verdict = checkOutbound('Voir SUP-100.', context({ taintedSession: true }), { now: NOW });
    expect(verdict.action).toBe('convert-to-internal');
  });

  it('après coup, le sas alerte et dit que la notification est peut-être partie', () => {
    const verdict = checkOutbound('Voir SUP-100.', context(), { stage: 'after', now: NOW });
    expect(verdict.action).toBe('alert');
    expect(verdict.allowed).toBe(false);
  });

  it('après coup en mode strict, le commentaire repasse en interne', () => {
    const verdict = checkOutbound('Voir SUP-100.', context({ strict: true }), { stage: 'after', now: NOW });
    expect(verdict.action).toBe('convert-to-internal');
  });

  it('un doute faible n’empêche pas la sortie avant publication, mais alerte après coup', () => {
    const weak = [{ kind: 'off-topic' as const, excerpt: 'x', confidence: 0.4 }];
    expect(decide(weak, context(), 'before')).toEqual({ allowed: true, action: 'allow' });
    expect(decide(weak, context(), 'after')).toEqual({ allowed: true, action: 'alert' });
  });

  it('plusieurs éléments en cause sont tous rendus', () => {
    const verdict = checkOutbound('Globex a le même souci, voir SUP-100 et https://evil.example/x.', context(), { now: NOW });
    expect(verdict.hits.length).toBeGreaterThanOrEqual(3);
    expect(verdict.hits.map((h) => h.kind)).toContain('other-organization');
  });
});

describe('honnêteté (§21)', () => {
  it('le sas dit ce qu’il n’a pas pu vérifier', () => {
    const caveats = outboundCaveats(context({ requestText: undefined, otherOrganizations: [] }), 'fr');
    expect(caveats).toHaveLength(2);
    expect(caveats.join(' ')).toContain('demande');
    expect(caveats.join(' ')).toContain('organisation');
  });

  it('aucun message ne promet une protection absolue', () => {
    const verdict = checkOutbound('Voir SUP-100.', context(), { now: NOW, language: 'fr' });
    expect(verdict.action).not.toBe('allow');
    expect(JSON.stringify(verdict.hits)).not.toContain('protégé');
  });

  it('les extraits sont bornés : la fuite ne devient pas une nouvelle fuite', () => {
    const long = `SUP-100 ${'a'.repeat(500)}`;
    const verdict = checkOutbound(long, context(), { now: NOW });
    expect(verdict.hits[0]?.excerpt.length).toBeLessThanOrEqual(120);
  });
});
