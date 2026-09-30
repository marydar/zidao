import type {
  HanziCharacter,
  HanziWritingEvaluator,
  Point,
  StrokeIssue,
  StrokeResult,
  Strictness,
  UserStroke,
  WritingEvaluation,
} from '../../types';
import {
  BOX,
  allPoints,
  bboxOf,
  clamp,
  describeStroke,
  dist,
  meanDist,
  resample,
} from './geometry';

const SAMPLES = 16;
/** Shape distance (fraction of the 1024 box) that drives similarity to 0. */
const SHAPE_NORM = 0.17;
/** Endpoint error (fraction of box) that drives position similarity to 0. */
const POS_NORM = 0.2;
/** DP cost of skipping/adding one stroke. */
const GAP_PENALTY = 0.75;
const MAX_USER_STROKES = 40;
/** Margin required before we claim a stroke is "really" a different expected stroke. */
const IDENTITY_MARGIN = 0.15;

interface Gates {
  extra: number;
  reversals: number;
  minSim: number;
  meanSim: number;
  orderEnforced: boolean;
}

const GATES: Record<Strictness, Gates> = {
  lenient: { extra: 1, reversals: 1, minSim: 0.4, meanSim: 0.5, orderEnforced: false },
  normal: { extra: 0, reversals: 0, minSim: 0.5, meanSim: 0.65, orderEnforced: true },
  strict: { extra: 0, reversals: 0, minSim: 0.6, meanSim: 0.75, orderEnforced: true },
};

const clamp01 = (v: number) => clamp(v, 0, 1);

interface PairMetrics {
  sim: number;
  shapeSim: number;
  posSim: number;
  dirCos: number;
  reversed: boolean;
  endErr: number;
}

/** Compare one user stroke with one expected stroke (both in 1024 space). */
function compareStroke(uRaw: Point[], eRaw: Point[]): PairMetrics {
  const u = resample(uRaw, SAMPLES);
  const e = resample(eRaw, SAMPLES);
  const uFirst = u[0];
  const uLast = u[u.length - 1];
  const eFirst = e[0];
  const eLast = e[e.length - 1];

  const endFwd = (dist(uFirst, eFirst) + dist(uLast, eLast)) / 2;
  const endRev = (dist(uFirst, eLast) + dist(uLast, eFirst)) / 2;
  const strokeLen = Math.hypot(eLast.x - eFirst.x, eLast.y - eFirst.y);
  const reversed =
    endRev < endFwd * 0.8 && endFwd > Math.max(0.06 * BOX, strokeLen * 0.35) && endRev < 0.2 * BOX;

  const uAligned = reversed ? [...u].reverse() : u;
  const shape = meanDist(uAligned, e) / BOX;
  const endErr = Math.min(endFwd, endRev) / BOX;
  const shapeSim = clamp01(1 - shape / SHAPE_NORM);
  const posSim = clamp01(1 - endErr / POS_NORM);

  const udx = uLast.x - uFirst.x;
  const udy = uLast.y - uFirst.y;
  const edx = eLast.x - eFirst.x;
  const edy = eLast.y - eFirst.y;
  const un = Math.hypot(udx, udy);
  const en = Math.hypot(edx, edy);
  let dirCos = 1;
  if (un > 1e-6 && en > 1e-6) dirCos = clamp((udx * edx + udy * edy) / (un * en), -1, 1);
  const dirSim = clamp01((dirCos + 0.35) / 1.35);

  const sim = clamp01(0.55 * shapeSim + 0.3 * posSim + 0.15 * dirSim);
  return { sim, shapeSim, posSim, dirCos, reversed, endErr };
}

/**
 * Align user strokes to expected strokes with a monotonic edit-distance DP.
 * Returns per-pair metrics plus which expected strokes are missing and which
 * user strokes are extra.
 */
