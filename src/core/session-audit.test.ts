/**
 * Tests — journal de session exportable (#28) et boucle d'agent (#30).
 *
 * Couvre : assainissement par liste blanche (aucun texte de ticket, aucune
 * donnée personnelle ne sort), bornage du journal, exports stables et
 * parsables, et détection déterministe d'une boucle à partir de N appels du
 * même outil sur N tickets distincts.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIT_COLUMNS,
  DEFAULT_LOOP_SETTINGS,
  MAX_AUDIT_ENTRIES,
  auditSummary,
  detectAgentLoop,
  detectAgentLoops,
  exportAuditCsv,
  exportAuditJson,
  kindOfDecision,
  loopMessage,
  recordAudit,
  recordDecision,
  recordLoopAlert,
  sanitizeEntry,
  withheldCount,
  type AuditEntry,
} from './session-audit';
import { decide, startSession, recordSignal } from './session-policy';

const NOW = '2026-11-12T10:00:00.000Z';
const SECRET = 'Bonjour, mon IBAN FR1420041010050500013M02606 fuit ici';

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: NOW,
    sessionRef: 'sess-1',
    accountId: 'acc-agent',
    kind: 'read',
    action: 'read',
    issueId: '10001',
    ...overrides,
  };
}

/** N appels du même outil sur N tickets distincts, à une minute d'intervalle. */
function sweep(count: number, toolRef = 'mcp-read-issue', stepMinutes = 1): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = new Date(Date.parse(NOW) + index * stepMinutes * 60000).toISOString();
    out.push(entry({
      at,
      kind: 'read',
      action: 'read',
      toolRef,
      issueId: String(10000 + index),
      fingerprint: 'abc123',
    }));
  }
  return out;
}

