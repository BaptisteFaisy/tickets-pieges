/**
 * Catalogue « couche C2 — adresse à une IA » (§6) — propriétaire : lot C2.
 *
 * Deux familles de clés :
 *  - `c2.summary.<ruleId>` : le résumé **neutre** posé dans `LayerHit.askSummary`.
 *    Il décrit ce que le passage demande, sans jamais recopier la charge (§6) ;
 *    c'est pour cela qu'il vit ici et pas dans le motif.
 *  - `c2.summary.reported.<ruleId>` : même résumé quand le passage est **cité**
 *    (un client qui signale une faille, une documentation interne, §22).
 *  - `c2.kind.<kind>` : libellé court du type de constat, pour l'écran de revue.
 */
export const detectionC2Catalog = {
  fr: {
    'c2.title': 'C2 — adresse à une IA',
    'c2.kind.assistant-addressing': 'consigne adressée à un assistant',
    'c2.kind.role-switch': 'changement de rôle demandé',
    'c2.kind.fake-system-marker': 'faux marqueur de système',
    'c2.kind.tool-command': 'commande d’outil',
    'c2.kind.exfiltration-url': 'adresse jointe à un envoi de données',
    'c2.summary.C2-01':
      'Le passage s’adresse directement à l’assistant : il lui demande d’ignorer, d’oublier ou de remplacer ses consignes.',
    'c2.summary.C2-02':
      'Le passage demande à l’assistant d’adopter un autre rôle, une autre identité ou un autre mode de fonctionnement.',
    'c2.summary.C2-03':
      'Le passage imite un marqueur de système — préfixe, balise, titre ou délimiteur — pour se présenter comme une consigne de la plateforme.',
    'c2.summary.C2-04':
      'Le passage demande d’exécuter des actions sur des tickets — commentaire, recherche, export, étiquette — au moyen d’un outil.',
    'c2.summary.C2-05':
      'Le passage associe une adresse web à un envoi de données, ou charge cette adresse avec des données du ticket.',
    'c2.summary.reported.C2-01':
      'Passage cité dans un signalement ou une documentation : il rapporte une consigne qui demande à un assistant d’ignorer ses instructions.',
    'c2.summary.reported.C2-02':
      'Passage cité dans un signalement ou une documentation : il rapporte une demande de changement de rôle adressée à un assistant.',
    'c2.summary.reported.C2-03':
      'Passage cité dans un signalement ou une documentation : il rapporte un faux marqueur de système.',
    'c2.summary.reported.C2-04':
      'Passage cité dans un signalement ou une documentation : il rapporte une commande d’outil sur des tickets.',
    'c2.summary.reported.C2-05':
      'Passage cité dans un signalement ou une documentation : il rapporte une adresse web accompagnée de données.',
  },
  en: {
    'c2.title': 'C2 — addressing an AI',
    'c2.kind.assistant-addressing': 'instruction addressed to an assistant',
    'c2.kind.role-switch': 'requested role change',
    'c2.kind.fake-system-marker': 'fake system marker',
    'c2.kind.tool-command': 'tool command',
    'c2.kind.exfiltration-url': 'address tied to a data send',
    'c2.summary.C2-01':
      'The passage addresses the assistant directly: it asks it to ignore, forget or replace its instructions.',
    'c2.summary.C2-02':
      'The passage asks the assistant to take on another role, another identity or another operating mode.',
    'c2.summary.C2-03':
      'The passage imitates a system marker — prefix, tag, heading or delimiter — to pass itself off as a platform instruction.',
    'c2.summary.C2-04':
      'The passage asks for actions on tickets — comment, search, export, label — to be carried out through a tool.',
    'c2.summary.C2-05':
      'The passage ties a web address to a data send, or loads that address with ticket data.',
    'c2.summary.reported.C2-01':
      'Passage quoted in a report or a piece of documentation: it reports an instruction asking an assistant to ignore its instructions.',
    'c2.summary.reported.C2-02':
      'Passage quoted in a report or a piece of documentation: it reports a role-change request aimed at an assistant.',
    'c2.summary.reported.C2-03':
      'Passage quoted in a report or a piece of documentation: it reports a fake system marker.',
    'c2.summary.reported.C2-04':
      'Passage quoted in a report or a piece of documentation: it reports a tool command on tickets.',
    'c2.summary.reported.C2-05':
      'Passage quoted in a report or a piece of documentation: it reports a web address together with data.',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
