import type { Point, StrokeData, UserStroke } from '../../types';
import { BOX, allPoints, bboxOf, clamp, resample } from './geometry';
import { loadStrokeData } from './strokeDataSource';

/**
 * Dictation-mode suggestions: given what the user drew, surface the zi that
 * look most like it, so the user can pick the one they meant.
 *
 * The recognizer works in a normalized character coordinate system: the
 * drawing is cropped to its bounding box and fitted onto each candidate's
 * box (position, size, and proportions are free), then candidates are ranked
 * by four independent signals:
 *
 *   Shape      — whole-character silhouette (rasterized distance transform)
 *   Structure  — stroke count, direction histogram, spatial relations,
 *                relative stroke lengths, stroke order (soft)
 *   Stroke     — order-free greedy per-stroke shape matching with partial
 *                credit for near-misses (no hard rejection on stroke count)
 *   Position   — where strokes sit relative to each other (centroids,
 *                start/end regions)
 *
 * Stroke order and exact coordinates are hints, never requirements.
 */

export interface CharCandidate {
  char: string;
  /** 0..1 similarity of the drawing to this character. */
  score: number;
}

export interface ScoreBreakdown {
  shape: number;
  structure: number;
  stroke: number;
  position: number;
  overall: number;
}

export interface SuggestionResult {
  /** Ranked most similar first; empty when nothing could be compared. */
  suggestions: CharCandidate[];
  /** How many candidates were scored. */
  poolSize: number;
}

export type StrokeLoader = (char: string) => Promise<StrokeData | null>;

const SUGGESTION_COUNT = 8;
/** Candidates below this overall score are not shown at all. */
const MIN_SCORE = 0.32;
/** Session-queue characters considered alongside the drawing. */
const CONTEXT_CAP = 8;
/** Stage-1 finalists that get the full (expensive) scoring pass. */
const STAGE1_TOP = 60;
const MAX_USER_STROKES = 40;
const SAMPLES = 16;
/** Chamfer distance (fraction of the box) at which shape similarity hits 0. */
const SHAPE_NORM = 0.22;

/** Component weights of the overall score. */
const W_SHAPE = 0.3;
const W_STRUCTURE = 0.25;
const W_STROKE = 0.3;
const W_POSITION = 0.15;

/** Silhouette raster. */
const GRID = 40;
const SIL_SIGMA = 2.2;
/** Silhouette direction weights: user ink must sit near the template (fwd). */
const SIL_USER_W = 0.75;
const SIL_CHAR_W = 0.25;
/** Chamfer direction weights: tolerate unfinished/prefix strokes. */
const CHAM_USER_W = 1;
const CHAM_CHAR_W = 0.5;
/** Stroke-position similarity decay (fraction of the box). */
const POS_SIGMA = 0.15;

const clamp01 = (v: number) => clamp(v, 0, 1);

/* ------------------------------------------------------------------ */
/* debug                                                              */
/* ------------------------------------------------------------------ */

let debugEnabled = false;

/** Dev aid: log normalized drawing + per-component scores on suggest. */
export function setSuggestionDebug(on: boolean): void {
  debugEnabled = on;
}

if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  try {
    if (new URLSearchParams(location.search).has('hsdebug')) debugEnabled = true;
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* offline pool                                                       */
/* ------------------------------------------------------------------ */

let bundlePromise: Promise<Record<string, StrokeData>> | null = null;

function offlineBundle(): Promise<Record<string, StrokeData>> {
  if (!bundlePromise) {
    bundlePromise = import('../../data/strokes/common.json')
      .then((m) => m.default as unknown as Record<string, StrokeData>)
      .catch(() =>
        import('../../data/strokes/hsk-1.json')
          .then((m) => m.default as unknown as Record<string, StrokeData>)
          .catch(() => ({})),
      );
  }
  return bundlePromise;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Nearest-neighbour (Chamfer) distance between two resampled polylines in
 * box units, tolerant to strokes that are shorter/longer, shifted along
 * their own axis, differently curved, or sampled differently.
 *
 * Weighted asymmetrically: points of `a` (the user's drawing) must lie near
 * `b` (the template), while template coverage of the user's stroke is
 * weighted less — so an unfinished/prefix stroke still counts as a match.
 */
function chamferDistance(a: Point[], b: Point[]): number {
  let fwd = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) best = d;
    }
    fwd += Math.sqrt(best);
  }
  let bwd = 0;
  for (const q of b) {
    let best = Infinity;
    for (const p of a) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) best = d;
    }
    bwd += Math.sqrt(best);
  }
  return (CHAM_USER_W * fwd + CHAM_CHAR_W * bwd) / (CHAM_USER_W * a.length + CHAM_CHAR_W * b.length);
}

