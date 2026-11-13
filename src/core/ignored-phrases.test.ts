/**
 * Formules à ignorer (§14) — le calcul des intervalles couverts.
 *
 * Ce module porte une seule règle, partagée par C2 et C3 : une formule du
 * projet ne lève aucun constat, et le modèle ne la lit pas. Les tests
 * vérifient le pliage (casse, accents, apostrophes typographiques), la
 * couverture exacte, et le fait qu'une formule vide n'ignore jamais rien.
 */

import { describe, expect, it } from 'vitest';
import {
  IGNORED_MARKER,
  MIN_PHRASE_CHARS,
  ignoredSpans,
  isCovered,
  readableRemainder,
  withoutIgnoredPhrases,
} from './ignored-phrases';

const FOOTER = 'Ce message est destiné à son seul destinataire.';

describe('intervalles couverts', () => {
  it('trouve une formule malgré la casse, les accents et les apostrophes typographiques', () => {
    const text = 'Bonjour,\n\nConfidentialite : CE MESSAGE EST DESTINE à son seul destinataire.\n';
    const spans = ignoredSpans(text, ['confidentialité : ce message est destiné à son seul destinataire']);
    expect(spans).toHaveLength(1);
    expect(isCovered(spans[0]!.start, spans[0]!.end, spans)).toBe(true);
  });

  it('rend les positions du texte d’origine, pas celles du texte plié', () => {
    const text = `Préambule accentué. ${FOOTER}`;
    const spans = ignoredSpans(text, ['ce message est destiné à son seul destinataire']);
    const covered = text.slice(spans[0]!.start, spans[0]!.end);
    expect(covered.toLowerCase()).toContain('ce message est destiné');
    expect(covered).not.toContain('Préambule');
  });

  it('ne couvre rien pour une formule vide, courte, ou absente du texte', () => {
    expect(ignoredSpans(FOOTER, ['', '   ', 'ab', 'formule qui n’existe pas'])).toEqual([]);
    expect(MIN_PHRASE_CHARS).toBeGreaterThan(3);
  });

  it('fusionne deux formules qui se chevauchent', () => {
    const text = 'mention légale : ne pas imprimer ce message';
    const spans = ignoredSpans(text, ['mention légale : ne pas', 'ne pas imprimer ce message']);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(text);
  });
});

describe('texte sans les passages ignorés', () => {
  it('retire le pied de page et garde la demande réelle', () => {
    const text = `Bonjour, merci de mettre à jour mon adresse de facturation.\n\n${FOOTER}`;
    const kept = withoutIgnoredPhrases(text, ['ce message est destiné à son seul destinataire']);
    expect(kept).toContain('mettre à jour mon adresse de facturation');
    expect(kept).not.toContain('destiné à son seul destinataire');
    expect(kept).toContain(IGNORED_MARKER);
  });

  it('rend le texte intact quand aucune formule ne s’applique', () => {
    const text = 'Bonjour, mon export échoue depuis mardi.';
    expect(withoutIgnoredPhrases(text, ['mention légale'])).toBe(text);
    expect(withoutIgnoredPhrases(text, [])).toBe(text);
  });

  it('vide un texte entièrement couvert', () => {
    const kept = withoutIgnoredPhrases(FOOTER, ['ce message est destiné à son seul destinataire']);
    expect(kept.replace(IGNORED_MARKER, '').trim().length).toBeLessThan(20);
  });
});


describe('reste à juger', () => {
  it('une chaîne vide quand le texte n’est que des formules ignorées', () => {
    expect(readableRemainder(FOOTER, ['ce message est destiné à son seul destinataire'])).toBe('');
  });

  it('garde la demande réelle quand elle accompagne le pied de page', () => {
    const text = `Merci de mettre à jour mon adresse.\n\n${FOOTER}`;
    expect(readableRemainder(text, ['ce message est destiné à son seul destinataire']))
      .toContain('mettre à jour');
  });
});
