/**
 * Conversions pures JSM (§20) et pièces jointes (TP-22) — sans réseau.
 */

import { describe, expect, it } from 'vitest';
import type { JiraAttachmentView } from './schema';
import { analyzeAttachment, attachmentPlan, MAX_ANALYZED_BYTES } from './attachments';
import {
  accountTypeOf,
  adfToText,
  emailDomainOf,
  JSM_FIELDS,
  organizationNamesOf,
  participantsOf,
  textToAdf,
  toAccountSnapshot,
  toRequestChannel,
  visibilityOfComment,
  visibilityPropertyBody,
} from './jsm';

describe('canal de la demande (§20)', () => {
  it('les six valeurs vérifiées sont reconnues', () => {
    expect(toRequestChannel('jira')).toBe('jira');
    expect(toRequestChannel('portal')).toBe('portal');
    expect(toRequestChannel('anonymousportal')).toBe('anonymousportal');
    expect(toRequestChannel('email')).toBe('email');
    expect(toRequestChannel('API')).toBe('API');
    expect(toRequestChannel('deployment')).toBe('deployment');
  });

  it('insensible à la casse et aux espaces', () => {
    expect(toRequestChannel(' Api ')).toBe('API');
    expect(toRequestChannel('PORTAL')).toBe('portal');
  });

  it('une valeur inconnue devient unknown, jamais une exception', () => {
    expect(toRequestChannel('slack')).toBe('unknown');
    expect(toRequestChannel('')).toBe('unknown');
    expect(toRequestChannel(null)).toBe('unknown');
    expect(toRequestChannel(42)).toBe('unknown');
    expect(toRequestChannel({ value: 'jira' })).toBe('unknown');
  });
});

describe('types de compte (§20)', () => {
  it('appId avec deux-points, client 5d, Atlassian 5b, sinon unknown', () => {
    expect(accountTypeOf('ari:cloud:team:xyz')).toBe('app');
    expect(accountTypeOf('5d0123456789abcdef012345')).toBe('customer');
    expect(accountTypeOf('5b0123456789abcdef012345')).toBe('atlassian');
    expect(accountTypeOf('zzz')).toBe('unknown');
    expect(accountTypeOf('')).toBe('unknown');
  });

  it('un agent de support est toujours atlassian', () => {
    expect(accountTypeOf('5d0123456789abcdef012345', true)).toBe('atlassian');
  });

  it('le snapshot ne garde que le domaine de messagerie', () => {
    const snapshot = toAccountSnapshot({
      accountId: '5b1',
      displayName: 'Agent',
      emailAddress: 'agent@EXEMPLE.fr',
    });
    expect(snapshot.accountId).toBe('5b1');
    expect(snapshot.accountType).toBe('atlassian');
    expect(snapshot.emailDomain).toBe('exemple.fr');
    expect(JSON.stringify(snapshot)).not.toContain('agent@');
    expect(emailDomainOf('pas-un-mail')).toBeUndefined();
  });

  it('un utilisateur brut absent ne casse rien', () => {
    expect(toAccountSnapshot(undefined).accountType).toBe('unknown');
  });
});

describe('visibilité des commentaires (§20)', () => {
  it('sd.public.comment internal=true → interne', () => {
    const properties = [{ key: 'sd.public.comment', value: { internal: true } }];
    expect(visibilityOfComment(properties)).toBe('internal');
    expect(visibilityOfComment([{ key: 'sd.public.comment', value: { internal: false } }])).toBe('public');
    expect(visibilityOfComment([])).toBe('public');
    expect(visibilityOfComment(undefined)).toBe('public');
    expect(visibilityOfComment('cassé')).toBe('public');
  });

  it('le corps de propriété fait l’aller-retour', () => {
    const body = visibilityPropertyBody('internal');
    expect(body.key).toBe('sd.public.comment');
    expect(visibilityOfComment([body])).toBe('internal');
  });
});