function alignStrokes(user: Point[][], expected: Point[][]): {
  pairs: { ui: number; ej: number; metrics: PairMetrics }[];
  simMatrix: PairMetrics[][];
  missing: number[];
  extras: number[];
  dpCost: number;
} {
  const n = user.length;
  const m = expected.length;
  const simMatrix: PairMetrics[][] = [];
  for (let i = 0; i < n; i += 1) {
    simMatrix.push(expected.map((e) => compareStroke(user[i], e)));
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  // 0 = match, 1 = extra user stroke, 2 = missing expected stroke
  const back: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    dp[i][0] = i * GAP_PENALTY;
    back[i][0] = 1;
  }
  for (let j = 1; j <= m; j += 1) {
    dp[0][j] = j * GAP_PENALTY;
    back[0][j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const match = dp[i - 1][j - 1] + (1 - simMatrix[i - 1][j - 1].sim);
      const skipUser = dp[i - 1][j] + GAP_PENALTY;
      const skipExpected = dp[i][j - 1] + GAP_PENALTY;
      let best = match;
      let dir = 0;
      if (skipUser < best) {
        best = skipUser;
        dir = 1;
      }
      if (skipExpected < best) {
        best = skipExpected;
        dir = 2;
      }
      dp[i][j] = best;
      back[i][j] = dir;
    }
  }

  const pairs: { ui: number; ej: number; metrics: PairMetrics }[] = [];
  const matchedUser = new Set<number>();
  const matchedExpected = new Set<number>();
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = back[i][j];
    if (dir === 0) {
      pairs.push({ ui: i - 1, ej: j - 1, metrics: simMatrix[i - 1][j - 1] });
      matchedUser.add(i - 1);
      matchedExpected.add(j - 1);
      i -= 1;
      j -= 1;
    } else if (dir === 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  const missing: number[] = [];
  for (let k = 0; k < m; k += 1) if (!matchedExpected.has(k)) missing.push(k);
  const extras: number[] = [];
  for (let k = 0; k < n; k += 1) if (!matchedUser.has(k)) extras.push(k);
  return { pairs, simMatrix, missing, extras, dpCost: dp[n][m] };
}

/**
 * Detect that the user drew two strokes in the wrong relative order.
 * Uses per-stroke identity (which expected stroke each drawn stroke most resembles)
 * rather than the DP pairing, because the DP may resolve a swap as a missing stroke.
 */
function detectOrderIssue(
  simMatrix: PairMetrics[][],
): { first: number; second: number } | null {
  const confident: { ui: number; ej: number }[] = [];
  for (let ui = 0; ui < simMatrix.length; ui += 1) {
    let best = -1;
    let bestSim = -Infinity;
    let second = -Infinity;
    for (let j = 0; j < simMatrix[ui].length; j += 1) {
      const s = simMatrix[ui][j].sim;
      if (s > bestSim) {
        second = bestSim;
        bestSim = s;
        best = j;
      } else if (s > second) {
        second = s;
      }
    }
    if (bestSim >= 0.5 && bestSim - second >= IDENTITY_MARGIN) confident.push({ ui, ej: best });
  }
  for (let k = 0; k < confident.length - 1; k += 1) {
    if (confident[k].ej > confident[k + 1].ej) {
      return { first: confident[k + 1].ej, second: confident[k].ej };
    }
  }
  return null;
}

/** Move/align user strokes (0..1 normalized) into the expected 1024 space. */
function alignToExpectedSpace(userStrokes: UserStroke[], expected: Point[][]): Point[][] {
  const raw = userStrokes.map((s) => s.points.map((p) => ({ x: p.x * BOX, y: p.y * BOX })));
  const uBounds = bboxOf(allPoints(raw));
  const eBounds = bboxOf(allPoints(expected));
  const uSize = Math.max(uBounds.w, uBounds.h);
  const eSize = Math.max(eBounds.w, eBounds.h);
  let scale = eSize / Math.max(uSize, eSize * 0.08);
  scale = clamp(scale, 0.4, 2.5);
  return raw.map((stroke) =>
    stroke.map((p) => ({
      x: (p.x - uBounds.cx) * scale + eBounds.cx,
      y: (p.y - uBounds.cy) * scale + eBounds.cy,
    })),
  );
}

function emptyEvaluation(drawn: number, expected: number, message: string, issues: StrokeIssue[]): WritingEvaluation {
  return {
    correct: false,
    score: 0,
    strokeResults: [],
    issues,
    feedback: message,
    hintTarget: issues[0]?.strokeIndex || 1,
    strokeCount: { expected, drawn },
    fallback: expected === 0,
  };
}

function fallbackEvaluation(strokes: UserStroke[]): WritingEvaluation {
  const points = strokes.reduce((sum, s) => sum + s.points.length, 0);
  const bounds = bboxOf(allPoints(strokes.map((s) => s.points)));
  const span = Math.max(bounds.w, bounds.h);
  const inkOk = strokes.length >= 1 && points >= 6 && span >= 0.18;
  const score = inkOk ? clamp01(0.45 + Math.min(span, 0.8) * 0.4 + Math.min(strokes.length, 8) * 0.02) : 0.15;
  return {
    correct: inkOk,
    score,
    strokeResults: [],
    issues: inkOk
      ? [
          {
            kind: 'no-data',
            strokeIndex: 0,
            message: 'Stroke data unavailable — only checking that something was written.',
          },
        ]
      : [{ kind: 'empty', strokeIndex: 0, message: 'Draw the character across the whole square.' }],
    feedback: inkOk
      ? 'Stroke data for this character is unavailable, so this was checked loosely — try to fill the square.'
      : 'Draw the character first — make it large enough to fill the square.',
    hintTarget: null,
    strokeCount: { expected: 0, drawn: strokes.length },
    fallback: true,
  };
}

export function createHanziEvaluator(strictness: Strictness = 'normal'): HanziWritingEvaluator {
  const gates = GATES[strictness];

  return {
    evaluate(strokes: UserStroke[], expected: HanziCharacter): WritingEvaluation {
      const expectedStrokes: Point[][] = (expected.data?.medians ?? []).map((median) =>
        median.map(([x, y]) => ({ x, y })),
      );
      const drawn = strokes.length;

      if (expectedStrokes.length === 0) return fallbackEvaluation(strokes);
      if (drawn === 0) {
        return emptyEvaluation(0, expectedStrokes.length, 'Draw the character first.', [
          { kind: 'empty', strokeIndex: 1, message: 'Nothing has been drawn yet.' },
        ]);
      }

      const trimmed = strokes.slice(0, MAX_USER_STROKES);
      const overLimit = strokes.length > MAX_USER_STROKES;
      const userPts = alignToExpectedSpace(trimmed, expectedStrokes);
      const { pairs, simMatrix, missing, extras } = alignStrokes(userPts, expectedStrokes);

      const issues: StrokeIssue[] = [];
      const strokeResults: StrokeResult[] = pairs.map((p) => ({
        expectedIndex: p.ej + 1,
        userIndex: p.ui,
        similarity: p.metrics.sim,
        matched: p.metrics.sim >= 0.35,
        directionReversed: p.metrics.reversed,
      }));

      const orderIssue = detectOrderIssue(simMatrix);
      const reversals = pairs.filter((p) => p.metrics.reversed);
      const pairSims = pairs.map((p) => p.metrics.sim);
      const meanSim = pairSims.length ? pairSims.reduce((a, b) => a + b, 0) / pairSims.length : 0;
      const minSim = pairSims.length ? Math.min(...pairSims) : 0;

      // ---- issues (also produced when we pass, so feedback can mention near-misses)
      if (orderIssue) {
        issues.push({
          kind: 'order',
          strokeIndex: orderIssue.first + 1,
          message: `Draw stroke ${orderIssue.first + 1} before stroke ${orderIssue.second + 1}.`,
        });
      }
      for (const ej of missing) {
        issues.push({
          kind: 'missing',
          strokeIndex: ej + 1,
          message: `Stroke ${ej + 1} is missing — you skipped the ${describeStroke(expectedStrokes[ej])}.`,
        });
      }
      for (const p of reversals) {
        issues.push({
          kind: 'direction',
          strokeIndex: p.ej + 1,
          message: `Stroke ${p.ej + 1} goes the wrong way — draw the ${describeStroke(expectedStrokes[p.ej])} from the other end.`,
        });
      }
      // position/shape notes for weak-but-matched strokes
      const weak = pairs
        .filter((p) => p.metrics.sim < 0.72 && !p.metrics.reversed)
        .sort((a, b) => a.metrics.sim - b.metrics.sim);
      for (const p of weak.slice(0, 2)) {
        const uCenter = centroidOf(userPts[p.ui]);
        const eCenter = centroidOf(expectedStrokes[p.ej]);
        const dx = uCenter.x - eCenter.x;
        const dy = uCenter.y - eCenter.y;
        const shift =
          Math.abs(dx) > 0.07 * BOX || Math.abs(dy) > 0.07 * BOX
            ? ` — it should sit ${describeShift(dx, dy)}`
            : '';
        if (p.metrics.posSim < p.metrics.shapeSim) {
          issues.push({
            kind: 'position',
            strokeIndex: p.ej + 1,
            message: `Stroke ${p.ej + 1} is misplaced${shift}.`,
          });
        } else {
          issues.push({
            kind: 'shape',
            strokeIndex: p.ej + 1,
            message: `Stroke ${p.ej + 1} doesn't match — check its ${describeStroke(expectedStrokes[p.ej])} shape and length.`,
          });
        }
      }
      if (extras.length) {
        issues.push({
          kind: 'extra',
          strokeIndex: 0,
          message: `You drew ${extras.length} extra stroke${extras.length > 1 ? 's' : ''}.`,
        });
      }
      if (overLimit) {
        issues.push({
          kind: 'extra',
          strokeIndex: 0,
          message: 'Too many strokes — clear it and try again more simply.',
        });
      }

      // ---- score
      const expectedCount = expectedStrokes.length;
      const quality = pairs.reduce((sum, p) => sum + p.metrics.sim, 0) / expectedCount;
      const extraPenalty = Math.min(0.5, (Math.max(0, trimmed.length - expectedCount) / Math.max(expectedCount, 1)) * 1.0);
      const orderPenalty = orderIssue ? 0.85 : 1;
      const reversalPenalty = Math.max(0.7, 1 - 0.1 * reversals.length);
      const score = clamp01(
        (quality * (1 - extraPenalty) * orderPenalty * reversalPenalty + (overLimit ? -0.3 : 0)),
      );

      // ---- correctness gates
      const failed: string[] = [];
      if (missing.length > 0) failed.push(`${missing.length} missing stroke(s)`);
      if (extras.length > gates.extra || overLimit) failed.push('extra strokes');
      if (reversals.length > gates.reversals) failed.push('stroke direction');
      if (orderIssue && gates.orderEnforced) failed.push('stroke order');
      if (minSim < gates.minSim && pairs.length) failed.push('poor stroke shape');
      if (meanSim < gates.meanSim) failed.push('overall mismatch');
      const correct = failed.length === 0;

      // ---- primary feedback
      const feedback = buildFeedback({ correct, issues, pairs, expectedStrokes, strictness, reversals, orderIssue });

      // ---- hint target: first stroke needing attention
      const firstMissing = missing[0];
      const firstReversal = reversals[0]?.ej;
      const worst = weak[0]?.ej;
      const hintTarget =
        firstMissing !== undefined
          ? firstMissing + 1
          : firstReversal !== undefined
            ? firstReversal + 1
            : orderIssue
              ? orderIssue.first + 1
              : !correct && worst !== undefined
                ? worst + 1
                : !correct
                  ? 1
                  : null;

      return {
        correct,
        score,
        strokeResults,
        issues,
        feedback,
        hintTarget,
        strokeCount: { expected: expectedCount, drawn: strokes.length },
        fallback: false,
      };
    },
  };
}

function centroidOf(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function describeShift(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) > 0.07 * BOX) parts.push(dx > 0 ? 'further left' : 'further right');
  if (Math.abs(dy) > 0.07 * BOX) parts.push(dy > 0 ? 'higher up' : 'lower down');
  if (!parts.length) return 'in a slightly different spot';
  return parts.join(' and ');
}

