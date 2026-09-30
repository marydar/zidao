import type { BookMeta, BooksDoc, PracticeSelection, SelectionSummary, WordEntry } from '../../types';

let booksPromise: Promise<BooksDoc> | null = null;
let indexPromise: Promise<Map<string, WordEntry>> | null = null;

/** Book/lesson structure (small, loaded on demand). */
export function getBooksDoc(): Promise<BooksDoc> {
  if (!booksPromise) {
    booksPromise = import('../../data/hsk/books.json').then(
      (m) => m.default as unknown as BooksDoc,
    );
  }
  return booksPromise;
}

/** Full word index (pinyin, meaning, levels) — lazily imported once. */
export function getWordMap(): Promise<Map<string, WordEntry>> {
  if (!indexPromise) {
    indexPromise = import('../../data/hsk/index.json').then((m) => {
      const doc = m.default as unknown as { words: WordEntry[] };
      return new Map(doc.words.map((w) => [w.word, w]));
    });
  }
  return indexPromise;
}

export async function getBook(bookId: string): Promise<BookMeta | null> {
  const doc = await getBooksDoc();
  return doc.books.find((b) => b.id === bookId) ?? null;
}

/** Words for a single book, optionally restricted to lessons. */
export async function getBookWords(bookId: string, lessons?: number[]): Promise<WordEntry[]> {
  const book = await getBook(bookId);
  if (!book) return [];
  const map = await getWordMap();
  const wanted = lessons?.length ? new Set(lessons) : null;
  const out: WordEntry[] = [];
  for (let i = 0; i < book.words.length; i += 1) {
    if (wanted && !wanted.has(book.lessons[i])) continue;
    const entry = map.get(book.words[i]);
    if (entry) out.push(entry);
  }
  return out;
}

export async function getWordsByText(texts: string[]): Promise<WordEntry[]> {
  const map = await getWordMap();
  return texts.map((t) => map.get(t) ?? { word: t, pinyin: '', meaning: '' });
}

/** Resolve a practice selection into concrete vocabulary, preserving order. */
export async function resolveSelection(sel: PracticeSelection): Promise<WordEntry[]> {
  if (sel.words && sel.words.length) {
    return getWordsByText([...new Set(sel.words)]);
  }
  const texts: string[] = [];
  for (const b of sel.books ?? []) {
    const book = await getBook(b.bookId);
    if (!book) continue;
    const wanted = b.lessons?.length ? new Set(b.lessons) : null;
    for (let i = 0; i < book.words.length; i += 1) {
      if (wanted && !wanted.has(book.lessons[i])) continue;
      texts.push(book.words[i]);
    }
  }
  if (sel.customListIds?.length) {
    const { listRepo } = await import('./listRepository');
    for (const id of sel.customListIds) {
      const list = await listRepo.get(id);
      if (list) for (const item of list.items) texts.push(item.word);
    }
  }
  return getWordsByText([...new Set(texts)]);
}

/** Human-readable description of a selection for headers and session records. */
export async function describeSelection(sel: PracticeSelection): Promise<SelectionSummary> {
  if (sel.words?.length) {
    return { label: 'Selected words', detail: `${sel.words.length} words` };
  }
  const parts: string[] = [];
  let lessonCount = 0;
  for (const b of sel.books ?? []) {
    const book = await getBook(b.bookId);
    if (!book) continue;
    if (b.lessons?.length) {
      lessonCount += b.lessons.length;
      const sorted = [...b.lessons].sort((a, z) => a - z);
      const range =
        sorted.length === 1
          ? `Lesson ${sorted[0]}`
          : `Lessons ${sorted[0]}–${sorted[sorted.length - 1]}`;
      parts.push(`${book.title} · ${range}`);
    } else {
      parts.push(book.title);
    }
  }
  if (sel.customListIds?.length) {
    const { listRepo } = await import('./listRepository');
    for (const id of sel.customListIds) {
      const list = await listRepo.get(id);
      if (list) parts.push(list.name);
    }
  }
  if (!parts.length) return { label: 'Vocabulary' };
  const label = parts.join(' + ');
  const detail =
    lessonCount > 1 ? `${parts.length} source${parts.length > 1 ? 's' : ''}` : undefined;
  return { label, detail };
}

const diacritics = /[\u0300-\u036f]/g;

function normalizePinyin(pinyin: string): string {
  return pinyin
    .normalize('NFD')
    .replace(diacritics, '')
    .replace(/ü/g, 'v')
    .toLowerCase()
    .trim();
}

export interface SearchOptions {
  limit?: number;
  bookId?: string;
}

/** Search vocabulary by hanzi, pinyin (tone-insensitive) or meaning. */
export async function searchWords(query: string, opts: SearchOptions = {}): Promise<WordEntry[]> {
  const q = query.trim().toLowerCase();
  const qp = normalizePinyin(q);
  let pool: WordEntry[];
  if (opts.bookId) {
    pool = await getBookWords(opts.bookId);
  } else {
    const map = await getWordMap();
    pool = [...map.values()];
  }
  if (!q) return pool.slice(0, opts.limit ?? 60);
  const matched = pool.filter((w) => {
    if (w.word.includes(query.trim())) return true;
    if (normalizePinyin(w.pinyin).includes(qp)) return true;
    return w.meaning.toLowerCase().includes(q);
  });
  // Prefer shorter/higher-frequency words first for a stable ranking.
  matched.sort((a, b) => (a.frequency ?? 1e9) - (b.frequency ?? 1e9));
  return matched.slice(0, opts.limit ?? 60);
}
