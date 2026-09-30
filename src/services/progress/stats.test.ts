import { describe, expect, it } from 'vitest';
import type { DayStat, WordStat } from '../../types';
import { computeOverall, computeStreaks, buildDaySeries, difficultyRows } from './stats';
import { dueForReview, isMastered, rankedWeakWords, selectWeakWords, weaknessScore } from '../adaptive/weakness';

function stat(partial: Partial<WordStat> & { word: string }): WordStat {
  return {
    attempts: 0,
    correct: 0,
    incorrect: 0,
    mistakes: 0,
    scoreSum: 0,
    scoreCount: 0,
    bestScore: 0,
    lastAttempt: Date.now(),
    firstAttempt: Date.now(),
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    ...partial,
  };
}

function day(day: string, words = 10, correctWords = words, seconds = 600): DayStat {
  return { day, words, attempts: words * 2, correct: words, correctWords, seconds, sessions: 1 };
}

describe('weakness scoring', () => {
  it('never-practiced words are not weak', () => {
    expect(weaknessScore(stat({ word: 'x' }))).toBe(0);
  });

  it('ranks repeatedly failed words above mostly-correct words', () => {
    const now = Date.now();
    const failing = stat({
      word: '学',
      attempts: 10,
      correct: 3,
      incorrect: 7,
      mistakes: 9,
      scoreSum: 5.5,
      scoreCount: 10,
      consecutiveIncorrect: 2,
      lastAttempt: now,
    });
    const strong = stat({
      word: '看',
      attempts: 10,
      correct: 9,
      incorrect: 1,
      mistakes: 1,
      scoreSum: 8.5,
      scoreCount: 10,
      consecutiveCorrect: 5,
      lastAttempt: now,
    });
    expect(weaknessScore(failing, now)).toBeGreaterThan(weaknessScore(strong, now));
  });

  it('mastery drives weakness towards zero', () => {
    const now = Date.now();
    const mastered = stat({
      word: '的',
      attempts: 12,
      correct: 12,
      scoreSum: 11.5,
      scoreCount: 12,
      consecutiveCorrect: 6,
      lastAttempt: now,
    });
    expect(weaknessScore(mastered, now)).toBeLessThan(0.1);
    expect(isMastered(mastered)).toBe(true);
  });

  it('selects weak words more often for higher weakness (weighted sampling)', () => {
    const now = Date.now();
    const stats = new Map<string, WordStat>();
    stats.set('bad', stat({ word: 'bad', attempts: 8, correct: 1, incorrect: 7, mistakes: 9, consecutiveIncorrect: 3, scoreSum: 10, scoreCount: 8, lastAttempt: now }));
    stats.set('ok', stat({ word: 'ok', attempts: 8, correct: 7, incorrect: 1, mistakes: 1, consecutiveCorrect: 2, scoreSum: 70, scoreCount: 8, lastAttempt: now }));
    stats.set('new', stat({ word: 'new' }));

    const counts = { bad: 0, ok: 0 };
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 60; i += 1) {
      const picked = selectWeakWords(stats, 1, now, rng);
      if (picked[0] === 'bad') counts.bad += 1;
      if (picked[0] === 'ok') counts.ok += 1;
    }
    expect(counts.bad).toBeGreaterThan(counts.ok);
    expect(counts.bad).toBeGreaterThan(30);
  });

  it('lists weak words worst-first', () => {
    const now = Date.now();
    const stats = new Map<string, WordStat>([
      ['a', stat({ word: 'a', attempts: 5, correct: 4, incorrect: 1, mistakes: 1, scoreSum: 4, scoreCount: 5, consecutiveCorrect: 0, lastAttempt: now })],
      ['b', stat({ word: 'b', attempts: 5, correct: 1, incorrect: 4, mistakes: 6, scoreSum: 1, scoreCount: 5, consecutiveIncorrect: 2, lastAttempt: now })],
    ]);
    const ranked = rankedWeakWords(stats, now);
    expect(ranked[0].word).toBe('b');
    expect(ranked.length).toBe(2);
  });

  it('flags review candidates', () => {
    const now = Date.now();
    const fresh = stat({ word: 'fresh', attempts: 4, correct: 4, scoreSum: 40, scoreCount: 4, consecutiveCorrect: 4, lastAttempt: now });
    const stale = stat({ word: 'stale', attempts: 4, correct: 3, incorrect: 1, mistakes: 1, scoreSum: 30, scoreCount: 4, lastAttempt: now - 5 * 86_400_000 });
    expect(dueForReview(fresh, now)).toBe(false);
    expect(dueForReview(stale, now)).toBe(true);
  });
});

describe('streaks', () => {
  const now = Date.parse('2026-09-30T12:00:00');

  it('counts consecutive active days up to today', () => {
    const days = [day('2026-09-28'), day('2026-09-29'), day('2026-09-30')];
    const s = computeStreaks(days, now);
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
    expect(s.activeToday).toBe(true);
    expect(s.todayWords).toBe(10);
  });

  it('keeps yesterday streak alive when today has not started', () => {
    const days = [day('2026-09-28'), day('2026-09-29')];
    const s = computeStreaks(days, now);
    expect(s.current).toBe(2);
    expect(s.activeToday).toBe(false);
  });

  it('breaks the streak on a gap', () => {
    const days = [day('2026-09-25'), day('2026-09-26'), day('2026-09-29'), day('2026-09-30')];
    const s = computeStreaks(days, now);
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
  });

  it('reports zero when nothing was practiced', () => {
    expect(computeStreaks([], now).current).toBe(0);
  });
});

describe('overall stats and series', () => {
  it('aggregates days and word stats', () => {
    const days = [day('2026-09-29', 10, 8, 600), day('2026-09-30', 5, 4, 300)];
    const stats = new Map<string, WordStat>([
      ['a', stat({ word: 'a', attempts: 3, correct: 3, scoreSum: 2.7, scoreCount: 3, consecutiveCorrect: 4 })],
      ['b', stat({ word: 'b', attempts: 3, correct: 1, incorrect: 2, mistakes: 3, scoreSum: 1.0, scoreCount: 3, consecutiveIncorrect: 2 })],
      ['none', stat({ word: 'none' })],
    ]);
    const overall = computeOverall(days, stats);
    expect(overall.wordTrials).toBe(15);
    expect(overall.wordAccuracy).toBeCloseTo(12 / 15);
    expect(overall.totalSeconds).toBe(900);
    expect(overall.distinctWords).toBe(2);
    expect(overall.currentStreak).toBeGreaterThanOrEqual(1);
  });

  it('builds a gap-free day series', () => {
    const series = buildDaySeries([day('2026-09-30', 4, 3)], 7, Date.parse('2026-09-30T12:00:00'));
    expect(series).toHaveLength(7);
    expect(series[6].day).toBe('2026-09-30');
    expect(series[6].accuracy).toBe(75);
    expect(series[5].words).toBe(0);
  });

  it('orders difficulty rows worst-first', () => {
    const stats = new Map<string, WordStat>([
      ['ok', stat({ word: 'ok', attempts: 4, correct: 4, scoreSum: 3.8, scoreCount: 4, consecutiveCorrect: 4 })],
      ['bad', stat({ word: 'bad', attempts: 4, correct: 0, incorrect: 4, mistakes: 5, scoreSum: 0.5, scoreCount: 4, consecutiveIncorrect: 4 })],
    ]);
    const rows = difficultyRows(stats);
    expect(rows[0].word).toBe('bad');
    expect(rows[0].accuracy).toBe(0);
  });
});
