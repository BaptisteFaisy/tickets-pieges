import { describe, expect, it } from 'vitest';
import {
  SELF_WRITE_KINDS,
  SELF_WRITE_WINDOW_MS,
  isSelfEcho,
  lastSelfWriteAge,
} from './self-write';

const NOW = '2026-11-12T12:00:00.000Z';

function marks(...entries: [string, string][]): { kind: string; at: string }[] {
  return entries.map(([kind, at]) => ({ kind, at }));
}

describe('garde anti-écho (Confluence n’a pas de filtre ignoreSelf)', () => {
  it('une écriture à nous il y a 5 s est un écho', () => {
    expect(isSelfEcho(marks(['label-applied', '2026-11-12T11:59:55.000Z']), NOW)).toBe(true);
  });

  it('une écriture plus ancienne que la fenêtre n’est plus un écho', () => {
    const old = new Date(Date.parse(NOW) - SELF_WRITE_WINDOW_MS - 1000).toISOString();
    expect(isSelfEcho(marks(['neutralize', old]), NOW)).toBe(false);
  });

  it('une lecture journalisée (scan) n’est jamais un écho', () => {
    expect(isSelfEcho(marks(['scan', NOW]), NOW)).toBe(false);
  });

  it('aucune entrée, ou une date illisible : pas d’écho (on analyse)', () => {
    expect(isSelfEcho([], NOW)).toBe(false);
    expect(isSelfEcho(marks(['neutralize', 'pas-une-date']), NOW)).toBe(false);
    expect(isSelfEcho(marks(['neutralize', NOW]), 'pas-une-date')).toBe(false);
  });

  it('une écriture future n’est pas un écho (horloge désynchronisée)', () => {
    expect(isSelfEcho(marks(['neutralize', '2026-11-12T12:05:00.000Z']), NOW)).toBe(false);
  });

  it('la fenêtre est réglable', () => {
    const at = '2026-11-12T11:59:30.000Z';
    expect(isSelfEcho(marks(['neutralize', at]), NOW, 10_000)).toBe(false);
    expect(isSelfEcho(marks(['neutralize', at]), NOW, 60_000)).toBe(true);
  });

  it('les gestes d’écriture couverts sont ceux qui modifient le ticket', () => {
    for (const kind of [
      'property-written',
      'label-applied',
      'neutralize',
      'restore',
      'confluence-write',
      'replace-segment',
    ]) {
      expect(SELF_WRITE_KINDS).toContain(kind);
    }
    expect(SELF_WRITE_KINDS).not.toContain('scan');
  });

  it('l’écriture de la propriété indexée est un écho (elle déclenche un événement)', () => {
    // Mesuré le 12 novembre 2026 : écrire `pieges` déclenche
    // `avi:jira:updated:issue` ; sans cette trace, l'app réanalyse son propre
    // écrit et la couche C3 devient intermittente.
    const marks = [{ kind: 'property-written', at: '2026-11-12T12:00:02.000Z' }];
    expect(isSelfEcho(marks, '2026-11-12T12:00:05.000Z')).toBe(true);
    // Au-delà de la fenêtre par défaut (120 s), l'événement n'est plus un écho.
    expect(isSelfEcho(marks, '2026-11-12T12:02:30.000Z')).toBe(false);
    // Le déclencheur, lui, utilise une fenêtre courte (20 s).
    expect(isSelfEcho(marks, '2026-11-12T12:00:05.000Z', 20_000)).toBe(true);
    expect(isSelfEcho(marks, '2026-11-12T12:00:40.000Z', 20_000)).toBe(false);
  });

  it('l’âge de la dernière écriture se lit pour décider', () => {
    const age = lastSelfWriteAge(
      marks(['scan', '2026-11-12T11:59:59.000Z'], ['neutralize', '2026-11-12T11:59:50.000Z']),
      NOW,
    );
    expect(age).toBe(10_000);
    expect(lastSelfWriteAge(marks(['scan', NOW]), NOW)).toBeNull();
    expect(lastSelfWriteAge([], NOW)).toBeNull();
  });
});