/** End-to-end direction cosine; |·| so a stroke drawn backwards still counts. */
function directionCos(a: Point[], b: Point[]): number {
  const adx = a[a.length - 1].x - a[0].x;
  const ady = a[a.length - 1].y - a[0].y;
  const bdx = b[b.length - 1].x - b[0].x;
  const bdy = b[b.length - 1].y - b[0].y;
  const an = Math.hypot(adx, ady);
  const bn = Math.hypot(bdx, bdy);
  if (an < 1e-6 || bn < 1e-6) return 1;
  return Math.abs(clamp((adx * bdx + ady * bdy) / (an * bn), -1, 1));
}

function strokeLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Do two polylines intersect anywhere? */
function polylinesCross(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/* ------------------------------------------------------------------ */
/* normalized structure features                                      */
/* ------------------------------------------------------------------ */

/**
 * Length-weighted direction histogram over 4 axes (horizontal, two
 * diagonals, vertical). Soft bin assignment + axis space (period π) makes it
 * invariant to stroke reversal and robust to angle jitter.
 */
function directionHistogram(strokes: Point[][]): number[] {
  const h = [0, 0, 0, 0];
  for (const s of strokes) {
    if (s.length < 2) continue;
    const dx = s[s.length - 1].x - s[0].x;
    const dy = s[s.length - 1].y - s[0].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI;
    const pos = a / (Math.PI / 4); // 0..4, wraps at 4
    const k = Math.floor(pos) % 4;
    const t = pos - Math.floor(pos);
    h[k] += len * (1 - t);
    h[(k + 1) % 4] += len * t;
  }
  const sum = h[0] + h[1] + h[2] + h[3];
  if (sum < 1e-6) return [0.25, 0.25, 0.25, 0.25];
  return h.map((v) => v / sum);
}

function histogramSim(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff += Math.abs(a[i] - b[i]);
  return clamp01(1 - diff / 2);
}

/**
 * Aggregate spatial relations over stroke pairs:
 * crossing, bbox overlap, vertically stacked (same x), horizontally aligned
 * (same y). Captures "A above B", "C crosses D" without exact coordinates.
 */
function spatialRelations(strokes: Point[][], boxW: number, boxH: number): number[] {
  const n = strokes.length;
  if (n < 2) return [0, 0, 1, 1];
  let cross = 0;
  let overlap = 0;
  let valign = 0;
  let halign = 0;
  let pairs = 0;
  const bounds = strokes.map((s) => bboxOf(s));
  const cents = strokes.map((s) => centroid(s));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      pairs += 1;
      if (polylinesCross(strokes[i], strokes[j])) cross += 1;
      const bi = bounds[i];
      const bj = bounds[j];
      if (bi.x < bj.x + bj.w && bj.x < bi.x + bi.w && bi.y < bj.y + bj.h && bj.y < bi.y + bi.h) {
        overlap += 1;
      }
      if (Math.abs(cents[i].x - cents[j].x) < 0.18 * boxW) valign += 1;
      if (Math.abs(cents[i].y - cents[j].y) < 0.18 * boxH) halign += 1;
    }
  }
  return [cross / pairs, overlap / pairs, valign / pairs, halign / pairs];
}

function relationsSim(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff += Math.abs(a[i] - b[i]);
  return clamp01(1 - diff / a.length);
}

/** Relative stroke lengths, longest first (padded), scale-invariant. */
function lengthProfile(strokes: Point[][]): number[] {
  const lens = strokes.map((s) => strokeLength(s)).sort((a, b) => b - a);
  const total = lens.reduce((a, b) => a + b, 0);
  if (total < 1e-6) return [1];
  return lens.map((l) => l / total);
}

