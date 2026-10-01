import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserStroke } from '../../../types';
import { HCR_LABELS, setHcrRunner } from './model';
import { recognizeHandwriting } from './recognize';

/** A large, deliberate square-ish drawing — a meaningful input. */
const BIG: UserStroke[] = [
  {
    points: [
      { x: 0.15, y: 0.15 },
      { x: 0.85, y: 0.15 },
      { x: 0.85, y: 0.85 },
      { x: 0.15, y: 0.85 },
      { x: 0.15, y: 0.15 },
    ],
  },
  { points: [{ x: 0.5, y: 0.15 }, { x: 0.5, y: 0.85 }] },
];

function logitsFor(entries: [string, number][], rest = -30): Float32Array {
  const logits = new Float32Array(HCR_LABELS.length).fill(rest);
  for (const [ch, v] of entries) {
    const idx = HCR_LABELS.indexOf(ch);
    expect(idx, `${ch} must be in the charset`).toBeGreaterThanOrEqual(0);
    logits[idx] = v;
  }
  return logits;
}

afterEach(() => setHcrRunner(null));

describe('charset sanity', () => {
  it('has 3755 unique labels with common characters present', () => {
    expect(HCR_LABELS.length).toBe(3755);
    expect(new Set(HCR_LABELS).size).toBe(3755);
    for (const ch of '一的我是不了人他在有这中大来上国个') expect(HCR_LABELS).toContain(ch);
  });
});

describe('input validation', () => {
  it('rejects empty drawings without running the model', async () => {
    const runner = vi.fn();
    setHcrRunner(runner);
    const r = await recognizeHandwriting([]);
    expect(r).toEqual({ suggestions: [], poolSize: 0, source: 'model', reason: 'empty' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects accidental marks (tiny extent) without running the model', async () => {
    const runner = vi.fn();
    setHcrRunner(runner);
    const r = await recognizeHandwriting([{ points: [{ x: 0.5, y: 0.5 }] }]);
    expect(r.reason).toBe('tiny');
    expect(r.suggestions).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('model path', () => {
  it('returns ranked top-K candidates and feeds the model a full input tensor', async () => {
    const seen: Float32Array[] = [];
    setHcrRunner(async (input) => {
      seen.push(input);
      return logitsFor([['为', 6], ['的', 3], ['办', 1]]);
    });
    const r = await recognizeHandwriting(BIG, { context: [] });
    expect(r.source).toBe('model');
    expect(r.reason).toBe('ok');
    expect(r.poolSize).toBe(3755);
    expect(r.suggestions).toHaveLength(8);
    expect(r.suggestions[0].char).toBe('为');
    expect(r.suggestions[0].score).toBeGreaterThan(0.5);
    expect(r.suggestions.map((s) => s.score)).toEqual(
      [...r.suggestions.map((s) => s.score)].sort((a, b) => b - a),
    );
    expect(r.suggestions.every((s) => s.score > 0 && s.score <= 1)).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(4096);
    expect([...seen[0]].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...seen[0])).toBeGreaterThan(0.5); // real ink reached the tensor
  });

  it('never injects the expected answer — suggestions are only what the model ranks', async () => {
    setHcrRunner(async () => logitsFor([['的', 8]]));
    const r = await recognizeHandwriting(BIG, { expected: '鬼' });
    const chars = r.suggestions.map((s) => s.char);
    expect(chars[0]).toBe('的');
    expect(chars).not.toContain('鬼');
  });

  it('gives session-queue characters a small boost when the model is nearly unsure', async () => {
    // Two near-tie logits: the model itself prefers 的, but 你 is in the queue.
    setHcrRunner(async () => logitsFor([['的', 0.02], ['你', 0]]));
    const neutral = await recognizeHandwriting(BIG, { context: [] });
    expect(neutral.suggestions[0].char).toBe('的');
    const boosted = await recognizeHandwriting(BIG, { context: ['你', '好'] });
    expect(boosted.suggestions[0].char).toBe('你');
    // a strong model preference is not overturned by the small boost
    setHcrRunner(async () => logitsFor([['的', 6], ['你', 0]]));
    const confident = await recognizeHandwriting(BIG, { context: ['你'] });
    expect(confident.suggestions[0].char).toBe('的');
  });
});

describe('legacy fallback', () => {
  it('falls back to the geometric recognizer when the model fails', async () => {
    setHcrRunner(async () => {
      throw new Error('model offline');
    });
    const bar: UserStroke[] = [
      { points: Array.from({ length: 15 }, (_, i) => ({ x: 0.1 + (0.8 * i) / 14, y: 0.5 })) },
    ];
    const r = await recognizeHandwriting(bar, { expected: '一' });
    expect(r.source).toBe('fallback');
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions[0].char).toBe('一');
  });
});
