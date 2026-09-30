#!/usr/bin/env node
/**
 * Builds an offline stroke-data bundle for the characters of a book (default: HSK 1)
 * from the `hanzi-writer-data` package (MIT, Make Me a Hanzi data).
 *
 * Output: src/data/strokes/<bookId>.json  — { [char]: { strokes, medians } }
 *
 * Special bookId `common`: the 400 most frequent vocabulary characters plus the
 * HSK 1 set — the offline pool used for handwriting suggestions.
 *
 * Characters missing from the package are skipped (the runtime falls back to the CDN).
 * Usage: node scripts/build-stroke-bundle.mjs [bookId]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const bookId = process.argv[2] || 'hsk-1';

const books = JSON.parse(await readFile(path.join(ROOT, 'src/data/hsk/books.json'), 'utf8'));
const index = JSON.parse(await readFile(path.join(ROOT, 'src/data/hsk/index.json'), 'utf8'));

const chars = new Set();
if (bookId === 'common') {
  const freq = new Map();
  for (const word of index.words) {
    for (const ch of word.word) freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
  for (const [ch] of top) chars.add(ch);
  const hsk1File = path.join(ROOT, 'src/data/strokes/hsk-1.json');
  if (existsSync(hsk1File)) {
    for (const ch of Object.keys(JSON.parse(await readFile(hsk1File, 'utf8')))) chars.add(ch);
  }
} else {
  const book = books.books.find((b) => b.id === bookId);
  if (!book) {
    console.error(`Unknown book: ${bookId}`);
    process.exit(1);
  }
  const byWord = new Map(index.words.map((w) => [w.word, w]));
  for (const word of book.words) {
    const entry = byWord.get(word);
    if (entry) for (const ch of word) chars.add(ch);
  }
}

const out = {};
let missing = 0;
const dataRoot = path.join(ROOT, 'node_modules', 'hanzi-writer-data');
for (const ch of chars) {
  const file = path.join(dataRoot, `${ch}.json`);
  if (!existsSync(file)) {
    missing += 1;
    continue;
  }
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    out[ch] = { strokes: data.strokes, medians: data.medians };
  } catch {
    missing += 1;
  }
}

const outDir = path.join(ROOT, 'src', 'data', 'strokes');
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `${bookId}.json`);
await writeFile(outFile, JSON.stringify(out));
const size = (await readFile(outFile)).length;
console.log(
  `Bundled ${Object.keys(out).length} chars (${missing} missing) → ${path.relative(ROOT, outFile)} (${(size / 1024).toFixed(0)} KB)`,
);
