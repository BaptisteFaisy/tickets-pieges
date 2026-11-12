import type { DlpFinding } from '../../core/dlp';
import { createDraft, decidePublication } from '../../core/drafts';
import { checkOutboundFile } from '../../core/outbound-files';
import type { OutboundFileCheck } from '../../core/outbound-files';
import type { RedTeamAttempt, RedTeamReport } from '../../core/outbound-rate';
import { checkNotification } from '../../core/outbound-notify';
import { buildRedTeamAttempts, countForAgent, createRateState, PUBLIC_REPLY_HOURLY_LIMIT, recordPublicReply, runRedTeam } from '../../core/outbound-rate';
import type { RateDecision, RateState } from '../../core/outbound-rate';
import { checkOutbound, outboundCaveats } from '../../core/outbound';
import type { OutboundDlpResult } from '../../core/outbound';
import type { Language, OutboundAction, OutboundContext, OutboundHit } from '../../core/types';
import {
  badge, buttonHtml, byId, details, esc, field, grid, heading, kv, list, note,
  panel, pre, selectHtml, table, textareaHtml, valueOf,
} from '../dom';
import type { Section, SectionContext } from './types';

const FR = {
  intro: 'Tout ce qui quitte le service passe par ce sas : autre client, autre organisation, adresse inconnue, bloc encodé, hors sujet, données personnelles.',
  reply: 'Réponse que l’agent s’apprête à envoyer',
  replyPh: 'Colle la réponse publique…',
  sample: 'Bonjour, voici le récapitulatif GLOBEX-12 : virement FR1420041010050500013M02606 traité. Détails : https://exfil.example.net/?d=abc. Le dossier de Globex avance bien. Sinon, voici la recette du gratin dauphinois : pommes de terre, crème, ail, cuisson lente au four pendant une heure.',
  requestSample: 'Demande du client Acme : accès impossible au portail de facturation depuis ce matin, erreur 403 sur toutes les pages.',
  stage: 'Moment du contrôle',
  stageBefore: 'avant publication',
  stageAfter: 'après coup',
  issue: 'Ticket en cours',
  strict: 'Mode strict',
  tainted: 'Session contaminée',
  external: 'Demande externe T0/T1',
  orgs: 'Organisations connues (virgules)',
  keys: 'Clés de tickets connues (virgules)',
  urls: 'Adresses connues (une par ligne)',
  yes: 'oui',
  no: 'non',
  run: 'Contrôler la sortie',
  result: 'Verdict du sas',
  verdict: 'Décision',
  allowed: 'Laisser passer',
  doubleReview: 'Double relecture exigée',
  checkedAt: 'Contrôlé à',
  hitsH: 'Éléments en cause',
  none: 'Aucun élément retenu',
  kind: 'Nature',
  excerpt: 'Extrait',
  confidence: 'Confiance',
  detail: 'Détail',
  dlpH: 'Données personnelles détectées',
  pattern: 'Motif',
  caveatsH: 'Ce que le sas n’a pas pu vérifier',
  pending: 'Renseigne le formulaire puis lance le contrôle.',
  redactedH: 'Texte masqué réversible',
  redactedNote: 'Table de correspondance affichée à titre inerte : sur le produit réel, elle reste hors du ticket. Aucune restauration n’est câblée ici.',
  redactedNone: 'Rien à masquer dans ce texte.',
  token: 'Jeton',
  value: 'Valeur',
  draftH: 'Brouillon et publication',
  draftNote: 'Le brouillon reste une note interne tant qu’une relecture humaine ET un sas favorable ne sont pas réunis.',
  humanReview: 'Relecture humaine',
  visibility: 'Visibilité',
  reason: 'Motif',
  journalH: 'Journal du geste',
  draftId: 'Brouillon',
  draftAuthor: 'Auteur',
  internal: 'note interne',
  public: 'commentaire public',
  rateH: 'Débit de réponses publiques',
  rateCount: 'Réponses dans la dernière heure',
  rateLimit: 'Limite horaire',
  rateAllowed: 'Débit acceptable',
  delay: 'Délai avant contrôle (s)',
  delay0: 'immédiat',
  notifyH: 'Courriel de notification',
  notifyWindow: 'Fenêtre d’exposition',
  notifyLeft: 'Le courriel est peut-être déjà parti',
  notifyWithin: 'Contrôle dans la cible de 60 s',
  fileH: 'Pièce jointe sortante',
  fileName: 'Nom du fichier',
  fileSize: 'Taille',
  fileBtn: 'Contrôler la pièce',
  fileReasons: 'Raisons',
  fileAnalyzed: 'Contenu analysé',
  redH: 'Mode red team',
  redNote: 'Cinq tentatives déterministes pour faire sortir un marqueur ; le sas est joué tel quel, sans avantage ajouté.',
  redMarker: 'Marqueur à faire sortir',
  redBtn: 'Lancer le mode red team',
  redScore: 'Tentatives passées',
  redRate: 'Taux de réussite',
  redPassed: 'Tentatives qui percent',
  attempt: 'Tentative',
  text: 'Texte joué',
} as const;

