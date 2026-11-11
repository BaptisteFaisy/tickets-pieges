/**
 * Résolveur des originaux conservés (§17.6) — lot UI.
 *
 * Accès réservé au rôle sécurité (§21) : l'identité vient du contexte Forge,
 * jamais du payload ; sans compte autorisé, la porte reste fermée. Le texte est
 * rendu inerte (`inertDisplay`) — jamais de markup. La restauration est
 * journalisée (§8.3, réversibilité).
 */
import { t } from '../core/i18n';
import { inertDisplay, restoreText } from '../core/neutralize';
import type { OriginalRow } from '../platform/schema';
import {
  accountIdOf,
  fail,
  ok,
  payloadText,
  type OriginalView,
  type ResolverDeps,
  type UiHandler,
} from '../ui/api';

/** L'appelant est-il du rôle sécurité ? Défaut : non (accès refusé). */
export function isSecurity(deps: ResolverDeps, context: unknown): boolean {
  const accountId = accountIdOf(context);
  return accountId !== null && deps.securityAccounts.includes(accountId);
}

async function issueKeyOf(deps: ResolverDeps, issueId: string): Promise<string> {
  const state = await deps.store.states.get(issueId);
  return state?.issueKey ?? issueId;
}

function forbidden(): ReturnType<typeof fail> {
  return fail(t('fr', 'ui.originals.forbidden'));
}

/** `listOriginals` : les originaux en attente, sans leur contenu. */
function makeListOriginals(deps: ResolverDeps): UiHandler {
  const { store } = deps;
  return async (_payload, context) => {
    if (!isSecurity(deps, context)) return forbidden();
    try {
      const rows = await store.originals.pending();
      const views: OriginalView[] = [];
      for (const row of rows) {
        views.push(await toView(deps, row, false));
      }
      return ok(views);
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };
}

/** `getOriginal` : un original, contenu rendu inerte (§17.6). */
function makeGetOriginal(deps: ResolverDeps): UiHandler {
  const { store } = deps;
  return async (payload, context) => {
    if (!isSecurity(deps, context)) return forbidden();
    const id = payloadText(payload, 'id');
    if (!id) return fail(t('fr', 'ui.error.missing', { name: 'id' }));
    try {
      const row = await store.originals.byId(id);
      if (!row) return fail(t('fr', 'ui.error.notFound', { name: id }));
      return ok(await toView(deps, row, true));
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };
}

/** `restoreOriginal` : restauration journalisée, constats repassés à « restored ». */
function makeRestoreOriginal(deps: ResolverDeps): UiHandler {
  const { store, clock } = deps;
  return async (payload, context) => {
    if (!isSecurity(deps, context)) return forbidden();
    const id = payloadText(payload, 'id');
    if (!id) return fail(t('fr', 'ui.error.missing', { name: 'id' }));
    try {
      const row = await store.originals.byId(id);
      if (!row) return fail(t('fr', 'ui.error.notFound', { name: id }));
      await restoreRow(deps, row, payloadText(payload, 'reason') ?? 'ui', accountIdOf(context) ?? 'security', clock.now());
      return ok({ id });
    } catch {
      return fail(t('fr', 'ui.error.generic'));
    }
  };
}

async function restoreRow(deps: ResolverDeps, row: OriginalRow, reason: string, by: string, now: string): Promise<void> {
  const { store } = deps;
  const issueKey = await issueKeyOf(deps, row.issueId);
  const { journal } = restoreText(row.content, {
    issueKey,
    segmentId: row.segmentId,
    originalId: row.id,
    reason,
    at: now,
    by,
  });
  await store.originals.markRestored(row.id, now);
  for (const findingId of row.findingIds) {
    await store.findings.setStatus(findingId, 'restored');
  }
  for (const entry of journal) {
    await store.events.append(entry.kind, row.issueId, entry.detail);
  }
}

/** Fabrique les gestionnaires des originaux conservés. */
export function originalsResolvers(deps: ResolverDeps): Record<string, UiHandler> {
  return {
    listOriginals: makeListOriginals(deps),
    getOriginal: makeGetOriginal(deps),
    restoreOriginal: makeRestoreOriginal(deps),
  };
}

async function toView(deps: ResolverDeps, row: OriginalRow, withContent: boolean): Promise<OriginalView> {
  const view: OriginalView = {
    id: row.id,
    issueKey: await issueKeyOf(deps, row.issueId),
    segmentId: row.segmentId,
    storedAt: row.storedAt,
    restoredAt: row.restoredAt,
    findingIds: row.findingIds,
  };
  if (withContent) view.contentInert = inertDisplay(row.content);
  return view;
}
