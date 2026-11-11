/**
 * Le sas de sortie (§10, TP-13, TP-24) — ce qu'une IA s'apprête à renvoyer vers
 * l'extérieur.
 *
 * « La fuite a besoin d'un chemin de retour vers l'attaquant. Dans un service de
 * support, ce chemin est le plus souvent la réponse publique. » Le contrôle cherche
 * quatre choses : des données d'un autre client, une adresse web inconnue ou à
 * requête anormalement longue, un bloc encodé, une réponse sans rapport avec la
 * demande.
 *
 * Trois moments (§10), trois effets :
 *  - avant, par les outils de l'app  → le brouillon reste une note interne ;
 *  - avant, par le hook              → confirmation demandée au pilote ;
 *  - après, pour toute autre réponse → contrôle dans les secondes qui suivent,
 *    alerte à la sécurité, et en mode strict le commentaire repasse en interne.
 *
 * Limite dite clairement : après coup, le courriel de notification est peut-être
 * déjà parti. Le sas limite, il n'empêche pas tout.
 */

import type { Language, OutboundAction, OutboundContext, OutboundHit, OutboundKind, OutboundVerdict } from './types';
import { shingleOverlap, shingles } from './hashing';
import { clamp01 } from './findings';
import { t } from './i18n';
import { detectDlp } from './dlp';
import type { DlpFinding } from './dlp';
import { redact } from './redaction';
import type { RedactionTable } from './redaction';

/** Au-delà, une requête d'URL est « anormalement longue » (§10). */
export const MAX_URL_QUERY = 300;

/** Longueur minimale d'un bloc encodé suspect. */
export const MIN_ENCODED_RUN = 60;

/** Recouvrement lexical sous lequel une réponse est dite « sans rapport ». */
export const MIN_RELEVANCE = 0.06;

/** Confiance à partir de laquelle un élément retient la réponse. */
export const HOLD_CONFIDENCE = 0.6;

/** Longueur minimale d'une réponse pour que le rapport au sujet soit mesuré. */
export const MIN_OFFTOPIC_LENGTH = 120;

/** À quel moment le contrôle a lieu (§10). */
export type OutboundStage = 'before' | 'after';

export interface OutboundOptions {
  stage?: OutboundStage;
  language?: Language;
  now?: string;
}

/**
 * Verdict du sas enrichi par les contrôles des lots DLP (#33/#34/#35/#37).
 *
 * `OutboundVerdict` reste la forme minimale consommée par le reste du produit ;
 * ces champs supplémentaires sont ajoutés ici, sans toucher au tronc — à
 * reprendre dans `types-flow.ts` quand le lot sera fusionné.
 */
export interface OutboundDlpResult extends OutboundVerdict {
  /** Données personnelles relevées, avec leur `ruleId` et leur confiance. */
  dlp: DlpFinding[];
  /** Texte masqué, prêt à être rendu ; `null` si rien n'a été masqué. */
  redactedText: string | null;
  /** Table de masquage à conserver hors du ticket. */
  redactionTable: RedactionTable | null;
  /** `true` : une relecture humaine ne suffit pas, il en faut deux (#37). */
  requiresDoubleReview: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s)"'<>\]]+/g;
const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const ENCODED_PATTERN = /[A-Za-z0-9+/=_-]{60,}/g;

/** Un élément en cause, avec son extrait court et sa confiance. */
function hit(kind: OutboundKind, excerpt: string, confidence: number, language: Language, detail?: string): OutboundHit {
  return { kind, excerpt: excerpt.slice(0, 120), detail, confidence: clamp01(confidence) };
}

