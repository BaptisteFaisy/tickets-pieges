/**
 * Catalogue « session étendue » (§9, §11, §21) — propriétaire : lot sessions.
 *
 * Quatre familles de clés :
 *  - `session.capability.*` : les capacités produit-agnostiques (#21) que le
 *    hook ou un agent externe lit ; les noms sont stables et ne citent aucun
 *    produit Atlassian ;
 *  - `session.decision.*` : les motifs lisibles rendus au hook
 *    (`permissionDecisionReason`, §11) pour le budget (#26), la quarantaine
 *    (#27) et l'extinction par inactivité (#24) ;
 *  - `session.audit.*` : les libellés du journal exportable (#28) ;
 *  - `session.honesty.*` : les limites dites franchement (§21) — un jeton signé
 *    prouve l'intégrité, pas la vie de la session ; la politique réduit le
 *    risque, elle ne protège pas.
 */
export const sessionCatalog = {
  fr: {
    'session.policy.title': 'Politique de session contaminée étendue',

    'session.capability.read': 'lire un ticket',
    'session.capability.search.broad': 'recherche étendue',
    'session.capability.reply.public': 'réponse publique',
    'session.capability.net.fetch': 'appel vers une adresse web',
    'session.capability.write.internal': 'commentaire interne',
    'session.capability.export.data': 'export de données',

    'session.decision.budget':
      'Budget de {budget} réponse(s) publique(s) atteint dans cette session ({issueId}). '
      + 'La suivante exige une validation humaine dans l’app : l’agent ne peut plus publier seul.',
    'session.decision.quarantine':
      'Session en quarantaine ({issueId}) : lecture seule. {signals} signal(aux) cumulés, '
      + 'aucun geste de sortie n’est autorisé tant qu’un humain n’a pas revu la session.',
    'session.decision.expired':
      'Marque de session éteinte après {minutes} minute(s) d’inactivité ({issueId}). '
      + 'Les gestes redeviennent libres ; une nouvelle lecture de contenu non vérifié '
      + 're-marque la session. L’extinction ne vaut pas blanchiment.',
    'session.decision.loop':
      'Boucle d’agent détectée : l’outil {tool} a été appelé sur {count} tickets différents '
      + 'en {seconds} seconde(s). Les capacités de sortie de cette session sont suspendues.',

    'session.token.rejected': 'Jeton de session refusé.',
    'session.token.minted': 'Jeton de session émis pour {sessionRef}.',

    'session.audit.title': 'Journal de session exportable',
    'session.audit.kind.read': 'lecture',
    'session.audit.kind.gesture-requested': 'geste demandé',
    'session.audit.kind.confirmation': 'confirmation humaine',
    'session.audit.kind.denial': 'refus',
    'session.audit.kind.budget-exhausted': 'budget épuisé',
    'session.audit.kind.quarantine': 'mise en quarantaine',
    'session.audit.kind.session-expired': 'extinction par inactivité',
    'session.audit.kind.loop-alert': 'alerte de boucle',
    'session.audit.kind.token-issued': 'jeton émis',
    'session.audit.kind.token-rejected': 'jeton refusé',
    'session.audit.redacted': 'retenu',
    'session.audit.empty': 'Aucune entrée de journal pour cette session.',
    'session.audit.count': '{count} entrée(s) de journal, du {from} au {to}.',

    'session.loop.none': 'Aucune boucle d’agent détectée sur la fenêtre observée.',

    'session.honesty.token':
      'Le jeton signé prouve que la marque n’a été ni forgée ni altérée ; il ne prouve pas '
      + 'que la session est encore ouverte ailleurs. La révocation passe par la rotation '
      + 'de la clé de signature.',
    'session.honesty.policy':
      'Cette politique réduit le risque de sortie de données depuis une session contaminée ; '
      + 'elle ne l’élimine pas. Un geste hors des capacités listées n’est pas couvert.',
    'session.honesty.audit':
      'Le journal exportable ne contient ni texte de ticket ni donnée personnelle : seules '
      + 'des empreintes, des identifiants et des compteurs y figurent. Ce qui n’est pas '
      + 'journalisé est dit comme tel.',
  },
  en: {
    'session.policy.title': 'Extended tainted-session policy',

    'session.capability.read': 'read an issue',
    'session.capability.search.broad': 'broad search',
    'session.capability.reply.public': 'public reply',
    'session.capability.net.fetch': 'web address call',
    'session.capability.write.internal': 'internal comment',
    'session.capability.export.data': 'data export',

    'session.decision.budget':
      'Budget of {budget} public reply(ies) reached in this session ({issueId}). The next one '
      + 'requires human validation in the app: the agent can no longer publish on its own.',
    'session.decision.quarantine':
      'Session in quarantine ({issueId}): read-only. {signals} signal(s) accumulated, no '
      + 'outbound gesture is allowed until a human has reviewed the session.',
    'session.decision.expired':
      'Session mark extinguished after {minutes} minute(s) of inactivity ({issueId}). Gestures '
      + 'are free again; reading unverified content marks the session once more. Expiry is not '
      + 'a clearance.',
    'session.decision.loop':
      'Agent loop detected: tool {tool} was called on {count} different issues within '
      + '{seconds} second(s). Outbound capabilities of this session are suspended.',

    'session.token.rejected': 'Session token rejected.',
    'session.token.minted': 'Session token issued for {sessionRef}.',

    'session.audit.title': 'Exportable session journal',
    'session.audit.kind.read': 'read',
    'session.audit.kind.gesture-requested': 'requested gesture',
    'session.audit.kind.confirmation': 'human confirmation',
    'session.audit.kind.denial': 'denial',
    'session.audit.kind.budget-exhausted': 'budget exhausted',
    'session.audit.kind.quarantine': 'quarantined',
    'session.audit.kind.session-expired': 'inactivity expiry',
    'session.audit.kind.loop-alert': 'loop alert',
    'session.audit.kind.token-issued': 'token issued',
    'session.audit.kind.token-rejected': 'token rejected',
    'session.audit.redacted': 'withheld',
    'session.audit.empty': 'No journal entry for this session.',
    'session.audit.count': '{count} journal entry(ies), from {from} to {to}.',

    'session.loop.none': 'No agent loop detected in the observed window.',

    'session.honesty.token':
      'The signed token proves the mark was neither forged nor altered; it does not prove the '
      + 'session is still open elsewhere. Revocation happens by rotating the signing key.',
    'session.honesty.policy':
      'This policy reduces the risk of data leaving a tainted session; it does not remove it. '
      + 'A gesture outside the listed capabilities is not covered.',
    'session.honesty.audit':
      'The exportable journal holds no issue text and no personal data: only fingerprints, '
      + 'identifiers and counters. What is not journalled is stated as such.',
  },
} satisfies Record<'fr' | 'en', Record<string, string>>;
