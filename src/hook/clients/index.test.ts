/**
 * Tests — les cinq rendus clients (#22).
 *
 * Couvre : JSON/TOML parsable, réutilisation du fichier de hooks généré (pas de
 * recopie), mêmes URL et même jeton partout, noms de serveur et d'outils
 * réglables répercutés sur les cinq clients, blocage à l'écriture présent
 * partout (et absent à la lecture), aucun jeton en clair, honnêteté sur les
 * clients sans hook (§21). Aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import type { HookConfig } from '../../core/types';
import { renderHookFile, resolveHookConfig } from '../config';
import { tokenFingerprint } from '../token';
import { buildPlan, CLIENT_IDS, renderAllClients, renderClient } from './index';
import type { ClientArtifact, ClientOptions, ClientPlan } from './index';

const BASE = 'https://demo.webtrigger.atlassian.app/pieges';
const TOKEN = 'jeton-secret-a-ne-jamais-ecrire-2026';

function makePlan(config: Partial<HookConfig> = {}, options: ClientOptions = {}): ClientPlan {
  return buildPlan({ baseUrl: BASE, ...config }, { token: TOKEN, ...options });
}

function contentOf(artifacts: ClientArtifact[], clientId: string): string {
  return artifacts.filter((item) => item.clientId === clientId).map((i) => i.content).join('\n');
}

/** Parseur TOML minimal (sous-ensemble du rendu) — les tests n'ont pas de dépendance. */
function parseTomlValue(text: string): unknown {
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((item) => parseTomlValue(item.trim()));
  }
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  if (text === 'true' || text === 'false') return text === 'true';
  const number = Number(text);
  if (!Number.isNaN(number)) return number;
  throw new Error(`valeur TOML invalide : ${text}`);
}

function parseToml(text: string): Record<string, Record<string, unknown>> {
  const parsed: Record<string, Record<string, unknown>> = {};
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      parsed[section] = {};
      continue;
    }
    const equal = line.indexOf('=');
    if (equal < 0 || section === '') throw new Error(`ligne TOML invalide : ${line}`);
    const target = parsed[section];
    if (!target) throw new Error(`section manquante : ${line}`);
    target[line.slice(0, equal).trim()] = parseTomlValue(line.slice(equal + 1).trim());
  }
  return parsed;
}

describe('les cinq rendus clients (#22)', () => {
  it('servent les cinq clients, avec un chemin et un format par fichier', () => {
    const artifacts = renderAllClients(makePlan());
    const served = new Set(artifacts.map((item) => item.clientId));
    expect(CLIENT_IDS).toHaveLength(5);
    expect([...served].sort()).toEqual([...CLIENT_IDS].sort());
    for (const artifact of artifacts) {
      expect(artifact.path.length).toBeGreaterThan(0);
      expect(artifact.clientLabel.length).toBeGreaterThan(0);
      expect(['json', 'toml', 'markdown']).toContain(artifact.format);
    }
  });

  it('chaque rendu JSON et TOML est parsable', () => {
    for (const artifact of renderAllClients(makePlan())) {
      if (artifact.format === 'json') expect(() => JSON.parse(artifact.content)).not.toThrow();
      if (artifact.format === 'toml') expect(() => parseToml(artifact.content)).not.toThrow();
    }
  });

  it('Claude Code reçoit exactement le fichier de hooks généré (réutilisé, pas recopié)', () => {
    const settings = renderClient('claude-code', makePlan()).find(
      (item) => item.path === '.claude/settings.json',
    );
    expect(settings?.content).toBe(renderHookFile(resolveHookConfig({ baseUrl: BASE })));
  });

  it('ZeroClaw : hooks de lecture et d’écriture, mêmes matchers, jeton par variable', () => {
    const plan = makePlan();
    const file = renderClient('zeroclaw', plan).find((item) => item.format === 'toml');
    const toml = parseToml(file?.content ?? '');
    expect(toml['hooks.inbound']?.matcher).toBe(plan.readMatcher);
    expect(toml['hooks.outbound']?.matcher).toBe(plan.writeMatcher);
    expect(toml['hooks.outbound']?.on_failure).toBe('block');
    expect(toml['hooks.inbound']?.authorization_env).toBe(plan.tokenEnvVar);
    expect(toml['hooks.inbound']?.url).toBe(plan.inboundUrl);
    expect(toml['hooks.outbound']?.url).toBe(plan.outboundUrl);
  });
});

