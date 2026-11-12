/**
 * §21 — honnêteté de la couverture.
 *
 * Ce qui n'a pas été analysé doit être **dit**, pas caché : une pièce jointe
 * illisible, une image, un binaire ou un document que la plateforme n'a pas su
 * ouvrir restent hors du champ de vision. Ce module chiffre cette part non
 * analysée pour un ticket puis pour un projet (nombre de pièces, octets,
 * formats) afin que l'indicateur soit exploitable par l'écran et par le rapport.
 *
 * Domaine pur : aucune E/S, aucune horloge, aucun import `@forge/*`.
 * Les octets sont fournis par l'appelant (la plateforme), jamais lus ici.
 */

import type { UnanalyzedReason } from './types';
import { clamp01 } from './findings';

/** Format déclaré d'une partie non analysée. */
export type UnanalyzedFormat =
  | 'text'
  | 'pdf'
  | 'ooxml'
  | 'image'
  | 'binary-attachment'
  | 'unsupported';

/** Une partie du ticket qui n'a pas pu être analysée. */
export interface UnanalyzedPart {
  /** Identifiant stable : nom de fichier, ou identifiant de segment. */
  id: string;
  format: UnanalyzedFormat;
  /** Taille en octets, telle que déclarée par la plateforme. */
  bytes: number;
  /** Pourquoi la partie n'a pas été analysée. */
  reason: UnanalyzedReason;
}

/** Ce qui a été analysé, pour calculer la part réellement couverte. */
export interface AnalyzedTotals {
  analyzedParts: number;
  analyzedBytes: number;
}

/** Part d'un format dans la partie non analysée. */
export interface FormatShare {
  format: UnanalyzedFormat;
  parts: number;
  bytes: number;
}

/** Part d'une raison dans la partie non analysée. */
export interface ReasonShare {
  reason: UnanalyzedReason;
  parts: number;
  bytes: number;
}

/** Chiffre de la couverture d'un ticket. */
export interface UnanalyzedCoverage {
  /** Nombre de parties non analysées. */
  parts: number;
  /** Octets non analysés. */
  bytes: number;
  analyzedParts: number;
  analyzedBytes: number;
  totalParts: number;
  totalBytes: number;
  /** Part non analysée en octets (0 → 1). */
  byteShare: number;
  /** Part non analysée en pièces (0 → 1). */
  partShare: number;
  formats: FormatShare[];
  reasons: ReasonShare[];
}

/** Agrégat d'un projet : le même chiffre, au niveau du portefeuille. */
export interface ProjectCoverage {
  projectKey: string;
  /** Nombre de tickets couverts par l'agrégat. */
  tickets: number;
  coverage: UnanalyzedCoverage;
  /** Couverture par ticket, triée par part non analysée décroissante. */
  byTicket: { ticketId: string; coverage: UnanalyzedCoverage }[];
}

interface Counter {
  parts: number;
  bytes: number;
}

/** Une pièce non analysée, telle que la plateforme la déclare. */
export interface TicketInput {
  ticketId: string;
  parts: UnanalyzedPart[];
  analyzed?: AnalyzedTotals;
}

function bump<K>(map: Map<K, Counter>, key: K, bytes: number, parts = 1): void {
  const entry = map.get(key);
  if (entry) {
    entry.parts += parts;
    entry.bytes += bytes;
  } else {
    map.set(key, { parts, bytes });
  }
}

function toShares<K>(map: Map<K, Counter>): { key: K; parts: number; bytes: number }[] {
  return [...map.entries()]
    .map(([key, value]) => ({ key, parts: value.parts, bytes: value.bytes }))
    .sort((a, b) => b.bytes - a.bytes || String(a.key).localeCompare(String(b.key)));
}

function ratios(bytes: number, analyzedBytes: number, parts: number, analyzedParts: number) {
  const totalBytes = bytes + analyzedBytes;
  const totalParts = parts + analyzedParts;
  return {
    totalBytes,
    totalParts,
    byteShare: totalBytes > 0 ? clamp01(bytes / totalBytes) : 0,
    partShare: totalParts > 0 ? clamp01(parts / totalParts) : 0,
  };
}

/**
 * Chiffre la part non analysée d'un ticket.
 * Les tailles négatives ou les doublons d'identifiant ne font pas exploser le
 * calcul : on borne à zéro et l'on compte les pièces telles qu'elles viennent.
 */
