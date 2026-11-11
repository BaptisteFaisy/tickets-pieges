import { describe, expect, it } from 'vitest';
import { weeklySchedule, weekToken } from './canary-schedule';

const QUEUES = ['help', 'billing'];
const WEEKS = ['2026-W46', '2026-W47'];

describe('exercices permanents (#41)', () => {
  it('même graine, même planning (reproductible)', () => {
    const first = weeklySchedule('graine-a', QUEUES, WEEKS);
    const second = weeklySchedule('graine-a', QUEUES, WEEKS);
    expect(first).toEqual(second);
  });

  it('une graine différente donne un tirage différent', () => {
    const a = weeklySchedule('graine-a', QUEUES, WEEKS).map((slot) => slot.token);
    const b = weeklySchedule('graine-b', QUEUES, WEEKS).map((slot) => slot.token);
    expect(a).not.toEqual(b);
  });

  it('deux files la même semaine reçoivent des jetons distincts', () => {
    const slots = weeklySchedule('graine-a', QUEUES, ['2026-W46']);
    expect(slots).toHaveLength(2);
    expect(slots[0].token).not.toBe(slots[1].token);
  });

  it('les jetons tournent d’une semaine à l’autre', () => {
    const first = weekToken('graine-a', 'help', '2026-W46');
    const next = weekToken('graine-a', 'help', '2026-W47');
    expect(first).not.toBe(next);
  });

  it('le planning couvre file × semaine', () => {
    expect(weeklySchedule('graine-a', QUEUES, WEEKS)).toHaveLength(4);
  });
});