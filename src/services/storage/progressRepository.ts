import type {
  ActiveSessionSnapshot,
  AttemptRecord,
  DayStat,
  ProgressRepository,
  SessionRecord,
  WeakWord,
  WordStat,
} from '../../types';
import { dayKey, startOfDay } from '../../lib/date';
import { rankedWeakWords } from '../adaptive/weakness';
import { clearAllData, withDB } from './db';

const ACTIVE_KEY = 'active-session';
const BEST_KEY = 'best-accuracy';

function emptyDay(day: string): DayStat {
  return { day, words: 0, attempts: 0, correct: 0, correctWords: 0, seconds: 0, sessions: 0 };
}

class LocalProgressRepository implements ProgressRepository {
  private wordCache: Map<string, WordStat> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  /** Subscribe to progress mutations (used by hooks to refresh derived views). */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getVersion(): number {
    return this.version;
  }

  private emit() {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  private async ensureWords(): Promise<Map<string, WordStat>> {
    if (this.wordCache) return this.wordCache;
    const rows = await withDB(
      async (db) => (await db.getAll('words')) as WordStat[],
      [] as WordStat[],
    );
    this.wordCache = new Map(rows.map((r) => [r.word, r]));
    return this.wordCache;
  }

  async getWordStats(): Promise<Map<string, WordStat>> {
    return this.ensureWords();
  }

  async recordAttempt(rec: Omit<AttemptRecord, 'id' | 'day'>): Promise<void> {
    const day = dayKey(rec.ts);
    await withDB(
      async (db) => {
        const tx = db.transaction(['attempts', 'days'], 'readwrite');
        await tx.objectStore('attempts').add({ ...rec, day });
        const days = tx.objectStore('days');
        const current = (await days.get(day)) ?? emptyDay(day);
        current.attempts += 1;
        if (rec.correct) current.correct += 1;
        await days.put(current);
        await tx.done;
      },
      undefined,
    );
    this.emit();
  }

  async recordWordTrial(trial: {
    word: string;
    correct: boolean;
    mistakes: number;
    attempts: number;
    scoreSum: number;
    scoreCount: number;
    ts: number;
  }): Promise<void> {
    const cache = await this.ensureWords();
    const existing = cache.get(trial.word);
    const now = trial.ts;
    const stat: WordStat = existing
      ? { ...existing }
      : {
          word: trial.word,
          attempts: 0,
          correct: 0,
          incorrect: 0,
          mistakes: 0,
          scoreSum: 0,
          scoreCount: 0,
          bestScore: 0,
          lastAttempt: now,
          firstAttempt: now,
          consecutiveCorrect: 0,
          consecutiveIncorrect: 0,
        };

    stat.attempts += 1;
    if (trial.correct) {
      stat.correct += 1;
      stat.consecutiveCorrect += 1;
      stat.consecutiveIncorrect = 0;
    } else {
      stat.incorrect += 1;
      stat.consecutiveIncorrect += 1;
      stat.consecutiveCorrect = 0;
    }
    stat.mistakes += trial.mistakes;
    stat.scoreSum += trial.scoreSum;
    stat.scoreCount += trial.scoreCount;
    if (trial.scoreCount) {
      const bestTrial = trial.scoreSum / trial.scoreCount;
      if (bestTrial > stat.bestScore) stat.bestScore = bestTrial;
    }
    stat.lastAttempt = now;
    cache.set(stat.word, stat);

    const day = dayKey(now);
    await withDB(
      async (db) => {
        const tx = db.transaction(['words', 'days'], 'readwrite');
        await tx.objectStore('words').put(stat);
        const days = tx.objectStore('days');
        const current = (await days.get(day)) ?? emptyDay(day);
        current.words += 1;
        if (trial.correct) current.correctWords += 1;
        await days.put(current);
        await tx.done;
      },
      undefined,
    );
    this.emit();
  }

  async getDayStats(fromMs: number, toMs: number): Promise<DayStat[]> {
    const from = dayKey(startOfDay(fromMs));
    const to = dayKey(startOfDay(toMs));
    return withDB(
      async (db) => (await db.getAll('days', IDBKeyRange.bound(from, to))) as DayStat[],
      [] as DayStat[],
    );
  }

  async getRecentSessions(limit: number): Promise<SessionRecord[]> {
    const rows = await withDB(
      async (db) => (await db.getAll('sessions')) as SessionRecord[],
      [] as SessionRecord[],
    );
    rows.sort((a, b) => b.startedAt - a.startedAt);
    return rows.slice(0, limit);
  }

  async finishSession(rec: SessionRecord): Promise<void> {
    const day = dayKey(rec.startedAt);
    await withDB(
      async (db) => {
        const tx = db.transaction(['sessions', 'days'], 'readwrite');
        await tx.objectStore('sessions').put(rec);
        const days = tx.objectStore('days');
        const current = (await days.get(day)) ?? emptyDay(day);
        current.sessions += 1;
        current.seconds += rec.durationSec;
        await days.put(current);
        await tx.done;
      },
      undefined,
    );
    this.emit();
  }

  async getWeakWords(limit: number): Promise<WeakWord[]> {
    const cache = await this.ensureWords();
    return rankedWeakWords(cache).slice(0, limit);
  }

  async saveActiveSession(snap: ActiveSessionSnapshot | null): Promise<void> {
    await withDB(
      async (db) => {
        if (snap) await db.put('meta', { id: ACTIVE_KEY, value: snap });
        else await db.delete('meta', ACTIVE_KEY);
      },
      undefined,
    );
  }

  async loadActiveSession(): Promise<ActiveSessionSnapshot | null> {
    const row = await withDB(
      async (db) => (await db.get('meta', ACTIVE_KEY)) as { id: string; value: ActiveSessionSnapshot } | undefined,
      undefined,
    );
    return row?.value ?? null;
  }

  /** Erase every stored statistic (keeps custom word lists). */
  async resetProgress(): Promise<void> {
    await clearAllData();
    this.wordCache = null;
    this.emit();
  }

  /** Personal best accuracy (only tracked for sessions of a decent size). */
  async getBestAccuracy(): Promise<number> {
    const row = await withDB(
      async (db) => (await db.get('meta', BEST_KEY)) as { id: string; value: number } | undefined,
      undefined,
    );
    return row?.value ?? 0;
  }

  async considerBestAccuracy(accuracy: number, wordCount: number): Promise<boolean> {
    if (wordCount < 8) return false;
    const current = await this.getBestAccuracy();
    if (accuracy > current) {
      await withDB(
        async (db) => db.put('meta', { id: BEST_KEY, value: accuracy }),
        undefined,
      );
      return true;
    }
    return false;
  }
}

export const progressRepo = new LocalProgressRepository();
