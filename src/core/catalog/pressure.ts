/**
 * Catalogue « couche C4 — pression lexicale » (§6) — propriétaire : lot pression.
 *
 * Signaux **hors lexique** : une densité d'impératifs, une consigne différée ou
 * un acrostiche d'action ne recopie jamais la charge brute. Les clés `summary`
 * décrivent neutrement ce que le passage suggère — c'est le texte posé dans
 * `LayerHit.askSummary` et `LayerHit.excerpt`.
 */
export const pressureCatalog = {
  fr: {
    'pressure.title': 'C4 — pression lexicale',
    'pressure.kind.imperative-density': 'densité d’impératifs',
    'pressure.kind.deferred-instruction': 'consigne différée',
    'pressure.kind.text-acrostich': 'acrostiche d’action',
    'pressure.summary.C4-06':
      'Nombreuses formules impératives : ce passage enchaîne les verbes d’action, ce qui ressemble à une série de consignes.',
    'pressure.summary.C4-07':
      'Consigne différée : le passage demande d’agir plus tard, une fois une autre étape terminée.',
    'pressure.summary.C4-08':
      'Les initiales des lignes composent un verbe d’action : une consigne peut y être dissimulée.',
  },
  en: {
    'pressure.title': 'C4 — lexical pressure',
    'pressure.kind.imperative-density': 'imperative density',
    'pressure.kind.deferred-instruction': 'deferred instruction',
    'pressure.kind.text-acrostich': 'action acrostic',
    'pressure.summary.C4-06':
      'Many imperative verbs: this passage keeps stacking action verbs, which reads like a series of instructions.',
    'pressure.summary.C4-07':
      'Deferred instruction: the passage asks to act later, once another step is complete.',
    'pressure.summary.C4-08':
      'The first letters of the lines spell an action verb: an instruction may be concealed.',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;