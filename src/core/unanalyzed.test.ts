import { describe, expect, it } from 'vitest';

import {
  aggregateCoverage,
  coverageSeverity,
  hasUnanalyzed,
  projectCoverage,
  summarizeUnanalyzed,
  type UnanalyzedPart,
} from './unanalyzed';

function part(id: string, format: UnanalyzedPart['format'], bytes: number, reason: UnanalyzedPart['reason']): UnanalyzedPart {
  return { id, format, bytes, reason };
}

describe('summarizeUnanalyzed', () => {
  it('chiffre exactement la part non analysée', () => {
    const coverage = summarizeUnanalyzed(
      [
        part('a.pdf', 'pdf', 300, 'unsupported-format'),
        part('b.png', 'image', 100, 'image'),
        part('c.bin', 'binary-attachment', 600, 'binary-attachment'),
      ],
      { analyzedParts: 4, analyzedBytes: 1000 },
    );
    expect(coverage.parts).toBe(3);
    expect(coverage.bytes).toBe(1000);
    expect(coverage.totalParts).toBe(7);
    expect(coverage.totalBytes).toBe(2000);
    expect(coverage.byteShare).toBeCloseTo(0.5, 10);
    expect(coverage.partShare).toBeCloseTo(3 / 7, 10);
  });

  it('regroupe par format et par raison, trié par octets décroissants', () => {
    const coverage = summarizeUnanalyzed([
      part('a.pdf', 'pdf', 10, 'unsupported-format'),
      part('b.pdf', 'pdf', 90, 'oversize'),
      part('c.png', 'image', 40, 'image'),
    ]);
    expect(coverage.formats.map((f) => f.format)).toEqual(['pdf', 'image']);
    expect(coverage.formats[0]).toEqual({ format: 'pdf', parts: 2, bytes: 100 });
    expect(coverage.reasons.map((r) => r.reason)).toEqual(['oversize', 'image', 'unsupported-format']);
    expect(coverage.reasons[0]?.bytes).toBe(90);
  });

  it('reste à zéro quand tout est analysé', () => {
    const coverage = summarizeUnanalyzed([], { analyzedParts: 2, analyzedBytes: 500 });
    expect(coverage.parts).toBe(0);
    expect(coverage.bytes).toBe(0);
    expect(coverage.byteShare).toBe(0);
    expect(coverage.partShare).toBe(0);
    expect(coverage.formats).toEqual([]);
    expect(coverage.reasons).toEqual([]);
    expect(hasUnanalyzed(coverage)).toBe(false);
  });

  it('ne divise jamais par zéro et ne jette jamais', () => {
    const coverage = summarizeUnanalyzed([]);
    expect(coverage.totalBytes).toBe(0);
    expect(coverage.byteShare).toBe(0);
  });

  it('borne les tailles négatives ou fractionnaires à zéro', () => {
    const coverage = summarizeUnanalyzed([part('a.pdf', 'pdf', -50, 'oversize'), part('b.pdf', 'pdf', 12.7, 'oversize')]);
    expect(coverage.bytes).toBe(12);
    expect(coverage.formats[0]?.bytes).toBe(12);
  });
});

describe('aggregateCoverage', () => {
  it('additionne les tickets sans perdre le détail des formats', () => {
    const ticketA = summarizeUnanalyzed([part('a.pdf', 'pdf', 400, 'oversize')], { analyzedParts: 1, analyzedBytes: 100 });
    const ticketB = summarizeUnanalyzed([part('b.pdf', 'pdf', 600, 'oversize'), part('c.png', 'image', 400, 'image')]);
    const project = aggregateCoverage([ticketA, ticketB]);
    expect(project.parts).toBe(3);
    expect(project.bytes).toBe(1400);
    expect(project.analyzedBytes).toBe(100);
    expect(project.totalBytes).toBe(1500);
    expect(project.byteShare).toBeCloseTo(1400 / 1500, 10);
    const pdf = project.formats.find((f) => f.format === 'pdf');
    expect(pdf).toEqual({ format: 'pdf', parts: 2, bytes: 1000 });
  });

  it('est stable : mêmes entrées, mêmes chiffres', () => {
    const a = summarizeUnanalyzed([part('x.png', 'image', 10, 'image')]);
    const b = summarizeUnanalyzed([part('y.png', 'image', 10, 'image')]);
    expect(aggregateCoverage([a, b])).toEqual(aggregateCoverage([b, a]));
  });
});

describe('projectCoverage', () => {
  it('rend le total et le détail par ticket, le plus exposé en premier', () => {
    const project = projectCoverage('SUP', [
      { ticketId: 'SUP-2', parts: [part('a.png', 'image', 100, 'image')], analyzed: { analyzedParts: 3, analyzedBytes: 900 } },
      { ticketId: 'SUP-1', parts: [part('b.bin', 'binary-attachment', 800, 'binary-attachment')] },
    ]);
    expect(project.projectKey).toBe('SUP');
    expect(project.tickets).toBe(2);
    expect(project.byTicket[0]?.ticketId).toBe('SUP-1');
    expect(project.byTicket[0]?.coverage.byteShare).toBe(1);
    expect(project.coverage.parts).toBe(2);
    expect(project.coverage.bytes).toBe(900);
  });

  it('trie à part égale par identifiant de ticket', () => {
    const project = projectCoverage('SUP', [
      { ticketId: 'SUP-9', parts: [] },
      { ticketId: 'SUP-1', parts: [] },
    ]);
    expect(project.byTicket.map((t) => t.ticketId)).toEqual(['SUP-1', 'SUP-9']);
  });
});

describe('coverageSeverity', () => {
  it('borne la sévérité sans jamais trancher seule', () => {
    expect(coverageSeverity(summarizeUnanalyzed([]))).toBe('none');
    const low = summarizeUnanalyzed([part('a.png', 'image', 10, 'image')], { analyzedParts: 9, analyzedBytes: 990 });
    expect(coverageSeverity(low)).toBe('low');
    const medium = summarizeUnanalyzed([part('a.png', 'image', 300, 'image')], { analyzedParts: 2, analyzedBytes: 700 });
    expect(coverageSeverity(medium)).toBe('medium');
    const high = summarizeUnanalyzed([part('a.png', 'image', 900, 'image')], { analyzedParts: 0, analyzedBytes: 100 });
    expect(coverageSeverity(high)).toBe('high');
  });

  it('monte en sévérité si une seule pièce énorme n’est pas lue', () => {
    const coverage = summarizeUnanalyzed([part('a.bin', 'binary-attachment', 10, 'binary-attachment')], {
      analyzedParts: 50,
      analyzedBytes: 10,
    });
    expect(coverage.byteShare).toBe(0.5);
    expect(coverageSeverity(coverage)).toBe('high');
  });
});
