/**
 * Constats (§6, TP-05) — assemblage des coups de détection en `Finding`.
 *
 * Un constat porte sa couche, son extrait, sa position, un résumé neutre de ce
 * que le passage demande et une confiance. Il porte aussi une empreinte de
 * charge (`campaignHash`) : c'est elle qui regroupe les campagnes (§14) et qui
 * permet de reconnaître une charge déjà vue.
 *
 * Deux exigences de tenue, tirées du §21 (« peu de bruit ») :
 *  - deux règles qui frappent le même passage ne font qu'un constat affiché ;
 *  - l'identifiant d'un constat est **stable** pour un même passage : un verdict
 *    humain ne se perd pas au réexamen suivant.
 */

import type { Finding, FindingKind, LayerHit, SegmentSource } from './types';
import { contentHash, sha256 } from './hashing';
import { t } from './i18n';
import type { Language } from './types';

/** Ce qu'il faut pour fabriquer des constats : des coups, un segment, l'heure. */
export interface FindingsInput {
  hits: LayerHit[];
  segment: SegmentSource;
  segmentId: string;
  language?: Language;
  now: string;
}

/** Deux coups se chevauchent-ils ? (bornes incluses, tolérance de 2 caractères). */
export function overlaps(a: LayerHit, b: LayerHit, tolerance = 2): boolean {
  return a.startPos <= b.endPos + tolerance && b.startPos <= a.endPos + tolerance;
}

/**
 * Ne garde qu'un coup par passage. À confiance égale, la couche déterministe la
 * plus basse l'emporte (C1 avant C2, C2 avant C3, C3 avant C4) : une preuve
 * vérifiable passe avant une pondération.
 */
export function dedupeHits(hits: LayerHit[]): LayerHit[] {
  const sorted = [...hits].sort((a, b) => {
    if (a.startPos !== b.startPos) return a.startPos - b.startPos;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.layer.localeCompare(b.layer);
  });
  const kept: LayerHit[] = [];
  for (const hit of sorted) {
    const twin = kept.find((other) => overlaps(other, hit));
    if (!twin) {
      kept.push(hit);
      continue;
    }
    if (hit.confidence > twin.confidence) {
      kept[kept.indexOf(twin)] = hit;
    }
  }
  return kept.sort((a, b) => a.startPos - b.startPos);
}

/** Identifiant stable d'un constat : même passage, même identifiant au réexamen. */
export function findingId(segmentId: string, hit: LayerHit): string {
  return `${hit.layer}-${sha256(`${segmentId}:${hit.ruleId}:${hit.startPos}:${hit.kind}`).slice(0, 12)}`;
}

/** Résumé neutre par défaut quand la couche n'en a pas fourni (§6). */
export function defaultAskSummary(kind: FindingKind, language: Language): string {
  const key = `ask.${kind}`;
  const text = t(language, key);
  return text === key ? t(language, 'ask.unknown') : text;
}

/**
 * Transforme les coups d'un segment en constats. L'extrait est borné (jamais la
 * charge entière dans une ligne de journal), et l'empreinte de campagne porte
 * sur l'extrait normalisé : deux copies de la même charge se regroupent.
 */
export function toFindings(input: FindingsInput): Finding[] {
  const { segment, segmentId, hits, now } = input;
  const language = input.language ?? 'fr';
  return dedupeHits(hits).map((hit) => {
    const excerpt = boundedExcerpt(hit.excerpt);
    return {
      id: findingId(segmentId, hit),
      segmentId,
      issueId: segment.issueId,
      layer: hit.layer,
      kind: hit.kind,
      ruleId: hit.ruleId,
      excerpt,
      startPos: hit.startPos,
      endPos: hit.endPos,
      askSummary: hit.askSummary.trim().length > 0
        ? hit.askSummary
        : defaultAskSummary(hit.kind, language),
      confidence: clamp01(hit.confidence),
      status: 'open',
      campaignHash: contentHash(excerpt),
      createdAt: now,
    };
  });
}

/** Extrait borné : 160 caractères, ellipse comprise (§21 : journal lisible). */
export function boundedExcerpt(excerpt: string, max = 160): string {
  const clean = excerpt.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Confiance ramenée dans [0, 1] : aucune couche ne peut promettre plus. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Constats d'un ticket, triés par position (bandeau, panneau du ticket). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.segmentId !== b.segmentId) return a.segmentId.localeCompare(b.segmentId);
    return a.startPos - b.startPos;
  });
}

/** Constats encore actifs : ni neutralisés, ni restaurés (§8.3). */
export function activeFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.status === 'open');
}