export function summarizeUnanalyzed(parts: UnanalyzedPart[], totals?: AnalyzedTotals): UnanalyzedCoverage {
  const analyzedParts = Math.max(0, Math.trunc(totals?.analyzedParts ?? 0));
  const analyzedBytes = Math.max(0, Math.trunc(totals?.analyzedBytes ?? 0));
  const byFormat = new Map<UnanalyzedFormat, Counter>();
  const byReason = new Map<UnanalyzedReason, Counter>();
  let bytes = 0;
  for (const part of parts) {
    const size = Math.max(0, Math.trunc(part.bytes));
    bytes += size;
    bump(byFormat, part.format, size);
    bump(byReason, part.reason, size);
  }
  const ratio = ratios(bytes, analyzedBytes, parts.length, analyzedParts);
  return {
    parts: parts.length,
    bytes,
    analyzedParts,
    analyzedBytes,
    totalParts: ratio.totalParts,
    totalBytes: ratio.totalBytes,
    byteShare: ratio.byteShare,
    partShare: ratio.partShare,
    formats: toShares(byFormat).map((s) => ({ format: s.key, parts: s.parts, bytes: s.bytes })),
    reasons: toShares(byReason).map((s) => ({ reason: s.key, parts: s.parts, bytes: s.bytes })),
  };
}

/** Agrège des couvertures de tickets en une couverture de projet. */
export function aggregateCoverage(reports: UnanalyzedCoverage[]): UnanalyzedCoverage {
  const byFormat = new Map<UnanalyzedFormat, Counter>();
  const byReason = new Map<UnanalyzedReason, Counter>();
  let parts = 0;
  let bytes = 0;
  let analyzedParts = 0;
  let analyzedBytes = 0;
  for (const report of reports) {
    parts += report.parts;
    bytes += report.bytes;
    analyzedParts += report.analyzedParts;
    analyzedBytes += report.analyzedBytes;
    for (const share of report.formats) bump(byFormat, share.format, share.bytes, share.parts);
    for (const share of report.reasons) bump(byReason, share.reason, share.bytes, share.parts);
  }
  const ratio = ratios(bytes, analyzedBytes, parts, analyzedParts);
  return {
    parts,
    bytes,
    analyzedParts,
    analyzedBytes,
    totalParts: ratio.totalParts,
    totalBytes: ratio.totalBytes,
    byteShare: ratio.byteShare,
    partShare: ratio.partShare,
    formats: toShares(byFormat).map((s) => ({ format: s.key, parts: s.parts, bytes: s.bytes })),
    reasons: toShares(byReason).map((s) => ({ reason: s.key, parts: s.parts, bytes: s.bytes })),
  };
}

/**
 * Couverture d'un projet : le total, et le détail par ticket afin de
 * retrouver d'où vient la part non analysée.
 */
export function projectCoverage(projectKey: string, tickets: TicketInput[]): ProjectCoverage {
  const byTicket = tickets.map((ticket) => ({
    ticketId: ticket.ticketId,
    coverage: summarizeUnanalyzed(ticket.parts, ticket.analyzed),
  }));
  byTicket.sort(
    (a, b) =>
      b.coverage.byteShare - a.coverage.byteShare ||
      b.coverage.bytes - a.coverage.bytes ||
      a.ticketId.localeCompare(b.ticketId),
  );
  return {
    projectKey,
    tickets: byTicket.length,
    coverage: aggregateCoverage(byTicket.map((entry) => entry.coverage)),
    byTicket,
  };
}

/** Y a-t-il quelque chose à dire ? (le bandeau n'apparaît que s'il y a du non analysé) */
export function hasUnanalyzed(coverage: UnanalyzedCoverage): boolean {
  return coverage.parts > 0 || coverage.bytes > 0;
}

/**
 * Sévérité de la part non analysée, bornée et lisible : elle sert à trier
 * les tickets et à prioriser une reprise humaine. Jamais un verdict.
 */
export type CoverageSeverity = 'none' | 'low' | 'medium' | 'high';

export function coverageSeverity(coverage: UnanalyzedCoverage): CoverageSeverity {
  if (!hasUnanalyzed(coverage)) return 'none';
  const share = Math.max(coverage.byteShare, coverage.partShare);
  if (share >= 0.5) return 'high';
  if (share >= 0.2) return 'medium';
  return 'low';
}
