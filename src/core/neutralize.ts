/**
 * Neutralisation (§8.3, TP-10) — remplacer un passage suspect par une mention.
 *
 * Trois garanties, écrites dans le cahier et tenues ici :
 *  - l'original est **conservé hors du ticket** et consultable par le rôle
 *    sécurité, affiché comme un texte inerte ;
 *  - toute neutralisation se **restaure en un clic** ;
 *  - les deux gestes sont **journalisés**.
 *
 * Le domaine ne stocke rien et n'écrit rien dans Jira : il rend le texte de
 * remplacement, l'original à conserver et les entrées de journal. La plateforme
 * exécute (lot Plateforme), l'écran affiche (lot UI).
 *
 * Limite connue, rappelée dans le rapport (§8.3) : pour une description,
 * l'historique du ticket garde l'ancienne valeur. Le mode réduit l'exposition,
 * il ne l'annule pas.
 */

import type { Finding, Language, NeutralizationResult } from './types';
import { t } from './i18n';

/** Une entrée de journal : le domaine la produit, la plateforme l'écrit. */
export interface JournalEntry {
  kind: string;
  at: string;
  detail: Record<string, string>;
}

/** Ce qu'il faut pour neutraliser un segment. */
export interface NeutralizeInput {
  segmentId: string;
  issueId: string;
  issueKey: string;
  text: string;
  /** Constats à neutraliser : seuls ceux de statut `open` sont pris. */
  findings: Finding[];
  language?: Language;
  now: string;
  /** Identifiant de l'original conservé (alloué par l'appelant). */
  originalId: string;
}

/** Résultat complet : le texte, la ligne à stocker, le journal. */
export interface NeutralizeOutcome {
  result: NeutralizationResult;
  /** Le texte d'origine, à conserver hors du ticket. */
  original: string;
  journal: JournalEntry[];
  /** Vrai si rien n'était à neutraliser. */
  noop: boolean;
}

/** Référence lisible d'un constat, telle qu'elle apparaît dans la mention. */
export function findingRef(finding: Finding): string {
  return `${finding.layer}-${finding.ruleId}-${finding.id.slice(-6)}`;
}

/**
 * Constats à neutraliser, triés de gauche à droite et sans chevauchement : un
 * passage déjà remplacé n'est pas remplacé deux fois, et les positions restent
 * justes (§22 : charge répartie, passages multiples).
 */
export function selectSpans(findings: Finding[]): Finding[] {
  const open = findings
    .filter((finding) => finding.status === 'open')
    .sort((a, b) => a.startPos - b.startPos || b.endPos - a.endPos);
  const kept: Finding[] = [];
  let cursor = -1;
  for (const finding of open) {
    if (finding.startPos >= cursor) {
      kept.push(finding);
      cursor = finding.endPos + 1;
    }
  }
  return kept;
}

/** Mention qui remplace un passage : elle renvoie au constat, jamais à la charge. */
export function mentionFor(finding: Finding, language: Language): string {
  return t(language, 'neutralize.mention', {
    reason: t(language, `ask.${finding.kind}`),
    ref: findingRef(finding),
  });
}

/**
 * Remplace les passages suspects par leurs mentions. Le texte rendu est celui
 * qui ira dans le ticket ; l'original est rendu à part pour être conservé.
 */
/** Résultat quand il n'y a rien à neutraliser : le texte est rendu tel quel. */
function noopOutcome(input: NeutralizeInput): NeutralizeOutcome {
  return {
    result: {
      segmentId: input.segmentId,
      issueId: input.issueId,
      replacedText: input.text,
      originalId: '',
      mentionRefs: [],
      journalized: false,
    },
    original: input.text,
    journal: [],
    noop: true,
  };
}

/** Remplace les passages retenus par leurs mentions, de gauche à droite. */
function replaceSpans(text: string, spans: Finding[], language: Language): { text: string; refs: string[] } {
  let out = '';
  let cursor = 0;
  const refs: string[] = [];
  for (const finding of spans) {
    const start = Math.max(0, Math.min(finding.startPos, text.length));
    const end = Math.max(start, Math.min(finding.endPos + 1, text.length));
    out += text.slice(cursor, start) + mentionFor(finding, language);
    refs.push(findingRef(finding));
    cursor = end;
  }
  return { text: out + text.slice(cursor), refs };
}

/** Entrée de journal d'une neutralisation (§8.3 : les deux gestes sont journalisés). */
function neutralizeJournal(input: NeutralizeInput, refs: string[]): JournalEntry {
  return {
    kind: 'neutralize',
    at: input.now,
    detail: {
      issueKey: input.issueKey,
      segmentId: input.segmentId,
      originalId: input.originalId,
      findings: refs.join(','),
    },
  };
}

/**
 * Remplace les passages suspects par leurs mentions. Le texte rendu est celui
 * qui ira dans le ticket ; l'original est rendu à part pour être conservé.
 */
export function neutralizeText(input: NeutralizeInput): NeutralizeOutcome {
  const language = input.language ?? 'fr';
  const spans = selectSpans(input.findings);
  if (spans.length === 0) return noopOutcome(input);

  const replaced = replaceSpans(input.text, spans, language);
  return {
    result: {
      segmentId: input.segmentId,
      issueId: input.issueId,
      replacedText: replaced.text,
      originalId: input.originalId,
      mentionRefs: replaced.refs,
      journalized: true,
    },
    original: input.text,
    journal: [neutralizeJournal(input, replaced.refs)],
    noop: false,
  };
}

/**
 * Restauration (§8.3) : le texte d'origine conservé redevient le texte du
 * segment. Un motif est obligatoire — une neutralisation contestée se discute.
 */
export function restoreText(
  original: string,
  context: { issueKey: string; segmentId: string; originalId: string; reason: string; at: string; by: string },
): { text: string; journal: JournalEntry[] } {
  return {
    text: original,
    journal: [
      {
        kind: 'restore',
        at: context.at,
        detail: {
          issueKey: context.issueKey,
          segmentId: context.segmentId,
          originalId: context.originalId,
          reason: context.reason,
          by: context.by,
        },
      },
    ],
  };
}

/**
 * Affichage inerte d'un original conservé (§17.6) : aucun caractère de contrôle,
 * aucune balise, longueur bornée. Ce qui est montré ne peut rien exécuter.
 */
export function inertDisplay(original: string, max = 4000): string {
  const stripped = original.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const noTags = stripped.replace(/[<>]/g, (char) => (char === '<' ? '‹' : '›'));
  return noTags.length <= max ? noTags : `${noTags.slice(0, max)}…`;
}
