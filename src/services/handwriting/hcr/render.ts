import type { UserStroke } from '../../../types';

/**
 * Rasterize the user's strokes into a gray bitmap shaped like a photo of
 * handwriting on paper: 255 = white background, 0 = black ink. The path is
 * built exactly like HandwritingCanvas draws it (quadratic midpoint
 * smoothing, round caps and joins) so what the model sees matches what the
 * user sees.
 *
 * Coordinates are the canvas-normalized 0..1 user points (y grows downward —
 * real input is upright and needs no flip).
 */

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Raster size before normalization; large enough that downscaling anti-aliases. */
export const RENDER_SIZE = 256;
/** Stroke diameter as a fraction of the canvas (best top-3 in eval sweep). */
export const STROKE_WIDTH_FRAC = 0.025;

/** Disc pixel offsets for a given radius, cached — radius is constant per config. */
const discCache = new Map<number, Array<[number, number]>>();
function discOffsets(r: number): Array<[number, number]> {
  const key = Math.round(r * 100);
  const hit = discCache.get(key);
  if (hit) return hit;
  const r2 = r * r;
  const out: Array<[number, number]> = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy += 1) {
    for (let dx = -ri; dx <= ri; dx += 1) {
      if (dx * dx + dy * dy <= r2) out.push([dx, dy]);
    }
  }
  discCache.set(key, out);
  return out;
}

export function renderStrokes(
  strokes: UserStroke[],
  size: number = RENDER_SIZE,
  strokeWidthFrac: number = STROKE_WIDTH_FRAC,
): GrayImage {
  const data = new Uint8Array(size * size).fill(255);
  const radius = Math.max(0.5, (strokeWidthFrac * size) / 2);
  const disc = discOffsets(radius);
  const stamp = (cx: number, cy: number) => {
    const bx = Math.round(cx);
    const by = Math.round(cy);
    for (let i = 0; i < disc.length; i += 1) {
      const x = bx + disc[i][0];
      const y = by + disc[i][1];
      if (x >= 0 && x < size && y >= 0 && y < size) data[y * size + x] = 0;
    }
  };
  const stroke = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const step = Math.max(0.5, radius * 0.75);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      stamp(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  };

  for (const s of strokes) {
    const pts = s.points;
    if (!pts.length) continue;
    const px = pts.map((p) => ({ x: p.x * size, y: p.y * size }));
    if (px.length === 1) {
      stamp(px[0].x, px[0].y);
      continue;
    }
    // Same path as the canvas: moveTo(first); quadratic midpoint smoothing;
    // lineTo(last). Sample each quadratic, then stroke the polyline.
    let cur = px[0];
    for (let i = 1; i < px.length - 1; i += 1) {
      const ctrl = px[i];
      const end = { x: (px[i].x + px[i + 1].x) / 2, y: (px[i].y + px[i + 1].y) / 2 };
      const approxLen = Math.hypot(ctrl.x - cur.x, ctrl.y - cur.y) + Math.hypot(end.x - ctrl.x, end.y - ctrl.y);
      const steps = Math.max(1, Math.ceil(approxLen));
      let prev = cur;
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps;
        const u = 1 - t;
        const p = {
          x: u * u * cur.x + 2 * u * t * ctrl.x + t * t * end.x,
          y: u * u * cur.y + 2 * u * t * ctrl.y + t * t * end.y,
        };
        stroke(prev.x, prev.y, p.x, p.y);
        prev = p;
      }
      cur = end;
    }
    const last = px[px.length - 1];
    stroke(cur.x, cur.y, last.x, last.y);
  }

  return { data, width: size, height: size };
}
