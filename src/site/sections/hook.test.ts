/**
 * Tests de la section « Hook et clients d'agents » — sans DOM (vitest en
 * `node`) : le HTML produit par `render(ctx)` et les fonctions pures exposées
 * par les blocs (`hook-config`, `hook-flows`, `hook-token`, `hook-policy`).
 */

import { describe, expect, it } from 'vitest';
import { t as translate } from '../../core/i18n';
import { createMemoryStore } from '../../platform/memory';
import { sha256 } from '../../core/hashing';
import { hookLimits } from '../../hook/config';
import { CLIENT_IDS } from '../../hook/clients/index';
import { esc } from '../dom';
import type { SectionContext } from './types';
import { hookSection } from './hook';
import { artifactsFor, DEFAULT_INPUTS, filesPanel, hookConfigOf, type ConfigInput } from './hook-config';
import { DEFAULT_OUTBOUND, inboundResultHtml, outboundResultHtml, runInbound, runOutbound } from './hook-flows';
import { tokenCycle, tokenResultHtml } from './hook-token';
import { policyResultHtml, queryPolicy } from './hook-policy';

const NOW = '2026-11-12T12:00:00.000Z';

function contextOf(lang: 'fr' | 'en'): SectionContext {
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    store: createMemoryStore(),
    now: NOW,
    notify: () => undefined,
  };
}

const ctxFr = contextOf('fr');
const ctxEn = contextOf('en');

/** Le html de la section, dans une langue donnée. */
function html(lang: 'fr' | 'en' = 'fr'): string {
  return hookSection.render(contextOf(lang)) as string;
}

describe('section hook : contrat et rendu', () => {
  it('porte l’identifiant et les titres du brief', () => {
    expect(hookSection.id).toBe('hook');
    expect(hookSection.titles).toEqual({ fr: 'Hook et clients d’agents', en: 'Hook & agent clients' });
  });

  it('rend les cinq blocs, démontrables sans attendre', () => {
    const page = html();
    for (const id of [
      'h-client', 'h-generate', 'h-files', 'h-copy-0',
      'h-inbound-run', 'h-inbound-result',
      'h-outbound-run', 'h-outbound-result',
      'h-token-run', 'h-token-result',
      'h-policy-run', 'h-policy-result',
    ]) {
      expect(page).toContain(id);
    }
  });

  it('est bilingue : les titres de blocs existent en anglais', () => {
    const page = html('en');
    expect(page).toContain('PostToolUse response');
    expect(page).toContain('PreToolUse response');
    expect(page).toContain('Hook token lifecycle');
    expect(page).toContain('Read-only policy');
  });

  it('affiche les deux limites du §11, dans la langue de la page', () => {
    const limits = hookLimits('fr');
    expect(limits).toHaveLength(2);
    const page = html();
    for (const limit of limits) expect(page).toContain(esc(limit));
    expect(html('en')).toContain(esc(hookLimits('en')[1]!));
  });

  it('une page qui parle d’injection n’est pas injectable', () => {
    expect(html()).not.toContain('<script>');
  });
});