function profileSim(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < n; i += 1) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return clamp01(1 - diff / n);
}

/* ------------------------------------------------------------------ */
/* silhouette raster                                                  */
/* ------------------------------------------------------------------ */

function rasterize(strokes: Point[][], b: { x: number; y: number; w: number; h: number }): Uint8Array {
  const mask = new Uint8Array(GRID * GRID);
  const w = Math.max(b.w, 1e-6);
  const h = Math.max(b.h, 1e-6);
  const step = Math.max(w, h) / (GRID * 1.5);
  const put = (x: number, y: number) => {
    const cx = clamp(Math.floor(((x - b.x) / w) * (GRID - 1)), 0, GRID - 1);
    const cy = clamp(Math.floor(((y - b.y) / h) * (GRID - 1)), 0, GRID - 1);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) mask[ny * GRID + nx] = 1;
      }
    }
  };
  for (const s of strokes) {
    if (s.length === 1) {
      put(s[0].x, s[0].y);
      continue;
    }
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1];
      const c = s[i];
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      const n = Math.max(1, Math.ceil(d / Math.max(step, 1e-6)));
      for (let k = 0; k <= n; k += 1) {
        put(a.x + ((c.x - a.x) * k) / n, a.y + ((c.y - a.y) * k) / n);
      }
    }
  }
  return mask;
}

/** Two-pass chamfer distance transform, in cells. */
function distanceTransform(mask: Uint8Array): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(GRID * GRID);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const i = y * GRID + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 3);
      if (y > 0) d[i] = Math.min(d[i], d[i - GRID] + 3);
      if (x > 0 && y > 0) d[i] = Math.min(d[i], d[i - GRID - 1] + 4);
      if (x < GRID - 1 && y > 0) d[i] = Math.min(d[i], d[i - GRID + 1] + 4);
    }
  }
  for (let y = GRID - 1; y >= 0; y -= 1) {
    for (let x = GRID - 1; x >= 0; x -= 1) {
      const i = y * GRID + x;
      if (x < GRID - 1) d[i] = Math.min(d[i], d[i + 1] + 3);
      if (y < GRID - 1) d[i] = Math.min(d[i], d[i + GRID] + 3);
      if (x < GRID - 1 && y < GRID - 1) d[i] = Math.min(d[i], d[i + GRID + 1] + 4);
      if (x > 0 && y < GRID - 1) d[i] = Math.min(d[i], d[i + GRID - 1] + 4);
    }
  }
  for (let i = 0; i < d.length; i += 1) d[i] = d[i] / 3;
  return d;
}

/** exp(-d/σ) lookup by quarter-cell distance (avoids Math.exp in hot loops). */
const EXP_LUT_LEN = 64;
const EXP_LUT = new Float64Array(EXP_LUT_LEN + 1);
for (let k = 0; k <= EXP_LUT_LEN; k += 1) EXP_LUT[k] = Math.exp(-k / 4 / SIL_SIGMA);
const OOB_CELL_D = 16;
const lut = (d: number) => EXP_LUT[Math.min(EXP_LUT_LEN, Math.round(d * 4))];

function occupiedCells(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) out.push(i);
  return out;
}

/** Forward-only silhouette if the user mask were shifted by (dx, dy) cells. */
function shiftedFwd(uOcc: number[], eDT: Float32Array, dx: number, dy: number): number {
  let sum = 0;
  for (let k = 0; k < uOcc.length; k += 1) {
    const i = uOcc[k];
    const x = (i % GRID) + dx;
    const y = ((i / GRID) | 0) + dy;
    sum += lut(x >= 0 && x < GRID && y >= 0 && y < GRID ? eDT[y * GRID + x] : OOB_CELL_D);
  }
  return uOcc.length ? sum / uOcc.length : 0;
}