describe('journal exportable (#28)', () => {
  it('l’ajout est immutable et la liste est bornée', () => {
    const initial = [entry()];
    const after = recordAudit(initial, entry({ issueId: '10002' }));
    expect(initial).toHaveLength(1);
    expect(after).toHaveLength(2);
    const many: AuditEntry[] = [];
    let bounded = many;
    for (let index = 0; index < MAX_AUDIT_ENTRIES + 200; index += 1) {
      bounded = recordAudit(bounded, entry({ issueId: String(index) }));
    }
    expect(bounded).toHaveLength(MAX_AUDIT_ENTRIES);
    expect(bounded[bounded.length - 1]?.issueId).toBe(String(MAX_AUDIT_ENTRIES + 199));
  });

  it('un texte de ticket entré par erreur ne ressort jamais', () => {
    const dirty = [entry({
      detail: SECRET,
      action: SECRET,
      issueId: 'client@example.com a demandé 0612345678',
      fingerprint: 'FR1420041010050500013M02606',
    })];
    const json = exportAuditJson(dirty);
    const csv = exportAuditCsv(dirty);
    for (const needle of ['IBAN', 'FR1420041010050500013M02606', 'client@example.com', '0612345678', 'fuit']) {
      expect(json).not.toContain(needle);
      expect(csv).not.toContain(needle);
    }
    expect(withheldCount(dirty)).toBeGreaterThan(0);
  });

  it('l’assainissement garde les identifiants et les empreintes', () => {
    const clean = sanitizeEntry(entry({
      toolRef: 'mcp-read-issue',
      fingerprint: 'a1b2c3d4',
      detail: 'session.decision.budget',
    }));
    expect(clean.sessionRef).toBe('sess-1');
    expect(clean.toolRef).toBe('mcp-read-issue');
    expect(clean.fingerprint).toBe('a1b2c3d4');
    expect(clean.detail).toBe('session.decision.budget');
    expect(clean.at).toBe(NOW);
  });

  it('une nature inconnue et une date illisible sont neutralisées', () => {
    const odd = sanitizeEntry(entry({ at: 'hier', kind: 'invention' as AuditEntry['kind'] }));
    expect(odd.at).toBe('');
    expect(odd.kind).toBe('read');
  });

  it('le JSON et le CSV sont parsables et stables', () => {
    const entries = sweep(3);
    const parsed = JSON.parse(exportAuditJson(entries)) as { version: number; entries: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(3);
    const csv = exportAuditCsv(entries).split('\n');
    expect(csv[0]).toBe(AUDIT_COLUMNS.join(','));
    expect(csv).toHaveLength(4);
    expect(exportAuditJson(entries)).toBe(exportAuditJson([...entries]));
  });

  it('le résumé dit ce qu’il y a, et ce qui a été retenu', () => {
    expect(auditSummary([])).toContain('Aucune');
    expect(auditSummary(sweep(3))).toContain('3');
    expect(auditSummary([entry({ detail: SECRET })])).toContain('retenu');
    expect(auditSummary(sweep(2), 'en')).toContain('journal entry');
  });

  it('une décision est journalisée sans son motif lisible', () => {
    const state = startSession({ sessionRef: 's1', accountId: 'a1', issueId: '10001', now: NOW });
    const asked = recordDecision([], decide(state, 'public-reply', NOW), 's1', 'a1', NOW, '10001');
    expect(asked[0]?.kind).toBe('gesture-requested');
    expect(asked[0]?.action).toBe('reply.public');
    const locked = recordSignal(recordSignal(state, NOW), NOW);
    const denied = recordDecision([], decide(locked, 'public-reply', NOW), 's1', 'a1', NOW, '10001');
    expect(denied[0]?.kind).toBe('quarantine');
    const stale = recordDecision([], decide(state, 'public-reply', '2026-11-12T12:00:00.000Z'), 's1', 'a1', NOW);
    expect(stale[0]?.kind).toBe('session-expired');
    expect(kindOfDecision(decide(state, 'read', NOW))).toBe('gesture-requested');
  });
});

describe('détection d’agent en boucle (#30)', () => {
  it('N tickets distincts avec le même outil dans la fenêtre : alerte', () => {
    const alert = detectAgentLoop(sweep(DEFAULT_LOOP_SETTINGS.threshold));
    expect(alert).not.toBeNull();
    expect(alert?.issueCount).toBe(5);
    expect(alert?.calls).toBe(5);
    expect(alert?.toolRef).toBe('mcp-read-issue');
    expect(alert?.severity).toBe('watch');
    expect(alert?.issueIds).toHaveLength(5);
  });

  it('au double du seuil la gravité monte', () => {
    expect(detectAgentLoop(sweep(10, 'mcp-read-issue', 0.2))?.severity).toBe('alert');
  });

  it('sous le seuil, sur un seul ticket, ou hors fenêtre : rien', () => {
    expect(detectAgentLoop(sweep(4))).toBeNull();
    const sameIssue = sweep(8).map((item) => ({ ...item, issueId: '10001' }));
    expect(detectAgentLoop(sameIssue)).toBeNull();
    expect(detectAgentLoop(sweep(6, 'mcp-read-issue', 30))).toBeNull();
    expect(detectAgentLoop([])).toBeNull();
  });

  it('deux outils différents ne s’additionnent pas', () => {
    const mixed = [...sweep(3, 'mcp-read-issue'), ...sweep(3, 'mcp-post-reply')];
    expect(detectAgentLoops(mixed)).toEqual([]);
  });

  it('deux sessions différentes ne s’additionnent pas', () => {
    const mixed = [
      ...sweep(3, 'mcp-read-issue'),
      ...sweep(3, 'mcp-read-issue').map((item) => ({ ...item, sessionRef: 'sess-2' })),
    ];
    expect(detectAgentLoops(mixed)).toEqual([]);
  });

  it('le seuil est réglable et borné : un réglage absurde ne rend rien', () => {
    expect(detectAgentLoop(sweep(3), { windowMs: 600000, threshold: 3 })?.issueCount).toBe(3);
    expect(detectAgentLoops(sweep(9), { windowMs: 60000, threshold: 1 })).toEqual([]);
    expect(detectAgentLoops(sweep(9), { windowMs: 0, threshold: 5 })).toEqual([]);
  });

  it('des entrées sans outil, sans ticket ou sans date sont ignorées', () => {
    const partial = [
      ...sweep(4),
      entry({ toolRef: '', issueId: '10099' }),
      entry({ at: 'pas-une-date', toolRef: 'mcp-read-issue', issueId: '10098' }),
    ];
    expect(detectAgentLoop(partial)).toBeNull();
  });

  it('la détection est déterministe et le tri stable', () => {
    const entries = [...sweep(6), ...sweep(7, 'mcp-post-reply', 0.5)];
    const first = detectAgentLoops(entries);
    expect(first).toHaveLength(2);
    expect(first[0]?.issueCount).toBe(7);
    expect(JSON.stringify(first)).toBe(JSON.stringify(detectAgentLoops([...entries].reverse())));
  });

  it('l’alerte se dit dans les deux langues et se journalise', () => {
    const alert = detectAgentLoop(sweep(5));
    expect(alert).not.toBeNull();
    const fr = loopMessage(alert as NonNullable<typeof alert>, 'fr');
    const en = loopMessage(alert as NonNullable<typeof alert>, 'en');
    expect(fr).toContain('mcp-read-issue');
    expect(en).toContain('mcp-read-issue');
    expect(fr).not.toBe(en);
    const logged = recordLoopAlert([], alert as NonNullable<typeof alert>, NOW);
    expect(logged[0]?.kind).toBe('loop-alert');
    expect(sanitizeEntry(logged[0] as AuditEntry).detail).toBe('session.decision.loop');
    expect(exportAuditCsv(logged)).toContain('loop-alert');
  });
});
