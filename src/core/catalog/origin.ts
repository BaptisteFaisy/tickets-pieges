/**
 * Catalogue « origine » (§5) — propriétaire : lot Origine (TP-01, TP-02).
 *
 * Chaque raison d'origine porte un code stable (`origin.*`) repris dans
 * `SegmentOrigin.reasons` : l'interface affiche le texte, le journal garde le code.
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
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
