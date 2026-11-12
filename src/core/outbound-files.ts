/**
 * Sas de sortie — pièces jointes sortantes (#32) — propriétaire : lot sas-ops.
 *
 * Une pièce qui sort passe par le sas : nom (double extension, caractères
 * invisibles), type (exécutable ou scriptable), taille (borne documentée) et,
 * quand un texte extrait est disponible, contenu analysé par `checkOutbound`
 * (réutilisé, jamais recopié). Sans texte extrait, la pièce n'est pas
 * analysée — et c'est dit (§21), jamais tu.
 *
 * Domaine pur : aucune E/S, aucune lecture d'octets, l'heure vient des
 * paramètres.
 */
import type { Language, OutboundAction, OutboundContext } from './types';
import { checkOutbound } from './outbound';
import { invisibleHits } from './c1-concealment';
import { t } from './i18n';

/** Borne documentée : au-delà, la pièce est retenue pour relecture humaine. */
export const MAX_OUTBOUND_FILE_BYTES = 10_000_000;

/** Longueur de nom raisonnable : au-delà, le nom lui-même devient une cache. */
export const MAX_FILE_NAME_LENGTH = 180;

const EXECUTABLE_EXTENSIONS: readonly string[] = [
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'js', 'mjs', 'cjs', 'sh',
  'ps1', 'vbs', 'wsf', 'jar', 'hta', 'apk', 'dll', 'iso', 'img',
];

const EXECUTABLE_MIME_PREFIXES: readonly string[] = [
  'application/x-msdownload', 'application/x-executable', 'application/x-sh',
  'application/javascript', 'text/javascript', 'application/x-javascript',
];

/** Pièce jointe telle que le sas la reçoit : métadonnées + texte éventuel. */
export interface OutboundFileInput {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  /** Texte extrait par la plateforme, si elle sait le faire ; sinon absent. */
  extractedText?: string | null;
}

/** Verdict du sas sur une pièce sortante. */
export interface OutboundFileCheck {
  fileName: string;
  allowed: boolean;
  action: OutboundAction;
  /** Raisons traduites, lisibles par un humain. */
  reasons: string[];
  /** `false` : le contenu n'a pas été analysé — la décision le dit. */
  contentAnalyzed: boolean;
}

/** Extension finale, en minuscules, sans le point ; chaîne vide si aucune. */
export function extensionOf(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Vrai si le nom empile au moins deux extensions dont la dernière exécute. */
export function hasDoubleExtension(fileName: string): boolean {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const parts = base.split('.').filter((p) => p.length > 0);
  if (parts.length < 3) return false;
  const last = parts[parts.length - 1] ?? '';
  return EXECUTABLE_EXTENSIONS.includes(last.toLowerCase());
}

function isExecutableMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const mime = mimeType.toLowerCase();
  return EXECUTABLE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

/** Problèmes de nom ou de type, en raisons traduites (réutilise C1 invisibles). */
export function fileNameIssues(file: OutboundFileInput, language: Language): string[] {
  const reasons: string[] = [];
  const ext = extensionOf(file.fileName);
  if (hasDoubleExtension(file.fileName)) {
    reasons.push(t(language, 'outbound-ops.file.double-extension', { name: file.fileName.slice(0, 80) }));
  } else if (EXECUTABLE_EXTENSIONS.includes(ext) || isExecutableMime(file.mimeType)) {
    reasons.push(t(language, 'outbound-ops.file.executable', { ext: ext || String(file.mimeType) }));
  }
  if (invisibleHits(file.fileName, language).length > 0) {
    reasons.push(t(language, 'outbound-ops.file.concealment'));
  }
  return reasons;
}

/**
 * Contrôle une pièce jointe sortante (#32). Ne jette jamais : un nom bizarre,
 * une taille négative ou un texte absent produisent des raisons, pas d'erreur.
 */
export function checkOutboundFile(
  file: OutboundFileInput,
  context: OutboundContext,
  language: Language = 'fr',
  now?: string,
): OutboundFileCheck {
  const reasons = fileNameIssues(file, language);
  if (!(file.sizeBytes >= 0) || file.sizeBytes > MAX_OUTBOUND_FILE_BYTES) {
    reasons.push(t(language, 'outbound-ops.file.too-large', { bytes: Math.max(0, file.sizeBytes) }));
  }
  if (file.fileName.length > MAX_FILE_NAME_LENGTH) {
    reasons.push(t(language, 'outbound-ops.file.long-name', { chars: file.fileName.length }));
  }
  const text = file.extractedText ?? null;
  const contentAnalyzed = text !== null && text.trim().length > 0;
  let action: OutboundAction = reasons.length > 0 ? 'hold-for-review' : 'allow';
  if (contentAnalyzed) {
    const verdict = checkOutbound(text as string, context, { language, now });
    if (!verdict.allowed) action = verdict.action === 'allow' ? 'hold-for-review' : verdict.action;
  } else {
    reasons.push(t(language, 'outbound-ops.file.unanalyzed'));
    if (context.strict && action === 'allow') action = 'hold-for-review';
  }
  return {
    fileName: file.fileName,
    allowed: action === 'allow',
    action,
    reasons,
    contentAnalyzed,
  };
}
