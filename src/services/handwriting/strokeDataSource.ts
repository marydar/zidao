import type { StrokeData } from '../../types';
import { withDB } from '../storage/db';

/**
 * Stroke data source with a layered cache:
 *   memory → IndexedDB → network (jsDelivr) → offline bundle (HSK 1).
 * Returns null when a character has no stroke data; callers must degrade gracefully.
 */

const CDN = (char: string) =>
  `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`;

const memory = new Map<string, StrokeData | null>();
const pending = new Map<string, Promise<StrokeData | null>>();
let bundlePromise: Promise<Record<string, StrokeData>> | null = null;

function isValid(data: unknown): data is StrokeData {
  const d = data as StrokeData;
  return (
    !!d &&
    Array.isArray(d.strokes) &&
    Array.isArray(d.medians) &&
    d.medians.length > 0 &&
    Array.isArray(d.medians[0])
  );
}

async function loadBundle(): Promise<Record<string, StrokeData>> {
  if (!bundlePromise) {
    bundlePromise = import('../../data/strokes/hsk-1.json')
      .then((m) => m.default as unknown as Record<string, StrokeData>)
      .catch(() => ({}));
  }
  return bundlePromise;
}

async function fetchFromNetwork(char: string): Promise<StrokeData | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(CDN(char), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

export async function loadStrokeData(char: string): Promise<StrokeData | null> {
  if (memory.has(char)) return memory.get(char) ?? null;
  const inflight = pending.get(char);
  if (inflight) return inflight;

  const task = (async (): Promise<StrokeData | null> => {
    // 1. IndexedDB cache
    const cached = await withDB(
      async (db) => (await db.get('strokes', char)) as { data: StrokeData } | undefined,
      undefined,
    );
    if (cached?.data) {
      memory.set(char, cached.data);
      return cached.data;
    }

    // 2. Network
    const fetched = await fetchFromNetwork(char);
    if (fetched) {
      memory.set(char, fetched);
      await withDB(
        async (db) => db.put('strokes', { char, data: fetched, ts: Date.now() }),
        undefined,
      );
      return fetched;
    }

    // 3. Offline bundle (HSK 1 characters)
    const bundle = await loadBundle();
    const bundled = bundle[char];
    if (bundled) {
      memory.set(char, bundled);
      return bundled;
    }

    memory.set(char, null);
    return null;
  })();

  pending.set(char, task);
  try {
    return await task;
  } finally {
    pending.delete(char);
  }
}

/** Warm the cache for the characters of upcoming words (fire and forget). */
export function preloadStrokes(chars: string[]): void {
  const unique = [...new Set(chars.filter((c) => c.trim() && !memory.has(c)))].slice(0, 12);
  for (const char of unique) void loadStrokeData(char);
}

/** Synchronous peek at already-loaded data (renderers use this first). */
export function peekStrokeData(char: string): StrokeData | null {
  return memory.get(char) ?? null;
}
