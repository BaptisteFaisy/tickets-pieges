/**
 * Pièces jointes (TP-22) — texte des PDF si possible, sinon « non analysé ».
 *
 * Le runtime Forge ne garantit pas de pouvoir lire le contenu d'un fichier
 * (`docs/FORGE.md` §7) : l'extraction est injectée et **best effort**. Quand
 * elle échoue, la pièce est marquée non analysée avec sa raison (§21 : le
 * ticket porte ce qu'on n'a pas pu lire, jamais de silence).
 *
 * Aucune dépendance Forge : ce fichier est importé par les tests.
 */

import type { UnanalyzedReason } from '../core/types';
import type { JiraAttachmentView } from './schema';

/** Au-delà, on renonce à lire : fenêtre d'exposition et limites Forge. */
export const MAX_ANALYZED_BYTES = 1_000_000;

/** Mimes dont on tente l'extraction de texte. */
const TEXT_MIMES = ['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json', 'application/xml', 'text/xml'];

export interface AttachmentPlan {
  /** `text` : un texte extrait est disponible ; `unanalyzed` : raison à porter. */
  kind: 'text' | 'unanalyzed';
  text?: string;
  reason?: UnanalyzedReason;
}

/** Extraction injectée : rend le texte, ou `null` si impossible. */
export type TextExtractor = (view: JiraAttachmentView) => Promise<string | null>;

export function isTextMime(mimeType: string): boolean {
  return TEXT_MIMES.includes(mimeType.toLowerCase());
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

/**
 * Décide du sort d'une pièce à partir de la métadonnée et du texte éventuel.
 * Pur : `extractedText` vient de l'extracteur (ou `null` s'il a échoué).
 */
export function attachmentPlan(view: JiraAttachmentView, extractedText: string | null): AttachmentPlan {
  if (view.sizeBytes > MAX_ANALYZED_BYTES) return { kind: 'unanalyzed', reason: 'oversize' };
  if (isImageMime(view.mimeType)) return { kind: 'unanalyzed', reason: 'image' };
  if (!isTextMime(view.mimeType)) return { kind: 'unanalyzed', reason: 'binary-attachment' };
  const text = extractedText?.trim() ?? '';
  if (text === '') return { kind: 'unanalyzed', reason: 'unsupported-format' };
  return { kind: 'text', text };
}

/**
 * Orchestration : tente l'extraction pour les mimes supportés, marque
 * « non analysé » sinon. Une erreur de l'extracteur ne remonte jamais —
 * elle vaut échec d'extraction (§21 : rien ne bloque le ticket).
 */
export async function analyzeAttachment(view: JiraAttachmentView, extract: TextExtractor): Promise<AttachmentPlan> {
  const worthTrying = view.sizeBytes <= MAX_ANALYZED_BYTES && isTextMime(view.mimeType);
  let extracted: string | null = null;
  if (worthTrying) {
    try {
      extracted = await extract(view);
    } catch {
      extracted = null;
    }
  }
  return attachmentPlan(view, extracted);
}
