import type { DayStat, WordStat } from '../../types';
import { dayKey, daysBetween } from '../../lib/date';
import { isMastered, weaknessScore } from '../adaptive/weakness';

export interface StreakInfo {
  current: number;
  longest: number;
  activeToday: boolean;
  todayWords: number;
}

function isActive(day: DayStat): boolean {
  return day.words > 0 || day.seconds > 0;
}

export function computeStreaks(days: DayStat[], now: number = Date.now()): StreakInfo {
  const active = new Set(days.filter(isActive).map((d) => d.day));
  const today = dayKey(now);
  const todayWords = days.find((d) => d.day === today)?.words ?? 0;

  let current = 0;
  let cursor = now;
  if (!active.has(today)) cursor = now - 86_400_000; // today not started → streak may live on
  while (active.has(dayKey(cursor))) {
    current += 1;
    cursor -= 86_400_000;
  }

  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sorted) {
    if (prev && daysBetween(Date.parse(`${prev}T00:00:00`), Date.parse(`${key}T00:00:00`)) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = key;
  }

  return { current, longest, activeToday: active.has(today), todayWords };
}

export interface OverallStats {
  distinctWords: number;
  wordTrials: number;
  attempts: number;
  wordAccuracy: number;
  strokeAccuracy: number;
  writingScore: number;
  mastered: number;
  totalSeconds: number;
  daysActive: number;
  currentStreak: number;
  longestStreak: number;
  todayWords: number;
  todayAccuracy: number;
}

export function computeOverall(days: DayStat[], wordStats: Map<string, WordStat>): OverallStats {
  const streaks = computeStreaks(days);
  const today = dayKey();
  const todayRow = days.find((d) => d.day === today);

  let wordTrials = 0;
  let attempts = 0;
  let correctTrials = 0;
  let correctAttempts = 0;
  let totalSeconds = 0;
  for (const d of days) {
    wordTrials += d.words;
    correctTrials += d.correctWords;
    attempts += d.attempts;
    correctAttempts += d.correct;
    totalSeconds += d.seconds;
  }

  let scoreSum = 0;
  let scoreCount = 0;
  let mastered = 0;
  let practiced = 0;
  for (const stat of wordStats.values()) {
    if (!stat.attempts) continue;
    practiced += 1;
    scoreSum += stat.scoreSum;
    scoreCount += stat.scoreCount;
    if (isMastered(stat)) mastered += 1;
  }

  return {
    distinctWords: practiced,
    wordTrials,
    attempts,
    wordAccuracy: wordTrials ? correctTrials / wordTrials : 0,
    strokeAccuracy: attempts ? correctAttempts / attempts : 0,
    writingScore: scoreCount ? scoreSum / scoreCount : 0,
    mastered,
    totalSeconds,
    daysActive: days.filter(isActive).length,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    todayWords: todayRow?.words ?? 0,
    todayAccuracy: todayRow?.words ? todayRow.correctWords / todayRow.words : 0,
  };
}

export interface DaySeriesPoint {
  day: string;
  label: string;
  accuracy: number;
  words: number;
  score: number;
  minutes: number;
}

/** Daily series for charts, filling gaps so the x-axis stays continuous. */
export function buildDaySeries(days: DayStat[], rangeDays: number, now = Date.now()): DaySeriesPoint[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const points: DaySeriesPoint[] = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const key = dayKey(now - i * 86_400_000);
    const row = byDay.get(key);
    const [, , d] = key.split('-');
    points.push({
      day: key,
      label: `${Number(d)}`,
      accuracy: row && row.words ? Math.round((row.correctWords / row.words) * 100) : 0,
      words: row?.words ?? 0,
      score: 0,
      minutes: row ? Math.round((row.seconds / 60) * 10) / 10 : 0,
    });
  }
  return points;
}

export interface DifficultyRow {
  word: string;
  attempts: number;
  accuracy: number;
  mistakes: number;
  weakness: number;
  lastAttempt: number;
}

/** Vocabulary difficulty table — the worst offenders first. */
export function difficultyRows(
  wordStats: Map<string, WordStat>,
  now = Date.now(),
): DifficultyRow[] {
  const rows: DifficultyRow[] = [];
  for (const stat of wordStats.values()) {
    if (!stat.attempts) continue;
    rows.push({
      word: stat.word,
      attempts: stat.attempts,
      accuracy: stat.attempts ? stat.correct / stat.attempts : 0,
      mistakes: stat.mistakes,
      weakness: weaknessScore(stat, now),
      lastAttempt: stat.lastAttempt,
    });
  }
  rows.sort((a, b) => b.weakness - a.weakness || b.mistakes - a.mistakes);
  return rows;
}
