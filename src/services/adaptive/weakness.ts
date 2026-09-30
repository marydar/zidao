import type { WeakWord, WordStat } from '../../types';

/**
 * Adaptive scoring: how much a word needs practice right now.
 *
 *   weakness = mistakeRate
 *            + recencyFactor   (recent attempts weigh more, recent failures even more)
 *            + difficultyFactor (low handwriting scores)
 *            + failure streak
 *            − masteryFactor    (long correct streaks)
 */
export function weaknessScore(stat: WordStat, now: number = Date.now()): number {
  if (!stat.attempts) return 0;
  const mistakeRate = stat.incorrect / stat.attempts;
  const avgScore = stat.scoreCount ? stat.scoreSum / stat.scoreCount : 0;
  const difficulty = Math.max(0, Math.min(1, 1 - avgScore));
  const daysSince = Math.max(0, (now - stat.lastAttempt) / 86_400_000);
  const recency = Math.exp(-daysSince / 14);
  const failStreak = Math.min(stat.consecutiveIncorrect, 4) / 4;
  const mastery = Math.min(stat.consecutiveCorrect, 5) / 5;

  const raw =
    0.5 * mistakeRate +
    0.15 * recency * (0.4 + 0.6 * failStreak) +
    0.2 * difficulty +
    0.15 * failStreak -
    0.45 * mastery;
  return Math.max(0, Math.min(1, raw));
}

/** Words ranked by weakness (highest first). Only practiced words qualify. */
export function rankedWeakWords(
  stats: Map<string, WordStat>,
  now: number = Date.now(),
): WeakWord[] {
  const rows: WeakWord[] = [];
  for (const stat of stats.values()) {
    if (!stat.attempts) continue;
    const weakness = weaknessScore(stat, now);
    if (weakness <= 0.02) continue;
    rows.push({ word: stat.word, weakness, stats: stat });
  }
  rows.sort((a, b) => b.weakness - a.weakness || b.stats.mistakes - a.stats.mistakes);
  return rows;
}

/**
 * Weighted random pick of weak words — harder words appear more often, but the
 * order is not deterministic so the user cannot memorize the queue.
 */
export function selectWeakWords(
  stats: Map<string, WordStat>,
  limit: number,
  now: number = Date.now(),
  rng: () => number = Math.random,
): string[] {
  const candidates = rankedWeakWords(stats, now).filter((w) => w.weakness >= 0.08);
  if (!candidates.length) return [];
  const picked: string[] = [];
  const pool = [...candidates];
  const weight = (w: WeakWord) => w.weakness ** 1.5 + 0.05;
  while (picked.length < limit && pool.length) {
    const total = pool.reduce((sum, w) => sum + weight(w), 0);
    let roll = rng() * total;
    let chosen = 0;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weight(pool[i]);
      if (roll <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(pool[chosen].word);
    pool.splice(chosen, 1);
  }
  return picked;
}

/** Words that are due for spaced review (practiced before, not yet mastered). */
export function dueForReview(
  stat: WordStat,
  now: number = Date.now(),
): boolean {
  if (!stat.attempts) return false;
  const accuracy = (stat.correct / stat.attempts) * 100;
  if (accuracy >= 95 && stat.consecutiveCorrect >= 3) return false;
  const daysSince = (now - stat.lastAttempt) / 86_400_000;
  return stat.consecutiveIncorrect > 0 || daysSince >= 3 || accuracy < 70;
}

/** A word counts as mastered once it is consistently written correctly. */
export function isMastered(stat: WordStat): boolean {
  if (stat.attempts < 3) return false;
  const accuracy = stat.correct / stat.attempts;
  return accuracy >= 0.85 && stat.consecutiveCorrect >= 3;
}