describe('mêmes réglages partout', () => {
  it('les cinq rendus partagent la même URL de politique et la même variable de jeton', () => {
    const plan = makePlan();
    const artifacts = renderAllClients(plan);
    for (const clientId of CLIENT_IDS) {
      const content = contentOf(artifacts, clientId);
      expect(content, clientId).toContain(plan.policyUrl);
      expect(content, clientId).toContain(plan.tokenEnvVar);
    }
  });

  it('l’en-tête d’authentification renvoie à la variable, jamais à la valeur', () => {
    const plan = makePlan();
    const artifacts = renderAllClients(plan);
    for (const clientId of CLIENT_IDS) {
      if (clientId === 'zeroclaw') continue; // TOML : `authorization_env`
      expect(contentOf(artifacts, clientId), clientId).toContain(plan.authHeader);
    }
  });

  it('aucun rendu ne contient le jeton en clair ; l’empreinte est rendue', () => {
    const artifacts = renderAllClients(makePlan());
    for (const artifact of artifacts) {
      expect(artifact.content, artifact.path).not.toContain(TOKEN);
    }
    const plan = makePlan();
    expect(plan.fingerprint).toBe(tokenFingerprint(TOKEN));
    expect(contentOf(artifacts, 'cline')).toContain(tokenFingerprint(TOKEN));
  });

  it('changer le nom du serveur de politique se répercute dans les cinq', () => {
    const artifacts = renderAllClients(makePlan({}, { policyServer: 'mon-serveur' }));
    for (const clientId of CLIENT_IDS) {
      expect(contentOf(artifacts, clientId), clientId).toContain('mon-serveur');
    }
  });

  it('changer le nom de l’outil de politique se répercute dans les cinq', () => {
    const artifacts = renderAllClients(makePlan({}, { policyTool: 'lire-le-droit' }));
    for (const clientId of CLIENT_IDS) {
      expect(contentOf(artifacts, clientId), clientId).toContain('lire-le-droit');
    }
  });

  it('changer le nom du serveur MCP se répercute dans les matchers des clients à hooks', () => {
    const artifacts = renderAllClients(makePlan({ serverName: 'mon-jira' }));
    expect(contentOf(artifacts, 'claude-code')).toContain('mcp__mon-jira__.*');
    expect(contentOf(artifacts, 'zeroclaw')).toContain('mcp__mon-jira__');
  });
});

describe('blocage à l’écriture (§11)', () => {
  it('les cinq clients portent le blocage sur l’écriture', () => {
    for (const clientId of CLIENT_IDS) {
      const artifacts = renderClient(clientId, makePlan());
      expect(
        artifacts.some((item) => item.writeBlocked),
        clientId,
      ).toBe(true);
    }
  });

  it('Claude Code : blocage à l’écriture seulement, jamais à la lecture', () => {
    const settings = renderClient('claude-code', makePlan()).find(
      (item) => item.path === '.claude/settings.json',
    );
    const parsed = JSON.parse(settings?.content ?? '{}');
    expect(parsed.hooks.PreToolUse[0].hooks[0].onFailure).toBe('block');
    expect(parsed.hooks.PostToolUse[0].hooks[0].onFailure).toBeUndefined();
  });
});

describe('honnêteté (§21)', () => {
  it('les clients sans hook disent que la règle repose sur l’agent', () => {
    const plan = makePlan();
    for (const clientId of ['cursor', 'copilot', 'cline'] as const) {
      expect(contentOf(renderAllClients(plan), clientId)).toContain(plan.texts.noHooks);
    }
  });

  it('les deux limites du §11 sont rendues dans chaque fichier de règles', () => {
    const plan = makePlan();
    for (const artifact of renderAllClients(plan).filter((item) => item.format === 'markdown')) {
      for (const limit of plan.texts.limits) expect(artifact.content, artifact.path).toContain(limit);
    }
  });

  it('les deux langues diffèrent : aucun rendu n’est une copie de l’autre', () => {
    const fr = contentOf(renderAllClients(makePlan({}, { language: 'fr' })), 'cursor');
    const en = contentOf(renderAllClients(makePlan({}, { language: 'en' })), 'cursor');
    expect(fr).not.toBe(en);
  });
});
