import { describe, expect, it } from 'vitest';
import goldens from './testdata/normalize-goldens.json';
import { CANVAS_SIZE, FG_THRESHOLD, canvasToInput, normalizeGray, normalizeToCanvas } from './normalize';

function derle(data: number[]): Uint8Array {
  let total = 0;
  for (let i = 1; i < data.length; i += 2) total += data[i];
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < data.length; i += 2) {
    out.fill(data[i], at, at + data[i + 1]);
    at += data[i + 1];
  }
  return out;
}

function inkBBox(canvas: Uint8Array): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = CANVAS_SIZE;
  let y0 = CANVAS_SIZE;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      if (canvas[y * CANVAS_SIZE + x] < FG_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

describe('normalizeToCanvas: golden vectors from the author\u2019s PIL normalize()', () => {
  for (const c of goldens.cases) {
    it(`${c.name} (${c.w}×${c.h})`, () => {
      const input = derle(c.in);
      expect(input.length).toBe(c.w * c.h);
      const expected = derle(c.out);
      const actual = normalizeToCanvas(input, c.w, c.h);
      const mismatches: number[] = [];
      for (let i = 0; i < expected.length; i += 1) {
        if (actual[i] !== expected[i]) mismatches.push(i);
        if (mismatches.length >= 5) break;
      }
      expect(
        mismatches.map((i) => `#${i} got ${actual[i]} want ${expected[i]}`),
      ).toEqual([]);
    });
  }
});

describe('normalizeToCanvas behavior', () => {
  it('returns an all-white canvas for blank input, all-zero model input', () => {
    const white = normalizeToCanvas(new Uint8Array(100 * 100).fill(255), 100, 100);
    expect(white.every((v) => v === 255)).toBe(true);
    const input = canvasToInput(white);
    expect(input.length).toBe(CANVAS_SIZE * CANVAS_SIZE);
    expect(input.every((v) => v === 0)).toBe(true);
  });

  it('keeps ink values proportional: black → 1.0, white → 0.0', () => {
    const gray = new Uint8Array(64 * 64).fill(255);
    gray[10 * 64 + 10] = 0;
    gray[20 * 64 + 20] = 128;
    const input = normalizeGray(gray, 64, 64);
    expect(Math.max(...input)).toBeCloseTo(1, 5);
    expect(Math.min(...input)).toBe(0);
    expect([...input].every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('finds the bbox with threshold 220: 219 is ink, 220 is not', () => {
    const gray = new Uint8Array(60 * 120).fill(255);
    for (let y = 10; y < 30; y += 1) {
      for (let x = 5; x < 25; x += 1) gray[y * 120 + x] = 219;
      for (let x = 80; x < 100; x += 1) gray[y * 120 + x] = 220;
    }
    const canvas = normalizeToCanvas(gray, 120, 60);
    const box = inkBBox(canvas);
    expect(box.x0).toBeGreaterThanOrEqual(4);
    expect(box.x1).toBeLessThan(CANVAS_SIZE - 4);
  });

  it('fits content to the 56px content box and centers it', () => {
    // Solid block 300×120 → long side 56, short side round(120/300*56)=22.
    const gray = new Uint8Array(300 * 120).fill(255);
    for (let y = 40; y < 80; y += 1) {
      for (let x = 100; x < 200; x += 1) gray[y * 300 + x] = 0;
    }
    const canvas = normalizeToCanvas(gray, 300, 120);
    const box = inkBBox(canvas);
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    expect(Math.max(w, h)).toBeLessThanOrEqual(56);
    expect(Math.abs(w / h - 2.5)).toBeLessThan(0.1); // 100×40 block keeps its aspect
    // centered (± 1px for even/odd parity)
    expect(Math.abs((box.x0 + box.x1 + 1) / 2 - CANVAS_SIZE / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((box.y0 + box.y1 + 1) / 2 - CANVAS_SIZE / 2)).toBeLessThanOrEqual(1);
  });

  it('preserves gray midtones through the resize (no binarization)', () => {
    // 100×100 uniform 128 (ink): bbox = whole image, resize keeps 128.
    const gray = new Uint8Array(100 * 100).fill(128);
    const canvas = normalizeToCanvas(gray, 100, 100);
    const center = canvas[32 * CANVAS_SIZE + 32];
    expect(center).toBeGreaterThanOrEqual(127);
    expect(center).toBeLessThanOrEqual(129);
  });
});
