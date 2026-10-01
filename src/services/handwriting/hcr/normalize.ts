/**
 * TypeScript port of the model author's bitmap normalization
 * (Ismantic/Handwritten: `normalize.py`, whose resize is PIL's). The
 * resampler reproduces Pillow's Resample.c fixed-point path bit for bit
 * (verified against golden vectors produced by Pillow itself): weights are
 * normalized in float64, quantized to 22 fractional bits, accumulated as
 * integers with a rounding bias, then arithmetic-shifted back to uint8.
 *
 * Gray convention: 255 = white background, 0 = black ink (CASIA/HWDB GNT).
 * Model input: ink = 1.0, background = 0.0, shape [1, 64, 64].
 *
 * Pipeline: threshold at FG_THRESHOLD to find the ink bbox → crop →
 * aspect-preserving resize until the long side is CONTENT_SIZE → center on
 * a white CANVAS_SIZE² canvas → invert to floats.
 */

export const CANVAS_SIZE = 64;
export const CONTENT_SIZE = 56;
/** Pixels below this are ink (GNT background ≈ 255, strokes darker). */
export const FG_THRESHOLD = 220;

/** Pillow Resample.c: fixed-point coefficient precision (32 - 8 - 2). */
const PRECISION_BITS = 22;
/** Accumulator rounding bias: half of one output LSB. */
const ROUND_BIAS = 1 << (PRECISION_BITS - 1);

/** Python round(): ties resolve to even — normalize.py uses int(round(...)). */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const frac = x - f;
  if (frac > 0.5) return f + 1;
  if (frac < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Separable resample with the triangular filter — Pillow's
 * precompute_coeffs + _ImagingResample{Horizontal,Vertical}_8bpc for
 * single-channel images, so output is bit-identical to PIL.Image.resize
 * with BILINEAR (what normalize.py calls).
 *
 * `horizontal`: srcW×srcH → dstW×srcH, otherwise srcW×srcH → srcW×dstH.
 */
function resamplePass(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  horizontal: boolean,
): Uint8Array {
  const outDim = horizontal ? dstW : dstH;
  const inDim = horizontal ? srcW : srcH;
  const scale = inDim / outDim;
  const filterScale = scale >= 1 ? scale : 1;
  const support = filterScale; // bilinear support = 1.0 × filterScale
  const invFilterScale = 1 / filterScale;

  const bounds0 = new Int32Array(outDim); // xmin
  const taps: Int32Array[] = new Array(outDim); // quantized weights per output index
  for (let xx = 0; xx < outDim; xx += 1) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inDim) xmax = inDim;
    const len = xmax - xmin; // may be ≤ 0 for degenerate boundaries, as in Pillow
    const k = new Int32Array(Math.max(0, len));
    let sum = 0;
    const ws = new Float64Array(k.length);
    for (let x = 0; x < k.length; x += 1) {
      const d = (x + xmin - center + 0.5) * invFilterScale;
      const w = 1 - Math.abs(d);
      ws[x] = w > 0 ? w : 0;
      sum += ws[x];
    }
    if (sum !== 0) {
      for (let x = 0; x < k.length; x += 1) k[x] = Math.floor(0.5 + (ws[x] / sum) * 2 ** PRECISION_BITS);
    }
    bounds0[xx] = xmin;
    taps[xx] = k;
  }

  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y += 1) {
    for (let xx = 0; xx < dstW; xx += 1) {
      const outIdx = horizontal ? xx : y;
      const srcRow = horizontal ? y : xx;
      const xmin = bounds0[outIdx];
      const k = taps[outIdx];
      let acc = ROUND_BIAS;
      for (let x = 0; x < k.length; x += 1) {
        const v = horizontal ? src[srcRow * srcW + xmin + x] : src[(xmin + x) * srcW + srcRow];
        acc += v * k[x];
      }
      const v = acc >> PRECISION_BITS;
      dst[y * dstW + xx] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return dst;
}

/**
 * Gray bitmap → normalized 64×64 uint8 canvas (255 = white, 0 = ink),
 * matching the author's normalize.py byte for byte on the golden vectors.
 */
export function normalizeToCanvas(gray: Uint8Array, width: number, height: number): Uint8Array {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (gray[y * width + x] < FG_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    // No ink: a pure white canvas — downstream this becomes all-zero input.
    return new Uint8Array(CANVAS_SIZE * CANVAS_SIZE).fill(255);
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y += 1) {
    cropped.set(gray.subarray((minY + y) * width + minX, (minY + y) * width + minX + cropW), y * cropW);
  }

  const scale = CONTENT_SIZE / Math.max(cropW, cropH);
  const newW = Math.max(1, roundHalfEven(cropW * scale));
  const newH = Math.max(1, roundHalfEven(cropH * scale));

  const tmp = resamplePass(cropped, cropW, cropH, newW, cropH, true);
  const resized = resamplePass(tmp, newW, cropH, newW, newH, false);

  const canvas = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE).fill(255);
  const offX = Math.floor((CANVAS_SIZE - newW) / 2);
  const offY = Math.floor((CANVAS_SIZE - newH) / 2);
  for (let y = 0; y < newH; y += 1) {
    canvas.set(resized.subarray(y * newW, (y + 1) * newW), (offY + y) * CANVAS_SIZE + offX);
  }
  return canvas;
}

/** Normalized 64×64 uint8 canvas → model input floats (ink = 1.0). */
export function canvasToInput(canvas: Uint8Array): Float32Array {
  const out = new Float32Array(CANVAS_SIZE * CANVAS_SIZE);
  for (let i = 0; i < out.length; i += 1) out[i] = (255 - canvas[i]) / 255;
  return out;
}

/** Gray bitmap → [4096] model input (ink = 1.0, background = 0.0). */
export function normalizeGray(gray: Uint8Array, width: number, height: number): Float32Array {
  return canvasToInput(normalizeToCanvas(gray, width, height));
}