describe('section hook : fichiers clients générés (§11)', () => {
  it('rend au moins un fichier pour chacun des cinq clients', () => {
    expect(CLIENT_IDS).toHaveLength(5);
    for (const clientId of CLIENT_IDS) {
      const artifacts = artifactsFor(clientId, DEFAULT_INPUTS, 'fr');
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.every((a) => a.clientId === clientId)).toBe(true);
    }
  });

  it('le fichier Claude Code porte les deux webtriggers et le blocage à l’écriture', () => {
    const artifacts = artifactsFor('claude-code', DEFAULT_INPUTS, 'fr');
    const hooks = artifacts.find((a) => a.purpose === 'hooks');
    expect(hooks).toBeDefined();
    expect(hooks!.writeBlocked).toBe(true);
    for (const marker of ['"PostToolUse"', '"PreToolUse"', 'mcp__atlassian__.*', '"onFailure": "block"', '$PIEGE_TOKEN', '/inbound', '/outbound']) {
      expect(hooks!.content).toContain(marker);
    }
  });

  it('le jeton n’est jamais écrit en clair : seule l’empreinte apparaît', () => {
    for (const clientId of CLIENT_IDS) {
      for (const artifact of artifactsFor(clientId, DEFAULT_INPUTS, 'fr')) {
        expect(artifact.content).not.toContain(DEFAULT_INPUTS.token);
      }
    }
    const rendered = CLIENT_IDS.flatMap((id) => artifactsFor(id, DEFAULT_INPUTS, 'fr'))
      .map((a) => a.content)
      .join('\n');
    expect(rendered).toContain(sha256(DEFAULT_INPUTS.token));
  });

  it('les noms de serveur et d’outils sont réglables', () => {
    const input: ConfigInput = { ...DEFAULT_INPUTS, serverName: 'mon-serveur', writeTools: 'editJiraIssue, addCommentToJiraIssue' };
    expect(hookConfigOf(input).readTools).toEqual(['.*']);
    expect(hookConfigOf(input).writeTools).toEqual(['editJiraIssue', 'addCommentToJiraIssue']);
    const content = artifactsFor('claude-code', input, 'fr').map((a) => a.content).join('\n');
    expect(content).toContain('mcp__mon-serveur__.*');
    expect(content).toContain('mcp__mon-serveur__(editJiraIssue|addCommentToJiraIssue)');
  });

  it('échappe une URL de base piégée dans le panneau des fichiers', () => {
    const input: ConfigInput = { ...DEFAULT_INPUTS, baseUrl: 'https://x.exemple/<script>alert(1)</script>' };
    const page = filesPanel(artifactsFor('cursor', input, 'fr'), ctxFr);
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
  });
});

describe('section hook : réponse PostToolUse (src/hook/inbound.ts)', () => {
  it('retrouve la clé et rend la sortie encadrée avec son contexte', () => {
    const result = runInbound(NOW, 'fr');
    expect(result.key).toBe('SUP-482');
    const out = result.response.hookSpecificOutput;
    expect(out.hookEventName).toBe('PostToolUse');
    expect(out.updatedToolOutput).toContain('SUP-482');
    expect(out.updatedToolOutput).toContain('<donnee-');
    expect(out.additionalContext).toContain('1');
  });

  it('le passage suspect est encadré comme donnée, pas comme instruction', () => {
    const out = runInbound(NOW, 'fr').response.hookSpecificOutput;
    expect(out.updatedToolOutput).toContain('suspicion=');
    expect(out.updatedToolOutput).toContain('ASSISTANT');
  });

  it('échappe le texte encadré dans le HTML (les balises du produit ne passent pas)', () => {
    const page = inboundResultHtml(runInbound(NOW, 'fr'), ctxFr);
    expect(page).not.toContain('<donnee-');
    expect(page).toContain('&lt;donnee-');
    expect(page).toContain('SUP-482');
  });
});

describe('section hook : réponse PreToolUse (src/hook/outbound.ts)', () => {
  it('écriture publique en session contaminée : ask avec motif qui cite la clé', () => {
    const out = runOutbound(DEFAULT_OUTBOUND, 'fr').response.hookSpecificOutput;
    expect(out.hookEventName).toBe('PreToolUse');
    expect(out.permissionDecision).toBe('ask');
    expect(out.permissionDecisionReason).toContain('SUP-482');
    expect(out.permissionDecisionReason).toContain('session');
  });

  it('demande piégée en mode strict : deny — rien ne part', () => {
    const out = runOutbound({ ...DEFAULT_OUTBOUND, suspicionLevel: 'trapped', strictOutbound: true }, 'fr')
      .response.hookSpecificOutput;
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toContain('SUP-482');
  });

  it('note interne et demande interne : allow sans motif', () => {
    const internal = runOutbound({ ...DEFAULT_OUTBOUND, visibility: 'internal' }, 'fr').response.hookSpecificOutput;
    expect(internal.permissionDecision).toBe('allow');
    expect(internal.permissionDecisionReason).toBe('');
    const trusted = runOutbound({ ...DEFAULT_OUTBOUND, trustLevel: 'T3', sessionTainted: false }, 'fr')
      .response.hookSpecificOutput;
    expect(trusted.permissionDecision).toBe('allow');
  });

  it('le verdict s’affiche en pastille dans le HTML', () => {
    const page = outboundResultHtml(runOutbound(DEFAULT_OUTBOUND, 'fr'), ctxFr);
    expect(page).toContain('>ask<');
    expect(page).toContain('SUP-482');
  });
});

