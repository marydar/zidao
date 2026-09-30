import type { Point } from '../../types';

export const BOX = 1024;

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  return total;
}

/** Arc-length resampling to exactly n points (degenerate polylines repeat the point). */
export function resample(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }));
  const total = polylineLength(points);
  if (total < 1e-6) return Array.from({ length: n }, () => ({ ...points[0] }));

  const out: Point[] = [{ ...points[0] }];
  const step = total / (n - 1);
  let target = step;
  let traveled = 0;
  for (let i = 1; i < points.length && out.length < n; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a, b);
    if (seg < 1e-9) continue;
    while (out.length < n && target <= traveled + seg + 1e-9) {
      const t = clamp((target - traveled) / seg, 0, 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += step;
    }
    traveled += seg;
  }
  while (out.length < n) out.push({ ...points[points.length - 1] });
  return out;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export function bboxOf(points: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function allPoints(strokes: Point[][]): Point[] {
  const out: Point[] = [];
  for (const s of strokes) out.push(...s);
  return out;
}

export function meanDist(a: Point[], b: Point[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += dist(a[i], b[i]);
  return total / n;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Human-readable description of a stroke (used for hints and feedback). */
export function describeStroke(points: Point[]): string {
  if (points.length < 2) return 'dot stroke (点)';
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < polylineLength(points) * 0.35) {
    // The stroke folds back on itself or turns sharply.
    const turn = turnAngle(points);
    if (turn > 1.7) return 'turning stroke (折)';
    return 'dot stroke (点)';
  }
  const horizontal = Math.abs(dx) >= Math.abs(dy) * 1.6;
  const vertical = Math.abs(dy) >= Math.abs(dx) * 1.6;
  if (horizontal) return dx >= 0 ? 'horizontal stroke (横)' : 'horizontal stroke (横) — draw it left to right';
  if (vertical) return dy >= 0 ? 'vertical stroke (竖)' : 'vertical stroke (竖) — draw it top to bottom';
  if (dx > 0 && dy > 0) return 'right-falling stroke (捺)';
  if (dx < 0 && dy > 0) return 'left-falling stroke (撇)';
  if (dx > 0 && dy < 0) return 'rising stroke (提)';
  return 'upward stroke';
}

function turnAngle(points: Point[]): number {
  const quarter = Math.max(2, Math.floor(points.length / 4));
  const v1 = { x: points[quarter].x - points[0].x, y: points[quarter].y - points[0].y };
  const last = points.length - 1;
  const v2 = { x: points[last].x - points[last - quarter].x, y: points[last].y - points[last - quarter].y };
  const n1 = Math.hypot(v1.x, v1.y);
  const n2 = Math.hypot(v2.x, v2.y);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  const cos = clamp((v1.x * v2.x + v1.y * v2.y) / (n1 * n2), -1, 1);
  return Math.acos(cos);
}

/**
 * Minimal SVG path parser for Make-Me-a-Hanzi outlines (M / L / Q / C / Z),
 * returning closed polygons in the 1024 space.
 */
export function parseOutline(path: string): Point[][] {
  const tokens = path.match(/[MLQCZmlqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) return [];
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let pos: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let i = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLQCZmlqcz]/.test(t)) {
      cmd = t;
      i += 1;
    }
    switch (cmd) {
      case 'M':
      case 'm': {
        const x = num();
        const y = num();
        pos = cmd === 'm' ? { x: pos.x + x, y: pos.y + y } : { x, y };
        start = pos;
        if (current.length) polygons.push(current);
        current = [pos];
        cmd = cmd === 'M' ? 'L' : 'l';
        break;
      }
      case 'L':
      case 'l': {
        const x = num();
        const y = num();
        pos = cmd === 'l' ? { x: pos.x + x, y: pos.y + y } : { x, y };
        current.push(pos);
        break;
      }
      case 'Q':
      case 'q': {
        const cx = num();
        const cy = num();
        const x = num();
        const y = num();
        const c: Point = cmd === 'q' ? { x: pos.x + cx, y: pos.y + cy } : { x: cx, y: cy };
        const e: Point = cmd === 'q' ? { x: pos.x + x, y: pos.y + y } : { x, y };
        current.push(...quadToPoints(pos, c, e));
        pos = e;
        break;
      }
      case 'C':
      case 'c': {
        const c1x = num();
        const c1y = num();
        const c2x = num();
        const c2y = num();
        const x = num();
        const y = num();
        const c1: Point = cmd === 'c' ? { x: pos.x + c1x, y: pos.y + c1y } : { x: c1x, y: c1y };
        const c2: Point = cmd === 'c' ? { x: pos.x + c2x, y: pos.y + c2y } : { x: c2x, y: c2y };
        const e: Point = cmd === 'c' ? { x: pos.x + x, y: pos.y + y } : { x, y };
        current.push(...cubicToPoints(pos, c1, c2, e));
        pos = e;
        break;
      }
      case 'Z':
      case 'z': {
        current.push({ ...start });
        pos = start;
        i += 1;
        break;
      }
      default:
        i += 1;
    }
  }
  if (current.length) polygons.push(current);
  return polygons.filter((p) => p.length >= 3);
}

function quadToPoints(from: Point, control: Point, to: Point, steps = 8): Point[] {
  const out: Point[] = [];
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const mt = 1 - t;
    out.push({
      x: mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x,
      y: mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y,
    });
  }
  return out;
}

function cubicToPoints(from: Point, c1: Point, c2: Point, to: Point, steps = 10): Point[] {
  const out: Point[] = [];
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const mt = 1 - t;
    out.push({
      x: mt ** 3 * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * to.x,
      y: mt ** 3 * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * to.y,
    });
  }
  return out;
}
