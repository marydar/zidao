#!/usr/bin/env node
/**
 * Imports HSK vocabulary from the MIT-licensed `complete-hsk-vocabulary` dataset
 * (https://github.com/drkameleon/complete-hsk-vocabulary) into the app-native format.
 *
 * Output:
 *   src/data/hsk/index.json  — unique words (pinyin, meaning, HSK levels, frequency)
 *   src/data/hsk/books.json  — book/lesson structure referencing words by text
 *
 * Lessons are deterministic study groups: words inside a book are ordered by corpus
 * frequency (most frequent first) and chunked into lessons. The upstream dataset does
 * not ship lesson numbers, so this grouping is derived — see src/data/hsk/SOURCES.md.
 *
 * Usage: node scripts/import-vocabulary.mjs [--source <path-to-complete.min.json>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'hsk');
const CACHE = path.join(__dirname, '.cache', 'complete.min.json');
const REMOTE =
  'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json';

const args = process.argv.slice(2);
const sourceArgIdx = args.indexOf('--source');
const sourcePath = sourceArgIdx >= 0 ? args[sourceArgIdx + 1] : null;

async function loadSource() {
  if (sourcePath) return JSON.parse(await readFile(sourcePath, 'utf8'));
  if (existsSync(CACHE)) return JSON.parse(await readFile(CACHE, 'utf8'));
  console.log(`Downloading ${REMOTE} ...`);
  const res = await fetch(REMOTE);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const text = await res.text();
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(CACHE, text);
  return JSON.parse(text);
}

/** 15-50 words per lesson, targeting ~10-20 lessons per book. */
function lessonSize(count) {
  const target = Math.ceil(count / 15);
  return Math.min(50, Math.max(15, target));
}

function cleanMeaning(meanings) {
  if (!meanings || !meanings.length) return '';
  const picked = meanings.slice(0, 3).join('; ');
  return picked.length > 110 ? `${picked.slice(0, 107).trimEnd()}…` : picked;
}

const CJK = /^[㐀-䶿一-鿿豈-﫿]+$/;

async function main() {
  const raw = await loadSource();
  console.log(`Source entries: ${raw.length}`);

  /** @type {Map<string, {word:string,pinyin:string,meaning:string,traditional?:string,hsk2?:number,hsk3?:number,frequency?:number}>} */
  const words = new Map();
  const books = new Map(); // id -> {meta, words: string[]}

  const ensureBook = (id, track, level, title) => {
    if (!books.has(id)) books.set(id, { id, track, level, title, words: [] });
    return books.get(id);
  };

  for (const entry of raw) {
    const word = (entry.s || '').trim();
    if (!word || !CJK.test(word)) continue;

    const form = Array.isArray(entry.f) && entry.f[0] ? entry.f[0] : null;
    const pinyin = (form?.i?.y || '').trim();
    const meaning = cleanMeaning(form?.m);
    if (!pinyin) continue;

    let hsk2 = null;
    let hsk3 = null;
    for (const level of entry.l || []) {
      if (/^o([1-6])$/.test(level)) hsk2 = Number(RegExp.$1);
      if (/^n([1-9])$/.test(level)) hsk3 = Number(RegExp.$1);
    }

    const existing = words.get(word);
    const rec = {
      word,
      pinyin,
      meaning,
      traditional: (form?.t || '').trim() || undefined,
      hsk2: hsk2 ?? existing?.hsk2 ?? undefined,
      hsk3: hsk3 ?? existing?.hsk3 ?? undefined,
      frequency: entry.q ?? existing?.frequency ?? undefined,
    };
    // Merge repeated entries (same word listed in several levels/books).
    words.set(word, {
      ...existing,
      ...rec,
      hsk2: rec.hsk2 ?? existing?.hsk2,
      hsk3: rec.hsk3 ?? existing?.hsk3,
      frequency: rec.frequency ?? existing?.frequency,
    });

    if (hsk2) ensureBook(`hsk-${hsk2}`, 'hsk2', hsk2, `HSK ${hsk2}`).words.push(word);
    if (hsk3) ensureBook(`nhsk-${hsk3}`, 'hsk3', hsk3, `HSK ${hsk3} (3.0)`).words.push(word);
  }

  // Stable, deterministic word ordering inside each book: frequency first.
  const freq = (w) => words.get(w)?.frequency ?? Number.MAX_SAFE_INTEGER;
  for (const book of books.values()) {
    book.words = [...new Set(book.words)].sort((a, b) => freq(a) - freq(b) || a.localeCompare(b));
  }

  const wordList = [...words.values()].sort((a, b) =>
    (a.frequency ?? Number.MAX_SAFE_INTEGER) - (b.frequency ?? Number.MAX_SAFE_INTEGER) ||
    a.word.localeCompare(b.word),
  );

  const tracks = [
    {
      id: 'hsk2',
      label: 'HSK 2.0',
      note: 'Classic 2010 syllabus, levels 1–6',
      bookIds: [...books.keys()].filter((id) => id.startsWith('hsk-')).sort(byLevel),
    },
    {
      id: 'hsk3',
      label: 'HSK 3.0',
      note: 'New 2021 syllabus, levels 1–9',
      bookIds: [...books.keys()].filter((id) => id.startsWith('nhsk-')).sort(byLevel),
    },
  ];

  const booksOut = [...books.values()].sort((a, b) => a.track.localeCompare(b.track) || a.level - b.level)
    .map((book) => {
      const size = lessonSize(book.words.length);
      const lessons = book.words.map((_, i) => Math.floor(i / size) + 1);
      return {
        id: book.id,
        track: book.track,
        level: book.level,
        title: book.title,
        count: book.words.length,
        lessonCount: lessons[lessons.length - 1] || 0,
        lessonSize: size,
        words: book.words,
        lessons,
      };
    });

  function byLevel(a, b) {
    return Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''));
  }

  await mkdir(OUT_DIR, { recursive: true });
  const indexDoc = {
    source: 'drkameleon/complete-hsk-vocabulary (MIT)',
    generatedAt: new Date().toISOString(),
    count: wordList.length,
    words: wordList,
  };
  const booksDoc = {
    source: 'drkameleon/complete-hsk-vocabulary (MIT)',
    generatedAt: new Date().toISOString(),
    lessonPolicy: 'words ordered by corpus frequency, chunked into lessons of 15–50',
    tracks,
    books: booksOut,
  };

  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(indexDoc));
  await writeFile(path.join(OUT_DIR, 'books.json'), JSON.stringify(booksDoc));

  const uniqueChars = new Set([...words.keys()].join('')).size;
  console.log(`Words: ${wordList.length}, unique chars: ${uniqueChars}`);
  for (const b of booksOut) console.log(`  ${b.id.padEnd(8)} ${String(b.count).padStart(5)} words, ${b.lessonCount} lessons`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
