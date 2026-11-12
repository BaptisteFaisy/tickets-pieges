import { beforeEach, describe, expect, it } from 'vitest';
import { t as translate } from '../../core/i18n';
import { createMemoryStore } from '../../platform/memory';
import type { SectionContext } from './types';
import {
  currentTaint,
  demoClaims,
  demoNow,
  ensurePolicy,
  formatRemaining,
  gestureDecision,
  resetSessionsDemo,
  sessionsSection,
  tamperToken,
} from './sessions';

const NOW = '2026-11-11T12:00:00.000Z';

function ctx(lang: 'fr' | 'en' = 'fr'): SectionContext {
  return { lang, t: (key, vars) => translate(lang, key, vars), store: createMemoryStore(), now: NOW, notify: () => undefined };
}

beforeEach(() => {
  resetSessionsDemo();
});

describe('section « Session contaminée »', () => {
  it('a un identifiant stable et deux titres', () => {
    expect(sessionsSection.id).toBe('sessions');
    expect(sessionsSection.titles.fr).toContain('Session');
    expect(sessionsSection.titles.en).toContain('Tainted');
  });

  it('rend les contrôles de la démonstration : jeton, signature, vérification, altération, geste', async () => {
    const html = await sessionsSection.render(ctx());
    for (const id of ['s-key', 's-sign', 's-verify', 's-tamper', 's-decide', 's-action', 's-trust', 's-decision', 's-token', 's-policy']) {
      expect(html).toContain(id);
    }
  });

  it('rend aussi en anglais', async () => {
    const html = await sessionsSection.render(ctx('en'));
    expect(html.toLowerCase()).toContain('session');
    expect(html).toContain('s-sign');
  });

  it('aucune contamination au départ : le geste sensible est autorisé', () => {
    expect(currentTaint()).toBeNull();
    const decision = gestureDecision('fr');
    expect(decision.required).toBe(false);
    expect(decision.decision).toBe('allow');
    expect(decision.reason).toBe('');
  });

  it('la politique de session s’ouvre à la première interaction', () => {
    const policy = ensurePolicy(ctx());
    expect(policy).not.toBeNull();
    expect(typeof policy).toBe('object');
  });

  it('l’heure de la démonstration vient de ctx.now, jamais du système', () => {
    expect(demoNow(ctx())).toBe(NOW);
  });

  it('les affirmations signables décrivent la session, pas son contenu', () => {
    const claims = demoClaims(ctx());
    expect(claims.sessionRef).toBeTruthy();
    expect(claims.accountId).toBeTruthy();
    expect(claims.publicRepliesUsed).toBe(0);
    expect(claims.quarantine).toBe(false);
  });
});

describe('jeton de session signé (#23)', () => {
  it('une altération change la charge et conserve les trois parties', () => {
    const token = 'entete.CHARGE.sig';
    const altered = tamperToken(token);
    expect(altered).not.toBe(token);
    expect(altered.split('.')).toHaveLength(3);
    expect(altered.split('.')[0]).toBe('entete');
    expect(altered.split('.')[2]).toBe('sig');
  });

  it('une altération est reproductible : le même jeton donne le même jeton altéré', () => {
    expect(tamperToken('a.BCDE.f')).toBe(tamperToken('a.BCDE.f'));
  });

  it('une chaîne qui n’est pas un jeton est rendue telle quelle', () => {
    expect(tamperToken('pas-un-jeton')).toBe('pas-un-jeton');
  });
});

describe('compte à rebours du TTL (#24)', () => {
  it('affiche minutes:secondes', () => {
    expect(formatRemaining(65_000)).toBe('1:05');
    expect(formatRemaining(600_000)).toBe('10:00');
    expect(formatRemaining(1_000)).toBe('0:01');
  });

  it('échec, négatif ou zéro : échéance passée, jamais de chiffre négatif', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5_000)).toBe('0:00');
    expect(formatRemaining(Number.NaN)).toBe('0:00');
  });
});
