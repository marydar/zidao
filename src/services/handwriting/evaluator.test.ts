import { describe, expect, it } from 'vitest';
import type { StrokeData, UserStroke } from '../../types';
import { BOX } from './geometry';
import { createHanziEvaluator } from './evaluator';
import hsk1Bundle from '../../data/strokes/hsk-1.json';

const evaluator = createHanziEvaluator('normal');
const lenient = createHanziEvaluator('lenient');
const strict = createHanziEvaluator('strict');

function strokeData(char: string): StrokeData {
  const data = (hsk1Bundle as Record<string, StrokeData>)[char];
  if (!data) throw new Error(`char ${char} not in test bundle`);
  return data;
}

/** Deterministic PRNG so tests are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert expected medians into "user" strokes in 0..1 space. */
function mediansToUser(medians: number[][][], opts?: { noise?: number; seed?: number }): UserStroke[] {
  const rand = mulberry32(opts?.seed ?? 42);
  const noise = opts?.noise ?? 0;
  return medians.map((median) => ({
    points: median.map(([x, y]) => ({
      x: x / BOX + (rand() - 0.5) * noise,
      y: y / BOX + (rand() - 0.5) * noise,
    })),
  }));
}

const chars = ['学', '的', '好', '爱', '一', '十', '你'];

describe('handwriting evaluator', () => {
  it('has stroke data for the test characters', () => {
    for (const c of chars) expect(strokeData(c)).toBeTruthy();
  });

  it.each(chars)('accepts a perfect reproduction of %s', (char) => {
    const data = strokeData(char);
    const result = evaluator.evaluate(mediansToUser(data.medians), { character: char, data });
    expect(result.correct).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.strokeCount.expected).toBe(data.medians.length);
    expect(result.fallback).toBe(false);
  });

  it.each(chars)('accepts a slightly noisy reproduction of %s', (char) => {
    const data = strokeData(char);
    const result = evaluator.evaluate(mediansToUser(data.medians, { noise: 0.025, seed: 7 }), {
      character: char,
      data,
    });
    expect(result.correct).toBe(true);
    expect(result.score).toBeGreaterThan(0.7);
  });

  it('rejects an empty canvas', () => {
    const data = strokeData('学');
    const result = evaluator.evaluate([], { character: '学', data });
    expect(result.correct).toBe(false);
    expect(result.issues[0].kind).toBe('empty');
    expect(result.hintTarget).toBe(1);
  });

  it('detects a missing stroke and points at it', () => {
    const data = strokeData('学');
    const strokes = mediansToUser(data.medians);
    strokes.pop();
    const result = evaluator.evaluate(strokes, { character: '学', data });
    expect(result.correct).toBe(false);
    const missing = result.issues.find((i) => i.kind === 'missing');
    expect(missing).toBeTruthy();
    expect(missing!.strokeIndex).toBe(data.medians.length);
    expect(result.hintTarget).toBe(data.medians.length);
    expect(result.feedback).toMatch(/missing/i);
  });

  it('detects a wrong stroke direction', () => {
    const data = strokeData('一');
    const strokes = mediansToUser(data.medians);
    strokes[0].points.reverse();
    const result = evaluator.evaluate(strokes, { character: '一', data });
    expect(result.correct).toBe(false);
    expect(result.issues.some((i) => i.kind === 'direction')).toBe(true);
    expect(result.feedback).toMatch(/wrong way/i);
  });

  it('detects an extra stroke (normal strictness)', () => {
    const data = strokeData('十');
    const strokes = mediansToUser(data.medians);
    strokes.push({
      points: [
        { x: 0.15, y: 0.8 },
        { x: 0.3, y: 0.75 },
      ],
    });
    const result = evaluator.evaluate(strokes, { character: '十', data });
    expect(result.correct).toBe(false);
    expect(result.issues.some((i) => i.kind === 'extra')).toBe(true);
    expect(lenient.evaluate(strokes, { character: '十', data }).correct).toBe(true);
  });

  it('detects a wrong stroke order', () => {
    const data = strokeData('十'); // horizontal first, then vertical
    const strokes = mediansToUser(data.medians);
    strokes.reverse();
    const result = evaluator.evaluate(strokes, { character: '十', data });
    expect(result.correct).toBe(false);
    expect(result.issues.some((i) => i.kind === 'order')).toBe(true);
    expect(result.feedback).toMatch(/before stroke/i);
  });

  it('rejects a completely different character', () => {
    const expected = strokeData('学');
    const other = strokeData('的');
    const result = evaluator.evaluate(mediansToUser(other.medians), {
      character: '学',
      data: expected,
    });
    expect(result.correct).toBe(false);
    expect(result.score).toBeLessThan(0.75);
  });

  it('rejects a scribble', () => {
    const data = strokeData('学');
    const rand = mulberry32(5);
    const scribble: UserStroke[] = Array.from({ length: 7 }, () => ({
      points: Array.from({ length: 6 }, () => ({ x: 0.15 + rand() * 0.7, y: 0.15 + rand() * 0.7 })),
    }));
    const result = evaluator.evaluate(scribble, { character: '学', data });
    expect(result.correct).toBe(false);
    expect(result.score).toBeLessThan(0.7);
  });

  it('rejects a tiny doodle in the corner', () => {
    const data = strokeData('学');
    const doodle: UserStroke[] = [
      {
        points: [
          { x: 0.05, y: 0.05 },
          { x: 0.08, y: 0.07 },
        ],
      },
    ];
    const result = evaluator.evaluate(doodle, { character: '学', data });
    expect(result.correct).toBe(false);
  });

  it('scores worse as the drawing gets sloppier', () => {
    const data = strokeData('学');
    const tight = evaluator.evaluate(mediansToUser(data.medians, { noise: 0.02, seed: 3 }), {
      character: '学',
      data,
    });
    const sloppy = evaluator.evaluate(mediansToUser(data.medians, { noise: 0.24, seed: 3 }), {
      character: '学',
      data,
    });
    expect(tight.score).toBeGreaterThan(sloppy.score);
    expect(sloppy.correct).toBe(false);
  });

  it('is stricter when strictness is raised', () => {
    const data = strokeData('学');
    const strokes = mediansToUser(data.medians, { noise: 0.06, seed: 11 });
    const strictResult = strict.evaluate(strokes, { character: '学', data });
    const lenientResult = lenient.evaluate(strokes, { character: '学', data });
    expect(lenientResult.score).toBeGreaterThanOrEqual(strictResult.score - 0.001);
    if (!lenientResult.correct) expect(strictResult.correct).toBe(false);
  });

  it('degrades gracefully when stroke data is missing', () => {
    const strokes = mediansToUser(strokeData('学').medians);
    const result = evaluator.evaluate(strokes, { character: '𠀀', data: null });
    expect(result.fallback).toBe(true);
    expect(result.correct).toBe(true);
    expect(result.issues.some((i) => i.kind === 'no-data')).toBe(true);
    const empty = evaluator.evaluate([], { character: '𠀀', data: null });
    expect(empty.correct).toBe(false);
    expect(empty.fallback).toBe(true);
  });

  it('handles multi-character input size limits without hanging', () => {
    const data = strokeData('学');
    const many: UserStroke[] = Array.from({ length: 80 }, (_, i) => ({
      points: [
        { x: 0.1 + (i % 10) * 0.08, y: 0.1 + Math.floor(i / 10) * 0.1 },
        { x: 0.2 + (i % 10) * 0.08, y: 0.2 + Math.floor(i / 10) * 0.1 },
      ],
    }));
    const result = evaluator.evaluate(many, { character: '学', data });
    expect(result.correct).toBe(false);
  });
});
