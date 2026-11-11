import { describe, expect, it } from 'vitest';
import type { LurePlant } from './lure';
import { createLure, describeIncident, detectLureLeak, lureValueFor, markerFor, severityFor } from './lure';

const PLANT: LurePlant = {
  issueId: '10001',
  issueKey: 'SUP-900',
  plantedBy: 'acc-secu',
  kind: 'fake-api-key',
  now: '2026-11-11T10:00:00.000Z',
  token: 'abc123',
};

describe('canary appât (§43)', () => {
  it('un appât porte une valeur factice qui contient son marqueur', () => {
    const lure = createLure(PLANT);
    expect(lure.value).toContain(lure.marker);
    expect(lure.marker).toBe(markerFor('abc123'));
    expect(lure.value).toBe(lureValueFor('fake-api-key', 'abc123'));
  });

  it('la valeur est distincte selon la frappe', () => {
    expect(lureValueFor('fake-iban', 'x')).toContain('FR76');
    expect(lureValueFor('fake-api-key', 'x')).toContain('sk-');
    expect(lureValueFor('fake-customer-name', 'x')).toContain('Client');
  });

  it('un appât intact ne produit rien', () => {
    const lure = createLure(PLANT);
    const incident = detectLureLeak({
      lure,
      text: 'un texte ordinaire sans révélation',
      foundIn: 'SUP-901',
      at: PLANT.now,
    });
    expect(incident).toBeNull();
  });

  it('un appât touché ailleurs produit un incident, pas une obéissance', () => {
    const lure = createLure(PLANT);
    const incident = detectLureLeak({
      lure,
      text: `voici la clé ${lure.value}`,
      foundIn: 'SUP-901',
      at: PLANT.now,
    });
    expect(incident).not.toBeNull();
    expect(incident?.kind).toBe('fake-api-key');
    expect(incident?.matchedBy).toBe('value');
    expect(incident?.foundIn).toBe('SUP-901');
  });

  it('le marqueur seul suffit, insensible à la casse', () => {
    const lure = createLure(PLANT);
    const incident = detectLureLeak({
      lure,
      text: lure.marker.toUpperCase(),
      foundIn: 'export',
      at: PLANT.now,
    });
    expect(incident?.matchedBy).toBe('marker');
  });
});

describe('alerte et gravité (#46)', () => {
  it('une clé qui ressort est plus grave qu’un nom de client', () => {
    expect(severityFor('fake-api-key')).toBe('critical');
    expect(severityFor('fake-iban')).toBe('high');
    expect(severityFor('fake-customer-name')).toBe('medium');
  });

  it('la description est lisible et localisée', () => {
    const lure = createLure(PLANT);
    const incident = detectLureLeak({ lure, text: lure.value, foundIn: 'SUP-901', at: PLANT.now });
    expect(describeIncident('fr', incident!)).toContain('exfiltration');
    expect(describeIncident('en', incident!)).toContain('exfiltration');
  });
});