type TKey = keyof typeof FR;

const EN: Record<TKey, string> = {
  intro: 'Everything leaving the service goes through this gate: other customer, other organization, unknown address, encoded block, off topic, personal data.',
  reply: 'Reply the agent is about to send',
  replyPh: 'Paste the public reply…',
  sample: FR.sample,
  requestSample: 'Customer request (Acme): cannot reach the billing portal since this morning, error 403 on every page.',
  stage: 'Control moment',
  stageBefore: 'before publishing',
  stageAfter: 'after the fact',
  issue: 'Current issue',
  strict: 'Strict mode',
  tainted: 'Tainted session',
  external: 'External request T0/T1',
  orgs: 'Known organizations (comma separated)',
  keys: 'Known issue keys (comma separated)',
  urls: 'Known addresses (one per line)',
  yes: 'yes',
  no: 'no',
  run: 'Run the outbound gate',
  result: 'Gate verdict',
  verdict: 'Decision',
  allowed: 'Let through',
  doubleReview: 'Double review required',
  checkedAt: 'Checked at',
  hitsH: 'Elements at stake',
  none: 'No element retained',
  kind: 'Kind',
  excerpt: 'Excerpt',
  confidence: 'Confidence',
  detail: 'Detail',
  dlpH: 'Personal data detected',
  pattern: 'Pattern',
  caveatsH: 'What the gate could not check',
  pending: 'Fill the form, then run the check.',
  redactedH: 'Reversible masked text',
  redactedNote: 'Correspondence table shown inert: in the real product it stays out of the ticket. No restore is wired here.',
  redactedNone: 'Nothing to mask in this text.',
  token: 'Token',
  value: 'Value',
  draftH: 'Draft and publication',
  draftNote: 'The draft stays an internal note until BOTH a human review and a favourable gate are met.',
  humanReview: 'Human review',
  visibility: 'Visibility',
  reason: 'Reason',
  journalH: 'Action journal',
  draftId: 'Draft',
  draftAuthor: 'Author',
  internal: 'internal note',
  public: 'public comment',
  rateH: 'Public reply rate',
  rateCount: 'Replies in the last hour',
  rateLimit: 'Hourly limit',
  rateAllowed: 'Rate acceptable',
  delay: 'Delay before control (s)',
  delay0: 'immediate',
  notifyH: 'Notification email',
  notifyWindow: 'Exposure window',
  notifyLeft: 'The email may already have left',
  notifyWithin: 'Control within the 60 s target',
  fileH: 'Outbound attachment',
  fileName: 'File name',
  fileSize: 'Size',
  fileBtn: 'Check the file',
  fileReasons: 'Reasons',
  fileAnalyzed: 'Content analyzed',
  redH: 'Red team mode',
  redNote: 'Five deterministic attempts to leak a marker; the gate is played as is, with no added advantage.',
  redMarker: 'Marker to leak',
  redBtn: 'Run red team mode',
  redScore: 'Attempts passed',
  redRate: 'Success rate',
  redPassed: 'Attempts that get through',
  attempt: 'Attempt',
  text: 'Played text',
};

const TEXT: Record<Language, Record<TKey, string>> = { fr: FR, en: EN };

function tr(lang: Language, key: TKey): string {
  return TEXT[lang][key];
}

const ACTION_TONE: Record<OutboundAction, string> = {
  allow: 'ok',
  'hold-for-review': 'warn',
  'convert-to-internal': 'review',
  alert: 'bad',
};

function actionLabel(lang: Language, action: OutboundAction): string {
  return action.replace(/-/g, ' ');
}

/** Texte d’exemple préchargé dans la zone de réponse (même contenu en fr/en). */
export function sampleReply(lang: Language): string {
  return tr(lang, 'sample');
}