/** Symmetric silhouette if the user mask were shifted by (dx, dy) cells. */
function shiftedSil(
  uOcc: number[],
  uDT: Float32Array,
  eOcc: number[],
  eDT: Float32Array,
  dx: number,
  dy: number,
): number {
  if (!uOcc.length || !eOcc.length) return 0;
  let fwd = 0;
  for (let k = 0; k < uOcc.length; k += 1) {
    const i = uOcc[k];
    const x = (i % GRID) + dx;
    const y = ((i / GRID) | 0) + dy;
    fwd += lut(x >= 0 && x < GRID && y >= 0 && y < GRID ? eDT[y * GRID + x] : OOB_CELL_D);
  }
  let bwd = 0;
  for (let k = 0; k < eOcc.length; k += 1) {
    const i = eOcc[k];
    const x = (i % GRID) - dx;
    const y = ((i / GRID) | 0) - dy;
    bwd += lut(x >= 0 && x < GRID && y >= 0 && y < GRID ? uDT[y * GRID + x] : OOB_CELL_D);
  }
  return (SIL_USER_W * (fwd / uOcc.length) + SIL_CHAR_W * (bwd / eOcc.length)) / (SIL_USER_W + SIL_CHAR_W);
}

/**
 * Best score over small translations: coarse step-2 grid on [-4, 4] cells,
 * then a ±1 refinement around the winner. Truncated/shifted drawings are
 * misaligned after bbox fitting; this lets the comparison snap into place.
 */
function searchShifts(evalAt: (dx: number, dy: number) => number): {
  score: number;
  dx: number;
  dy: number;
} {
  let score = -1;
  let dx = 0;
  let dy = 0;
  for (let sx = -4; sx <= 4; sx += 2) {
    for (let sy = -4; sy <= 4; sy += 2) {
      const s = evalAt(sx, sy);
      if (s > score) {
        score = s;
        dx = sx;
        dy = sy;
      }
    }
  }
  for (let sx = dx - 1; sx <= dx + 1; sx += 1) {
    for (let sy = dy - 1; sy <= dy + 1; sy += 1) {
      const s = evalAt(sx, sy);
      if (s > score) {
        score = s;
        dx = sx;
        dy = sy;
      }
    }
  }
  return { score, dx, dy };
}

/* ------------------------------------------------------------------ */
/* per-candidate features (cached)                                    */
/* ------------------------------------------------------------------ */

interface CharFeatures {
  strokes: Point[][];
  resampled: Point[][];
  bounds: { x: number; y: number; w: number; h: number; cx: number; cy: number };
  /** Center of mass — drifts less than the bbox when stroke ends vanish. */
  com: Point;
  dirHist: number[];
  relations: number[];
  lengths: number[];
  mask: Uint8Array;
  dt: Float32Array;
  /** Indices of occupied mask cells — hot loops iterate only these. */
  occupied: number[];
}

const featureCache = new WeakMap<StrokeData, CharFeatures>();

function meanPoint(pts: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}

function charFeatures(data: StrokeData): CharFeatures {
  const cached = featureCache.get(data);
  if (cached) return cached;
  const strokes: Point[][] = data.medians.map((m) => m.map(([x, y]) => ({ x, y })));
  const resampled = strokes.map((s) => resample(s, SAMPLES));
  const bounds = bboxOf(allPoints(strokes));
  const feats: CharFeatures = {
    strokes,
    resampled,
    bounds,
    com: meanPoint(allPoints(strokes)),
    dirHist: directionHistogram(resampled),
    relations: spatialRelations(resampled, Math.max(bounds.w, 1e-6), Math.max(bounds.h, 1e-6)),
    lengths: lengthProfile(resampled),
    mask: rasterize(strokes, bounds),
    dt: new Float32Array(0),
    occupied: [],
  };
  feats.dt = distanceTransform(feats.mask);
  feats.occupied = occupiedCells(feats.mask);
  featureCache.set(data, feats);
  return feats;
}

/* ------------------------------------------------------------------ */
/* similarity of one drawing against one character                    */
/* ------------------------------------------------------------------ */

/**
 * Fit the drawing onto the candidate's box: any position, any size, any
 * proportions work. Hypotheses vary the scale (independent x/y aspect fit,
 * uniform cover/contain) and the anchor (bbox center vs center of mass —
 * the COM drifts less when stroke ends are missing). The hypothesis whose
 * silhouette matches best wins.
 */
interface Fit {
  sx: number;
  sy: number;
  com: boolean;
}

