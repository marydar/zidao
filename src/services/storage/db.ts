import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AttemptRecord,
  CustomList,
  DayStat,
  SessionRecord,
  StrokeData,
  WordStat,
} from '../../types';

interface StrokeCacheEntry {
  char: string;
  data: StrokeData;
  ts: number;
}

type MetaEntry = { id: string; value: unknown };

interface HanziDB extends DBSchema {
  attempts: {
    key: number;
    value: AttemptRecord;
    indexes: { 'by-word': string; 'by-day': string; 'by-session': string };
  };
  words: { key: string; value: WordStat };
  days: { key: string; value: DayStat };
  sessions: { key: string; value: SessionRecord };
  lists: { key: string; value: CustomList };
  meta: { key: string; value: MetaEntry };
  strokes: { key: string; value: StrokeCacheEntry };
}

const DB_NAME = 'hanzi-practice';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<HanziDB>> | null = null;

function open(): Promise<IDBPDatabase<HanziDB>> {
  if (!dbPromise) {
    dbPromise = openDB<HanziDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const attempts = db.createObjectStore('attempts', {
          keyPath: 'id',
          autoIncrement: true,
        });
        attempts.createIndex('by-word', 'word');
        attempts.createIndex('by-day', 'day');
        attempts.createIndex('by-session', 'sessionId');
        db.createObjectStore('words', { keyPath: 'word' });
        db.createObjectStore('days', { keyPath: 'day' });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('lists', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('strokes', { keyPath: 'char' });
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Run a database operation, swallowing persistence failures (private-mode
 * browsers, quota errors, unsupported browsers) so the app keeps working
 * without stored progress.
 */
export async function withDB<T>(
  fn: (db: IDBPDatabase<HanziDB>) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const db = await open();
    return await fn(db);
  } catch (err) {
    console.warn('Persistence unavailable:', err);
    notifyStorageError(err);
    return fallback;
  }
}

const storageListeners = new Set<(message: string) => void>();
let lastStorageError = '';

export function onStorageError(cb: (message: string) => void): () => void {
  storageListeners.add(cb);
  if (lastStorageError) cb(lastStorageError);
  return () => storageListeners.delete(cb);
}

function notifyStorageError(err: unknown) {
  lastStorageError =
    err instanceof Error ? err.message : 'Progress could not be saved on this device.';
  for (const cb of storageListeners) cb(lastStorageError);
}

export function clearStorageError() {
  lastStorageError = '';
}

/**
 * Wipe all progress (attempts, word stats, days, sessions, metadata and the
 * cached stroke data). Custom word lists are intentionally kept.
 */
export async function clearAllData(): Promise<void> {
  await withDB(
    async (db) => {
      const tx = db.transaction(
        ['attempts', 'words', 'days', 'sessions', 'meta', 'strokes'],
        'readwrite',
      );
      await Promise.all([
        tx.objectStore('attempts').clear(),
        tx.objectStore('words').clear(),
        tx.objectStore('days').clear(),
        tx.objectStore('sessions').clear(),
        tx.objectStore('meta').clear(),
        tx.objectStore('strokes').clear(),
        tx.done,
      ]);
    },
    undefined,
  );
}
