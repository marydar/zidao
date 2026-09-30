import { describe, expect, it } from 'vitest';
import type { StrokeData, UserStroke } from '../../types';
import commonBundle from '../../data/strokes/common.json';
import { drawingSimilarity, explainSimilarity, suggestSimilar } from './suggestions';

/* ---------- synthetic stroke fixtures (1024×1024 space) ---------- */

function medianLine(x1: number, y1: number, x2: number, y2: number): number[][] {
  return Array.from({ length: 11 }, (_, i) => [
    x1 + ((x2 - x1) * i) / 10,
    y1 + ((y2 - y1) * i) / 10,
  ]);
}

function strokeData(medians: number[][][]): StrokeData {
  return { strokes: medians.map(() => 'M 0 0 L 10 10'), medians };
}

/** 一 — one horizontal stroke. */
const YI = strokeData([medianLine(120, 512, 900, 512)]);
/** 十 — horizontal + vertical crossing. */
const SHI = strokeData([medianLine(120, 512, 900, 512), medianLine(512, 120, 512, 900)]);
/** 人 — two slanted strokes. */
const REN = strokeData([medianLine(520, 140, 300, 880), medianLine(520, 140, 760, 880)]);

const FIXTURES: Record<string, StrokeData> = { 一: YI, 十: SHI, 人: REN };

const loader = async (char: string): Promise<StrokeData | null> => FIXTURES[char] ?? null;

/** Perfect user drawing of a median, normalized to 0..1 canvas coordinates. */
function draw(medians: number[][][], opts: { scale?: number; dx?: number; dy?: number } = {}): UserStroke[] {
  const scale = opts.scale ?? 1;
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  return medians.map((median) => ({
    points: median.map(([x, y]) => ({
      x: (x / 1024) * scale + dx,
      y: (y / 1024) * scale + dy,
    })),
  }));
}

describe('drawingSimilarity', () => {
  it('scores a matching drawing high and an unrelated one low', () => {
    expect(drawingSimilarity(draw(YI.medians), YI)).toBeGreaterThan(0.7);
    expect(drawingSimilarity(draw(YI.medians), REN)).toBeLessThan(0.3);
  });

  it('tolerates drawing small and off-center', () => {
    const exact = drawingSimilarity(draw(SHI.medians), SHI);
    const sloppy = drawingSimilarity(draw(SHI.medians, { scale: 0.35, dx: 0.08, dy: 0.1 }), SHI);
    expect(sloppy).toBeGreaterThan(0.6);
    expect(sloppy).toBeGreaterThan(exact - 0.35);
  });

  it('penalizes missing strokes only softly', () => {
    const full = drawingSimilarity(draw(SHI.medians), SHI);
    const half = drawingSimilarity([draw(SHI.medians)[0]], SHI);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(full);
  });
});

describe('suggestSimilar', () => {
  it('suggests the drawn character as the most similar zi', async () => {
    const result = await suggestSimilar(draw(YI.medians), '一', ['十', '人'], loader);
    expect(result.poolSize).toBeGreaterThan(3);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].char).toBe('一');
    expect(result.suggestions.map((s) => s.char)).toEqual(
      [...result.suggestions].sort((a, b) => b.score - a.score).map((s) => s.char),
    );
  });

  it('suggests the closest-looking zi even when it is not the expected answer', async () => {
    // The user drew 十 but the expected answer was 一 — the choice is theirs to make.
    const result = await suggestSimilar(draw(SHI.medians), '一', ['十', '人'], loader);
    expect(result.suggestions[0].char).toBe('十');
    expect(result.suggestions[0].char).not.toBe('一');
  });

  it('suggests near zi from the offline bundle when no loader data exists', async () => {
    const result = await suggestSimilar(draw(YI.medians), '一', [], async () => null);
    expect(result.suggestions[0]?.char).toBe('一');
    expect(result.suggestions.length).toBeGreaterThan(1);
  });

  it('keeps working when a loader rejects', async () => {
    const result = await suggestSimilar(draw(YI.medians), '一', ['十'], async () => {
      throw new Error('network down');
    });
    expect(result.poolSize).toBeGreaterThan(1);
    expect(result.suggestions[0]?.char).toBe('一');
  });

  it('suggests correctly even when the drawing is small and off-center', async () => {
    const result = await suggestSimilar(
      draw(YI.medians, { scale: 0.4, dx: 0.2, dy: 0.25 }),
      '一',
      ['十', '人'],
      loader,
    );
    expect(result.suggestions[0]?.char).toBe('一');
  });

  it('returns nothing without strokes or without a target', async () => {
    expect(await suggestSimilar([], '一', ['十'], loader)).toEqual({
      suggestions: [],
      poolSize: 0,
    });
    expect(await suggestSimilar(draw(YI.medians), '', ['十'], loader)).toEqual({
      suggestions: [],
      poolSize: 0,
    });
  });
});

