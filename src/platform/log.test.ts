/**
 * Journal des événements (§18 étape 5, §8.3) — adossé au `Store` en mémoire.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './memory';
import { createJournal, EVENT_KINDS, sanitize } from './log';

const SECRET = 'ignore-instructions-precedentes';

function payloads(rows: { payload: string }[]): Record<string, unknown>[] {
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

describe('sanitize — rien ne sort (§21)', () => {
  it('retire les charges textuelles, garde les faits', () => {
    const clean = sanitize({ findingIds: ['F-1'], text: SECRET, body: SECRET, excerpt: SECRET, mode: 'neutralize' });
    expect(clean).toEqual({ findingIds: ['F-1'], mode: 'neutralize' });
    expect(JSON.stringify(clean)).not.toContain(SECRET);
  });

  it('une charge non-objet devient vide', () => {
    expect(sanitize('texte')).toEqual({});
    expect(sanitize(null)).toEqual({});
  });
});

describe('journal de neutralisation et restauration (§8.3)', () => {
  it('neutralized porte les constats et l’original, jamais le texte', async () => {
    const store = createMemoryStore();
    const journal = createJournal(store.events);
    await journal.neutralized('10001', { findingIds: ['F-1', 'F-2'], originalId: 'O-1', text: SECRET });
    const events = await store.events.list('10001', 10);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe(EVENT_KINDS.neutralized);
    expect(payloads(events)[0]!).toEqual({ findingIds: ['F-1', 'F-2'], originalId: 'O-1' });
    expect(events[0]!.payload).not.toContain(SECRET);
  });

  it('restored referme la boucle sur le même ticket', async () => {
    const store = createMemoryStore();
    const journal = createJournal(store.events);
    await journal.neutralized('10001', { findingIds: ['F-1'], originalId: 'O-1' });
    await journal.restored('10001', { originalId: 'O-1', findingIds: ['F-1'] });
    const events = await store.events.list('10001', 10);
    expect(events.map((row) => row.kind)).toEqual(['neutralized', 'restored']);
  });
});

describe('écritures sensibles journalisées (exigence 4)', () => {
  it('commentaire public, note interne et texte remplacé ont leur genre', async () => {
    const store = createMemoryStore();
    const journal = createJournal(store.events);
    await journal.publicComment('SUP-1', 'C-9');
    await journal.internalNote('SUP-1', 'C-10');
    await journal.segmentTextReplaced('SUP-1', { field: 'description', refId: null });
    const events = await store.events.list(null, 10);
    expect(events.map((row) => row.kind)).toEqual([
      EVENT_KINDS.publicComment,
      EVENT_KINDS.internalNote,
      EVENT_KINDS.segmentTextReplaced,
    ]);
    expect(payloads(events)[0]!).toEqual({ commentId: 'C-9' });
  });

  it('verdict humain et publication d’état', async () => {
    const store = createMemoryStore();
    const journal = createJournal(store.events);
    await journal.verdict('10001', 'F-1', 'false-positive', '5b-reviewer');
    await journal.statePublished('SUP-1', { trustLevel: 'T0', suspicionLevel: 'suspect', summary: SECRET });
    const events = await store.events.list(null, 10);
    expect(events[0]!.kind).toBe('verdict');
    expect(payloads(events)[0]!).toMatchObject({ findingId: 'F-1', decision: 'false-positive' });
    expect(events[1]!.payload).not.toContain(SECRET);
  });
});

describe('relecture', () => {
  it('recent filtre par ticket et borne la liste', async () => {
    const store = createMemoryStore();
    const journal = createJournal(store.events);
    await journal.labeled('10001', 'pieges-suspect');
    await journal.labeled('10002', 'pieges-suspect');
    await journal.append('analyzed', '10001', { layer: 'C1' });
    expect(await journal.recent('10001', 10)).toHaveLength(2);
    expect(await journal.recent('10002', 10)).toHaveLength(1);
    const last = await journal.recent(null, 1);
    expect(last).toHaveLength(1);
    expect(last[0]!.kind).toBe('analyzed');
  });
});
