import type { StrokeData, UserStroke } from '../../../types';
import commonBundle from '../../../data/strokes/common.json';

/**
 * Fixtures for the gated evaluation harness (eval.test.ts): upright
 * drawings of real characters plus deliberate degradations, in the same
 * spirit as the legacy matrix tests.
 *
 * Hanzi-writer medians are y-up (the official Make Me a Hanzi render is
 * `scale(1,-1) translate(0,-900)`); real users draw y-down upright. Every
 * fixture flips y before applying the degradation, so the new model is
 * judged on what a person would actually draw — and the legacy recognizer
 * is judged on the same input it faces in the app.
 */

export const EVAL_CHARS = ['为', '办', '好', '山', '水', '大', '中', '学', '的', '你'];

export const EVAL_VARIANTS: [string, MatrixOpts][] = [
  ['normal', { seed: 1 }],
  ['small+shifted', { scale: 0.4, dx: 0.25, dy: 0.2, seed: 2 }],
  ['large', { scale: 1.6, dx: -0.3, dy: -0.25, seed: 3 }],
  ['wide', { stretchX: 1.5, stretchY: 0.7, seed: 4 }],
  ['narrow', { stretchX: 0.65, stretchY: 1.4, seed: 5 }],
  ['messy-wobble', { wobble: 0.02, jitter: 0.01, seed: 6 }],
  ['mouse', { sparse: 3, jitter: 0.012, wobble: 0.01, seed: 7 }],
  ['wrong-order', { shuffle: true, jitter: 0.01, seed: 8 }],
  ['reversed-strokes', { reverse: true, jitter: 0.01, seed: 9 }],
  ['merged+extra', { merge: true, jitter: 0.01, seed: 10 }],
  ['split-strokes', { split: true, jitter: 0.01, seed: 11 }],
  ['short-strokes', { trim: 0.35, jitter: 0.01, seed: 12 }],
];

export interface MatrixOpts {
  scale?: number;
  dx?: number;
  dy?: number;
  stretchX?: number;
  stretchY?: number;
  jitter?: number;
  sparse?: number;
  trim?: number;
  shuffle?: boolean;
  wobble?: number;
  merge?: boolean;
  reverse?: boolean;
  split?: boolean;
  seed?: number;
}

export const BUNDLE = commonBundle as unknown as Record<string, StrokeData>;

/** Deterministic pseudo-random generator so "messy" fixtures are stable. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Keep the first (1 - frac) of the stroke's ARC LENGTH (not point count). */
function trimArc(pts: number[][], frac: number): number[][] {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const target = total * (1 - frac);
  const out: number[][] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= target) {
      const t = d > 1e-9 ? (target - acc) / d : 0;
      out.push([
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ]);
      break;
    }
    acc += d;
    out.push(pts[i]);
  }
  if (out.length < 2) out.push(pts[pts.length - 1]);
  return out;
}

/** Medians flipped to upright (y-down) user space — what a person draws. */
function upright(medians: number[][][]): number[][][] {
  return medians.map((m) => m.map(([x, y]) => [x, 1024 - y]));
}

/**
 * Synthetic user drawing of `medians` with degradations: scaling, shifting,
 * stretching, jitter, sparse (mouse) sampling, wobble, trimming, reordering,
 * merging and splitting strokes.
 */
export function evalDraw(medians: number[][][], o: MatrixOpts = {}): UserStroke[] {
  const {
    scale = 1,
    dx = 0,
    dy = 0,
    stretchX = 1,
    stretchY = 1,
    jitter = 0,
    sparse = 1,
    trim = 0,
    shuffle = false,
    wobble = 0,
    merge = false,
    reverse = false,
    split = false,
    seed = 1,
  } = o;
  const rnd = lcg(seed);
  let strokes: number[][][] = upright(medians)
    .map((m) => {
      let pts = m;
      if (trim > 0) pts = trimArc(pts, trim);
      if (wobble > 0) {
        const ph1 = rnd() * 6.28;
        const ph2 = rnd() * 6.28;
        const amp = wobble * 1024;
        pts = pts.map(([x, y], i) => {
          const t = i / Math.max(1, pts.length - 1);
          return [x + Math.sin(t * 7 + ph1) * amp, y + Math.cos(t * 6 + ph2) * amp];
        });
      }
      if (sparse > 1) {
        const kept = pts.filter((_, i) => i % sparse === 0);
        if (kept[kept.length - 1] !== pts[pts.length - 1]) kept.push(pts[pts.length - 1]);
        pts = kept;
      }
      if (split && pts.length > 6) {
        const at = Math.floor(pts.length / 2);
        return [pts.slice(0, at + 1), pts.slice(at).map(([x, y]) => [x + 8, y + 8])];
      }
      return [pts];
    })
    .flat();
  if (merge && strokes.length >= 2) {
    strokes = [[...strokes[0], ...strokes[1]], ...strokes.slice(2)];
  }
  if (reverse) strokes = strokes.map((s) => [...s].reverse());
  if (shuffle) strokes = [...strokes].reverse();
  return strokes.map((pts) => ({
    points: pts.map(([x, y]) => ({
      x: (x / 1024) * scale * stretchX + dx + (jitter ? (rnd() * 2 - 1) * jitter : 0),
      y: (y / 1024) * scale * stretchY + dy + (jitter ? (rnd() * 2 - 1) * jitter : 0),
    })),
  }));
}

export interface EvalCase {
  char: string;
  variant: string;
  strokes: UserStroke[];
}

export function evalCases(): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const ch of EVAL_CHARS) {
    const medians = BUNDLE[ch]?.medians;
    if (!medians) throw new Error(`fixture missing in bundle: ${ch}`);
    for (const [variant, opts] of EVAL_VARIANTS) {
      cases.push({ char: ch, variant, strokes: evalDraw(medians, opts) });
    }
  }
  return cases;
}