function alignmentHypotheses(
  uBounds: { w: number; h: number },
  eBounds: { w: number; h: number },
): Fit[] {
  const uMax = Math.max(uBounds.w, uBounds.h);
  const eMax = Math.max(eBounds.w, eBounds.h);
  const usable = (w: number, h: number, max: number) => w > 0.1 * max && h > 0.1 * max;
  const bothUsable = usable(uBounds.w, uBounds.h, uMax) && usable(eBounds.w, eBounds.h, eMax);
  const scales: { sx: number; sy: number }[] = [];
  if (bothUsable) {
    scales.push({
      sx: clamp(eBounds.w / Math.max(uBounds.w, 1e-6), 0.2, 5),
      sy: clamp(eBounds.h / Math.max(uBounds.h, 1e-6), 0.2, 5),
    });
  }
  const cover = clamp(eMax / Math.max(uMax, 1e-6), 0.25, 4);
  scales.push({ sx: cover, sy: cover });
  if (bothUsable) {
    const contain = clamp(
      Math.min(eBounds.w / Math.max(uBounds.w, 1e-6), eBounds.h / Math.max(uBounds.h, 1e-6)),
      0.2,
      5,
    );
    scales.push({ sx: contain, sy: contain });
  }
  return scales.flatMap((s) => [{ ...s, com: false }, { ...s, com: true }]);
}

function applyFit(
  raw: Point[][],
  u: { cx: number; cy: number; com: Point },
  e: { cx: number; cy: number; com: Point },
  fit: Fit,
): Point[][] {
  const uc = fit.com ? u.com : { x: u.cx, y: u.cy };
  const ec = fit.com ? e.com : { x: e.cx, y: e.cy };
  return raw.map((stroke) =>
    stroke.map((p) => ({
      x: (p.x - uc.x) * fit.sx + ec.x,
      y: (p.y - uc.y) * fit.sy + ec.y,
    })),
  );
}

/** Shape+direction similarity of one stroke pair (resampled, box space). */
function strokeSim(u: Point[], e: Point[]): number {
  const shapeSim = clamp01(1 - chamferDistance(u, e) / BOX / SHAPE_NORM);
  if (shapeSim <= 0) return 0;
  const dirSim = clamp01((directionCos(u, e) + 0.35) / 1.35);
  return shapeSim * (0.65 + 0.35 * dirSim);
}

/**
 * Score the drawing against one character; returns every component so the
 * ranking can be inspected (`explainSimilarity`).
 */
export function explainSimilarity(strokes: UserStroke[], data: StrokeData): ScoreBreakdown {
  const empty: ScoreBreakdown = { shape: 0, structure: 0, stroke: 0, position: 0, overall: 0 };
  const user = strokes.slice(0, MAX_USER_STROKES);
  if (!user.length || !data.medians?.length) return empty;

  const feats = charFeatures(data);
  const raw = user.map((s) => s.points.map((p) => ({ x: p.x * BOX, y: p.y * BOX })));
  const uAll = allPoints(raw);
  const uBounds = bboxOf(uAll);
  if (Math.max(uBounds.w, uBounds.h) < 1e-6 || Math.max(feats.bounds.w, feats.bounds.h) < 1e-6) {
    return empty;
  }
  const uAnchor = { cx: uBounds.cx, cy: uBounds.cy, com: meanPoint(uAll) };
  const eAnchor = { cx: feats.bounds.cx, cy: feats.bounds.cy, com: feats.com };

  /* ---- Select the two most plausible alignments (fwd-only, cheap) ---- */
  const cands = alignmentHypotheses(uBounds, feats.bounds).map((fit) => {
    const cand = applyFit(raw, uAnchor, eAnchor, fit);
    const mask = rasterize(cand, feats.bounds);
    // Selection uses only "is user ink near template ink?" (no user-side
    // distance transform) plus a small translation search; the finalists
    // get the full symmetric score.
    return { cand, mask, occ: occupiedCells(mask), sel: 0 };
  });
  for (const c of cands) {
    c.sel = searchShifts((dx, dy) => shiftedFwd(c.occ, feats.dt, dx, dy)).score;
  }
  cands.sort((a, b) => b.sel - a.sel);
  // Fully evaluate the two most plausible alignments and keep the better
  // overall: silhouette alone can prefer a dense look-alike whose strokes
  // (count, direction, position) don't actually line up.
  const top = cands.slice(0, 2);
  let best = scoreAligned(top[0], feats);
  if (top.length > 1 && top[1].sel >= top[0].sel - 0.08) {
    const alt = scoreAligned(top[1], feats);
    if (alt.overall > best.overall) best = alt;
  }
  return best;
}

