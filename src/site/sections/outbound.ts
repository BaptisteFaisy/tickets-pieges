import type { DlpFinding } from '../../core/dlp';
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
    buttonHtml('ob-run', tr(lang, 'run')),
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

function runHtml(lang: Language, v: OutboundDlpResult, context: OutboundContext): string {
  return [
    heading(tr(lang, 'result')),
    verdictHtml(lang, v),
    heading(tr(lang, 'hitsH')),
    hitsHtml(lang, v.hits),
    heading(tr(lang, 'dlpH')),
    dlpHtml(lang, v.dlp),
    caveatsHtml(lang, context),
  ].join('');
}

function render(ctx: SectionContext): string {
  const lang = ctx.lang;
  const left = panel(formHtml(lang), 'ob-form');
  const right = panel([heading(tr(lang, 'result')), note(tr(lang, 'pending'))].join(''), 'ob-result');
  return [heading(tr(lang, 'intro')), grid(left, right)].join('');
}

function mount(root: HTMLElement, ctx: SectionContext): void {
  const lang = ctx.lang;
  byId<HTMLButtonElement>(root, 'ob-run')?.addEventListener('click', () => {
    const text = valueOf(root, 'ob-text');
    const { context, stage } = readContext(root, lang);
    const verdict = checkOutbound(text, context, { stage, language: lang, now: ctx.now });
    const out = byId<HTMLElement>(root, 'ob-result');
    if (out) out.innerHTML = runHtml(lang, verdict, context);
  });
}

export const outboundSection: Section = {
  id: 'outbound',
  titles: { fr: 'Sas de sortie', en: 'Outbound gate' },
  render,
  mount,
};
