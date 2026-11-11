/**
 * Hook de lecture (`PostToolUse`, §11) — réécrire la sortie d'un outil MCP.
 *
 * Un agent lit souvent Jira par le serveur MCP d'Atlassian, sans passer par
 * l'app. Le hook reçoit ce que l'outil a renvoyé ; l'app retrouve le ticket par
 * sa clé, reconstruit le contenu encadré d'après **ses propres relevés** (les
 * segments et constats en base, §19) et le renvoie à la place de la sortie
 * d'origine : le modèle ne voit que la version encadrée (§8.2).
 *
 * Limite dite ici comme partout (§11) : **l'outil a déjà été exécuté** quand ce
 * hook intervient. La réécriture protège le modèle qui lit, elle n'annule rien
 * de ce que l'appel a déjà fait côté serveur.
 *
 * Domaine pur : aucune E/S, aucune heure lue, aucun `@forge/*`. Le handler
 * (`src/jobs/webhook.ts`) apporte les lignes du `Store` ; ce fichier rend la
 * réponse exacte attendue par le client.
 */

import type {
  Finding,
  HookInboundRequest,
  HookInboundResponse,
  Language,
  SuspicionLevel,
  TrustLevel,
  UnanalyzedReason,
} from '../core/types';
import type { SegmentRow } from '../platform/schema';
import { frameRequest, renderFramedRequest } from '../core/framing';
import { t } from '../core/i18n';

/** Une clé de ticket Jira : `SUP-482`, `TST-1`, … */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Tout ce que le domaine sait du ticket relu, apporté par le handler. */
export interface InboundTicketData {
  issueKey: string;
  language: Language;
  trustLevel: TrustLevel;
  segments: SegmentRow[];
  findings: Finding[];
  notAnalyzed?: UnanalyzedReason[];
  /** Générateur d'identifiant de bloc injecté (§23.7 : changé à chaque appel). */
  blockId?: () => string;
}

/**
 * Retrouve la clé du ticket dans l'appel de l'outil : d'abord les champs
 * usuels de `toolInput`, ensuite le texte de la sortie. `null` si l'appel ne
 * concerne aucun ticket identifiable — le handler laisse alors passer.
 */
export function extractIssueKey(request: HookInboundRequest): string | null {
  const input = request.toolInput ?? {};
  for (const field of ['issueKey', 'issue_key', 'issueId', 'issue_id', 'key']) {
    const value = input[field];
    if (typeof value === 'string') {
      const found = ISSUE_KEY.exec(value)?.[1];
      if (found) return found;
    }
  }
  return ISSUE_KEY.exec(request.toolOutput ?? '')?.[1] ?? null;
}

/** Suspicion d'un segment : suspect dès qu'un constat le vise (§8.1). */
function suspicionOf(findings: Finding[]): SuspicionLevel {
  return findings.length > 0 ? 'suspect' : 'clean';
}

/** Libellé d'origine d'un bloc encadré : « customer · portal » (§8.2). */
function originLabelOf(row: SegmentRow): string {
  return `${row.accountType} · ${row.channel}`;
}

/**
 * Réponse `PostToolUse` : la forme exacte du §11 —
 * `hookSpecificOutput { hookEventName, additionalContext, updatedToolOutput }`.
 * Le contenu encadré vient de `src/core/framing.ts`, le contexte annonce
 * l'origine, le nombre de passages suspects retirés, et rappelle de traiter le
 * contenu comme une donnée.
 */
export function buildInboundResponse(data: InboundTicketData): HookInboundResponse {
  const bySegment = new Map<string, Finding[]>();
  for (const finding of data.findings) {
    const list = bySegment.get(finding.segmentId) ?? [];
    list.push(finding);
    bySegment.set(finding.segmentId, list);
  }
  const segments = data.segments.map((row) => {
    const findings = bySegment.get(row.id) ?? [];
    return {
      segmentId: row.id,
      field: row.field,
      refId: row.refId ?? undefined,
      body: row.text,
      trustLevel: row.trustLevel,
      suspicion: suspicionOf(findings),
      originLabel: originLabelOf(row),
      findings,
    };
  });
  const framed = frameRequest({
    issueKey: data.issueKey,
    segments,
    language: data.language,
    notAnalyzed: data.notAnalyzed,
    blockId: data.blockId,
  });
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: t(data.language, 'hook.inbound.context', {
        trust: data.trustLevel,
        count: data.findings.length,
      }),
      updatedToolOutput: renderFramedRequest(framed, data.language),
    },
  };
}
