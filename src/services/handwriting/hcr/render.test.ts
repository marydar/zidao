import { describe, expect, it } from 'vitest';
import type { UserStroke } from '../../../types';
import { CANVAS_SIZE, FG_THRESHOLD, normalizeToCanvas } from './normalize';
import { RENDER_SIZE, renderStrokes } from './render';

function inkCount(data: Uint8Array): number {
  let n = 0;
  for (const v of data) if (v < FG_THRESHOLD) n += 1;
  return n;
}

const line = (x1: number, y1: number, x2: number, y2: number, n = 12): UserStroke => ({
  points: Array.from({ length: n }, (_, i) => ({
    x: x1 + ((x2 - x1) * i) / (n - 1),
    y: y1 + ((y2 - y1) * i) / (n - 1),
  })),
});

describe('renderStrokes', () => {
  it('is deterministic', () => {
    const strokes = [line(0.2, 0.2, 0.8, 0.7), line(0.5, 0.1, 0.5, 0.9)];
    const a = renderStrokes(strokes);
    const b = renderStrokes(strokes);
    expect(a.width).toBe(RENDER_SIZE);
    expect([...a.data]).toEqual([...b.data]);
  });

  it('stamps a dot for a single-point stroke at that location', () => {
    const img = renderStrokes([{ points: [{ x: 0.25, y: 0.75 }] }]);
    const cx = Math.round(0.25 * RENDER_SIZE);
    const cy = Math.round(0.75 * RENDER_SIZE);
    expect(img.data[cy * RENDER_SIZE + cx]).toBe(0);
    // and ink is confined near the dot
    expect(inkCount(img.data)).toBeGreaterThan(5);
    expect(inkCount(img.data)).toBeLessThan(300);
  });

  it('connects multi-point strokes without gaps', () => {
    const img = renderStrokes([line(0.1, 0.5, 0.9, 0.5)]);
    // walk along the line: every sampled pixel must be ink
    let missing = 0;
    for (let x = Math.round(0.1 * RENDER_SIZE); x <= Math.round(0.9 * RENDER_SIZE); x += 1) {
      const y = Math.round(0.5 * RENDER_SIZE);
      if (img.data[y * RENDER_SIZE + x] >= FG_THRESHOLD) missing += 1;
    }
    expect(missing).toBe(0);
  });

  it('handles degenerate and out-of-bounds input without throwing', () => {
    expect(() => renderStrokes([])).not.toThrow();
    expect(() =>
      renderStrokes([
        { points: [{ x: -0.5, y: -0.5 }, { x: 1.5, y: 1.5 }] },
        { points: [] },
        { points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }] },
      ]),
    ).not.toThrow();
    expect(inkCount(renderStrokes([{ points: [] }]).data)).toBe(0);
  });

  it('keeps orientation upright: mass at the top stays at the top', () => {
    // Wide horizontal bar near the top + a small dot near the bottom.
    const img = renderStrokes([line(0.15, 0.1, 0.85, 0.1), { points: [{ x: 0.5, y: 0.9 }] }]);
    const canvas = normalizeToCanvas(img.data, img.width, img.height);
    let top = 0;
    let bottom = 0;
    for (let y = 0; y < CANVAS_SIZE / 3; y += 1) {
      for (let x = 0; x < CANVAS_SIZE; x += 1) if (canvas[y * CANVAS_SIZE + x] < FG_THRESHOLD) top += 1;
    }
    for (let y = Math.ceil((CANVAS_SIZE * 2) / 3); y < CANVAS_SIZE; y += 1) {
      for (let x = 0; x < CANVAS_SIZE; x += 1) if (canvas[y * CANVAS_SIZE + x] < FG_THRESHOLD) bottom += 1;
    }
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    // the wide bar dominates the top third; a flipped render would fail this
    expect(top).toBeGreaterThan(bottom * 2);
  });

  it('feeds the normalizer a paper-like image that centers the drawing', () => {
    const img = renderStrokes([line(0.1, 0.1, 0.9, 0.9)]);
    const canvas = normalizeToCanvas(img.data, img.width, img.height);
    let x0 = CANVAS_SIZE;
    let x1 = -1;
    let y0 = CANVAS_SIZE;
    let y1 = -1;
    for (let y = 0; y < CANVAS_SIZE; y += 1) {
      for (let x = 0; x < CANVAS_SIZE; x += 1) {
        if (canvas[y * CANVAS_SIZE + x] < FG_THRESHOLD) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    expect(x1 - x0 + 1).toBeLessThanOrEqual(56);
    expect(y1 - y0 + 1).toBeLessThanOrEqual(56);
    expect(Math.abs((x0 + x1 + 1) / 2 - CANVAS_SIZE / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((y0 + y1 + 1) / 2 - CANVAS_SIZE / 2)).toBeLessThanOrEqual(1);
  });
});
