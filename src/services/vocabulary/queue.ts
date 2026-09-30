import type { PracticeMode, PracticeSelection, WordEntry, WordStat } from '../../types';
import { resolveSelection } from './vocabularyService';
import { selectWeakWords } from '../adaptive/weakness';
import { progressRepo } from '../storage/progressRepository';

export function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface QueueBuild {
  words: WordEntry[];
  mode: PracticeMode;
  /** True when the queue wraps forever (repeat / exhausted weak list). */
  cycling: boolean;
}

/**
 * Turn a selection + mode into the concrete word queue for a session.
 *  - sequential: selection order
 *  - random: shuffled once
 *  - weak: weighted by adaptive weakness (with randomness), weakest first-ish
 *  - repeat: shuffled base queue that wraps around
 */
export async function buildQueue(
  selection: PracticeSelection,
  stats: Map<string, WordStat>,
  size: number,
): Promise<QueueBuild> {
  const base = await resolveSelection(selection);
  const mode = selection.mode;

  if (!base.length) return { words: [], mode, cycling: mode === 'repeat' };

  if (mode === 'weak') {
    const selectionSet = new Set(base.map((w) => w.word));
    const scoped = new Map([...stats].filter(([word]) => selectionSet.has(word)));
    const weakTexts = selectWeakWords(scoped, Math.max(size, 8));
    const byText = new Map(base.map((w) => [w.word, w]));
    const weakWords = weakTexts.map((t) => byText.get(t)).filter((w): w is WordEntry => !!w);
    if (weakWords.length >= Math.min(4, size)) {
      const rest = base.filter((w) => !weakWords.includes(w));
      const queue = [...weakWords, ...shuffle(rest)];
      // Weak lists cycle: once exhausted, the same words come around again.
      return { words: queue.slice(0, Math.max(size, queue.length)), mode, cycling: true };
    }
    // Nothing practiced yet → fall back to a shuffled selection.
    const words = shuffle(base).slice(0, size);
    return { words, mode, cycling: false };
  }

  if (mode === 'random') {
    return { words: shuffle(base).slice(0, size), mode, cycling: false };
  }

  if (mode === 'repeat') {
    const words = shuffle(base);
    return { words, mode, cycling: true };
  }

  return { words: base.slice(0, size), mode, cycling: false };
}

/**
 * Selection covering every word the user has ever practised, in weak mode —
 * used by "review weak words" buttons on the dashboard and summary screen.
 * Returns null when there is nothing practised yet.
 */
export async function weakReviewSelection(): Promise<PracticeSelection | null> {
  const stats = await progressRepo.getWordStats();
  const words = [...stats.keys()];
  if (!words.length) return null;
  return { words, mode: 'weak', size: 20 };
}