function scoreAligned(
  cand: { cand: Point[][]; mask: Uint8Array; occ: number[] },
  feats: CharFeatures,
): ScoreBreakdown {
  const uDT = distanceTransform(cand.mask);
  const sil = searchShifts((dx, dy) =>
    shiftedSil(cand.occ, uDT, feats.occupied, feats.dt, dx, dy),
  );
  const shape = sil.score;
  let strokes = cand.cand;
  if (sil.dx !== 0 || sil.dy !== 0) {
    const tx = (sil.dx * feats.bounds.w) / (GRID - 1);
    const ty = (sil.dy * feats.bounds.h) / (GRID - 1);
    strokes = strokes.map((s) => s.map((p) => ({ x: p.x + tx, y: p.y + ty })));
  }
  const userRes = strokes.map((s) => resample(s, SAMPLES));

  /* ---- Structure ---- */
  const countSim = Math.exp(-0.55 * Math.abs(userRes.length - feats.resampled.length));
  const dirSimH = histogramSim(directionHistogram(userRes), feats.dirHist);
  const relSim = relationsSim(
    spatialRelations(userRes, Math.max(feats.bounds.w, 1e-6), Math.max(feats.bounds.h, 1e-6)),
    feats.relations,
  );
  const lenSim = profileSim(lengthProfile(userRes), feats.lengths);
  const orderSim =
    userRes.length === feats.resampled.length
      ? userRes.reduce((acc, s, i) => acc + strokeSim(s, feats.resampled[i]), 0) / userRes.length
      : 0.5;
  const structure = clamp01(
    0.3 * countSim + 0.25 * dirSimH + 0.2 * relSim + 0.15 * lenSim + 0.1 * orderSim,
  );

  /* ---- Stroke: greedy matching with partial credit everywhere ---- */
  const sims: number[][] = userRes.map((u) => feats.resampled.map((e) => strokeSim(u, e)));
  // Greedy strong pairs.
  const pairs: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < sims.length; i += 1) {
    for (let j = 0; j < sims[i].length; j += 1) {
      if (sims[i][j] >= 0.4) pairs.push({ i, j, sim: sims[i][j] });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);
  const usedU = new Set<number>();
  const usedE = new Set<number>();
  const strong: number[] = [];
  for (const p of pairs) {
    if (usedU.has(p.i) || usedE.has(p.j)) continue;
    usedU.add(p.i);
    usedE.add(p.j);
    strong.push(p.sim);
  }
  // Soft credit: every candidate stroke's best look-alike, and vice versa —
  // a skipped/merged/short stroke lowers the score but never zeroes it.
  let covSum = 0;
  for (let j = 0; j < feats.resampled.length; j += 1) {
    let best = 0;
    for (let i = 0; i < userRes.length; i += 1) best = Math.max(best, sims[i][j]);
    covSum += best;
  }
  let matchSum = 0;
  for (let i = 0; i < userRes.length; i += 1) {
    let best = 0;
    for (let j = 0; j < feats.resampled.length; j += 1) best = Math.max(best, sims[i][j]);
    matchSum += best;
  }
  const softCov = feats.resampled.length ? covSum / feats.resampled.length : 0;
  const softMatch = userRes.length ? matchSum / userRes.length : 0;
  const strongTerm = strong.length
    ? (strong.reduce((a, b) => a + b, 0) / strong.length) *
      (0.5 + (0.5 * strong.length) / feats.resampled.length)
    : 0;
  const stroke = clamp01(0.35 * softCov + 0.3 * softMatch + 0.35 * strongTerm);

  /* ---- Position: where strokes sit (centroids + start/end regions) ---- */
  const sigma = POS_SIGMA * BOX;
  const uCent = userRes.map((s) => centroid(s));
  const eCent = feats.resampled.map((s) => centroid(s));
  const posPair = (i: number, j: number): number => {
    const a = userRes[i];
    const b = feats.resampled[j];
    const dC = Math.hypot(uCent[i].x - eCent[j].x, uCent[i].y - eCent[j].y);
    const dS = Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y);
    const dE = Math.hypot(a[a.length - 1].x - b[b.length - 1].x, a[a.length - 1].y - b[b.length - 1].y);
    return 0.5 * Math.exp(-dC / sigma) + 0.25 * Math.exp(-dS / sigma) + 0.25 * Math.exp(-dE / sigma);
  };
  let pCov = 0;
  for (let j = 0; j < feats.resampled.length; j += 1) {
    let best = 0;
    for (let i = 0; i < userRes.length; i += 1) best = Math.max(best, posPair(i, j));
    pCov += best;
  }
  let pMatch = 0;
  for (let i = 0; i < userRes.length; i += 1) {
    let best = 0;
    for (let j = 0; j < feats.resampled.length; j += 1) best = Math.max(best, posPair(i, j));
    pMatch += best;
  }
  const position = clamp01(
    0.5 * (feats.resampled.length ? pCov / feats.resampled.length : 0) +
      0.5 * (userRes.length ? pMatch / userRes.length : 0),
  );

  const overall = clamp01(W_SHAPE * shape + W_STRUCTURE * structure + W_STROKE * stroke + W_POSITION * position);
  return { shape, structure, stroke, position, overall };
}

