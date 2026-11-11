/**
 * Catalogue « opérations du sas de sortie » (#31, #32, #38, #39, #40).
 * Propriétaire : lot sas-ops.
 *
 * Textes visibles quand une notification, une pièce jointe ou un flux de
 * réponses est mesuré, retenu ou annoncé. Ton factuel : on dit ce qui est
 * mesuré et ce qui ne l'est pas (§21), sans jamais promettre une protection.
 */
export const outboundOpsCatalog = {
  fr: {
    'outbound-ops.notify.window':
      'commentaire public posé {seconds} s avant le contrôle : le courriel de notification est peut-être déjà parti',
    'outbound-ops.notify.window-unmeasured':
      'fenêtre entre commentaire et contrôle non mesurable : le départ du courriel de notification ne peut pas être écarté',
    'outbound-ops.internal.copy':
      'commentaire interne contenant du texte d’origine externe : il hérite du niveau {level} et passe par le sas avant toute recopie',
    'outbound-ops.internal.no-inheritance':
      'commentaire interne sans texte d’origine externe : l’hérédité sortante ne s’applique pas, aucun contrôle imposé',
    'outbound-ops.file.double-extension': 'nom de pièce à double extension : {name}',
    'outbound-ops.file.executable': 'pièce d’un type exécutable ou scriptable : {ext}',
    'outbound-ops.file.too-large': 'taille de pièce au-dessus de la borne : {bytes} octets',
    'outbound-ops.file.concealment': 'nom de pièce contenant des caractères invisibles',
    'outbound-ops.file.unanalyzed':
      'contenu de la pièce non analysé : le sas s’est limité au nom, au type et à la taille',
    'outbound-ops.file.checked': 'contenu de la pièce analysé par le sas',
    'outbound-ops.rate.exceeded':
      'l’agent {agent} dépasse {limit} réponses publiques en une heure : une fuite de masse est bruyante, alerte envoyée',
    'outbound-ops.redteam.title': 'rapport red team',
    'outbound-ops.redteam.summary':
      '{passed} sortie(s) du marqueur sur {total} tentatives (taux de réussite {rate})',
    'outbound-ops.redteam.none': 'aucune tentative n’a fait sortir le marqueur',
  },
  en: {
    'outbound-ops.notify.window':
      'public comment posted {seconds} s before the check: the notification email may already have left',
    'outbound-ops.notify.window-unmeasured':
      'window between comment and check could not be measured: the notification email cannot be ruled out',
    'outbound-ops.internal.copy':
      'internal comment containing text of external origin: it inherits level {level} and goes through the gate before any copy-out',
    'outbound-ops.internal.no-inheritance':
      'internal comment with no external-origin text: outbound inheritance does not apply, no check imposed',
    'outbound-ops.file.double-extension': 'attachment name with a double extension: {name}',
    'outbound-ops.file.executable': 'attachment of an executable or scriptable type: {ext}',
    'outbound-ops.file.too-large': 'attachment size above the bound: {bytes} bytes',
    'outbound-ops.file.concealment': 'attachment name contains invisible characters',
    'outbound-ops.file.unanalyzed':
      'attachment content not analyzed: the gate was limited to name, type and size',
    'outbound-ops.file.checked': 'attachment content analyzed by the gate',
    'outbound-ops.rate.exceeded':
      'agent {agent} exceeded {limit} public replies within one hour: a mass leak is loud, alert raised',
    'outbound-ops.redteam.title': 'red team report',
    'outbound-ops.redteam.summary':
      'marker got out {passed} time(s) over {total} attempts (success rate {rate})',
    'outbound-ops.redteam.none': 'no attempt got the marker out',
  },
};
