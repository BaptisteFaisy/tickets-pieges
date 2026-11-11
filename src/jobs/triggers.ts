/**
 * Événements Jira (§18 : déroulement à l'arrivée d'une demande) — lot Jobs.
 *
 * Ordre imposé par le cahier :
 *   1. l'origine est calculée aussitôt, sans modèle, et écrite dans la propriété ;
 *   2. les couches C1 et C2 passent dans la foulée ;
 *   3. la couche C3 est mise en file (`pieges-c3`) ;
 *   4. le niveau de suspicion est fixé, le mode du projet s'applique ;
 *   5. tout est journalisé.
 *
 * Squelette : les corps sont remplacés par le lot Jobs.
 */

/** `avi:jira:created:issue` — origine + C1/C2 + mise en file de C3. */
export async function issueCreated(event: unknown): Promise<void> {
  void event;
}

/** `avi:jira:updated:issue` — pièces jointes, champs texte, déplacement de projet. */
export async function issueUpdated(event: unknown): Promise<void> {
  void event;
}

/** `avi:jira:created:comment` — le fil entier est réexaminé (§22). */
export async function commentCreated(event: unknown): Promise<void> {
  void event;
}

/** `avi:jira:updated:comment` — visibilité modifiée, texte édité. */
export async function commentUpdated(event: unknown): Promise<void> {
  void event;
}

/** `avi:jira:created:issuelink` — hérédité vers le ticket lié ou cloné (§12). */
export async function issueLinkCreated(event: unknown): Promise<void> {
  void event;
}
