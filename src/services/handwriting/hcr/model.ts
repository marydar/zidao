import type { InferenceSession } from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import labelsJson from './labels.json';

/**
 * Model runtime: Ismantic/Handwritten (MobileNetV2, 3755 GB2312 level-1
 * classes, 64×64 grayscale, trained on CASIA-HWDB1.1). The ONNX export
 * lives in public/models/ and the WebAssembly backend ships with
 * onnxruntime-web.
 *
 * Input: Float32Array(4096), ink = 1.0 / background = 0.0, layout NCHW
 * [1,1,64,64]. Output: Float32Array(3755) logits over HCR_LABELS.
 *
 * Tests and the evaluation harness inject their own runner via
 * `setHcrRunner`, so nothing browser-specific loads outside the browser.
 */

export const HCR_LABELS: readonly string[] = labelsJson.labels;
export const INPUT_SIZE = 64;
export const OUTPUT_CLASSES = labelsJson.num_classes;
export const MODEL_NAME = 'Ismantic/Handwritten (MobileNetV2 · GB2312-3755)';

const MODEL_URL = `${import.meta.env.BASE_URL}models/hcr-mbv2.onnx`;

/** Runs the model once: normalized input → logits. */
export type HcrRunner = (input: Float32Array) => Promise<Float32Array>;

export type HcrStatus = 'idle' | 'loading' | 'ready' | 'error';

let status: HcrStatus = 'idle';
let runnerOverride: HcrRunner | null = null;
let runnerPromise: Promise<HcrRunner> | null = null;

export function hcrStatus(): HcrStatus {
  return status;
}

/** Test/eval hook: supply a runner (or null to restore the browser loader). */
export function setHcrRunner(runner: HcrRunner | null): void {
  runnerOverride = runner;
  runnerPromise = null;
  status = runner ? 'ready' : 'idle';
}

async function createBrowserRunner(): Promise<HcrRunner> {
  const ort = await import('onnxruntime-web/wasm');
  // Serve the .wasm from the bundled asset URL instead of resolving it
  // relative to the emitted chunk (which Vite hashes).
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  // The app is not served with COOP/COEP headers, so multi-threading is
  // unavailable by design; a single thread also keeps worker startup out of
  // the first-inference path.
  ort.env.wasm.numThreads = 1;
  const session: InferenceSession = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  return async (input: Float32Array): Promise<Float32Array> => {
    const tensor = new ort.Tensor('float32', input, [1, 1, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ [inputName]: tensor });
    const output = results[outputName];
    if (!(output?.data instanceof Float32Array)) {
      throw new Error('hcr: unexpected model output');
    }
    return output.data;
  };
}

/** Load (or reuse) the browser runner. Rejects when the model cannot load. */
export function getHcrRunner(): Promise<HcrRunner> {
  if (runnerOverride) return Promise.resolve(runnerOverride);
  if (!runnerPromise) {
    status = 'loading';
    runnerPromise = createBrowserRunner()
      .then((runner) => {
        status = 'ready';
        return runner;
      })
      .catch((err: unknown) => {
        status = 'error';
        runnerPromise = null;
        throw err;
      });
  }
  return runnerPromise;
}

/** Warm the model up (dictation sessions). Never rejects. */
export function prefetchHcr(): void {
  void getHcrRunner().catch(() => {
    /* status already records the failure; first suggest falls back */
  });
}
