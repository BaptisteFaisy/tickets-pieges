/**
 * Jeu d'essai intégré (TP-18, §25) — domaine pur.
 *
 * Les demandes d'exemple sont importées **statiquement** depuis
 * `data/sample/*.json` (`resolveJsonModule`) : aucune entrée-sortie au runtime,
 * aucune heure lue (les dates de `to-segments.ts` sont fixes). Ce module sert la
 * démonstration, la recette (§23) et la page « Banc d'essai » (§17.7), où les
 * juges déposent une demande d'exemple.
 *
 * Le contrat d'une entrée est `SampleRequest` (`src/core/types.ts`) ; le jeu
 * ajoute trois champs locaux : la famille du cas limite (§22), le nom affiché du
 * demandeur et les pièces jointes déclarées — tous deux des segments comme les
 * autres (§22), convertis par `to-segments.ts`.
 */
import requestsEn from '../../data/sample/requests-en.json';
import requestsFr from '../../data/sample/requests-fr.json';
import type { FindingKind, Language, SampleRequest } from '../core/types';
import { SUSPICION_RANK, TRUST_LEVELS } from '../core/types';

/** Pièce jointe déclarée par le jeu d'essai ; son nom est un segment (§22). */
export interface SampleAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parseable: boolean;
}

/** Une entrée du jeu : le contrat `SampleRequest` plus les champs du banc. */
export interface SampleRequestEntry extends SampleRequest {
  /** Famille de cas limites (1 à 19), énumérée dans le brief du lot et §22. */
  family: number;
  /** Nom affiché du demandeur — segment à part entière quand il est piégé. */
  reporterName?: string;
  /** Pièces jointes déclarées (image non analysable, nom de fichier piégé…). */
  attachments?: SampleAttachment[];
  /** Note aux juges : intention du cas, verdict humain attendu (§14). */
  note?: string;
}

/** Nombre de familles de cas limites que le jeu doit couvrir, par langue. */
export const FAMILY_COUNT = 19;

/**
 * Valeurs runtime de `FindingKind` — le contrat ne fournit que le type. La
 * garde de compilation ci-dessous échoue si le tronc ajoute un kind oublié ici.
 */
export const FINDING_KINDS = [
  'invisible-chars',
  'bidi-override',
  'background-colored-text',
  'image-alt-text',
  'link-label-mismatch',
  'encoded-block',
  'assistant-addressing',
  'role-switch',
  'fake-system-marker',
  'tool-command',
  'exfiltration-url',
  'model-verdict',
  'model-malformed',
  'fresh-account',
  'anonymous-channel',
  'unusual-length',
  'language-shift',
  'unparseable-attachment',
  'inherited-external',
  'internal-copy-of-external',
] as const;

type KindsOublies = Exclude<FindingKind, (typeof FINDING_KINDS)[number]>;
const _gardeKinds: [KindsOublies] extends [never] ? true : never = true;
void _gardeKinds;

const ENTRIES: readonly SampleRequestEntry[] = [
  ...(requestsFr as unknown as SampleRequestEntry[]),
  ...(requestsEn as unknown as SampleRequestEntry[]),
];

const BY_ID = new Map(ENTRIES.map((entry) => [entry.id, entry]));
const BY_LANGUAGE = new Map<Language, SampleRequestEntry[]>(
  (['fr', 'en'] as const).map((lang) => [
    lang,
    ENTRIES.filter((entry) => entry.language === lang),
  ]),
);

/** Tout le jeu d'essai, français et anglais, dans l'ordre des fichiers. */
export function loadDataset(): readonly SampleRequestEntry[] {
  return ENTRIES;
}

/** Une demande d'exemple par son identifiant stable (ex. `fr-04-invisibles`). */
export function byId(id: string): SampleRequestEntry | undefined {
  return BY_ID.get(id);
}

/** Toutes les demandes d'une langue — le banc d'essai les sert une à une. */
export function byLanguage(lang: Language): readonly SampleRequestEntry[] {
  return BY_LANGUAGE.get(lang) ?? [];
}

