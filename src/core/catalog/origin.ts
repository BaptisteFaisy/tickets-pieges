/**
 * Catalogue « origine » (§5) — propriétaire : lot Origine (TP-01, TP-02).
 *
 * Chaque raison d'origine porte un code stable (`origin.*`) repris dans
 * `SegmentOrigin.reasons` : l'interface affiche le texte, le journal garde le
 * code. Les libellés des niveaux, des suspicions et des modes sont partagés par
 * tout le produit : ils vivent ici, dans ce même catalogue.
 */
export const originCatalog = {
  fr: {
    'trust.T0': 'T0 — anonyme ou machine',
    'trust.T1': 'T1 — externe identifié',
    'trust.T2': 'T2 — partenaire connu',
    'trust.T3': 'T3 — interne',
    'suspicion.clean': 'sain',
    'suspicion.review': 'à vérifier',
    'suspicion.suspect': 'suspect',
    'suspicion.trapped': 'piégé',
    'mode.report': 'signaler',
    'mode.label': 'étiqueter',
    'mode.neutralize': 'neutraliser',

    'origin.support-agent': 'écrit par un agent de support ({detail})',
    'origin.internal-account': "écrit par un compte de l'organisation ({detail})",
    'origin.trusted-organization': 'client rattaché à une organisation de confiance ({detail})',
    'origin.trusted-domain': 'domaine de courriel vérifié ({detail})',
    'origin.customer-portal': 'compte client du portail, sans organisation de confiance ({detail})',
    'origin.anonymous-portal': 'demande déposée sur le portail anonyme ({detail})',
    'origin.unknown-email': 'courriel d’un expéditeur inconnu ({detail})',
    'origin.app-account': 'texte créé par une intégration non listée ({detail})',
    'origin.trusted-integration': 'intégration inscrite sur la liste de confiance ({detail})',
    'origin.machine-channel': 'canal machine ou anonyme ({detail})',
    'origin.unknown-account': 'type de compte inconnu, auteur identifié ({detail})',
    'origin.unidentified-author': 'auteur non identifié : externe par défaut',
    'origin.channel': 'canal de la demande : {detail}',
    'origin.visibility': 'visibilité du commentaire : {detail}',
    'origin.summary': 'origine {trust} — {count} raison(s)',
  },
  en: {
    'trust.T0': 'T0 — anonymous or machine',
    'trust.T1': 'T1 — identified external',
    'trust.T2': 'T2 — known partner',
    'trust.T3': 'T3 — internal',
    'suspicion.clean': 'clean',
    'suspicion.review': 'to review',
    'suspicion.suspect': 'suspect',
    'suspicion.trapped': 'trapped',
    'mode.report': 'report',
    'mode.label': 'label',
    'mode.neutralize': 'neutralize',

    'origin.support-agent': 'written by a support agent ({detail})',
    'origin.internal-account': 'written by an organization account ({detail})',
    'origin.trusted-organization': 'customer attached to a trusted organization ({detail})',
    'origin.trusted-domain': 'verified email domain ({detail})',
    'origin.customer-portal': 'portal customer account, no trusted organization ({detail})',
    'origin.anonymous-portal': 'request filed through the anonymous portal ({detail})',
    'origin.unknown-email': 'email from an unknown sender ({detail})',
    'origin.app-account': 'text created by an unlisted integration ({detail})',
    'origin.trusted-integration': 'integration on the trust list ({detail})',
    'origin.machine-channel': 'machine or anonymous channel ({detail})',
    'origin.unknown-account': 'unknown account type, identified author ({detail})',
    'origin.unidentified-author': 'unidentified author: external by default',
    'origin.channel': 'request channel: {detail}',
    'origin.visibility': 'comment visibility: {detail}',
    'origin.summary': 'origin {trust} — {count} reason(s)',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