function splitList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function splitLines(raw: string): string[] {
  return raw.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Contexte du sas, construit depuis les contrôles du formulaire (rien d’autre). */
export function buildOutboundContext(lang: Language, input: {
  issueKey: string;
  stage: string;
  strict: boolean;
  taintedSession: boolean;
  externalRequest: boolean;
  orgs: string;
  keys: string;
  urls: string;
}): OutboundContext {
  return {
    issueKey: input.issueKey || 'DEMO-42',
    requestText: input.externalRequest ? tr(lang, 'requestSample') : undefined,
    requesterOrganization: 'Acme',
    otherOrganizations: splitList(input.orgs),
    otherIssueKeys: splitList(input.keys),
    knownUrls: splitLines(input.urls),
    strict: input.strict,
    taintedSession: input.taintedSession,
  };
}

function readContext(root: HTMLElement, lang: Language): { context: OutboundContext; stage: 'before' | 'after' } {
  const context = buildOutboundContext(lang, {
    issueKey: valueOf(root, 'ob-issue').trim(),
    stage: valueOf(root, 'ob-stage'),
    strict: valueOf(root, 'ob-strict') === 'yes',
    taintedSession: valueOf(root, 'ob-tainted') === 'yes',
    externalRequest: valueOf(root, 'ob-request') === 'yes',
    orgs: valueOf(root, 'ob-orgs'),
    keys: valueOf(root, 'ob-keys'),
    urls: valueOf(root, 'ob-urls'),
  });
  const stage = valueOf(root, 'ob-stage') === 'after' ? 'after' : 'before';
  return { context, stage };
}

function yesNoSelect(lang: Language, id: string, yes: boolean): string {
  return selectHtml(id, [['no', tr(lang, 'no')], ['yes', tr(lang, 'yes')]], yes ? 'yes' : 'no');
}

function formHtml(lang: Language): string {
  const controls = [
    field(tr(lang, 'reply'), textareaHtml('ob-text', 6, tr(lang, 'replyPh'), tr(lang, 'sample'))),
    field(tr(lang, 'stage'), selectHtml('ob-stage', [['before', tr(lang, 'stageBefore')], ['after', tr(lang, 'stageAfter')]])),
    field(tr(lang, 'issue'), textareaHtml('ob-issue', 1, 'DEMO-42', 'DEMO-42')),
    field(tr(lang, 'strict'), yesNoSelect(lang, 'ob-strict', false)),
    field(tr(lang, 'tainted'), yesNoSelect(lang, 'ob-tainted', false)),
    field(tr(lang, 'external'), yesNoSelect(lang, 'ob-request', true)),
    field(tr(lang, 'orgs'), textareaHtml('ob-orgs', 2, 'Globex, Initech', 'Globex, Initech')),
    field(tr(lang, 'keys'), textareaHtml('ob-keys', 2, 'GLOBEX-12', 'GLOBEX-12')),
    field(tr(lang, 'urls'), textareaHtml('ob-urls', 3, 'https://acme-support.example.com', 'https://acme-support.example.com')),
    field(tr(lang, 'humanReview'), yesNoSelect(lang, 'ob-review', false)),
    field(tr(lang, 'delay'), selectHtml('ob-delay', [['0', tr(lang, 'delay0')], ['45', '45 s'], ['90', '90 s'], ['300', '300 s']], '90')),
    buttonHtml('ob-run', tr(lang, 'run')),
    heading(tr(lang, 'fileH')),
    field(tr(lang, 'fileName'), textareaHtml('ob-fname', 1, 'rapport.pdf.exe', 'rapport.pdf.exe')),
    field(tr(lang, 'fileSize'), selectHtml('ob-fsize', [['250000', '250 Ko'], ['12000000', '12 Mo']], '12000000')),
    buttonHtml('ob-file', tr(lang, 'fileBtn'), 'ghost'),
    heading(tr(lang, 'redH')),
    note(tr(lang, 'redNote')),
    field(tr(lang, 'redMarker'), textareaHtml('ob-marker', 1, 'CANARI-SORTIE', 'CANARI-SORTIE')),
    buttonHtml('ob-redteam', tr(lang, 'redBtn'), 'ghost'),
  ];
  return controls.join('');
}

function verdictHtml(lang: Language, v: OutboundDlpResult): string {
  return [
    badge(actionLabel(lang, v.action), ACTION_TONE[v.action]),
    kv([
      [tr(lang, 'allowed'), v.allowed ? tr(lang, 'yes') : tr(lang, 'no')],
      [tr(lang, 'doubleReview'), v.requiresDoubleReview ? tr(lang, 'yes') : tr(lang, 'no')],
      [tr(lang, 'checkedAt'), v.checkedAt],
    ]),
  ].join('');
}

function hitsHtml(lang: Language, hits: OutboundHit[]): string {
  if (hits.length === 0) return note(tr(lang, 'none'));
  const rows = hits.map((h) => [h.kind, h.excerpt, h.detail ?? '', h.confidence.toFixed(2)]);
  return table([tr(lang, 'kind'), tr(lang, 'excerpt'), tr(lang, 'detail'), tr(lang, 'confidence')], rows);
}

function dlpHtml(lang: Language, findings: DlpFinding[]): string {
  if (findings.length === 0) return note(tr(lang, 'none'));
  const rows = findings.map((f) => [f.ruleId, f.excerpt, f.confidence.toFixed(2)]);
  return table([tr(lang, 'pattern'), tr(lang, 'excerpt'), tr(lang, 'confidence')], rows);
}

function caveatsHtml(lang: Language, context: OutboundContext): string {
  const caveats = outboundCaveats(context, lang);
  return caveats.length === 0 ? '' : details(tr(lang, 'caveatsH'), list(caveats), true);
}

function redactionHtml(lang: Language, v: OutboundDlpResult): string {
  if (!v.redactedText || !v.redactionTable) return note(tr(lang, 'redactedNone'));
  const rows = v.redactionTable.entries.map((e) => [e.token, e.ruleId, e.value]);
  return [
    pre(v.redactedText),
    details(tr(lang, 'token'), table([tr(lang, 'token'), tr(lang, 'pattern'), tr(lang, 'value')], rows), true),
    note(tr(lang, 'redactedNote')),
  ].join('');
}

function rateHtml(lang: Language, decision: RateDecision): string {
  return kv([
    [tr(lang, 'rateCount'), String(decision.count)],
    [tr(lang, 'rateLimit'), String(PUBLIC_REPLY_HOURLY_LIMIT)],
    [tr(lang, 'rateAllowed'), decision.allowed ? tr(lang, 'yes') : tr(lang, 'no')],
  ]) + (decision.message ? note(decision.message) : '');
}

function notifyHtml(lang: Language, text: string, context: OutboundContext, commentedAt: string, delaySeconds: number): string {
  const checkedAt = isoPlusSeconds(commentedAt, delaySeconds);
  const check = checkNotification(text, context, commentedAt, checkedAt, lang);
  const seconds = check.window.measured ? `${Math.round(check.window.delayMs / 1000)} s` : '?';
  return [
    kv([
      [tr(lang, 'notifyWindow'), seconds],
      [tr(lang, 'notifyWithin'), check.window.withinTarget ? tr(lang, 'yes') : tr(lang, 'no')],
      [tr(lang, 'notifyLeft'), check.window.notificationMayHaveLeft ? tr(lang, 'yes') : tr(lang, 'no')],
    ]),
    note(check.announcement),
  ].join('');
}

/** Instant décalé, calculé depuis `ctx.now` uniquement (jamais l’heure système). */
function isoPlusSeconds(iso: string, seconds: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return iso;
  return new Date(base + seconds * 1000).toISOString();
}

function draftHtml(lang: Language, text: string, v: OutboundDlpResult, humanReviewed: boolean, now: string): string {
  const draft = createDraft({
    id: `draft-${v.issueKey}`,
    issueId: v.issueKey.toLowerCase(),
    issueKey: v.issueKey,
    text,
    authorAccountId: 'agent-demo',
    now,
  });
  const decision = decidePublication(draft, v, humanReviewed, { language: lang, now, reviewerAccountId: 'human-demo' });
  const rows = decision.journal.map((entry) => [entry.kind, entry.at, JSON.stringify(entry.detail)]);
  return [
    note(tr(lang, 'draftNote')),
    badge(decision.visibility === 'public' ? tr(lang, 'public') : tr(lang, 'internal'), decision.visibility === 'public' ? 'ok' : 'warn'),
    kv([
      [tr(lang, 'reason'), decision.reason],
      [tr(lang, 'draftId'), draft.id],
      [tr(lang, 'draftAuthor'), draft.authorAccountId],
    ]),
    details(tr(lang, 'journalH'), table(['kind', tr(lang, 'checkedAt'), tr(lang, 'detail')], rows)),
  ].join('');
}

function runHtml(
  lang: Language,
  text: string,
  v: OutboundDlpResult,
  context: OutboundContext,
  humanReviewed: boolean,
  now: string,
  rate: RateDecision,
  delaySeconds: number,
): string {
  return [
    heading(tr(lang, 'result')),
    verdictHtml(lang, v),
    heading(tr(lang, 'hitsH')),
    hitsHtml(lang, v.hits),
    heading(tr(lang, 'dlpH')),
    dlpHtml(lang, v.dlp),
    heading(tr(lang, 'redactedH')),
    redactionHtml(lang, v),
    heading(tr(lang, 'draftH')),
    draftHtml(lang, text, v, humanReviewed, now),
    heading(tr(lang, 'rateH')),
    rateHtml(lang, rate),
    heading(tr(lang, 'notifyH')),
    notifyHtml(lang, text, context, now, delaySeconds),
    caveatsHtml(lang, context),
  ].join('');
}

function fileHtml(lang: Language, check: OutboundFileCheck): string {
  return [
    badge(actionLabel(lang, check.action), ACTION_TONE[check.action]),
    kv([
      [tr(lang, 'fileName'), check.fileName],
      [tr(lang, 'fileAnalyzed'), check.contentAnalyzed ? tr(lang, 'yes') : tr(lang, 'no')],
    ]),
    check.reasons.length > 0 ? details(tr(lang, 'fileReasons'), list(check.reasons), true) : note(tr(lang, 'none')),
  ].join('');
}

export function makeGate(context: OutboundContext, lang: Language, now: string): (text: string) => string | null {
  return (text) => {
    const v = checkOutbound(text, context, { stage: 'before', language: lang, now });
    return v.allowed ? (v.redactedText ?? text) : null;
  };
}

function redHtml(lang: Language, report: RedTeamReport, attempts: RedTeamAttempt[]): string {
  const rows = attempts.map((a) => [
    a.id,
    report.passedAttempts.includes(a.id) ? '✓' : '✗',
  ]);
  return [
    kv([
      [tr(lang, 'redScore'), `${report.passed} / ${report.total}`],
      [tr(lang, 'redRate'), `${Math.round(report.successRate * 100)} %`],
    ]),
    note(report.summary),
    table([tr(lang, 'attempt'), tr(lang, 'redPassed')], rows),
  ].join('');
}

function render(ctx: SectionContext): string {
  const lang = ctx.lang;
  const left = panel(formHtml(lang), 'ob-form');
  const right = [
    panel([heading(tr(lang, 'result')), note(tr(lang, 'pending'))].join(''), 'ob-result'),
    panel([heading(tr(lang, 'fileH')), note(tr(lang, 'pending'))].join(''), 'ob-file-result'),
    panel([heading(tr(lang, 'redH')), note(tr(lang, 'pending'))].join(''), 'ob-red-result'),
  ].join('');
  return [heading(tr(lang, 'intro')), grid(left, right)].join('');
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  const lang = ctx.lang;
  let rateState: RateState = createRateState();
  byId<HTMLButtonElement>(root, 'ob-run')?.addEventListener('click', () => {
    const text = valueOf(root, 'ob-text');
    const humanReviewed = valueOf(root, 'ob-review') === 'yes';
    const delaySeconds = Number.parseInt(valueOf(root, 'ob-delay'), 10) || 0;
    const { context, stage } = readContext(root, lang);
    const verdict = checkOutbound(text, context, { stage, language: lang, now: ctx.now });
    const recorded = verdict.allowed
      ? recordPublicReply(rateState, 'agent-demo', ctx.now, lang)
      : { state: rateState, decision: { allowed: true, count: countForAgent(rateState, 'agent-demo', ctx.now), alert: false, message: null } };
    rateState = recorded.state;
    const out = byId<HTMLElement>(root, 'ob-result');
    if (out) out.innerHTML = runHtml(lang, text, verdict, context, humanReviewed, ctx.now, recorded.decision, delaySeconds);
  });
  byId<HTMLButtonElement>(root, 'ob-file')?.addEventListener('click', () => {
    const { context } = readContext(root, lang);
    const file = {
      fileName: valueOf(root, 'ob-fname').trim(),
      sizeBytes: Number.parseInt(valueOf(root, 'ob-fsize'), 10) || 0,
      extractedText: valueOf(root, 'ob-text'),
    };
    const check = checkOutboundFile(file, context, lang, ctx.now);
    const out = byId<HTMLElement>(root, 'ob-file-result');
    if (out) out.innerHTML = [heading(tr(lang, 'fileH')), fileHtml(lang, check)].join('');
  });
  byId<HTMLButtonElement>(root, 'ob-redteam')?.addEventListener('click', () => {
    const { context } = readContext(root, lang);
    const marker = valueOf(root, 'ob-marker').trim() || 'CANARI-SORTIE';
    const attempts = buildRedTeamAttempts(marker);
    const report = runRedTeam(marker, makeGate(context, lang, ctx.now), lang, attempts);
    const out = byId<HTMLElement>(root, 'ob-red-result');
    if (out) out.innerHTML = [heading(tr(lang, 'redH')), redHtml(lang, report, attempts)].join('');
  });
}

export const outboundSection: Section = {
  id: 'outbound',
  titles: { fr: 'Sas de sortie', en: 'Outbound gate' },
  render,
  mount,
};