function buildFeedback(args: {
  correct: boolean;
  issues: StrokeIssue[];
  pairs: { ui: number; ej: number; metrics: PairMetrics }[];
  expectedStrokes: Point[][];
  strictness: Strictness;
  reversals: { ej: number }[];
  orderIssue: { first: number; second: number } | null;
}): string {
  const { correct, issues, pairs, expectedStrokes, reversals, orderIssue, strictness } = args;
  if (correct) {
    const notes: string[] = [];
    if (orderIssue) notes.push(`stroke order: try ${orderIssue.first + 1} before ${orderIssue.second + 1}`);
    if (reversals.length) notes.push(`stroke ${reversals[0].ej + 1} was drawn backwards`);
    if (notes.length && strictness === 'lenient') {
      return `Close enough — watch ${notes.join(', and ')}.`;
    }
    if (pairs.length > 2) return 'Good — stroke order and shape look right.';
    return 'Looks right.';
  }

  const byKind = (kind: StrokeIssue['kind']) => issues.find((i) => i.kind === kind);
  const primary =
    byKind('order') ??
    byKind('missing') ??
    byKind('direction') ??
    byKind('position') ??
    byKind('shape') ??
    byKind('extra') ??
    issues[0];
  if (primary) return primary.message;
  const worst = [...pairs].sort((a, b) => a.metrics.sim - b.metrics.sim)[0];
  if (worst) return `Stroke ${worst.ej + 1} doesn't look right yet.`;
  return `Check the ${expectedStrokes.length}-stroke shape again.`;
}

/** Convenience evaluator instance factory (one per strictness level). */
const cache = new Map<Strictness, HanziWritingEvaluator>();
export function getEvaluator(strictness: Strictness): HanziWritingEvaluator {
  let ev = cache.get(strictness);
  if (!ev) {
    ev = createHanziEvaluator(strictness);
    cache.set(strictness, ev);
  }
  return ev;
}
