/**
 * Canary appât (§43, TP) — une fausse donnée sensible, marquée, déposée dans
 * un ticket témoin. Si elle réapparaît ailleurs (réponse, autre ticket,
 * export), ce n'est pas une simple obéissance : c'est un **incident
 * d'exfiltration** (#46), porté par un événement doté d'une gravité.
 *
 * La donnée est volontairement faussée (faux IBAN, fausse clé, faux nom de
 * client) et porte un marqueur unique (`appat-<jeton>`), afin de ne signaler
 * que ses propres appâts — jamais une donnée réelle rencontrée par hasard.
 * En mode `report`, rien ne change dans le portail : l'incident est constaté,
 * pas annoncé à l'attaquant (§21).
 */

import type { Language } from './types';
import { randomToken } from './hashing';
import { t } from './i18n';

/** Frappes d'appât disponibles (§43). */
export const LURE_KINDS = ['fake-iban', 'fake-api-key', 'fake-customer-name'] as const;
export type LureKind = (typeof LURE_KINDS)[number];

/** Gravité d'un incident d'exfiltration, par nature de donnée (§46). */
export type LureSeverity = 'medium' | 'high' | 'critical';

/** Préfixe du marqueur : reconnaissable, imbriqué tel quel dans la valeur. */
export const LURE_MARKER_PREFIX = 'appat-';

/** Gravité par frappe : une clé qui ressort est plus grave qu'un nom de client. */
export const LURE_SEVERITIES: Record<LureKind, LureSeverity> = {
  'fake-iban': 'high',
  'fake-api-key': 'critical',
  'fake-customer-name': 'medium',
};

/** Un appât en vie : fausse donnée + marqueur, attachés à un ticket témoin. */
export interface Lure {
  id: string;
  kind: LureKind;
  /** valeur volontairement faussée, porte toujours le marqueur */
  value: string;
  /** marqueur unique : sert à ne signaler que ses propres appâts */
  marker: string;
  issueId: string;
  issueKey: string;
  plantedBy: string;
  plantedAt: string;
}

/** Ce qu'il faut pour déposer un appât dans un ticket témoin. */
export interface LurePlant {
  issueId: string;
  issueKey: string;
  plantedBy: string;
  kind: LureKind;
  now: string;
  /** jeton injecté en test ; aléatoire en production. */
  token?: string;
}

/** L'événement produit dès qu'un appât est touché ailleurs, avec gravité (#46). */
export interface ExfiltrationIncident {
  lureId: string;
  kind: LureKind;
  severity: LureSeverity;
  foundIn: string;
  at: string;
  matchedBy: 'value' | 'marker';
}

/** Détermine si un texte contient un appât (valeur complète puis marqueur). */
export interface LeakCheck {
  lure: Lure;
  text: string;
  foundIn: string;
  at: string;
}

/** Marqueur d'un jetondonnée : unique, préfixé, stable. */
export function markerFor(token: string): string {
  return `${LURE_MARKER_PREFIX}${token}`;
}

/** Valeur factice crédible selon la frappe, portant toujours le marqueur. */
export function lureValueFor(kind: LureKind, token: string): string {
  const marker = markerFor(token);
  if (kind === 'fake-iban') return `FR76 ${marker} 0000 00`;
  if (kind === 'fake-api-key') return `sk-${marker}`;
  return `Client ${marker}`;
}

/** Dépose un appât : valeur factice + marqueur, sans aucune donnée réelle. */
export function createLure(plant: LurePlant): Lure {
  const token = plant.token ?? randomToken();
  return {
    id: `lure-${token}`,
    kind: plant.kind,
    value: lureValueFor(plant.kind, token),
    marker: markerFor(token),
    issueId: plant.issueId,
    issueKey: plant.issueKey,
    plantedBy: plant.plantedBy,
    plantedAt: plant.now,
  };
}

/** Gravité attachée à une frappe d'appât (#46). */
export function severityFor(kind: LureKind): LureSeverity {
  return LURE_SEVERITIES[kind];
}

/**
 * Un appât qui réapparaît ailleurs est un incident d'exfiltration, pas une
 * simple obéissance (§43). La recherche est insensible à la casse ; si la
 * valeur complète manque, le marqueur seul suffit.
 */
export function detectLureLeak(check: LeakCheck): ExfiltrationIncident | null {
  const lower = check.text.toLowerCase();
  const value = check.lure.value.toLowerCase();
  const matchedBy = lower.includes(value) ? 'value' : lower.includes(check.lure.marker.toLowerCase()) ? 'marker' : null;
  if (matchedBy === null) return null;
  return {
    lureId: check.lure.id,
    kind: check.lure.kind,
    severity: severityFor(check.lure.kind),
    foundIn: check.foundIn,
    at: check.at,
    matchedBy,
  };
}

/** Description visible d'un incident, dans la langue du site (§21). */
export function describeIncident(language: Language, incident: ExfiltrationIncident): string {
  const kind = t(language, `lure.kind.${incident.kind}`);
  const severity = t(language, `lure.severity.${incident.severity}`);
  return `${t(language, 'lure.incident')} (${kind}, ${severity})`;
}