/** Les demandes dont l'attendu contient ce type de constat. */
export function casesOf(kind: FindingKind): readonly SampleRequestEntry[] {
  return ENTRIES.filter((entry) => entry.expected.kinds.includes(kind));
}

/** Récapitulatif du jeu : compte par famille, par langue, par suspicion. */
export function describeDataset(): {
  total: number;
  perLanguage: Record<Language, number>;
  perFamily: Record<number, number>;
} {
  const perFamily: Record<number, number> = {};
  for (const entry of ENTRIES) {
    perFamily[entry.family] = (perFamily[entry.family] ?? 0) + 1;
  }
  return {
    total: ENTRIES.length,
    perLanguage: { fr: byLanguage('fr').length, en: byLanguage('en').length },
    perFamily,
  };
}

// ------------------------------------------------------------------ intégrité

const CHANNELS = ['jira', 'portal', 'anonymousportal', 'email', 'API', 'deployment', 'unknown'];
const ACCOUNT_TYPES = ['atlassian', 'app', 'customer', 'unknown'];
const VISIBILITIES = ['public', 'internal'];

function entryProblems(entry: SampleRequestEntry): string[] {
  const problems: string[] = [];
  const id = entry.id;
  if (!entry.summary.trim() || !entry.description.trim()) problems.push(`${id}: texte vide`);
  if (!id.startsWith(`${entry.language}-`)) problems.push(`${id}: préfixe ≠ langue`);
  if (entry.family < 1 || entry.family > FAMILY_COUNT) problems.push(`${id}: famille hors jeu`);
  if (!TRUST_LEVELS.includes(entry.expected.trustLevel)) problems.push(`${id}: confiance invalide`);
  if (!(entry.expected.suspicion in SUSPICION_RANK)) problems.push(`${id}: suspicion invalide`);
  if (!CHANNELS.includes(entry.channel)) problems.push(`${id}: canal invalide`);
  if (!ACCOUNT_TYPES.includes(entry.accountType)) problems.push(`${id}: type de compte invalide`);
  for (const kind of entry.expected.kinds) {
    if (!(FINDING_KINDS as readonly string[]).includes(kind)) problems.push(`${id}: kind ${kind}`);
  }
  for (const comment of entry.comments) {
    if (!comment.body.trim()) problems.push(`${id}: commentaire vide`);
    if (!VISIBILITIES.includes(comment.visibility)) problems.push(`${id}: visibilité invalide`);
    if (!ACCOUNT_TYPES.includes(comment.authorType)) problems.push(`${id}: auteur invalide`);
  }
  return problems;
}

/** Les deux langues doivent couvrir exactement les mêmes familles, à l'identique. */
function parityProblems(): string[] {
  const problems: string[] = [];
  const key = (entry: SampleRequestEntry) =>
    `${entry.family}|${entry.expected.trustLevel}|${entry.expected.suspicion}|${entry.expected.kinds.join(',')}|${entry.comments.length}|${entry.attachments?.length ?? 0}|${entry.reporterName ? 1 : 0}`;
  const byFamily = (lang: Language) => new Map(byLanguage(lang).map((e) => [e.family, key(e)]));
  const fr = byFamily('fr');
  const en = byFamily('en');
  for (const family of new Set([...fr.keys(), ...en.keys()])) {
    const left = fr.get(family);
    const right = en.get(family);
    if (!left || !right) problems.push(`famille ${family}: présente dans une seule langue`);
    else if (left !== right) problems.push(`famille ${family}: attendu fr ≠ en`);
  }
  return problems;
}

/**
 * Diagnostic complet du jeu : liste de problèmes, vide quand le jeu est sain.
 * Le banc d'essai l'expose tel quel (§21 : pas de fausse assurance).
 */
export function datasetProblems(entries: readonly SampleRequestEntry[] = ENTRIES): string[] {
  const problems = entries.flatMap(entryProblems);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: identifiant en double`);
    seen.add(entry.id);
  }
  return [...problems, ...parityProblems()];
}
