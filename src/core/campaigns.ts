/**
 * Campagnes (§14, §22, lot S) — regrouper les charges identiques.
 *
 * « La même charge dans plusieurs demandes est regroupée : une alerte, pas
 * cinq cents. » Le regroupement se fait par la clé de campagne : l'empreinte de
 * la charge (`campaignHash` posé par `findings.ts`, sinon recalculée sur
 * l'extrait normalisé via `contentHash`). Deux copies de la même charge, à la
 * mise en forme près, tombent sur la même clé.
 *
 * Cinq cents demandes identiques en une heure (§22) ⇒ UNE campagne, UNE alerte
 * portant la liste des tickets et le compteur ; un verdict humain vaut alors
 * pour toute la campagne (§14).
 *
 * Domaine pur : les dates viennent des constats (aucune heure lue), aucune E/S.
 */

import type { Campaign, Finding } from './types';
import { contentHash } from './hashing';

/** Une alerte de campagne : ce que la file « Suspects » affiche (§23.14). */
export interface CampaignAlert {
  campaignId: string;
  payloadHash: string;
  count: number;
  issueKeys: string[];
}

/**
 * Clé de campagne d'un constat : son empreinte de charge si elle est posée,
 * sinon l'empreinte de l'extrait normalisé (même règle que `findings.ts`).
 */
export function campaignKey(finding: Pick<Finding, 'campaignHash' | 'excerpt'>): string {
  const hash = finding.campaignHash?.trim();
  return hash && hash.length > 0 ? hash : contentHash(finding.excerpt);
}

/** Identifiant stable d'une campagne : dérivé de l'empreinte de charge. */
export function campaignId(payloadHash: string): string {
  return `campaign-${payloadHash.slice(0, 16)}`;
}

/** Ajoute une clé de ticket à une liste, sans doublon. */
function pushIssueKey(keys: string[], issueKey: string): void {
  if (!keys.includes(issueKey)) keys.push(issueKey);
}

/**
 * Regroupe des constats en campagnes. Par campagne : première et dernière vue
 * (dates des constats), compteur de constats, liste des tickets sans doublon.
 * `issueKeyOf` résout la clé lisible d'un constat (défaut : son `issueId`,
 * seul identifiant porté par le type `Finding`).
 * Sortie stable : campagnes les plus nombreuses d'abord, puis empreinte.
 */
export function groupIntoCampaigns(
  findings: Finding[],
  issueKeyOf: (finding: Finding) => string = (finding) => finding.issueId,
): Campaign[] {
  const byKey = new Map<string, Campaign>();
  for (const finding of findings) {
    const key = campaignKey(finding);
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, {
        id: campaignId(key),
        payloadHash: key,
        firstSeen: finding.createdAt,
        lastSeen: finding.createdAt,
        count: 1,
        issueKeys: [issueKeyOf(finding)],
      });
      continue;
    }
    if (finding.createdAt < known.firstSeen) known.firstSeen = finding.createdAt;
    if (finding.createdAt > known.lastSeen) known.lastSeen = finding.createdAt;
    known.count += 1;
    pushIssueKey(known.issueKeys, issueKeyOf(finding));
  }
  return [...byKey.values()].sort((a, b) => {
    const diff = b.count - a.count;
    return diff !== 0 ? diff : a.payloadHash.localeCompare(b.payloadHash);
  });
}

/** Une alerte par campagne, avec la liste des tickets et le compteur (§14). */
export function alertsFor(campaigns: Campaign[]): CampaignAlert[] {
  return campaigns.map((campaign) => ({
    campaignId: campaign.id,
    payloadHash: campaign.payloadHash,
    count: campaign.count,
    issueKeys: [...campaign.issueKeys],
  }));
}
