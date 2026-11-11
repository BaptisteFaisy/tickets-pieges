/**
 * Tests — hook d'écriture `PreToolUse` (§11).
 *
 * Couvre : forme exacte de la réponse (`permissionDecision` + motif citant la
 * clé), `ask` sur une réponse publique d'une demande externe — surtout en
 * session contaminée (§9) —, `allow` sur note interne et demande interne,
 * `deny` en mode strict sur demande piégée, fr et en. Aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import type { HookOutboundRequest } from '../core/types';
import { buildOutboundResponse, isPublicWrite, issueKeyOf, type OutboundTicketData } from './outbound';

function hookRequest(overrides: Partial<HookOutboundRequest> = {}): HookOutboundRequest {
  return {
    toolName: 'mcp__atlassian__addCommentToJiraIssue',
    toolInput: { issueKey: 'SUP-482', comment: 'Voici la réponse.' },
    ...overrides,
  };
}

function data(overrides: Partial<OutboundTicketData> = {}): OutboundTicketData {
  return {
    issueKey: 'SUP-482',
    language: 'fr',
    trustLevel: 'T1',
    suspicionLevel: 'suspect',
    strictOutbound: false,
    sessionTainted: false,
    ...overrides,
  };
}

describe('buildOutboundResponse — forme exacte du §11', () => {
  it('hookSpecificOutput { hookEventName, permissionDecision, permissionDecisionReason }', () => {
    const response = buildOutboundResponse(hookRequest(), data());
    expect(Object.keys(response)).toEqual(['hookSpecificOutput']);
    expect(response.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(['allow', 'ask', 'deny']).toContain(response.hookSpecificOutput.permissionDecision);
    expect(typeof response.hookSpecificOutput.permissionDecisionReason).toBe('string');
  });

  it('réponse publique sur demande externe : ask, motif citant la clé du ticket', () => {
    const { permissionDecision, permissionDecisionReason } =
      buildOutboundResponse(hookRequest(), data()).hookSpecificOutput;
    expect(permissionDecision).toBe('ask');
    expect(permissionDecisionReason).toContain('SUP-482');
    expect(permissionDecisionReason).toContain('Réponse publique sur une demande externe');
  });

  it('session contaminée (§9) : ask renforcé, le motif dit le contenu non vérifié', () => {
    const { permissionDecision, permissionDecisionReason } =
      buildOutboundResponse(hookRequest(), data({ sessionTainted: true })).hookSpecificOutput;
    expect(permissionDecision).toBe('ask');
    expect(permissionDecisionReason).toContain('SUP-482');
    expect(permissionDecisionReason).toContain('contenu non vérifié');
    expect(permissionDecisionReason).toContain('Relis le texte avant l');
  });

  it('T0 anonyme : ask aussi — toute origine externe est concernée', () => {
    expect(buildOutboundResponse(hookRequest(), data({ trustLevel: 'T0' })).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('note interne : allow — rien ne sort', () => {
    const request = hookRequest({ toolInput: { issueKey: 'SUP-482', visibility: 'internal' } });
    const { permissionDecision, permissionDecisionReason } =
      buildOutboundResponse(request, data({ sessionTainted: true })).hookSpecificOutput;
    expect(permissionDecision).toBe('allow');
    expect(permissionDecisionReason).toBe('');
  });

  it('demande d’origine interne (T3) : allow', () => {
    expect(buildOutboundResponse(hookRequest(), data({ trustLevel: 'T3' })).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('demande piégée en mode strict : deny, motif citant la clé', () => {
    const { permissionDecision, permissionDecisionReason } = buildOutboundResponse(
      hookRequest(),
      data({ suspicionLevel: 'trapped', strictOutbound: true }),
    ).hookSpecificOutput;
    expect(permissionDecision).toBe('deny');
    expect(permissionDecisionReason).toContain('SUP-482');
  });

  it('demande piégée sans mode strict : ask — la relecture humaine reste la règle', () => {
    expect(
      buildOutboundResponse(hookRequest(), data({ suspicionLevel: 'trapped' })).hookSpecificOutput.permissionDecision,
    ).toBe('ask');
  });

  it('en anglais : le motif suit la langue du projet', () => {
    const { permissionDecisionReason } =
      buildOutboundResponse(hookRequest(), data({ language: 'en', sessionTainted: true })).hookSpecificOutput;
    expect(permissionDecisionReason).toContain('Public reply on an external request (SUP-482)');
    expect(permissionDecisionReason).toContain('unverified');
  });
});

describe('issueKeyOf', () => {
  it('lit les champs usuels de toolInput', () => {
    expect(issueKeyOf(hookRequest())).toBe('SUP-482');
    expect(issueKeyOf(hookRequest({ toolInput: { issue_key: 'TST-7' } }))).toBe('TST-7');
  });

  it('null si aucune clé exploitable', () => {
    expect(issueKeyOf(hookRequest({ toolInput: { comment: 'sans clé' } }))).toBeNull();
    expect(issueKeyOf(hookRequest({ toolInput: { issueKey: 'pas-une-cle' } }))).toBeNull();
  });
});

describe('isPublicWrite', () => {
  it('public ou visibilité absente : écriture publique', () => {
    expect(isPublicWrite({ visibility: 'public' })).toBe(true);
    expect(isPublicWrite({})).toBe(true);
  });

  it('internal ou restreint : rien ne sort', () => {
    expect(isPublicWrite({ visibility: 'internal' })).toBe(false);
    expect(isPublicWrite({ commentVisibility: 'restricted-administer' })).toBe(false);
  });
});
