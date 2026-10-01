import type { UserStroke } from '../../../types';
import { suggestSimilar, type CharCandidate } from '../suggestions';
import { getHcrRunner, HCR_LABELS, MODEL_NAME } from './model';
import { canvasToInput, normalizeToCanvas } from './normalize';
import { renderStrokes } from './render';

/**
 * Dictation-mode recognition: the model ranks all 3755 level-1 characters;
 * the top ones become suggestions the user can tap. The legacy geometric
 * `suggestSimilar` remains only as a fallback when the model fails to load
 * or run — and it never gets to see the expected answer's rank in the model
 * path (no answer injection: suggestions are whatever the drawing matches).
 */

export type RecognizeSource = 'model' | 'fallback';
export type RecognizeReason = 'ok' | 'empty' | 'tiny';

export interface RecognizeResult {
  /** Ranked most confident first; empty when the input was not meaningful. */
  suggestions: CharCandidate[];
  /** How many candidates were scored (3755 for the model). */
  poolSize: number;
  source: RecognizeSource;
  reason: RecognizeReason;
}

export interface RecognizeOptions {
  /** Session-queue characters — get a small additive boost near the top. */
  context?: string[];
  /** Only consulted by the legacy fallback; never influences the model. */
  expected?: string;
  topK?: number;
}

const TOP_K = 8;
/** Additive probability bump for characters in the session queue. */
const CONTEXT_BOOST = 0.012;
/** Drawings smaller than this (fraction of the canvas) are accidental marks. */
const MIN_EXTENT = 0.08;

const LABEL_SET = new Set(HCR_LABELS);

let debugEnabled = false;

if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  try {
    if (new URLSearchParams(location.search).has('hsdebug')) debugEnabled = true;
  } catch {
    /* ignore */
  }
}

/** Dev aid: log inference timing, raw top-10 and final ranking on suggest. */
export function setHcrDebug(on: boolean): void {
  debugEnabled = on;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function strokeExtent(strokes: UserStroke[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(maxX - minX, maxY - minY);
}

/** Softmax over logits, context boost, top-k (descending, ties by index). */
function rankLogits(
  logits: Float32Array,
  context: ReadonlySet<string>,
  topK: number,
  debug: boolean,
): { top: CharCandidate[]; raw: CharCandidate[] } {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) if (logits[i] > max) max = logits[i];
  const probs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const e = Math.exp(logits[i] - max);
    probs[i] = e;
    sum += e;
  }
  const order = new Array<number>(n);
  for (let i = 0; i < n; i += 1) order[i] = i;

  const boosted = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = probs[i] / sum;
    boosted[i] = context.has(HCR_LABELS[i]) ? p + CONTEXT_BOOST : p;
  }
  const byBoost = [...order].sort((a, b) => boosted[b] - boosted[a] || a - b);
  const top = byBoost
    .slice(0, topK)
    .map((i) => ({ char: HCR_LABELS[i], score: Math.min(1, boosted[i]) }));

  let raw: CharCandidate[] = [];
  if (debug) {
    const byProb = [...order].sort((a, b) => probs[b] - probs[a] || a - b);
    raw = byProb.slice(0, 10).map((i) => ({ char: HCR_LABELS[i], score: probs[i] / sum }));
  }
  return { top, raw };
}

function fmt(chars: CharCandidate[]): string {
  return chars.map((c) => `${c.char} ${c.score.toFixed(3)}`).join('  ');
}

/**
 * Recognize what the user drew. Returns model candidates; on model failure
 * the legacy geometric recognizer runs instead (source: 'fallback').
 */
export async function recognizeHandwriting(
  strokes: UserStroke[],
  opts: RecognizeOptions = {},
): Promise<RecognizeResult> {
  const topK = opts.topK ?? TOP_K;
  const context = [...new Set((opts.context ?? []).filter((c) => c))];
  const contextSet = new Set(context.filter((c) => LABEL_SET.has(c)));

  if (!strokes.length || strokes.every((s) => !s.points.length)) {
    return { suggestions: [], poolSize: 0, source: 'model', reason: 'empty' };
  }
  if (strokeExtent(strokes) < MIN_EXTENT) {
    return { suggestions: [], poolSize: 0, source: 'model', reason: 'tiny' };
  }

  try {
    const t0 = now();
    const img = renderStrokes(strokes);
    const canvas = normalizeToCanvas(img.data, img.width, img.height);
    const input = canvasToInput(canvas);
    const runner = await getHcrRunner();
    const t1 = now();
    const logits = await runner(input);
    const t2 = now();
    if (logits.length !== HCR_LABELS.length) {
      throw new Error(`hcr: expected ${HCR_LABELS.length} logits, got ${logits.length}`);
    }
    const { top, raw } = rankLogits(logits, contextSet, topK, debugEnabled);

    if (debugEnabled) {
      console.group('[hcr] recognition debug');
      console.log(MODEL_NAME);
      console.log(
        `render ${img.width}px → 64×64 · inference ${(t2 - t1).toFixed(1)}ms · total ${(t2 - t0).toFixed(1)}ms`,
      );
      console.log(`raw top-10:      ${fmt(raw)}`);
      console.log(`boosted top-${topK}: ${fmt(top)}`);
      console.groupEnd();
    }

    return { suggestions: top, poolSize: HCR_LABELS.length, source: 'model', reason: 'ok' };
  } catch (err) {
    if (debugEnabled) console.warn('[hcr] model unavailable, using legacy fallback', err);
    try {
      const legacy = await suggestSimilar(strokes, opts.expected ?? '', context);
      return { ...legacy, source: 'fallback', reason: 'ok' };
    } catch {
      return { suggestions: [], poolSize: 0, source: 'fallback', reason: 'ok' };
    }
  }
}
