/**
 * Catalogue « exposition étendue » (#42, #45, #47, #48, #59) — propriétaire : lot exposition-plus.
 *
 * Textes visibles du score d'exposition, des exports, de la médiane
 * inter-organisations, de la vue non analysé et de l'obéissance par assistant.
 * Honnêteté (§21) : le score « mesure », il ne « protège » pas ; ce qui n'est
 * pas analysé est dit.
 */
export const expositionCatalog = {
  fr: {
    'exposition.score.title': 'Score d’exposition',
    'exposition.score.value': '{score}/100',
    'exposition.score.band.low': 'faible',
    'exposition.score.band.medium': 'moyen',
    'exposition.score.band.high': 'élevé',
    'exposition.score.band.critical': 'critique',
    'exposition.score.component.suspects': 'constats suspects (C1+C2+C3)',
    'exposition.score.component.obedience': 'obéissance aux exercices',
    'exposition.score.component.outbound': 'réponses retenues par le sas',
    'exposition.score.component.unanalyzed': 'part non analysée',
    'exposition.score.honesty':
      'Ce score mesure l’exposition observée sur la fenêtre ; il réduit l’incertitude, '
      + 'il ne protège pas. Ce qui n’a pas été analysé compte contre le score.',

    'exposition.export.title': 'Export avant/après',
    'exposition.export.header.field': 'champ',
    'exposition.export.header.before': 'avant',
    'exposition.export.header.after': 'après',
    'exposition.export.header.change': 'variation',
    'exposition.export.honesty':
      'L’export ne contient que des compteurs et des taux : aucun texte de ticket n’en sort.',

    'exposition.median.title': 'Médiane inter-organisations',
    'exposition.median.honesty':
      'Seules des empreintes agrégées circulent : des nombres, jamais un extrait, '
      + 'jamais une identité.',

    'exposition.unanalyzed.title': 'Ce qui n’a pas été analysé',
    'exposition.unanalyzed.empty': 'Tout ce projet a été analysé sur la fenêtre.',
    'exposition.unanalyzed.count': '{count} ticket(s) portent au moins une part non analysée.',
    'exposition.unanalyzed.reason.image': 'image',
    'exposition.unanalyzed.reason.binary-attachment': 'pièce binaire',
    'exposition.unanalyzed.reason.oversize': 'texte hors taille',
    'exposition.unanalyzed.reason.unsupported-format': 'format non pris en charge',
    'exposition.unanalyzed.reason.model-pending': 'en attente du modèle',

    'exposition.assistant.title': 'Obéissance par assistant',
    'exposition.assistant.rovo': 'Atlassian Rovo',
    'exposition.assistant.claude': 'Claude (Anthropic)',
    'exposition.assistant.copilot': 'GitHub Copilot',
    'exposition.assistant.gemini': 'Gemini (Google)',
    'exposition.assistant.chatgpt': 'ChatGPT (OpenAI)',
    'exposition.assistant.unknown': 'assistant non reconnu',
    'exposition.assistant.honesty':
      'Un assistant nommé ici est une intégration, pas une personne ; ce taux mesure '
      + 'un comportement observé, il n’accuse ni ne disculpe.',
  },
  en: {
    'exposition.score.title': 'Exposure score',
    'exposition.score.value': '{score}/100',
    'exposition.score.band.low': 'low',
    'exposition.score.band.medium': 'medium',
    'exposition.score.band.high': 'high',
    'exposition.score.band.critical': 'critical',
    'exposition.score.component.suspects': 'suspect findings (C1+C2+C3)',
    'exposition.score.component.obedience': 'obedience to exercises',
    'exposition.score.component.outbound': 'responses held by the gate',
    'exposition.score.component.unanalyzed': 'unanalyzed share',
    'exposition.score.honesty':
      'This score measures the exposure observed in the window; it reduces uncertainty, '
      + 'it does not protect. What was not analyzed counts against the score.',

    'exposition.export.title': 'Before/after export',
    'exposition.export.header.field': 'field',
    'exposition.export.header.before': 'before',
    'exposition.export.header.after': 'after',
    'exposition.export.header.change': 'change',
    'exposition.export.honesty':
      'The export holds counters and rates only: no ticket text ever leaves it.',

    'exposition.median.title': 'Cross-organization median',
    'exposition.median.honesty':
      'Only aggregated fingerprints travel: numbers, never an excerpt, never an identity.',

    'exposition.unanalyzed.title': 'What was not analyzed',
    'exposition.unanalyzed.empty': 'Everything in this project was analyzed in the window.',
    'exposition.unanalyzed.count': '{count} ticket(s) carry at least one unanalyzed part.',
    'exposition.unanalyzed.reason.image': 'image',
    'exposition.unanalyzed.reason.binary-attachment': 'binary attachment',
    'exposition.unanalyzed.reason.oversize': 'oversized text',
    'exposition.unanalyzed.reason.unsupported-format': 'unsupported format',
    'exposition.unanalyzed.reason.model-pending': 'model pending',

    'exposition.assistant.title': 'Obedience by assistant',
    'exposition.assistant.rovo': 'Atlassian Rovo',
    'exposition.assistant.claude': 'Claude (Anthropic)',
    'exposition.assistant.copilot': 'GitHub Copilot',
    'exposition.assistant.gemini': 'Gemini (Google)',
    'exposition.assistant.chatgpt': 'ChatGPT (OpenAI)',
    'exposition.assistant.unknown': 'unrecognized assistant',
    'exposition.assistant.honesty':
      'An assistant named here is an integration, not a person; this rate measures an '
      + 'observed behavior, it neither accuses nor exonerates.',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