/* ---------- deliberately bad handwriting: rough drawings of 为 / 办 ---------- */

const BUNDLE = commonBundle as unknown as Record<string, StrokeData>;

/** Deterministic pseudo-random generator so "messy" tests are stable. */
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

interface RoughOpts {
  scale?: number;
  dx?: number;
  dy?: number;
  stretchX?: number;
  stretchY?: number;
  /** ± fraction of the box applied to every point (messy handwriting). */
  jitter?: number;
  /** Keep only every nth point (sparse mouse sampling). */
  sparse?: number;
  /** Drop the last fraction of every stroke (too-short strokes). */
  trim?: number;
  /** Draw strokes in reverse order. */
  reorder?: boolean;
  /** Append an extra copy of the first stroke (double-drawn stroke). */
  extra?: boolean;
  seed?: number;
}

function roughDraw(medians: number[][][], opts: RoughOpts = {}): UserStroke[] {
  const {
    scale = 1,
    dx = 0,
    dy = 0,
    stretchX = 1,
    stretchY = 1,
    jitter = 0,
    sparse = 1,
    trim = 0,
    reorder = false,
    extra = false,
    seed = 1,
  } = opts;
  const rnd = lcg(seed);
  let strokes: UserStroke[] = medians.map((median) => {
    let pts = median;
    if (trim > 0) pts = trimArc(pts, trim);
    if (sparse > 1) {
      const kept = pts.filter((_, i) => i % sparse === 0);
      if (kept[kept.length - 1] !== pts[pts.length - 1]) kept.push(pts[pts.length - 1]);
      pts = kept;
    }
    return {
      points: pts.map(([x, y]) => ({
        x: (x / 1024) * scale * stretchX + dx + (jitter ? (rnd() * 2 - 1) * jitter : 0),
        y: (y / 1024) * scale * stretchY + dy + (jitter ? (rnd() * 2 - 1) * jitter : 0),
      })),
    };
  });
  if (reorder) strokes = [...strokes].reverse();
  if (extra && strokes.length) strokes = [...strokes, strokes[0]];
  return strokes;
}

const noLoader = async (): Promise<StrokeData | null> => null;

const ROUGH_CASES: [string, RoughOpts][] = [
  ['normal', {}],
  ['small and shifted', { scale: 0.45, dx: 0.22, dy: 0.16 }],
  ['large', { scale: 1.5, dx: -0.2, dy: -0.15 }],
  ['stretched wide', { stretchX: 1.4, stretchY: 0.75 }],
  ['stretched tall', { stretchX: 0.7, stretchY: 1.35 }],
  ['messy (jitter)', { jitter: 0.02, seed: 3 }],
  ['imperfect stroke lengths', { trim: 0.3, jitter: 0.01, seed: 5 }],
  ['mouse-sparse points', { sparse: 3, jitter: 0.015, seed: 9 }],
  ['reversed stroke order', { reorder: true, jitter: 0.01, seed: 4 }],
  ['extra double-drawn stroke', { extra: true, jitter: 0.01, seed: 6 }],
  [
    'rough mouse writing (all at once)',
    { scale: 0.8, dx: 0.1, dy: 0.06, stretchX: 1.25, jitter: 0.025, trim: 0.15, sparse: 2, seed: 11 },
  ],
  ['drawn far outside the box', { scale: 0.5, dx: -0.1, dy: -0.1 }],
  ['tiny in the corner', { scale: 0.3, dx: 0.7, dy: 0.7 }],
];