/** Clés d'autres tickets citées dans la réponse (§10 : « clé d'un autre ticket »). */
export function findOtherIssueKeys(text: string, context: OutboundContext, language: Language): OutboundHit[] {
  const current = context.issueKey.toUpperCase();
  const found = new Set<string>();
  for (const match of text.match(ISSUE_KEY_PATTERN) ?? []) {
    if (match.toUpperCase() !== current) found.add(match);
  }
  const known = new Set((context.otherIssueKeys ?? []).map((key) => key.toUpperCase()));
  return [...found].map((key) =>
    hit('other-issue-key', key, known.has(key.toUpperCase()) ? 0.95 : 0.7, language, t(language, 'outbound.other-issue-key')),
  );
}

/** Noms d'autres organisations cités dans la réponse (§10 : « nom d'organisation »). */
export function findOtherOrganizations(text: string, context: OutboundContext, language: Language): OutboundHit[] {
  const lowered = text.toLowerCase();
  const others = context.otherOrganizations ?? [];
  const requester = (context.requesterOrganization ?? '').toLowerCase();
  return others
    .filter((name) => name.trim().length > 2 && name.toLowerCase() !== requester && lowered.includes(name.toLowerCase()))
    .map((name) => hit('other-organization', name, 0.9, language, t(language, 'outbound.other-organization')));
}