describe('organisation et participants', () => {
  it('lit les champs JSM usuels', () => {
    const fields: Record<string, unknown> = {
      [JSM_FIELDS.organizations]: ['Acme', ''],
      [JSM_FIELDS.requestParticipants]: [{ accountId: '5d9' }, null],
    };
    expect(organizationNamesOf(fields)).toEqual(['Acme']);
    const participants = participantsOf(fields);
    expect(participants).toHaveLength(2);
    expect(participants[0]!.accountType).toBe('customer');
    expect(organizationNamesOf({})).toEqual([]);
    expect(participantsOf({ [JSM_FIELDS.requestParticipants]: 'cassé' })).toEqual([]);
  });
});

describe('texte ADF (FORGE.md §4)', () => {
  it('extrait le texte des blocs, jamais d’exception', () => {
    const doc = textToAdf('bonjour');
    expect(adfToText(doc)).toBe('bonjour\n');
    expect(adfToText({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] })).toBe('a\nb\n');
    expect(adfToText('chaîne nue')).toBe('chaîne nue');
    expect(adfToText(null)).toBe('');
    expect(adfToText({ type: 'inconnu' })).toBe('');
  });
});

function attachment(overrides: Partial<JiraAttachmentView> = {}): JiraAttachmentView {
  return {
    id: 'A-1',
    fileName: 'f.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    author: { accountId: '5d1', accountType: 'customer' },
    createdAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('pièces jointes (TP-22)', () => {
  it('PDF avec texte extrait → analysé', () => {
    expect(attachmentPlan(attachment(), '  texte du pdf ')).toEqual({ kind: 'text', text: 'texte du pdf' });
  });

  it('trop lourde → oversize, image → image, binaire → binary-attachment', () => {
    expect(attachmentPlan(attachment({ sizeBytes: MAX_ANALYZED_BYTES + 1 }), 'x').reason).toBe('oversize');
    expect(attachmentPlan(attachment({ mimeType: 'image/png' }), null).reason).toBe('image');
    expect(attachmentPlan(attachment({ mimeType: 'application/zip' }), null).reason).toBe('binary-attachment');
  });

  it('extraction vide ou échouée → unsupported-format, sans exception', async () => {
    expect(attachmentPlan(attachment(), null).reason).toBe('unsupported-format');
    const failing = analyzeAttachment(attachment(), async () => {
      throw new Error('runtime');
    });
    expect((await failing).reason).toBe('unsupported-format');
    const empty = await analyzeAttachment(attachment({ mimeType: 'text/plain' }), async () => 'ok');
    expect(empty).toEqual({ kind: 'text', text: 'ok' });
  });

  it('l’extraction n’est pas tentée pour une image', async () => {
    let attempted = false;
    await analyzeAttachment(attachment({ mimeType: 'image/png' }), async () => {
      attempted = true;
      return 'non';
    });
    expect(attempted).toBe(false);
  });
});

describe('type de compte : ce que Jira montre vraiment (§20)', () => {
  it('un compte cloud moderne (préfixe de tenant) est interne, pas un compte d’app', () => {
    // Mesuré sur site réel le 12 novembre 2026 : `712020:ba9bbe36-…` est le
    // compte d'un agent de support, pas une intégration.
    expect(accountTypeOf('712020:ba9bbe36-cf26-4a6a-8f5e-2369b742296b')).toBe('atlassian');
  });

  it('un compte d’app est identifiable à son identité `ari:`', () => {
    expect(accountTypeOf('ari:cloud:ecosystem::app/6fb8fafb-3d45-4a47-bcac-f5d1cffe4902')).toBe('app');
  });

  it('les formes historiques sont conservées', () => {
    expect(accountTypeOf('5d10a8')).toBe('customer');
    expect(accountTypeOf('5b10a8')).toBe('atlassian');
  });

  it('un identifiant inconnu ne prétend rien', () => {
    expect(accountTypeOf('60ad2d2a06bf0c006a42fa84')).toBe('unknown');
    expect(accountTypeOf('')).toBe('unknown');
  });

  it('un agent de support est interne quoi que son identifiant dise', () => {
    expect(accountTypeOf('60ad2d2a06bf0c006a42fa84', true)).toBe('atlassian');
  });
});