describe('bad handwriting: the intended zi stays among the top suggestions', () => {
  for (const [name, opts] of ROUGH_CASES) {
    it(`为 — ${name}`, async () => {
      const result = await suggestSimilar(roughDraw(BUNDLE['为'].medians, opts), '为', [], noLoader);
      const top = result.suggestions.slice(0, 3).map((s) => s.char);
      expect(top, `got: ${result.suggestions.map((s) => s.char).join(' ')}`).toContain('为');
    });
  }

  for (const [name, opts] of ROUGH_CASES) {
    it(`办 — ${name}`, async () => {
      const result = await suggestSimilar(roughDraw(BUNDLE['办'].medians, opts), '办', [], noLoader);
      const top = result.suggestions.slice(0, 3).map((s) => s.char);
      expect(top, `got: ${result.suggestions.map((s) => s.char).join(' ')}`).toContain('办');
    });
  }

  it('returns several ranked candidates, best first', async () => {
    const result = await suggestSimilar(
      roughDraw(BUNDLE['为'].medians, { scale: 0.8, jitter: 0.025, seed: 11 }),
      '为',
      [],
      noLoader,
    );
    expect(result.suggestions.length).toBeGreaterThanOrEqual(5);
    expect(result.suggestions.length).toBeLessThanOrEqual(10);
    expect(result.suggestions[0].char).toBe('为');
    expect(result.suggestions.map((s) => s.score)).toEqual(
      [...result.suggestions.map((s) => s.score)].sort((a, b) => b - a),
    );
  });

  it('ranks a rough 为 well above unrelated zi', () => {
    const rough = roughDraw(BUNDLE['为'].medians, { scale: 0.8, jitter: 0.025, seed: 11 });
    expect(drawingSimilarity(rough, BUNDLE['为'])).toBeGreaterThan(0.7);
    expect(drawingSimilarity(rough, BUNDLE['办'])).toBeGreaterThan(0.2);
    expect(drawingSimilarity(rough, BUNDLE['为'])).toBeGreaterThan(
      drawingSimilarity(rough, BUNDLE['办']),
    );
  });
});

/* ---------- multi-character recognition matrix ---------- */

const MATRIX_CHARS = ['为', '办', '好', '山', '水', '大', '中', '学', '的', '你'];

interface MatrixOpts {
  scale?: number; dx?: number; dy?: number; stretchX?: number; stretchY?: number;
  jitter?: number; sparse?: number; trim?: number; shuffle?: boolean;
  wobble?: number; merge?: boolean; reverse?: boolean; split?: boolean; seed?: number;
}

function matrixDraw(medians: number[][][], o: MatrixOpts = {}): UserStroke[] {
  const { scale = 1, dx = 0, dy = 0, stretchX = 1, stretchY = 1, jitter = 0,
    sparse = 1, trim = 0, shuffle = false, wobble = 0, merge = false,
    reverse = false, split = false, seed = 1 } = o;
  const rnd = lcg(seed);
  let strokes: number[][][] = medians.map((m) => {
    let pts = m;
    if (trim > 0) pts = trimArc(pts, trim);
    if (wobble > 0) {
      const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
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
  }).flat();
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

const MATRIX_VARIANTS: [string, MatrixOpts][] = [
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

describe('recognition matrix: intended zi in top 3 across writing styles', () => {
  for (const ch of MATRIX_CHARS) {
    it(`${ch} — 12 variants`, { timeout: 60000 }, async () => {
      for (const [name, opts] of MATRIX_VARIANTS) {
        const r = await suggestSimilar(matrixDraw(BUNDLE[ch].medians, opts), ch, [], noLoader);
        const rank = r.suggestions.findIndex((s) => s.char === ch) + 1;
        expect(
          rank,
          `${ch} ${name}: got ${r.suggestions.map((s) => `${s.char}:${s.score.toFixed(2)}`).join(' ')}`,
        ).toBeGreaterThan(0);
        expect(rank, `${ch} ${name} rank=${rank}`).toBeLessThanOrEqual(3);
      }
    });
  }
});

describe('explainSimilarity breakdown', () => {
  it('exposes bounded components that combine into the overall score', () => {
    const b = explainSimilarity(matrixDraw(BUNDLE['为'].medians, { jitter: 0.02, seed: 3 }), BUNDLE['为']);
    for (const key of ['shape', 'structure', 'stroke', 'position', 'overall'] as const) {
      expect(b[key]).toBeGreaterThanOrEqual(0);
      expect(b[key]).toBeLessThanOrEqual(1);
    }
    expect(b.overall).toBeCloseTo(
      0.3 * b.shape + 0.25 * b.structure + 0.3 * b.stroke + 0.15 * b.position,
      5,
    );
    expect(b.overall).toBeGreaterThan(0.5);
  });

  it('scores an unrelated character clearly lower than the drawn one', () => {
    const strokes = matrixDraw(BUNDLE['中'].medians, { jitter: 0.015, seed: 4 });
    expect(explainSimilarity(strokes, BUNDLE['中']).overall).toBeGreaterThan(
      explainSimilarity(strokes, BUNDLE['三']).overall,
    );
  });
});