/** How much the drawing looks like `data`'s character (0..1). */
export function drawingSimilarity(strokes: UserStroke[], data: StrokeData): number {
  return explainSimilarity(strokes, data).overall;
}

/* ------------------------------------------------------------------ */
/* debug rendering                                                    */
/* ------------------------------------------------------------------ */

function asciiDrawing(strokes: UserStroke[], size = 17): string[] {
  const raw = strokes.map((s) => s.points.map((p) => ({ x: p.x * BOX, y: p.y * BOX })));
  const b = bboxOf(allPoints(raw));
  const w = Math.max(b.w, 1e-6);
  const h = Math.max(b.h, 1e-6);
  const mask: string[][] = Array.from({ length: size }, () => Array<string>(size).fill('.'));
  const put = (x: number, y: number) => {
    const cx = clamp(Math.floor(((x - b.x) / w) * (size - 1)), 0, size - 1);
    const cy = clamp(Math.floor(((y - b.y) / h) * (size - 1)), 0, size - 1);
    mask[cy][cx] = '#';
  };
  for (const s of raw) {
    for (let i = 1; i < s.length; i += 1) {
      const d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
      const n = Math.max(1, Math.ceil(d / Math.max(w, h) / (size * 1.2)));
      for (let k = 0; k <= n; k += 1) {
        put(s[i - 1].x + ((s[i].x - s[i - 1].x) * k) / n, s[i - 1].y + ((s[i].y - s[i - 1].y) * k) / n);
      }
    }
    put(s[0].x, s[0].y);
  }
  return mask.map((row) => row.join(''));
}

function logDebug(
  strokes: UserStroke[],
  ranked: { char: string; breakdown: ScoreBreakdown }[],
): void {
  console.group('[handwriting] suggestion debug');
  console.log(`user strokes: ${strokes.length} (normalized to its own bounds)`);
  for (const row of asciiDrawing(strokes)) console.log('  ' + row);
  const lines = ranked.slice(0, 10).map(
    (r, i) =>
      `${String(i + 1).padStart(2)}. ${r.char}  overall ${r.breakdown.overall.toFixed(2)}` +
      ` | shape ${r.breakdown.shape.toFixed(2)} structure ${r.breakdown.structure.toFixed(2)}` +
      ` stroke ${r.breakdown.stroke.toFixed(2)} position ${r.breakdown.position.toFixed(2)}`,
  );
  console.log(lines.join('\n'));
  console.groupEnd();
}

/* ------------------------------------------------------------------ */
/* ranking                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stage-1 score: cheap forward-only silhouette under two diverse fits
 * (aspect+bbox, cover+com). Ranking the whole pool with the full scorer
 * would cost several hundred ms; the finalists get `explainSimilarity`.
 */
