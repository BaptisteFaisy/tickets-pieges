import { describe, expect, it } from 'vitest';
import { catalogKeys, missingKeys, modeLabel, suspicionLabel, t, trustLabel } from './i18n';

describe('i18n', () => {
  it('assemble les catalogues des deux langues, sans trou', () => {
    expect(catalogKeys().length).toBeGreaterThan(0);
    expect(missingKeys()).toEqual({ fr: [], en: [] });
  });

  it('substitue les variables d’un message', () => {
    expect(t('fr', 'framing.preamble', { blockId: '7f3a9c' })).toContain('7f3a9c');
    expect(t('en', 'framing.preamble', { blockId: '7f3a9c' })).toContain('7f3a9c');
  });

  it('retombe sur la clé quand le message est inconnu', () => {
    expect(t('fr', 'cle.inconnue')).toBe('cle.inconnue');
  });

  it('donne les libellés des niveaux, des suspicions et des modes (§4)', () => {
    expect(trustLabel('fr', 'T1')).toContain('externe');
    expect(trustLabel('en', 'T0')).toContain('anonymous');
    expect(suspicionLabel('fr', 'trapped')).toBe('piégé');
    expect(suspicionLabel('en', 'review')).toBe('to review');
    expect(modeLabel('fr', 'neutralize')).toBe('neutraliser');
    expect(modeLabel('en', 'report')).toBe('report');
  });

  it('les deux langues diffèrent : aucune n’est une copie de l’autre', () => {
    expect(t('fr', 'trust.T3')).not.toBe(t('en', 'trust.T3'));
  });
});
