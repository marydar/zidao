import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InferenceSession } from 'onnxruntime-node';
import { suggestSimilar } from '../suggestions';
import { evalCases, EVAL_CHARS } from './evalFixtures';
import { HCR_LABELS, setHcrRunner } from './model';
import { canvasToInput, normalizeToCanvas } from './normalize';
import { RENDER_SIZE, STROKE_WIDTH_FRAC, renderStrokes } from './render';
import { recognizeHandwriting } from './recognize';

/**
 * Accuracy gate for the ML recognizer vs the legacy geometric one.
 *
 * Off by default so the normal suite stays fast and dependency-light:
 *
 *   HCR_EVAL=1 npx vitest run src/services/handwriting/hcr/eval.test.ts
 *
 * Requires onnxruntime-node (devDependency) and public/models/hcr-mbv2.onnx.
 * Fixtures are upright drawings of 10 characters × 12 degradations; both
 * recognizers see the identical strokes the app would hand them.
 */

const RUN = process.env.HCR_EVAL === '1';

interface ModelSession {
  session: InferenceSession;
  run: (input: Float32Array) => Promise<Float32Array>;
}

async function loadModel(): Promise<ModelSession> {
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create('public/models/hcr-mbv2.onnx');
  return {
    session,
    async run(input: Float32Array) {
      const out = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 1, 64, 64]),
      });
      const data = out[session.outputNames[0]].data;
      return data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
    },
  };
}

/** Model top-k from raw logits, no context boost (eval measures pure rank). */
function topRank(logits: Float32Array, expected: string, k: number): number {
  const order = Array.from(logits.keys()).sort((a, b) => logits[b] - logits[a] || a - b);
  const chars = order.slice(0, k).map((i) => HCR_LABELS[i]);
  const at = chars.indexOf(expected);
  return at === -1 ? k + 1 : at + 1;
}

function summarize(label: string, n: number, top1: number, top3: number, msTotal: number): void {
  const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`.padStart(6);
  console.log(
    `${label.padEnd(26)} n=${n}  top1=${pct(top1)}  top3=${pct(top3)}  avg=${(msTotal / n).toFixed(1)}ms`,
  );
}

(RUN ? describe : describe.skip)('HCR evaluation (HCR_EVAL=1)', () => {
  let model: ModelSession;

  beforeAll(async () => {
    model = await loadModel();
    setHcrRunner(model.run);
    for (const ch of EVAL_CHARS) expect(HCR_LABELS, `${ch} must be a model class`).toContain(ch);
  }, 60_000);

  afterAll(() => {
    setHcrRunner(null);
  });

  it(
    'model vs legacy across the fixture matrix',
    { timeout: 600_000 },
    async () => {
      const cases = evalCases();
      let mTop1 = 0;
      let mTop3 = 0;
      let lTop1 = 0;
      let lTop3 = 0;
      let fallbacks = 0;
      let modelMs = 0;
      const misses: string[] = [];

      for (const c of cases) {
        const t0 = performance.now();
        const m = await recognizeHandwriting(c.strokes, { context: [] });
        modelMs += performance.now() - t0;
        if (m.source !== 'model') fallbacks += 1;
        const l = await suggestSimilar(c.strokes, c.char, [], async () => null);

        const mRank = m.suggestions.findIndex((s) => s.char === c.char) + 1;
        const lRank = l.suggestions.findIndex((s) => s.char === c.char) + 1;
        if (mRank === 1) mTop1 += 1;
        if (mRank > 0 && mRank <= 3) mTop3 += 1;
        if (lRank === 1) lTop1 += 1;
        if (lRank > 0 && lRank <= 3) lTop3 += 1;
        if (mRank > 3 || mRank === 0) {
          const top = m.suggestions
            .slice(0, 5)
            .map((s) => s.char)
            .join('');
          misses.push(`  ${c.char} / ${c.variant}: model showed [${top}] (source ${m.source})`);
        }
      }

      const n = cases.length;
      summarize('model (HCR)', n, mTop1, mTop3, modelMs);
      summarize('legacy geometric', n, lTop1, lTop3, 0);
      if (misses.length) console.log(`model rank>3 (${misses.length}):\n${misses.join('\n')}`);

      expect(fallbacks, 'model must never fall back during eval').toBe(0);
      // Gates: set from observed results (see git history for the sweep).
      expect(mTop3 / n).toBeGreaterThanOrEqual(0.85);
      expect(mTop1 / n).toBeGreaterThanOrEqual(0.7);
      expect(lTop3 / n).toBeGreaterThanOrEqual(0.6); // fixture sanity: legacy is viable on these
      expect(mTop3).toBeGreaterThanOrEqual(lTop3);
    },
  );

  it(
    'stroke-width sweep for renderStrokes (model-only)',
    async () => {
      const cases = evalCases();
      const widths = [0.02, 0.025, 0.03, 0.035, 0.04, 0.05];
      for (const w of widths) {
        let top1 = 0;
        let top3 = 0;
        for (const c of cases) {
          const img = renderStrokes(c.strokes, RENDER_SIZE, w);
          const logits = await model.run(canvasToInput(normalizeToCanvas(img.data, img.width, img.height)));
          const rank = topRank(logits, c.char, 3);
          if (rank === 1) top1 += 1;
          if (rank <= 3) top3 += 1;
        }
        summarize(`width ${w}`, cases.length, top1, top3, 0);
      }
      expect(STROKE_WIDTH_FRAC).toBeGreaterThan(0); // current default is exercised by the main eval
    },
    { timeout: 600_000 },
  );
});
