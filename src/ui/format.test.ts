import { describe, expect, it } from 'vitest';
import { byMonth, confidenceLabel, languageOf, monthOf, percent, shortDate, splitList, truncate } from './format';

describe('languageOf (§21 : fr et en)', () => {
  it('reconnaît le français et l’anglais, défaut français', () => {
    expect(languageOf('fr-FR')).toBe('fr');
    expect(languageOf('en-US')).toBe('en');
    expect(languageOf(null)).toBe('fr');
    expect(languageOf('de-DE')).toBe('fr');
  });
});

describe('percent', () => {
  it('arrondit et borne la part affichée', () => {
    expect(percent(0.424)).toBe('42 %');
    expect(percent(1)).toBe('100 %');
    expect(percent(-3)).toBe('0 %');
    expect(percent(Number.NaN)).toBe('0 %');
  });
});

describe('shortDate / monthOf', () => {
  it('extrait la date courte et le mois d’un ISO', () => {
    expect(shortDate('2026-11-11T12:00:00.000Z')).toBe('2026-11-11');
    expect(shortDate('pas-une-date')).toBe('pas-une-date');
    expect(monthOf('2026-11-11T12:00:00.000Z')).toBe('2026-11');
    expect(monthOf('x')).toBe('');
  });
});

describe('byMonth (§17.5)', () => {
  it('compte par mois, du plus ancien au plus récent', () => {
    const entries = byMonth(['2026-11-02T00:00:00Z', '2026-10-05T00:00:00Z', '2026-11-09T00:00:00Z']);
    expect(entries).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-11', count: 2 },
    ]);
  });

  it('ignore les entrées qui ne sont pas des dates', () => {
    expect(byMonth(['x', ''])).toEqual([]);
  });
});

describe('splitList (§17.4)', () => {
  it('découpe, nettoie et déduplique les listes saisies', () => {
    expect(splitList(' a.fr , b.fr\n a.fr ; c.fr ')).toEqual(['a.fr', 'b.fr', 'c.fr']);
    expect(splitList('   ')).toEqual([]);
  });
});

describe('truncate / confidenceLabel', () => {
  it('borne un texte long sans le couper au milieu d’un mot visible', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('ab', 10)).toBe('ab');
  });

  it('affiche la confiance en pourcentage', () => {
    expect(confidenceLabel(0.85)).toBe('85 %');
  });
});
