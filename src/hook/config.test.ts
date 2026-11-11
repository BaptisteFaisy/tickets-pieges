/**
 * Tests — fichier de hooks généré (§11).
 *
 * Couvre : JSON parsable, structure exacte du §11, noms de serveur et d'outils
 * réglables, `onFailure: 'block'` à l'écriture seulement, jeton par variable
 * d'environnement, timeout court, et les deux limites rendues en fr et en.
 * Aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import type { HookConfig } from '../core/types';
import {
  DEFAULT_HOOK_CONFIG,
  generateHookFile,
  hookLimits,
  renderHookFile,
  resolveHookConfig,
  toolMatcher,
} from './config';

const BASE = 'https://demo.webtrigger.atlassian.app/pieges';

function config(overrides: Partial<HookConfig> = {}): HookConfig {
  return resolveHookConfig({ baseUrl: BASE, ...overrides });
}

describe('renderHookFile', () => {
  it('rend un JSON parsable', () => {
    expect(() => JSON.parse(renderHookFile(config()))).not.toThrow();
  });

  it('structure §11 : PostToolUse lit tout le serveur MCP, PreToolUse cible les écritures', () => {
    const file = generateHookFile(config());
    expect(file.hooks.PostToolUse[0]?.matcher).toBe('mcp__atlassian__.*');
    expect(file.hooks.PreToolUse[0]?.matcher).toBe(
      'mcp__atlassian__(addCommentToJiraIssue|editJiraIssue)',
    );
  });

  it('chaque entrée : type http, url, timeout court, jeton par variable d’environnement', () => {
    const entry = generateHookFile(config()).hooks.PostToolUse[0]?.hooks[0];
    expect(entry).toMatchObject({
      type: 'http',
      url: `${BASE}/inbound`,
      timeout: 5,
      headers: { Authorization: 'Bearer $PIEGE_TOKEN' },
      allowedEnvVars: ['PIEGE_TOKEN'],
    });
  });

  it('onFailure: block à l’écriture, jamais à la lecture', () => {
    const file = generateHookFile(config());
    expect(file.hooks.PreToolUse[0]?.hooks[0]?.onFailure).toBe('block');
    expect(file.hooks.PostToolUse[0]?.hooks[0]?.onFailure).toBeUndefined();
  });

  it('l’url d’écriture pointe vers /outbound', () => {
    const entry = generateHookFile(config()).hooks.PreToolUse[0]?.hooks[0];
    expect(entry?.url).toBe(`${BASE}/outbound`);
  });
});

describe('noms réglables (§11 : chaque poste a les siens)', () => {
  it('serveur et outils personnalisés changent les matchers', () => {
    const file = generateHookFile(
      config({ serverName: 'jira-mcp', readTools: ['getJiraIssue'], writeTools: ['addComment'] }),
    );
    expect(file.hooks.PostToolUse[0]?.matcher).toBe('mcp__jira-mcp__(getJiraIssue)');
    expect(file.hooks.PreToolUse[0]?.matcher).toBe('mcp__jira-mcp__(addComment)');
  });

  it('toolMatcher : [.*] ouvre tout, une liste cible', () => {
    expect(toolMatcher('s', ['.*'])).toBe('mcp__s__.*');
    expect(toolMatcher('s', ['a', 'b'])).toBe('mcp__s__(a|b)');
  });

  it('variable d’environnement et timeout réglables', () => {
    const file = generateHookFile(config({ tokenEnvVar: 'MON_JETON', timeoutSeconds: 3 }));
    const entry = file.hooks.PostToolUse[0]?.hooks[0];
    expect(entry?.headers.Authorization).toBe('Bearer $MON_JETON');
    expect(entry?.allowedEnvVars).toEqual(['MON_JETON']);
    expect(entry?.timeout).toBe(3);
  });
});

describe('resolveHookConfig', () => {
  it('les défauts s’appliquent, la baseUrl perd ses barres finales', () => {
    const resolved = resolveHookConfig({ baseUrl: `${BASE}//` });
    expect(resolved.baseUrl).toBe(BASE);
    expect(resolved.serverName).toBe(DEFAULT_HOOK_CONFIG.serverName);
    expect(resolved.timeoutSeconds).toBe(5);
    expect(resolved.writeTools).toEqual(['addCommentToJiraIssue', 'editJiraIssue']);
  });
});

describe('hookLimits — les deux limites du §11', () => {
  it('deux limites, en français comme en anglais, textes résolus (pas des clés)', () => {
    for (const language of ['fr', 'en'] as const) {
      const limits = hookLimits(language);
      expect(limits).toHaveLength(2);
      for (const limit of limits) {
        expect(limit.length).toBeGreaterThan(20);
        expect(limit).not.toContain('hook.limit');
      }
    }
  });

  it('la limite « outil déjà exécuté » et la limite « clients à hooks » sont distinctes', () => {
    expect(hookLimits('fr')[0]).not.toBe(hookLimits('fr')[1]);
  });
});
