import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../platform/memory';
import type { ResolverDeps } from '../ui/api';
import { replay, playgroundResolvers, SAMPLES } from './playground';

const NOW = '2026-11-11T12:00:00.000Z';

function deps(): ResolverDeps {
  return { store: createMemoryStore(), clock: { now: () => NOW }, securityAccounts: [] };
}

type Result = { ok: boolean; data?: any; error?: string };

async function call(d: ResolverDeps, key: string, payload: Record<string, unknown>): Promise<Result> {
  const handler = playgroundResolvers(d)[key];
  if (!handler) throw new Error(`${key} absent`);
  return handler(payload, {}) as Promise<Result>;
}

describe('listSamples (§17.7)', () => {
  it('rend le corpus intégré, avec ses attentes', async () => {
    const result = await call(deps(), 'listSamples', {});
    expect(result.ok).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(4);
    expect(result.data[0].expected).toBeTruthy();
  });
});

describe('runPlayground (§17.7)', () => {
  it('refuse un exemple inconnu avec une phrase lisible', async () => {
    const result = await call(deps(), 'runPlayground', { sampleId: 'absent' });
    expect(result.ok).toBe(false);
  });

  it('refuse un appel sans sampleId', async () => {
    const result = await call(deps(), 'runPlayground', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sampleId');
  });

  it('détecte l’exfiltration de l’exemple français et le dit non sain', async () => {
    const result = await call(deps(), 'runPlayground', { sampleId: 'fr-exfiltration' });
    expect(result.ok).toBe(true);
    expect(result.data.findings.length).toBeGreaterThan(0);
    expect(result.data.suspicionLevel).not.toBe('clean');
    expect(result.data.trustLevel).toBe('T1');
    expect(result.data.notAnalyzed).toEqual(['C1', 'C3']);
  });

  it('détecte le changement de rôle de l’exemple anglais', () => {
    const sample = SAMPLES.find((item) => item.id === 'en-role-switch');
    expect(sample).toBeTruthy();
    const result = replay(sample as (typeof SAMPLES)[number], () => NOW);
    expect(result.findings.map((finding) => finding.kind)).toContain('role-switch');
  });

  it('ne lève rien sur un message interne sain', () => {
    const sample = SAMPLES.find((item) => item.id === 'fr-interne');
    expect(sample).toBeTruthy();
    const result = replay(sample as (typeof SAMPLES)[number], () => NOW);
    expect(result.findings).toEqual([]);
    expect(result.suspicionLevel).toBe('clean');
  });

  it('rend l’extrait et le résumé neutre de chaque constat, jamais la charge brute seule', async () => {
    const result = await call(deps(), 'runPlayground', { sampleId: 'fr-exfiltration' });
    for (const finding of result.data.findings) {
      expect(typeof finding.excerpt).toBe('string');
      expect(finding.askSummary.length).toBeGreaterThan(0);
      expect(finding.layer).toMatch(/^C[1-4]$/);
    }
  });
});
