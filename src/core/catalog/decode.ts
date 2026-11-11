/**
 * Catalogue « décodage prudent des blocs encodés » (#1, #11) — propriétaire : lot decode.
 *
 * Familles de clés stables (français et anglais, toutes deux obligatoires) :
 *   `decode.rule.<ruleId>` — titre court du motif (revue / écran, §14) ;
 *   `decode.ask.<clé>`    — résumé neutre porté par `LayerHit.askSummary` ;
 *   `decode.warn.<clé>`   — avertissement rendu quand un décodage est partiel ou borné.
 *
 * Le résumé ne recopie jamais la charge : il décrit ce qui est fait du passage,
 * pas son contenu (§6, §21).
 */
export const decodeCatalog = {
  fr: {
    'decode.rule.DC-01': 'Bloc base64 décodé',
    'decode.rule.DC-02': 'Bloc hexadécimal décodé',
    'decode.rule.DC-03': 'Texte url-encodé décodé',
    'decode.rule.DC-04': 'Échappements unicode décodés',
    'decode.rule.DC-05': 'Encodage imbriqué (plusieurs niveaux)',
    'decode.rule.DC-06': 'Raccourcisseur de lien cachant sa destination',

    'decode.ask.decoded':
      'Du texte encodé a été décodé : une consigne dissimulée devient lisible',
    'decode.ask.shortener':
      'Cette URL est un raccourci : sa destination réelle est inconnue sans la consulter',

    'decode.warn.truncated': 'Bloc encodé tronqué ou corrompu : décodage partiel',
    'decode.warn.too-long': 'Bloc décodé trop long : analyse interrompue sur la borne de taille',
  },
  en: {
    'decode.rule.DC-01': 'Decoded base64 block',
    'decode.rule.DC-02': 'Decoded hexadecimal block',
    'decode.rule.DC-03': 'Decoded url-encoded text',
    'decode.rule.DC-04': 'Decoded unicode escapes',
    'decode.rule.DC-05': 'Nested encoding (several levels)',
    'decode.rule.DC-06': 'Link shortener hiding its destination',

    'decode.ask.decoded':
      'Encoded text was decoded: a concealed instruction becomes readable',
    'decode.ask.shortener':
      'This URL is a shortener: its real destination is unknown without consulting it',

    'decode.warn.truncated': 'Truncated or corrupted encoded block: partial decode',
    'decode.warn.too-long': 'Decoded block too long: analysis stopped at the size bound',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;