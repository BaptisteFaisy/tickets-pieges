/**
 * `sql.ts` est pur : les requêtes se testent comme des chaînes (exigence 2 :
 * aucune valeur utilisateur concaténée, sauf `LIMIT` inliné après coercion).
 */

import { describe, expect, it } from 'vitest';
import {
  ddl,
  deleteQuery,
  inlineLimit,
  insertQuery,
  selectQuery,
  SUSPICION_ORDER,
  TABLE,
  updateQuery,
  upsertQuery,
} from './sql';

const INJECTION = "'; DROP TABLE segment; --";

describe('LIMIT inliné après coercion (FORGE.md §2)', () => {
  it('coerce en entier et borne à 1', () => {
    expect(inlineLimit(0)).toBe(1);
    expect(inlineLimit(-5)).toBe(1);
    expect(inlineLimit(2.9)).toBe(2);
    expect(inlineLimit(Number.NaN)).toBe(1);
  });

  it('le select inline la limite, jamais LIMIT ?', () => {
    const q = selectQuery('segment', {}, { limit: 2.7 });
    expect(q.query).toContain('LIMIT 2');
    expect(q.query).not.toContain('LIMIT ?');
    expect(q.params).toEqual([]);
  });
});

describe('schéma §19', () => {
  it('les seize tables sont créées, idempotentes', () => {
    const statements = ddl();
    expect(statements).toHaveLength(16);
    for (const statement of statements) {
      expect(statement).toContain('CREATE TABLE IF NOT EXISTS');
    }
  });

  it('toutes les tables du contrat ont leur DDL', () => {
    const joined = ddl().join('\n');
    for (const name of Object.values(TABLE)) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS ${name} (`);
    }
  });

  it('event.seq est auto-incrémenté (journal appendice)', () => {
    expect(ddl().join('\n')).toContain('seq BIGINT AUTO_INCREMENT PRIMARY KEY');
  });
});

describe('paramètres liés, jamais concaténés', () => {
  it('une valeur hostile reste dans les paramètres', () => {
    const q = selectQuery('segment', { text: INJECTION });
    expect(q.query).not.toContain('DROP TABLE');
    expect(q.query).toBe('SELECT * FROM segment WHERE text = ?');
    expect(q.params).toEqual([INJECTION]);
  });

  it('insert et upsert lient toutes les valeurs', () => {
    const ins = insertQuery('verdict', { finding_id: INJECTION, at: 'x' });
    expect(ins.query).toBe('INSERT INTO verdict (finding_id, at) VALUES (?, ?)');
    expect(ins.params).toEqual([INJECTION, 'x']);
    const up = upsertQuery('segment', { id: INJECTION, text: 't' });
    expect(up.query).toContain('ON DUPLICATE KEY UPDATE id = VALUES(id), text = VALUES(text)');
    expect(up.query).not.toContain('DROP TABLE');
    expect(up.params).toEqual([INJECTION, 't']);
  });

  it('une valeur nulle devient IS NULL, sans paramètre', () => {
    const q = selectQuery('original', { segment_id: 'S-1', restored_at: null });
    expect(q.query).toBe('SELECT * FROM original WHERE segment_id = ? AND restored_at IS NULL');
    expect(q.params).toEqual(['S-1']);
  });

  it('les opérateurs viennent d’une liste blanche', () => {
    const q = selectQuery('finding', { created_at: { op: '>=', value: INJECTION } });
    expect(q.query).toBe('SELECT * FROM finding WHERE created_at >= ?');
    expect(q.params).toEqual([INJECTION]);
    expect(() => selectQuery('finding', { x: { op: 'LIKE', value: 1 } })).toThrow(/opérateur SQL refusé/);
  });

  it('update et delete lient set puis where', () => {
    const u = updateQuery('finding', { status: 'restored' }, { id: INJECTION });
    expect(u.query).toBe('UPDATE finding SET status = ? WHERE id = ?');
    expect(u.params).toEqual(['restored', INJECTION]);
    const d = deleteQuery('tainted_session', { session_ref: 's1' });
    expect(d.query).toBe('DELETE FROM tainted_session WHERE session_ref = ?');
    expect(d.params).toEqual(['s1']);
  });
});

describe('tris constants', () => {
  it('l’ordre des suspects est un fragment constant, sans trou', () => {
    expect(SUSPICION_ORDER).not.toContain('?');
    expect(SUSPICION_ORDER).toContain("WHEN 'trapped' THEN 3");
    expect(SUSPICION_ORDER).toContain("WHEN 'suspect' THEN 2");
  });

  it('orderBy et limit se combinent', () => {
    const q = selectQuery('event', {}, { orderBy: 'seq DESC', limit: 10 });
    expect(q.query).toBe('SELECT * FROM event ORDER BY seq DESC LIMIT 10');
  });
});
