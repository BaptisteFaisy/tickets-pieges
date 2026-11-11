/**
 * Catalogue « couche C4 — contexte » (§6) — propriétaire : lot Constats.
 *
 * Les clés `ask.*` sont les résumés neutres par défaut d'un constat (§6) : elles
 * servent aussi de repli quand une couche n'a pas fourni de résumé, et
 * `ask.unknown` est le repli universel du produit.
 */
export const detectionC4Catalog = {
  fr: {
    'c4.title': 'C4 — contexte',
    'c4.fresh-account.detail': 'compte créé il y a {hours} heure(s)',
    'c4.anonymous-channel.detail': 'demande déposée sur le portail anonyme',
    'c4.unusual-length.detail': 'longueur inhabituelle : {length} caractères pour une médiane de {median}',
    'c4.language-shift.detail': 'langue {found} dans un ticket en {expected}',
    'c4.unparseable-attachment.detail': 'pièce jointe non analysable',

    'ask.unknown': 'demande à examiner : contenu externe non vérifié',
    'ask.fresh-account': 'compte récent : premier contact, à situer',
    'ask.anonymous-channel': 'auteur anonyme : identité inconnue',
    'ask.unusual-length': 'longueur inhabituelle : contenu plus long que d’habitude',
    'ask.language-shift': 'langue différente du reste du ticket',
    'ask.unparseable-attachment': 'pièce jointe non analysée : contenu non vérifié',
    'ask.invisible-chars': 'caractères invisibles dans le texte',
    'ask.bidi-override': 'inversion du sens d’écriture dans le texte',
    'ask.background-colored-text': 'texte de la couleur du fond, invisible à la lecture',
    'ask.image-alt-text': 'texte alternatif d’image porteur d’un contenu',
    'ask.link-label-mismatch': 'lien dont le libellé ne correspond pas à l’adresse',
    'ask.encoded-block': 'bloc encodé, contenu non lisible directement',
    'ask.assistant-addressing': 'phrases adressées à un assistant plutôt qu’au support',
    'ask.role-switch': 'tentative de changement de rôle de l’assistant',
    'ask.fake-system-marker': 'marqueur imitant une consigne de système',
    'ask.tool-command': 'demande d’action sur des outils ou d’autres tickets',
    'ask.exfiltration-url': 'adresse à consulter en y joignant des données',
    'ask.model-verdict': 'consigne adressée à une IA relevée par le modèle',
    'ask.model-malformed': 'réponse du modèle non conforme : traité comme suspect',
  },
  en: {
    'c4.title': 'C4 — context',
    'c4.fresh-account.detail': 'account created {hours} hour(s) ago',
    'c4.anonymous-channel.detail': 'request filed through the anonymous portal',
    'c4.unusual-length.detail': 'unusual length: {length} characters against a median of {median}',
    'c4.language-shift.detail': '{found} text in a ticket written in {expected}',
    'c4.unparseable-attachment.detail': 'attachment could not be analysed',

    'ask.unknown': 'request to review: unverified external content',
    'ask.fresh-account': 'recent account: first contact, worth placing',
    'ask.anonymous-channel': 'anonymous author: identity unknown',
    'ask.unusual-length': 'unusual length: longer content than usual',
    'ask.language-shift': 'language different from the rest of the ticket',
    'ask.unparseable-attachment': 'attachment not analysed: unverified content',
    'ask.invisible-chars': 'invisible characters in the text',
    'ask.bidi-override': 'writing direction override in the text',
    'ask.background-colored-text': 'text in the background colour, invisible to a reader',
    'ask.image-alt-text': 'image alt text carrying content',
    'ask.link-label-mismatch': 'link whose label does not match its address',
    'ask.encoded-block': 'encoded block, content not directly readable',
    'ask.assistant-addressing': 'phrases addressed to an assistant rather than to support',
    'ask.role-switch': 'attempt to switch the assistant role',
    'ask.fake-system-marker': 'marker imitating a system instruction',
    'ask.tool-command': 'request to act on tools or other tickets',
    'ask.exfiltration-url': 'address to fetch while carrying data',
    'ask.model-verdict': 'instruction addressed to an AI, spotted by the model',
    'ask.model-malformed': 'non-conforming model answer: treated as suspect',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
