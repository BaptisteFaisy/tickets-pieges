/**
 * **Une seule implémentation de la détection** — le point d'entrée commun du
 * produit, du banc d'essai et du site.
 *
 * Pourquoi ce fichier existe : jusqu'ici, trois appelants assemblaient les couches
 * à leur main, et ils n'assemblaient pas la même chose. Le banc jouait C1 + C2 +
 * décodage + pression, la production (les déclencheurs Forge) ne jouait que C1 +
 * C2, et le site rejouait la production. Résultat mesuré sur le site réel le
 * 12 novembre 2026 : une demande contenant un long bloc encodé était
 * « suspecte » dans le jeu d'essai et **propre** sur le ticket — parce que le
 * décodeur n'était branché ni dans la production ni dans le banc d'essai.
 *
 * La règle de la maison (`docs/ARCHITECTURE.md` §1) s'applique ici aussi : une
 * règle écrite une fois, utilisée partout.
 *
 * Depuis le lot « contrat de détection », ce fichier porte en plus le **contrat**
 * : la liste des familles jouées vient de `src/core/rules-version.ts` (source
 * unique), chaque famille a son joueur dans `PLAYERS` — le typage oblige à
 * écrire le joueur d'une famille nouvelle, et `assertFamilies` refuse, à
 * l'import, une famille déclarée sans joueur. Le résultat d'une détection
 * porte la version du catalogue : on peut donc dire avec quelle version des
 * règles un constat a été produit.
 */

import { detectConcealment } from './c1-concealment';
import { detectAddressing } from './c2-addressing';
import { decodeHits } from './decode';
import { pressureHits } from './pressure';
import { dedupeHits } from './findings';
import type { Language, LayerHit } from './types';
import {
  RULES_FINGERPRINT,
  RULES_ID,
  RULES_VERSION,
  RULE_FAMILIES,
  assertFamilies,
  assertKnownFamily,
  type RulesFamily,
} from './rules-version';

/** Les familles déterministes qu'une détection peut jouer. */
export type DetectLayer = RulesFamily;

/** Toutes les familles : le comportement par défaut du produit. */
export const DETECT_LAYERS: readonly DetectLayer[] = RULE_FAMILIES;

export interface DetectOptions {
  /** Langue de détection (fr, en, ou une langue de lexique). */
  language: Language;
  /** Formules à ignorer (§14) : mentions légales, signatures. */
  ignoredPhrases?: readonly string[];
  /** Hôtes connus du site : un lien vers un autre hôte est signalé (C1). */
  knownHosts?: readonly string[];
  /** Précision par règle : une règle rétrogradée ne lève plus de constat (§14). */
  precisionByRule?: Readonly<Record<string, number>>;
  /** Plafond de constats rendus (le banc l'utilise pour rester rapide). */
  maxHits?: number;
  /** Familles à jouer ; par défaut, toutes. */
  layers?: readonly DetectLayer[];
}

/** C1 — dissimulation : invisibles, bidi, couleur du fond, alt d'image, liens. */
function concealmentHits(text: string, options: DetectOptions): LayerHit[] {
  return detectConcealment({
    text,
    language: options.language,
    knownHosts: [...(options.knownHosts ?? [])],
  });
}

/** C2 — adresse à une IA : impératifs, rôle, faux système, outils, exfiltration. */
function addressingHits(text: string, options: DetectOptions): LayerHit[] {
  return detectAddressing(text, {
    language: options.language,
    ignoredPhrases: [...(options.ignoredPhrases ?? [])],
    precisionByRule: options.precisionByRule,
    maxHits: options.maxHits,
  });
}

/**
 * Blocs encodés : décodage prudent, puis **réanalyse** du décodé par C2 — un
 * encodage ne doit pas servir d'écran.
 */
function encodedHits(text: string, options: DetectOptions): LayerHit[] {
  return decodeHits(text, {
    language: options.language,
    reanalyze: (decoded, context) =>
      detectAddressing(decoded, {
        language: context.language,
        ignoredPhrases: [...(options.ignoredPhrases ?? [])],
      }),
  });
}

/** Pression lexicale hors lexique : densité, consigne différée, acrostiche (C4). */
function pressureSignals(text: string, options: DetectOptions): LayerHit[] {
  return pressureHits(text, { language: options.language });
}

