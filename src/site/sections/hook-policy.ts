/**
 * Bloc « politique en lecture seule » de la section Hook (#29) — un agent
 * externe demande ce qu'il a le droit de faire **avant** d'agir : l'app rend
 * l'énoncé de politique (permis / humain / interdit), sans jamais rendre de
 * texte de ticket ni de jeton (seule l'empreinte du jeton apparaît).
 *
 * La section appelle la véritable action MCP `get-policy`
 * (`createPolicyTool` de `src/hook/policy-server.ts`, pure et sans réseau) avec
 * un double de lecture local : un ticket connu (SUP-482, externe, suspect,
 * session contaminée) et des clés inconnues (INC-1…). Tout champ que
 * l'appelant déclare sur son propre droit (trustLevel…) est ignoré et signalé
 * en avertissement par l'outil — la politique ne se déclare pas elle-même.
 */

import type { Language } from '../../core/types';
import type { JsonPayload } from '../../mcp/result';
import {
  createPolicyTool,
  type PolicyEnvelope,
  type PolicyFacts,
  type PolicyReader,
} from '../../hook/policy-server';
import { badge, buttonHtml, byId, esc, field, grid, heading, kv, list, note, panel, pre, valueOf } from '../dom';
import type { SectionContext } from './types';
import { label } from './hook-copy';
import { DEFAULT_INPUTS } from './hook-config';

/** Le ticket connu de la démo : demande externe suspecte, session contaminée. */
function knownFacts(lang: Language): PolicyFacts {
  return {
    issueKey: 'SUP-482',
    language: lang,
    trustLevel: 'T1',
    suspicionLevel: 'suspect',
    modeApplied: 'label',
    strictOutbound: false,
    sessionTainted: true,
    unanalyzed: ['image'],
  };
}

/** Le port de lecture injecté : structurellement en lecture seule (une méthode). */
export function demoReader(lang: Language): PolicyReader {
  return {
    async facts(issueKey: string): Promise<PolicyFacts | null> {
      return issueKey.toUpperCase() === 'SUP-482' ? knownFacts(lang) : null;
    },
  };
}

/** Résultat d'un appel à `get-policy` : enveloppe, avertissements, erreur. */
export interface PolicyRunResult {
  envelope: PolicyEnvelope | null;
  warnings: string[];
  error: string | null;
}

/** Appelle l'outil réel `get-policy` avec la charge saisie à l'écran. */
export async function queryPolicy(payload: JsonPayload, lang: Language): Promise<PolicyRunResult> {
  const tool = createPolicyTool(demoReader(lang), { language: lang, token: DEFAULT_INPUTS.token });
  const result = await tool(payload);
  return {
    envelope: result.ok ? (result.data as PolicyEnvelope) : null,
    warnings: result.warnings,
    error: result.ok ? null : (result.error ?? 'erreur inconnue'),
  };
}

/** L'énoncé en paires clé/valeur : ce que l'app sait, ce qu'elle rend. */
function statementKv(result: PolicyRunResult, ctx: SectionContext): string {
  const statement = result.envelope?.statement;
  const fr = ctx.lang === 'fr';
  return kv([
    [label(ctx, 'policyIssue'), statement?.known ? statement.issueKey : fr ? 'ticket inconnu' : 'unknown ticket'],
    [fr ? 'Confiance' : 'Trust', statement?.trustLevel ?? '—'],
    [label(ctx, 'suspicion'), statement?.suspicionLevel ?? '—'],
    [fr ? 'Mode appliqué' : 'Applied mode', statement?.modeApplied ?? '—'],
    [fr ? 'Session contaminée' : 'Tainted session', statement?.sessionTainted ? '✓' : '—'],
    [fr ? 'Empreinte du jeton' : 'Token fingerprint', statement?.tokenFingerprint?.slice(0, 16) ?? '—'],
  ]);
}

/** Le panneau de résultat : verbe, énoncé, avertissements, JSON rendu. */
export function policyResultHtml(result: PolicyRunResult, ctx: SectionContext): string {
  if (result.error || !result.envelope) return note(result.error ?? '—');
  const warnings = result.warnings.length ? note(label(ctx, 'policyWarnings')) + list(result.warnings) : '';
  return badge('GET', 'ok') +
    note(label(ctx, 'policyGet')) +
    statementKv(result, ctx) +
    warnings +
    heading(label(ctx, 'policyStatement')) +
    pre(result.envelope.rendered);
}

/** Formulaire : clé du ticket, session, et un trustLevel auto-déclaré (ignoré). */
export function policyForm(ctx: SectionContext): string {
  return panel(
    field(label(ctx, 'policyIssue'), `<input id="h-policy-issue" type="text" value="SUP-482">`) +
      field(label(ctx, 'policySession'), `<input id="h-policy-session" type="text" value="session-agent-7">`) +
      field(label(ctx, 'policyDeclared'), `<input id="h-policy-trust" type="text" value="T3">`) +
      buttonHtml('h-policy-run', label(ctx, 'policyRun')) +
      note(label(ctx, 'policyHint')),
  );
}

/** Lit la charge utile depuis le formulaire. */
export function readPolicyPayload(root: HTMLElement): JsonPayload {
  const payload: JsonPayload = { issueKey: valueOf(root, 'h-policy-issue') || 'SUP-482' };
  const session = valueOf(root, 'h-policy-session');
  const trust = valueOf(root, 'h-policy-trust');
  if (session) payload.sessionRef = session;
  if (trust) payload.trustLevel = trust;
  return payload;
}

/** HTML initial du bloc : formulaire à gauche, résultat à droite. */
export function renderPolicyBlock(ctx: SectionContext): string {
  return `<div class="block"><h4>${esc(label(ctx, 'policyTitle'))}</h4>` +
    grid(policyForm(ctx), panel(note(label(ctx, 'policyEmpty')), 'h-policy-result')) +
    '</div>';
}

/** Câblage : interroger la politique (et le faire une fois au montage). */
export function mountPolicy(root: HTMLElement, ctx: SectionContext): void {
  const run = async (): Promise<void> => {
    const target = byId<HTMLDivElement>(root, 'h-policy-result');
    if (!target) return;
    const result = await queryPolicy(readPolicyPayload(root), ctx.lang);
    target.innerHTML = policyResultHtml(result, ctx);
  };
  byId<HTMLButtonElement>(root, 'h-policy-run')?.addEventListener('click', () => void run());
  void run();
}