/** Hôte d'une adresse, sans schéma ni chemin ; `null` si illisible. */
export function hostOf(url: string): string | null {
  const withoutScheme = url.replace(/^https?:\/\//i, '');
  const host = withoutScheme.split(/[/?#]/)[0];
  return host && host.length > 0 ? host.toLowerCase() : null;
}

/** #33 — liste de domaines autorisés, déduite des adresses connues du contexte. */
export function authorizedDomains(context: OutboundContext): string[] {
  return [...new Set((context.knownUrls ?? []).map((url) => hostOf(url)).filter((h): h is string => h !== null))];
}

/** Un hôte est autorisé s'il égale un domaine de la liste ou en est un sous-domaine. */
export function isAuthorizedHost(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

/** Adresses web hors liste autorisée ou à requête anormalement longue (§10, #33). */
export function findUrls(text: string, context: OutboundContext, language: Language): OutboundHit[] {
  const allowed = authorizedDomains(context);
  const hits: OutboundHit[] = [];
  for (const url of text.match(URL_PATTERN) ?? []) {
    const query = url.slice(url.indexOf('?') + 1);
    const longQuery = url.includes('?') && query.length > MAX_URL_QUERY;
    const host = hostOf(url);
    if (longQuery) {
      hits.push(hit('long-query-url', url, 0.95, language, t(language, 'outbound.long-query', { chars: query.length })));
    } else if (host && !isAuthorizedHost(host, allowed)) {
      hits.push(hit('unknown-url', url, 0.75, language, t(language, 'outbound.unknown-url', { host })));
    }
  }
  return hits;
}

/**
 * Blocs encodés (§10). Même notion qu'en couche C1, mais le sas doit fonctionner
 * même quand la détection d'entrée n'a rien vu : d'où ce relevé autonome.
 */
export function findEncodedBlocks(text: string, language: Language): OutboundHit[] {
  const runs = (text.match(ENCODED_PATTERN) ?? []).filter((run) => run.length >= MIN_ENCODED_RUN && looksEncoded(run));
  return runs.map((run) => hit('encoded-block', run, 0.8, language, t(language, 'outbound.encoded-block')));
}

/** Un long jeton alphanumérique n'est pas du texte : ratio de voyelles très bas. */
function looksEncoded(run: string): boolean {
  const vowels = (run.match(/[aeiouy]/gi) ?? []).length;
  return vowels / run.length < 0.15;
}

/**
 * Réponse sans rapport avec la demande (§10) : recouvrement lexical très faible.
 *
 * Mesure prudente : une réponse courte (« c'est rétabli, bonne journée ») partage
 * peu de mots avec la demande sans être suspecte. Le signal ne vaut que pour une
 * réponse substantielle, et sa confiance reste sous le seuil de retenue — c'est
 * une alerte pour un humain, jamais un blocage automatique (§21 : peu de bruit).
 */
export function findOffTopic(text: string, context: OutboundContext, language: Language): OutboundHit[] {
  const request = context.requestText ?? '';
  if (request.trim().length < 40) return [];
  if (text.trim().length < MIN_OFFTOPIC_LENGTH) return [];
  const overlap = shingleOverlap(shingles(request), shingles(text));
  if (overlap >= MIN_RELEVANCE) return [];
  return [hit('off-topic', text.slice(0, 80), 0.5, language, t(language, 'outbound.off-topic', { overlap: overlap.toFixed(2) }))];
}

/** Clé de catalogue du libellé d'un motif DLP, dérivée du `ruleId`. */
function dlpLabelKey(ruleId: DlpFinding['ruleId']): string {
  return `outbound.dlp.${ruleId}`;
}

/** Les données personnelles relevées, rendues comme éléments du sas (#34/#35). */
export function findDlpHits(findings: DlpFinding[], language: Language): OutboundHit[] {
  return findings.map((finding) =>
    hit('other-customer-data', finding.excerpt, finding.confidence, language, t(language, dlpLabelKey(finding.ruleId))),
  );
}

/**
 * #37 — une réponse vers un domaine inconnu, ou qui contient une donnée
 * personnelle, n'est pas confiée à une seule relecture : il en faut deux.
 */
export function requiresDoubleReview(hits: OutboundHit[], dlp: DlpFinding[]): boolean {
  return dlp.length > 0 || hits.some((item) => item.kind === 'unknown-url');
}

/** Décision du sas : ce qui est retenu, et comment (§10). */
export function decide(hits: OutboundHit[], context: OutboundContext, stage: OutboundStage): { allowed: boolean; action: OutboundAction } {
  if (hits.length === 0) return { allowed: true, action: 'allow' };
  const strong = hits.some((item) => item.confidence >= HOLD_CONFIDENCE);
  // Un doute faible ne bloque rien avant publication (§21 : peu de bruit) : les
  // éléments restent rendus et visibles. Après coup, en revanche, tout élément
  // sur une réponse déjà partie mérite une alerte (§10).
  if (!strong) return { allowed: true, action: stage === 'after' ? 'alert' : 'allow' };
  if (stage === 'after') {
    return { allowed: false, action: context.strict ? 'convert-to-internal' : 'alert' };
  }
  return { allowed: false, action: context.strict || context.taintedSession ? 'convert-to-internal' : 'hold-for-review' };
}

/** Contrôle d'un texte destiné à sortir (§10, #33/#34/#35/#37). Ne jette jamais. */
export function checkOutbound(text: string, context: OutboundContext, options: OutboundOptions = {}): OutboundDlpResult {
  const language = options.language ?? 'fr';
  const stage = options.stage ?? 'before';
  const dlp = detectDlp(text);
  const hits = [
    ...findOtherOrganizations(text, context, language),
    ...findOtherIssueKeys(text, context, language),
    ...findUrls(text, context, language),
    ...findEncodedBlocks(text, language),
    ...findOffTopic(text, context, language),
    ...findDlpHits(dlp, language),
  ];
  const decision = decide(hits, context, stage);
  const masked = dlp.length > 0 ? redact(text, dlp) : null;
  return {
    issueKey: context.issueKey,
    allowed: decision.allowed,
    action: decision.action,
    hits,
    checkedAt: options.now ?? new Date(0).toISOString(),
    dlp,
    redactedText: masked?.text ?? null,
    redactionTable: masked?.table ?? null,
    requiresDoubleReview: requiresDoubleReview(hits, dlp),
  };
}

/** Ce que le sas n'a pas pu vérifier : à afficher, jamais à taire (§21). */
export function outboundCaveats(context: OutboundContext, language: Language): string[] {
  const caveats: string[] = [];
  if (!context.requestText) caveats.push(t(language, 'outbound.caveat.no-request'));
  if (!context.otherOrganizations || context.otherOrganizations.length === 0) {
    caveats.push(t(language, 'outbound.caveat.no-orgs'));
  }
  return caveats;
}
