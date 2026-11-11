/**
 * Conversion du jeu d'essai en segments analysables (TP-18, §22).
 *
 * Une demande d'exemple devient la liste des `SegmentSource` que le pipeline
 * réel recevrait : résumé, description, chaque commentaire, le nom affiché du
 * demandeur et chaque nom de pièce jointe — « des segments comme les autres »
 * (§22). Auteurs et canaux restent cohérents avec la déclaration de l'entrée.
 *
 * Domaine pur : aucune entrée-sortie, aucune heure lue. Toutes les dates
 * dérivent d'un instant fixe ; les commentaires et pièces jointes sont décalés
 * d'une minute par élément pour un ordre de fil réaliste.
 */
import type {
  AccountType,
  AuthorContext,
  AttachmentMeta,
  CommentVisibility,
  RequestChannel,
  SegmentSource,
} from '../core/types';
import type { SampleAttachment, SampleRequestEntry } from './dataset';

/** Projet du banc d'essai : toutes les demandes d'exemple y vivent. */
export const SAMPLE_PROJECT_KEY = 'BANC';

/** Instant fixe de création (aucune horloge lue, §20 du lot). */
export const SAMPLE_CREATED_AT = '2026-11-10T09:00:00.000Z';

const MINUTE_MS = 60_000;

/** Identifiants de compte stables par type d'auteur — fictifs, sans donnée réelle. */
const SAMPLE_ACCOUNT_IDS: Record<AccountType, string> = {
  atlassian: 'acc-agent-interne',
  app: 'acc-integration-supervision',
  customer: 'acc-client-portail',
  unknown: 'acc-demandeur-inconnu',
};

/** Clé de ticket lisible dérivée de l'identifiant stable de l'entrée. */
export function sampleIssueKey(id: string): string {
  return `${SAMPLE_PROJECT_KEY}-${id.toUpperCase()}`;
}

/** Date fixe décalée de `minutes` minutes après la création. */
function atMinute(minutes: number): string {
  return new Date(Date.parse(SAMPLE_CREATED_AT) + minutes * MINUTE_MS).toISOString();
}

/** Contexte auteur cohérent avec le type de compte déclaré. */
function authorOf(accountType: AccountType, sample: SampleRequestEntry): AuthorContext {
  const author: AuthorContext = {
    accountId: SAMPLE_ACCOUNT_IDS[accountType],
    accountType,
    supportAgent: accountType === 'atlassian',
  };
  if (accountType === 'customer' || accountType === 'unknown') {
    if (sample.reporterName) author.displayName = sample.reporterName;
    if (sample.organizationId) author.organizationId = sample.organizationId;
  }
  return author;
}

interface IssueRef {
  issueId: string;
  issueKey: string;
  projectKey: string;
}

function issueOf(sample: SampleRequestEntry): IssueRef {
  return {
    issueId: `banc-${sample.id}`,
    issueKey: sampleIssueKey(sample.id),
    projectKey: SAMPLE_PROJECT_KEY,
  };
}

function segment(
  sample: SampleRequestEntry,
  issue: IssueRef,
  field: SegmentSource['field'],
  text: string,
  author: AuthorContext,
  createdAt: string,
  extra?: Partial<SegmentSource>,
): SegmentSource {
  return {
    ...issue,
    field,
    text,
    author,
    channel: sample.channel as RequestChannel,
    createdAt,
    ...extra,
  };
}

/** Segments du corps de la demande : résumé, description, nom du demandeur. */
function bodySegments(sample: SampleRequestEntry, issue: IssueRef): SegmentSource[] {
  const author = authorOf(sample.accountType, sample);
  const segments = [
    segment(sample, issue, 'summary', sample.summary, author, atMinute(0)),
    segment(sample, issue, 'description', sample.description, author, atMinute(0)),
  ];
  if (sample.reporterName) {
    segments.push(
      segment(sample, issue, 'reporterName', sample.reporterName, author, atMinute(0)),
    );
  }
  return segments;
}

/** Un segment par commentaire : auteur et visibilité propres à chaque élément. */
function commentSegments(sample: SampleRequestEntry, issue: IssueRef): SegmentSource[] {
  return sample.comments.map((comment, index) =>
    segment(
      sample,
      issue,
      'comment',
      comment.body,
      authorOf(comment.authorType, sample),
      atMinute(index + 1),
      {
        refId: `comment-${index + 1}`,
        visibility: comment.visibility as CommentVisibility,
      },
    ),
  );
}

/**
 * Un segment par nom de pièce jointe. La métadonnée n'est portée que si la
 * pièce est non analysable : c'est ce qui déclenche le signal C4
 * `unparseable-attachment` (§22) — le contenu des pièces n'est jamais émis ici.
 */
function attachmentSegments(sample: SampleRequestEntry, issue: IssueRef): SegmentSource[] {
  const author = authorOf(sample.accountType, sample);
  const offset = sample.comments.length + 1;
  return (sample.attachments ?? []).map((attachment: SampleAttachment, index) => {
    const meta: AttachmentMeta = {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      parseable: attachment.parseable,
    };
    return segment(sample, issue, 'attachmentName', attachment.fileName, author, atMinute(offset + index), {
      refId: `attachment-${attachment.fileName}`,
      ...(attachment.parseable ? {} : { attachment: meta }),
    });
  });
}

/** Tous les segments réels d'une demande d'exemple, dans l'ordre du fil. */
export function toSegments(sample: SampleRequestEntry): SegmentSource[] {
  const issue = issueOf(sample);
  return [
    ...bodySegments(sample, issue),
    ...commentSegments(sample, issue),
    ...attachmentSegments(sample, issue),
  ];
}
