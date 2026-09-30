# Hanzi Practice

A focused Hanzi handwriting practice app: default **dictation** mode (hear the word,
write the hanzi from memory — the app suggests similar zi for what you drew, you pick
the one you meant and it's judged), plus a classic stroke-order quiz with real
stroke-level feedback, progress tracking over time, and adaptive weak-word review.

## Development

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — start dev server
- `npm run build` — typecheck + production build
- `npm run typecheck` — TypeScript project check
- `npm run lint` — ESLint
- `npm test` — tests: handwriting evaluator, dictation suggestions, progress stats, and DOM smoke tests for every route
- `npm run data:import` — re-import HSK vocabulary from the upstream dataset
- `npm run data:strokes` — rebuild the bundled stroke cache for offline HSK 1 practice
- `npm run data:strokes:common` — rebuild the offline suggestion pool (top 400 frequent chars + HSK 1)

## Data sources

- Vocabulary: [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT),
  converted into `src/data/hsk/*.json` by `scripts/import-vocabulary.mjs`.
- Stroke paths: [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) (MIT),
  fetched lazily per character (CDN) with an IndexedDB cache, plus offline bundles
  (HSK 1 practice data and a suggestion pool of the 400 most frequent characters + HSK 1).

## Suggestion recognizer

Dictation mode scores each candidate character on four components — **shape**
(whole-character silhouette after scale/position normalization and a small
translation search), **structure** (stroke count, direction histogram, spatial
relations, length profile, stroke order), **stroke** (pairwise matching tolerant
to short/merged/split strokes), and **position** (stroke centroids and
endpoints) — then shows the top ranked zi. The whole pool is pre-ranked cheaply
and only the finalists get the full pass, so suggestions stay fast. Append
`?hsdebug` to any URL to log the normalized drawing and each top candidate's
per-component score breakdown to the console.