describe('section hook : cycle de vie du jeton (src/hook/token.ts)', () => {
  /** Cycle déterministe : deux jetons fixes, dans l'ordre d'émission. */
  function fixedCycle() {
    const tokens = ['jeton-un', 'jeton-deux'];
    let i = 0;
    return tokenCycle(NOW, () => tokens[i++ % tokens.length]!);
  }

  it('stocke l’empreinte, jamais le clair', () => {
    const result = fixedCycle();
    expect(result.issued.token).toBe('jeton-un');
    expect(result.issued.row.tokenHash).toBe(sha256('jeton-un'));
    expect(result.issued.row.tokenHash).not.toBe('jeton-un');
    expect(result.issued.row.createdAt).toBe(NOW);
    expect(result.issued.row.lastUsedAt).toBeNull();
  });

  it('le bon jeton passe ; faux, absent, inconnu rendent le même 401', () => {
    const steps = fixedCycle().steps;
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.correct).toMatchObject({ verdict: '200', log: 'ok' });
    expect(byKey.wrong).toMatchObject({ verdict: '401', log: 'mismatch' });
    expect(byKey.absent).toMatchObject({ verdict: '401', log: 'absent' });
    expect(byKey.unknown).toMatchObject({ verdict: '401', log: 'unknown-account' });
  });

  it('la rotation révoque l’ancien jeton et le nouveau vérifie', () => {
    const result = fixedCycle();
    expect(result.rotated.token).toBe('jeton-deux');
    expect(result.rotated.row.tokenHash).toBe(sha256('jeton-deux'));
    const byKey = Object.fromEntries(result.steps.map((s) => [s.key, s]));
    expect(byKey.oldAfter).toMatchObject({ verdict: '401', log: 'mismatch' });
    expect(byKey.newAfter).toMatchObject({ verdict: '200', log: 'ok' });
  });

  it('le tableau du cycle affiche les verdicts publics, pas les motifs', () => {
    const page = tokenResultHtml(fixedCycle(), ctxFr);
    expect(page).toContain('401');
    expect(page).toContain('200');
    expect(page).toContain('jeton-un');
  });
});

describe('section hook : politique en lecture seule (#29)', () => {
  it('ticket connu : l’énoncé rend les faits de l’app, pas ceux déclarés', async () => {
    const result = await queryPolicy(
      { issueKey: 'SUP-482', sessionRef: 'session-agent-7', trustLevel: 'T3' },
      'fr',
    );
    expect(result.error).toBeNull();
    const statement = result.envelope!.statement;
    expect(statement.known).toBe(true);
    expect(statement.trustLevel).toBe('T1'); // le T3 auto-déclaré est ignoré
    expect(statement.allowed).toContain('read-ticket');
    expect(statement.requiresHuman).toContain('public-reply');
    expect(statement.denied).toContain('field-write');
    expect(statement.denied).toContain('bulk-action');
  });

  it('le champ auto-déclaré produit un avertissement de l’outil', async () => {
    const result = await queryPolicy({ issueKey: 'SUP-482', trustLevel: 'T3' }, 'fr');
    expect(result.warnings.join(' ')).toContain('trustLevel');
  });

  it('aucun jeton rendu : seule l’empreinte figure dans la réponse', async () => {
    const result = await queryPolicy({ issueKey: 'SUP-482' }, 'fr');
    const statement = result.envelope!.statement;
    expect(statement.tokenFingerprint).toBe(sha256(DEFAULT_INPUTS.token));
    expect(result.envelope!.rendered).not.toContain(DEFAULT_INPUTS.token);
    expect(result.envelope!.rendered).toContain('"version": 1');
  });

  it('ticket inconnu : rien d’automatique, tout passe par un humain', async () => {
    const result = await queryPolicy({ issueKey: 'INC-1' }, 'fr');
    const statement = result.envelope!.statement;
    expect(statement.known).toBe(false);
    expect(statement.trustLevel).toBeNull();
    expect(statement.allowed).toEqual([]);
    expect(statement.denied).toContain('bulk-action');
    expect(statement.requiresHuman).toContain('public-reply');
  });

  it('bilingue : l’énoncé suit la langue demandée pour un ticket inconnu', async () => {
    const en = await queryPolicy({ issueKey: 'INC-1' }, 'en');
    const page = policyResultHtml(en, ctxEn);
    expect(page).toContain('GET');
    expect(page).not.toContain('<script>');
    expect(en.envelope!.rendered.length).toBeGreaterThan(0);
  });
});
