/**
 * Détection de données personnelles destinées à sortir (#33, #34, #35).
 *
 * Un texte qui s'apprête à quitter le service ne doit pas emporter d'IBAN, de
 * carte bancaire, de SIRET/SIREN, de numéro de sécurité sociale, de jeton
 * (`ghp_`, `sk-`, `AKIA`, JWT), ni d'adresse ou de téléphone. Chaque motif porte
 * un `ruleId` stable et une confiance : un motif devient un signal du sas, jamais
 * un verdict seul (§21).
 *
 * Domaine pur : aucune E/S, aucune lecture d'horloge, aucun `@forge/*`.
 */
import { clamp01 } from './findings';

/** Identifiant stable d'un motif de donnée personnelle. */
export type DlpRuleId =
  | 'iban'
  | 'card'
  | 'siret'
  | 'siren'
  | 'nir'
  | 'github-token'
  | 'api-key'
  | 'aws-access-key'
  | 'jwt'
  | 'email'
  | 'phone';

/** Un motif relevé, avec sa valeur claire (jamais rendue à l'écran) et ses bornes. */
export interface DlpFinding {
  ruleId: DlpRuleId;
  /** Valeur claire exacte, nécessaire à la restauration hors du ticket. */
  value: string;
  start: number;
  end: number;
  confidence: number;
  /** Extrait court et masqué, sûr à afficher. */
  excerpt: string;
}

interface Candidate {
  ruleId: DlpRuleId;
  value: string;
  start: number;
  end: number;
  confidence: number;
  excerpt: string;
}

const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const SIRET_RE = /\b\d{14}\b/g;
const SIREN_RE = /\b\d{9}\b/g;
const NIR_RE = /\b[12]\d{14}\b/g;
const GHP_RE = /\bghp_[A-Za-z0-9]{36}\b/g;
const SK_RE = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
const AKIA_RE = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{2,}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+33[\s.-]?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}\b/g;

/** Extrait masqué : la valeur claire ne sort jamais dans un extrait affiché. */
function maskedExcerpt(value: string): string {
  if (value.length <= 8) return value.slice(0, 2) + '…';
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Une occurrence trouvée par une expression rationnelle globale. */
function matchAt(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    out.push(m);
    if (m[0] === '') re.lastIndex++;
    m = re.exec(text);
  }
  return out;
}

/** Chiffres d'une chaîne : « 49 70 10… » devient « 497010… ». */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Contrôle de Luhn sur une chaîne de chiffres (§34 carte, SIRET, SIREN). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Contrôle de clé IBAN (modulo 97 — §34). */
function ibanMod97(iban: string): number {
  const rearranged = (iban.slice(4) + iban.slice(0, 4)).toUpperCase();
  let rest = 0;
  for (const c of rearranged) {
    if (/[0-9]/.test(c)) {
      rest = (rest * 10 + (c.charCodeAt(0) - 48)) % 97;
    } else {
      const value = c.charCodeAt(0) - 55;
      rest = (rest * 10 + Math.floor(value / 10)) % 97;
      rest = (rest * 10 + (value % 10)) % 97;
    }
  }
  return rest;
}

/** Un IBAN relevé : forte confiance si la clé est juste, sinon simple signal. */
function detectIban(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(IBAN_RE, text)) {
    const value = m[0];
    const valid = ibanMod97(value) === 1;
    out.push({
      ruleId: 'iban',
      value,
      start: m.index,
      end: m.index + value.length,
      confidence: valid ? 0.95 : 0.4,
      excerpt: maskedExcerpt(value),
    });
  }
  return out;
}

function detectCard(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(CARD_RE, text)) {
    const value = m[0];
    const digits = digitsOf(value);
    // Une carte doit passer Luhn : sans clé juste, ce n'est qu'un chiffre long.
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) continue;
    out.push({
      ruleId: 'card',
      value,
      start: m.index,
      end: m.index + value.length,
      confidence: 0.9,
      excerpt: maskedExcerpt(digits),
    });
  }
  return out;
}

/** SIRET (14 chiffres, Luhn) et SIREN (9 chiffres, Luhn). */
function detectSiretSiren(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(SIRET_RE, text)) {
    const value = m[0];
    const valid = luhnValid(value);
    out.push({
      ruleId: 'siret',
      value,
      start: m.index,
      end: m.index + value.length,
      confidence: valid ? 0.85 : 0.35,
      excerpt: maskedExcerpt(value),
    });
  }
  for (const m of matchAt(SIREN_RE, text)) {
    const value = m[0];
    if (luhnValid(value)) {
      out.push({
        ruleId: 'siren',
        value,
        start: m.index,
        end: m.index + value.length,
        confidence: 0.7,
        excerpt: maskedExcerpt(value),
      });
    }
  }
  return out;
}

/** Numéro de sécurité sociale français : 13 chiffres + clé = 97 - (N mod 97). */
function detectNir(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(NIR_RE, text)) {
    const value = m[0];
    const base = Number(value.slice(0, 13));
    const expected = 97 - (base % 97);
    const actual = Number(value.slice(13));
    const valid = actual === expected;
    out.push({
      ruleId: 'nir',
      value,
      start: m.index,
      end: m.index + value.length,
      confidence: valid ? 0.9 : 0.35,
      excerpt: maskedExcerpt(value),
    });
  }
  return out;
}

/** Jetons à préfixe connu et JWT (#35). */
function detectTokens(text: string): Candidate[] {
  const out: Candidate[] = [];
  const add = (re: RegExp, ruleId: DlpRuleId, confidence: number): void => {
    for (const m of matchAt(re, text)) {
      out.push({
        ruleId,
        value: m[0],
        start: m.index,
        end: m.index + m[0].length,
        confidence,
        excerpt: maskedExcerpt(m[0]),
      });
    }
  };
  add(GHP_RE, 'github-token', 0.97);
  add(SK_RE, 'api-key', 0.9);
  add(AKIA_RE, 'aws-access-key', 0.9);
  add(JWT_RE, 'jwt', 0.85);
  return out;
}

function detectEmail(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(EMAIL_RE, text)) {
    out.push({
      ruleId: 'email',
      value: m[0],
      start: m.index,
      end: m.index + m[0].length,
      confidence: 0.5,
      excerpt: maskedExcerpt(m[0]),
    });
  }
  return out;
}

function detectPhone(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matchAt(PHONE_RE, text)) {
    out.push({
      ruleId: 'phone',
      value: m[0],
      start: m.index,
      end: m.index + m[0].length,
      confidence: 0.35,
      excerpt: maskedExcerpt(m[0]),
    });
  }
  return out;
}

/**
 * Relevé des données personnelles d'un texte, trié par position et sans
 * chevauchement. Ne jette jamais : la liste vide signifie « rien relevé ».
 */
export function detectDlp(text: string): DlpFinding[] {
  const all: Candidate[] = [
    ...detectIban(text),
    ...detectSiretSiren(text),
    ...detectNir(text),
    ...detectCard(text),
    ...detectTokens(text),
    ...detectEmail(text),
    ...detectPhone(text),
  ];
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DlpFinding[] = [];
  let lastEnd = -1;
  for (const c of all) {
    if (c.start < lastEnd) continue;
    kept.push({
      ruleId: c.ruleId,
      value: c.value,
      start: c.start,
      end: c.end,
      confidence: clamp01(c.confidence),
      excerpt: c.excerpt,
    });
    lastEnd = c.end;
  }
  return kept;
}