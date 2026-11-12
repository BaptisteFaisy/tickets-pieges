/**
 * Textes de la section « Hook et clients d'agents » — les deux langues vivent
 * ici (règle 9 du site : rien n'est ajouté aux catalogues du produit). Les
 * textes du domaine (motifs, limites, contexte) viennent du catalogue via les
 * fonctions de `src/hook/*` ; ce fichier ne contient que les libellés d'écran.
 */

import type { SectionContext } from './types';

export const L = {
  client: { fr: 'Client d’agent', en: 'Agent client' },
  baseUrl: { fr: 'URL de base des webtriggers', en: 'Webtrigger base URL' },
  serverName: { fr: 'Nom du serveur MCP', en: 'MCP server name' },
  readTools: { fr: 'Outils de lecture (regex, séparées par des virgules)', en: 'Read tools (regex, comma-separated)' },
  writeTools: { fr: 'Outils d’écriture publique', en: 'Public write tools' },
  tokenEnvVar: { fr: 'Variable d’environnement du jeton', en: 'Token environment variable' },
  timeoutSeconds: { fr: 'Délai d’attente (secondes)', en: 'Timeout (seconds)' },
  token: { fr: 'Jeton du poste — jamais écrit dans les fichiers, seule son empreinte apparaît', en: 'Workstation token — never written to the files, only its fingerprint appears' },
  generate: { fr: 'Générer les fichiers', en: 'Generate files' },
  copy: { fr: 'Copier', en: 'Copy' },
  copied: { fr: 'Fichier copié dans le presse-papiers : rien n’a quitté la page.', en: 'File copied to the clipboard: nothing left the page.' },
  copyFailed: { fr: 'Copie impossible dans ce navigateur — sélectionnez le texte du fichier.', en: 'Copy unavailable in this browser — select the file text instead.' },
  file: { fr: 'Fichier', en: 'File' },
  format: { fr: 'Format', en: 'Format' },
  purpose: { fr: 'Rôle', en: 'Purpose' },
  writeBlocked: { fr: 'écriture bloquée si l’app ne répond pas (§11)', en: 'write blocked if the app does not answer (§11)' },
  writeOpen: { fr: 'pas de blocage à l’écriture', en: 'no write blocking' },
  filesTitle: { fr: 'Fichiers générés pour ce client', en: 'Files generated for this client' },
  local: { fr: 'Tout se calcule dans votre navigateur : aucun appel réseau, le jeton n’est jamais envoyé.', en: 'Everything runs in your browser: no network call, the token is never sent.' },
  inboundTitle: { fr: 'Réponse PostToolUse — ce que le modèle voit après une lecture MCP (§11)', en: 'PostToolUse response — what the model sees after an MCP read (§11)' },
  inboundRequest: { fr: 'Appel d’outil MCP simulé, avec sa sortie brute', en: 'Simulated MCP tool call, with its raw output' },
  inboundExtracted: { fr: 'Clé de ticket retrouvée par l’app', en: 'Issue key recovered by the app' },
  inboundUpdated: { fr: 'updatedToolOutput — la sortie remplacée par le contenu encadré (§8.2)', en: 'updatedToolOutput — the output replaced with framed content (§8.2)' },
  inboundFull: { fr: 'Réponse JSON complète du hook', en: 'Full hook JSON response' },
  inboundRun: { fr: 'Rejouer — l’identifiant de bloc change à chaque appel (§23.7)', en: 'Replay — the block id changes on every call (§23.7)' },
  outboundTitle: { fr: 'Réponse PreToolUse — confirmation avant une écriture publique (§11)', en: 'PreToolUse response — confirmation before a public write (§11)' },
  outboundRequest: { fr: 'Écriture simulée : commentaire sur le ticket externe SUP-482', en: 'Simulated write: comment on the external ticket SUP-482' },
  trust: { fr: 'Confiance du ticket (§5)', en: 'Ticket trust (§5)' },
  suspicion: { fr: 'Suspicion (§4)', en: 'Suspicion (§4)' },
  visibility: { fr: 'Visibilité de l’écriture', en: 'Write visibility' },
  public: { fr: 'publique', en: 'public' },
  internal: { fr: 'note interne (rien ne sort)', en: 'internal note (nothing goes out)' },
  tainted: { fr: 'Session contaminée (§9) : l’agent a lu du contenu non vérifié', en: 'Tainted session (§9): the agent read unverified content' },
  strict: { fr: 'Mode strict du projet (§8.1)', en: 'Project strict mode (§8.1)' },
  outboundRun: { fr: 'Rendre la décision', en: 'Return the decision' },
  outboundFull: { fr: 'Réponse JSON complète du hook', en: 'Full hook JSON response' },
  outboundNone: { fr: 'Aucun motif rendu : l’écriture passe sans relecture.', en: 'No reason returned: the write goes through without review.' },
  tokenTitle: { fr: 'Cycle de vie du jeton du hook — empreinte stockée, comparaison à temps constant, rotation (§11)', en: 'Hook token lifecycle — stored fingerprint, timing-safe comparison, rotation (§11)' },
  tokenRun: { fr: 'Rejouer le cycle (nouveaux jetons aléatoires)', en: 'Replay the cycle (new random tokens)' },
  tokenStep: { fr: 'Étape', en: 'Step' },
  tokenPublic: { fr: 'Réponse publique', en: 'Public response' },
  tokenLog: { fr: 'Journal (ne sort jamais)', en: 'Log (never returned)' },
  tokenDetail: { fr: 'Détail', en: 'Detail' },
  tokenNote: { fr: 'Jeton absent, compte inconnu, empreinte fausse : exactement le même 401, même corps — seul le journal distingue les cas. La comparaison des empreintes est à temps constant (timingSafeEqual) : aucun délai ne révèle le premier octet juste.', en: 'Absent token, unknown account, wrong fingerprint: exactly the same 401, same body — only the log tells the cases apart. Fingerprint comparison is timing-safe: no delay reveals the first matching byte.' },
  tokenIssued: { fr: 'Émission — le clair n’existe qu’ici, une seule fois ; la ligne stockée ne porte que l’empreinte SHA-256', en: 'Issue — the clear text exists only here, once; the stored row carries the SHA-256 fingerprint only' },
  tokenCorrect: { fr: 'Présentation du bon jeton', en: 'Presenting the correct token' },
  tokenWrong: { fr: 'Présentation d’un jeton faux', en: 'Presenting a wrong token' },
  tokenAbsent: { fr: 'Aucun jeton (en-tête Authorization absent)', en: 'No token (Authorization header missing)' },
  tokenUnknown: { fr: 'Compte inconnu de la table hook_token', en: 'Account unknown to the hook_token table' },
  tokenRotated: { fr: 'Rotation — nouvelle empreinte, createdAt repart ; la rotation est la seule révocation', en: 'Rotation — new fingerprint, createdAt resets; rotation is the only revocation' },
  tokenOldAfter: { fr: 'Ancien jeton présenté après rotation', en: 'Old token presented after rotation' },
  tokenNewAfter: { fr: 'Nouveau jeton présenté après rotation', en: 'New token presented after rotation' },
  policyTitle: { fr: 'Politique en lecture seule — ce qu’un agent externe a le droit de faire, avant d’agir (#29)', en: 'Read-only policy — what an external agent may do, before acting (#29)' },
  policyIssue: { fr: 'Clé du ticket', en: 'Issue key' },
  policySession: { fr: 'Référence de session', en: 'Session reference' },
  policyDeclared: { fr: 'trustLevel auto-déclaré par l’agent — ignoré : la politique ne se déclare pas elle-même', en: 'trustLevel self-declared by the agent — ignored: policy never declares itself' },
  policyRun: { fr: 'Interroger la politique (GET)', en: 'Query the policy (GET)' },
  policyGet: { fr: 'Action MCP en lecture (verbe GET) : rien n’est écrit, aucun texte de ticket n’est rendu, aucun jeton n’est renvoyé — seule son empreinte figure dans la réponse.', en: 'Read-only MCP action (GET verb): nothing is written, no ticket text is returned, no token is sent back — only its fingerprint appears in the response.' },
  policyHint: { fr: 'Ticket inconnu de l’app (essayez INC-1) : rien n’est automatique, tout passe par un humain.', en: 'Ticket unknown to the app (try INC-1): nothing is automatic, everything goes through a human.' },
  policyWarnings: { fr: 'Avertissements — champs déclarés à tort par l’appelant', en: 'Warnings — fields wrongly declared by the caller' },
  policyEmpty: { fr: 'Interrogez la politique pour voir l’énoncé rendu à l’agent.', en: 'Query the policy to see the statement returned to the agent.' },
  policyStatement: { fr: 'Énoncé de politique rendu (JSON)', en: 'Policy statement returned (JSON)' },
  limitsTitle: { fr: 'Les deux limites, dites franchement (§11)', en: 'The two limits, stated plainly (§11)' },
} as const;

export type CopyKey = keyof typeof L;

/** Le libellé dans la langue de la page. */
export function label(ctx: SectionContext, key: CopyKey): string {
  return L[key][ctx.lang];
}
