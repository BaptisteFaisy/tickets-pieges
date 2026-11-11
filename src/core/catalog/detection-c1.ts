/**
 * Catalogue « couche C1 — dissimulation » (§6) — propriétaire : lot C1.
 *
 * Trois familles de clés, toutes stables :
 *   `c1.rule.<ruleId>`  — titre court du motif, pour la revue et l'écran (§14) ;
 *   `c1.ask.<clé>`      — résumé neutre de ce que le passage fait (§6), sans
 *                         jamais recopier la charge ;
 *   `c1.detail.<ruleId>`— détail chiffré du constat, avec substitutions `{nom}`.
 *
 * Le résumé porté par `LayerHit.askSummary` est « clé + détail » : la clé se
 * traduit via `i18n.t()`, le détail est déjà dans la langue du segment.
 * `parseAskSummary()` (dans `c1-concealment.ts`) les sépare.
 */
export const detectionC1Catalog = {
  fr: {
    'c1.title': 'C1 — dissimulation',

    'c1.rule.C1-01': 'Caractères de largeur nulle',
    'c1.rule.C1-02': 'Caractères de balise (réservés Unicode)',
    'c1.rule.C1-03': 'Espaces insécables en surnombre',
    'c1.rule.C1-04': 'Traits d’union conditionnels en série',
    'c1.rule.C1-05': 'Inversion du sens d’écriture',
    'c1.rule.C1-06': 'Texte de la couleur du fond',
    'c1.rule.C1-07': 'Texte blanc sur fond blanc',
    'c1.rule.C1-08': 'Texte alternatif d’image porteur d’une consigne',
    'c1.rule.C1-09': 'Lien dont le libellé annonce une autre adresse',
    'c1.rule.C1-10': 'Lien vers une destination non navigable',
    'c1.rule.C1-11': 'Lien vers un hôte inconnu',
    'c1.rule.C1-12': 'Long bloc encodé',

    'c1.ask.invisible-chars': 'Du texte invisible est présent dans ce passage',
    'c1.ask.tag-chars': 'Des caractères réservés Unicode servent de texte caché',
    'c1.ask.nbsp': 'Des espaces insécables en surnombre morcellent le texte',
    'c1.ask.joiners': 'Des traits d’union conditionnels en série morcellent le texte',
    'c1.ask.bidi': 'Le sens d’écriture est inversé : ce qui est affiché diffère de ce qui est écrit',
    'c1.ask.color-bg': 'Le texte est rendu invisible par sa couleur',
    'c1.ask.white-on-white': 'Le texte est blanc sur un fond blanc',
    'c1.ask.alt-instruction': 'Le texte alternatif d’une image porte une consigne',
    'c1.ask.link-domain': 'Le libellé du lien annonce un autre domaine que sa destination',
    'c1.ask.link-scheme': 'Le lien pointe vers une destination qui ne s’affiche pas',
    'c1.ask.link-unknown-host': 'Le lien mène à un hôte qui n’est pas connu du projet',
    'c1.ask.encoded-block': 'Un long bloc encodé est présent ; son contenu n’est pas décodé ici',

    'c1.detail.C1-01': '{count} caractère(s) de largeur nulle ({codes})',
    'c1.detail.C1-02': '{count} caractère(s) de balise ({codes})',
    'c1.detail.C1-03': '{count} espace(s) insécable(s)',
    'c1.detail.C1-04': '{count} trait(s) d’union conditionnel(s) en série',
    'c1.detail.C1-05': '{count} marque(s) d’inversion ({codes})',
    'c1.detail.C1-06': 'texte {fg} sur fond {bg}',
    'c1.detail.C1-07': 'texte {fg} sur fond blanc',
    'c1.detail.C1-08': 'texte alternatif de {count} caractère(s)',
    'c1.detail.C1-09': 'libellé « {label} », destination {host}',
    'c1.detail.C1-10': 'destination {scheme}',
    'c1.detail.C1-11': 'libellé « {label} », hôte {host}',
    'c1.detail.C1-12': 'bloc {scheme} de {count} caractère(s)',
  },
  en: {
    'c1.title': 'C1 — concealment',

    'c1.rule.C1-01': 'Zero-width characters',
    'c1.rule.C1-02': 'Unicode tag characters',
    'c1.rule.C1-03': 'Excess non-breaking spaces',
    'c1.rule.C1-04': 'Conditional hyphens in series',
    'c1.rule.C1-05': 'Writing-direction override',
    'c1.rule.C1-06': 'Text coloured like its background',
    'c1.rule.C1-07': 'White text on white background',
    'c1.rule.C1-08': 'Image alternative text carrying an instruction',
    'c1.rule.C1-09': 'Link label announcing another address',
    'c1.rule.C1-10': 'Link to a non-navigable destination',
    'c1.rule.C1-11': 'Link to an unknown host',
    'c1.rule.C1-12': 'Long encoded block',

    'c1.ask.invisible-chars': 'Invisible text is present in this passage',
    'c1.ask.tag-chars': 'Unicode tag characters are used as hidden text',
    'c1.ask.nbsp': 'Excess non-breaking spaces split the text apart',
    'c1.ask.joiners': 'Conditional hyphens in series split the text apart',
    'c1.ask.bidi': 'Writing direction is overridden: what is shown differs from what is written',
    'c1.ask.color-bg': 'The text is made invisible by its colour',
    'c1.ask.white-on-white': 'The text is white on a white background',
    'c1.ask.alt-instruction': 'An image alternative text carries an instruction',
    'c1.ask.link-domain': 'The link label announces another domain than its target',
    'c1.ask.link-scheme': 'The link points to a destination that is not displayed',
    'c1.ask.link-unknown-host': 'The link leads to a host unknown to the project',
    'c1.ask.encoded-block': 'A long encoded block is present; it is not decoded here',

    'c1.detail.C1-01': '{count} zero-width character(s) ({codes})',
    'c1.detail.C1-02': '{count} tag character(s) ({codes})',
    'c1.detail.C1-03': '{count} non-breaking space(s)',
    'c1.detail.C1-04': '{count} conditional hyphen(s) in series',
    'c1.detail.C1-05': '{count} direction mark(s) ({codes})',
    'c1.detail.C1-06': 'text {fg} on background {bg}',
    'c1.detail.C1-07': 'text {fg} on white background',
    'c1.detail.C1-08': 'alternative text of {count} character(s)',
    'c1.detail.C1-09': 'label “{label}”, target {host}',
    'c1.detail.C1-10': 'target {scheme}',
    'c1.detail.C1-11': 'label “{label}”, host {host}',
    'c1.detail.C1-12': '{scheme} block of {count} character(s)',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