function quickSel(
  raw: Point[][],
  uBounds: { w: number; h: number },
  uAnchor: { cx: number; cy: number; com: Point },
  feats: CharFeatures,
): number {
  const eB = feats.bounds;
  const cover = clamp(Math.max(eB.w, eB.h) / Math.max(Math.max(uBounds.w, uBounds.h), 1e-6), 0.25, 4);
  const fits: Fit[] = [
    {
      sx: clamp(eB.w / Math.max(uBounds.w, 1e-6), 0.2, 5),
      sy: clamp(eB.h / Math.max(uBounds.h, 1e-6), 0.2, 5),
      com: false,
    },
    { sx: cover, sy: cover, com: true },
  ];
  const eAnchor = { cx: eB.cx, cy: eB.cy, com: feats.com };
  let best = 0;
  for (const fit of fits) {
    const mask = rasterize(applyFit(raw, uAnchor, eAnchor, fit), eB);
    const occ = occupiedCells(mask);
    const s = searchShifts((dx, dy) => shiftedFwd(occ, feats.dt, dx, dy)).score;
    if (s > best) best = s;
  }
  return best;
}

async function loadMany(
  chars: string[],
  loader: StrokeLoader,
): Promise<Map<string, StrokeData | null>> {
  const map = new Map<string, StrokeData | null>();
  await Promise.all(
    chars.map(async (char) => {
      try {
        map.set(char, await loader(char));
      } catch {
        map.set(char, null);
      }
    }),
  );
  return map;
}

/**
 * Suggest the zi most similar to the drawing: the expected character, a few
 * session characters, and the best matches from the offline stroke bundle —
 * all ranked by `explainSimilarity`.
 */
export async function suggestSimilar(
  strokes: UserStroke[],
  expected: string,
  context: string[] = [],
  loader: StrokeLoader = loadStrokeData,
): Promise<SuggestionResult> {
  if (!strokes.length || !expected) return { suggestions: [], poolSize: 0 };

  const contextPool = [...new Set(context.filter((c) => c && c !== expected))].slice(
    0,
    CONTEXT_CAP,
  );
  const [loaded, bundle] = await Promise.all([loadMany([expected, ...contextPool], loader), offlineBundle()]);

  const pool = new Map<string, StrokeData>();
  for (const [char, data] of loaded) {
    if (data?.medians?.length) pool.set(char, data);
  }
  for (const [char, data] of Object.entries(bundle)) {
    if (!pool.has(char) && data?.medians?.length) pool.set(char, data);
  }

  /* Stage 1: cheap ranking of the whole pool, stage 2: full scoring. */
  const user = strokes.slice(0, MAX_USER_STROKES);
  const raw = user.map((s) => s.points.map((p) => ({ x: p.x * BOX, y: p.y * BOX })));
  const uAll = allPoints(raw);
  const uBounds = bboxOf(uAll);
  const finalists: { char: string; data: StrokeData }[] = [];
  if (Math.max(uBounds.w, uBounds.h) >= 1e-6) {
    const uAnchor = { cx: uBounds.cx, cy: uBounds.cy, com: meanPoint(uAll) };
    const prelim = [...pool.entries()]
      .map(([char, data]) => ({ char, data, q: quickSel(raw, uBounds, uAnchor, charFeatures(data)) }))
      .sort((a, b) => b.q - a.q)
      .slice(0, STAGE1_TOP);
    const seen = new Set<string>();
    for (const p of [...prelim, ...[expected, ...contextPool].map((c) => ({ char: c, data: pool.get(c) }))]) {
      if (seen.has(p.char) || !p.data) continue;
      seen.add(p.char);
      finalists.push({ char: p.char, data: p.data });
    }
  } else {
    for (const [char, data] of pool) finalists.push({ char, data });
  }

  const scored: { char: string; score: number; breakdown: ScoreBreakdown }[] = [];
  for (const { char, data } of finalists) {
    const breakdown = explainSimilarity(strokes, data);
    if (breakdown.overall >= MIN_SCORE) scored.push({ char, score: breakdown.overall, breakdown });
  }
  scored.sort((a, b) => b.score - a.score || a.char.localeCompare(b.char));

  if (debugEnabled) {
    logDebug(strokes, scored.map((s) => ({ char: s.char, breakdown: s.breakdown })));
  }

  return {
    suggestions: scored.slice(0, SUGGESTION_COUNT).map(({ char, score }) => ({ char, score })),
    poolSize: pool.size,
  };
}