/** Le joueur d'une famille : le texte, les options, des constats. */
type LayerPlayer = (text: string, options: DetectOptions) => LayerHit[];

/**
 * Le joueur de chaque famille — la table qui rend la famille obligatoire.
 *
 * Le type `Record<DetectLayer, LayerPlayer>` fait échouer la compilation dès
 * qu'une famille est ajoutée à `RULE_FAMILIES` sans joueur : c'est l'erreur,
 * pas le silence.
 */
const PLAYERS: Record<DetectLayer, LayerPlayer> = {
  C1: concealmentHits,
  C2: addressingHits,
  decode: encodedHits,
  pressure: pressureSignals,
};

/** Les familles réellement jouées, dans l'ordre du catalogue. */
export const PLAYED_LAYERS: readonly DetectLayer[] = Object.keys(PLAYERS) as DetectLayer[];

// Le contrat, vérifié à l'import : une famille déclarée sans joueur est un
// défaut de programmation, pas un comportement à tolérer en silence.
assertFamilies(DETECT_LAYERS, PLAYED_LAYERS);

/** Le résultat d'une détection : les constats et la version du catalogue. */
export interface DetectResult {
  /** Les constats, dédupliqués, bornés, triés par position. */
  hits: LayerHit[];
  /** Version majeure du catalogue de règles jouée. */
  rulesVersion: number;
  /** Empreinte des tables de motifs jouées. */
  rulesFingerprint: string;
  /** Identifiant court : version + empreinte. */
  rulesId: string;
  /** Familles effectivement jouées. */
  families: readonly DetectLayer[];
}

/**
 * Les constats, avec la version du catalogue portée **par le tableau lui-même**.
 *
 * Les métadonnées sont non énumérables : un `JSON.stringify` des constats ne
 * les montre pas, et le tableau reste un `LayerHit[]` pour tous les appelants
 * existants. `detectWithVersion` rend la même information sous forme d'objet.
 */
export type DetectHits = LayerHit[] & {
  /** Version majeure du catalogue de règles jouée. */
  readonly rulesVersion: number;
  /** Empreinte des tables de motifs jouées. */
  readonly rulesFingerprint: string;
  /** Identifiant court : version + empreinte. */
  readonly rulesId: string;
  /** Familles effectivement jouées. */
  readonly families: readonly DetectLayer[];
};

/** Les familles demandées, vérifiées : une famille inconnue est refusée. */
function requestedFamilies(requested?: readonly DetectLayer[]): readonly DetectLayer[] {
  const families = requested ?? DETECT_LAYERS;
  for (const family of families) assertKnownFamily(family);
  return families;
}

/** Pose les métadonnées de version sur le tableau des constats. */
function withRules(hits: LayerHit[], families: readonly DetectLayer[]): DetectHits {
  const result = hits as DetectHits;
  const meta = { rulesVersion: RULES_VERSION, rulesFingerprint: RULES_FINGERPRINT, rulesId: RULES_ID, families };
  for (const [key, value] of Object.entries(meta)) {
    Object.defineProperty(result, key, { value, enumerable: false, writable: false });
  }
  return result;
}

/** Constats d'un texte : dédupliqués, bornés, triés par position. */
export function detectText(text: string, options: DetectOptions): DetectHits {
  const families = requestedFamilies(options.layers);
  const hits: LayerHit[] = [];
  for (const family of families) {
    hits.push(...PLAYERS[family](text, options));
  }
  const deduped = dedupeHits(hits);
  const limited = options.maxHits === undefined ? deduped : deduped.slice(0, options.maxHits);
  const sorted = limited.sort((a, b) => a.startPos - b.startPos || a.ruleId.localeCompare(b.ruleId));
  return withRules(sorted, families);
}

/**
 * La détection, avec sa version, sous forme d'objet.
 *
 * Pour un rapport ou un rejeu : le résultat porte la version du catalogue qui
 * l'a produit, donc un ticket rejoué aujourd'hui avec les règles d'aujourd'hui
 * est comparable à un ticket d'hier.
 */
export function detectWithVersion(text: string, options: DetectOptions): DetectResult {
  const hits = detectText(text, options);
  return {
    hits: [...hits],
    rulesVersion: hits.rulesVersion,
    rulesFingerprint: hits.rulesFingerprint,
    rulesId: hits.rulesId,
    families: [...hits.families],
  };
}
