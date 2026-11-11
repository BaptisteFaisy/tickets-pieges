import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../core/trust-rules';
import { createMemoryStore } from '../platform/memory';
import type { ResolverDeps } from '../ui/api';
import { parseSettings, settingsResolvers } from './settings';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(d: ResolverDeps, key: string, payload: Record<string, unknown>): Promise<Result> {
  const handler = settingsResolvers(d)[key];
  if (!handler) throw new Error(`${key} absent`);
  return handler(payload, {}) as Promise<Result>;
}

describe('getSettings (§17.4)', () => {
  it('refuse un appel sans projectKey', async () => {
    const result = await call(deps(), 'getSettings', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('projectKey');
  });

  it('revient aux réglages par défaut du domaine quand rien n’est enregistré', async () => {
    const result = await call(deps(), 'getSettings', { projectKey: 'SUP' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(defaultSettings('SUP'));
  });

  it('rend les réglages enregistrés', async () => {
    const d = deps();
    const saved = defaultSettings('SUP');
    await d.store.settings.put({ ...saved, mode: 'neutralize' });
    const result = await call(d, 'getSettings', { projectKey: 'SUP' });
    expect(result.data.mode).toBe('neutralize');
  });
});

describe('saveSettings (§17.4)', () => {
  it('enregistre des réglages valides et les rend lisibles', async () => {
    const d = deps();
    const payload = { ...defaultSettings('SUP'), mode: 'label', c3Enabled: false };
    const result = await call(d, 'saveSettings', { settings: payload });
    expect(result.ok).toBe(true);
    const read = await call(d, 'getSettings', { projectKey: 'SUP' });
    expect(read.data.mode).toBe('label');
    expect(read.data.c3Enabled).toBe(false);
  });

  it('refuse un mode inconnu, sans exception', async () => {
    const payload = { ...defaultSettings('SUP'), mode: 'detruire' };
    const result = await call(deps(), 'saveSettings', { settings: payload });
    expect(result.ok).toBe(false);
  });

  it('refuse un seuil de neutralisation inconnu', async () => {
    const payload = { ...defaultSettings('SUP'), neutralizeFrom: 'peut-etre' };
    const result = await call(deps(), 'saveSettings', { settings: payload });
    expect(result.ok).toBe(false);
  });

  it('nettoie les listes : doublons, espaces, domaines normalisés', () => {
    const parsed = parseSettings(
      {
        ...defaultSettings('SUP'),
        trustedDomains: [' Example.FR ', 'example.fr', 'autre.io'],
        neutralizeOrigins: ['T0', 'T9', 'T1'],
        ignoredPhrases: ['cordialement', 'cordialement'],
      },
      'SUP',
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.trustedDomains).toEqual(['example.fr', 'autre.io']);
    expect(parsed?.neutralizeOrigins).toEqual(['T0', 'T1']);
    expect(parsed?.ignoredPhrases).toEqual(['cordialement']);
  });
});
