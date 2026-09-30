import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { HanziCharacter, HintMode, Point, UserStroke } from '../../types';
import { BOX, parseOutline, polylineLength } from '../../services/handwriting/geometry';

export interface CanvasHandle {
  clear(): void;
  undo(): boolean;
  getStrokes(): UserStroke[];
  strokeCount(): number;
  /** Animate the correct stroke order (full guide). */
  playGuide(): void;
  stopGuide(): void;
}

interface Props {
  character: HanziCharacter | null;
  /** Changing this key resets the canvas (new word/character). */
  charKey: string;
  hintMode: HintMode;
  /** 1-based expected stroke to highlight when hintMode is 'next'. */
  nextStroke: number | null;
  brushWidth: number;
  smoothing: number;
  showGrid: boolean;
  theme: 'dark' | 'light';
  animationSpeed: number;
  disabled?: boolean;
  onStrokeChange?: (count: number) => void;
}

interface Palette {
  grid: string;
  gridFaint: string;
  ink: string;
  inkDisabled: string;
  ghost: string;
  hint: string;
  guide: string;
}

function paletteFor(theme: 'dark' | 'light'): Palette {
  return theme === 'dark'
    ? {
        grid: 'rgba(140, 216, 216, 0.2)',
        gridFaint: 'rgba(140, 216, 216, 0.1)',
        ink: '#e7f3f2',
        inkDisabled: 'rgba(231, 243, 242, 0.75)',
        ghost: 'rgba(45, 212, 191, 0.13)',
        hint: 'rgba(45, 212, 191, 0.8)',
        guide: 'rgba(34, 211, 238, 0.85)',
      }
    : {
        grid: 'rgba(8, 61, 64, 0.24)',
        gridFaint: 'rgba(8, 61, 64, 0.12)',
        ink: '#0a2325',
        inkDisabled: 'rgba(10, 35, 37, 0.7)',
        ghost: 'rgba(13, 148, 136, 0.14)',
        hint: 'rgba(13, 148, 136, 0.85)',
        guide: 'rgba(8, 145, 178, 0.85)',
      };
}

const polygonCache = new Map<string, Point[][]>();
function polygonsFor(char: HanziCharacter): Point[][] {
  if (!char.data) return [];
  const key = char.character;
  const cached = polygonCache.get(key);
  if (cached) return cached;
  const polys = char.data.strokes.flatMap((path) => parseOutline(path));
  polygonCache.set(key, polys);
  return polys;
}

function partialPolyline(points: Point[], fraction: number): Point[] {
  if (fraction >= 1) return points;
  if (fraction <= 0) return points.slice(0, 1);
  const total = polylineLength(points);
  const target = total * fraction;
  const out: Point[] = [points[0]];
  let traveled = 0;
  for (let i = 1; i < points.length && traveled < target; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + seg >= target) {
      const t = seg > 0 ? (target - traveled) / seg : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      break;
    }
    out.push(b);
    traveled += seg;
  }
  return out;
}

/**
 * Pointer-based handwriting canvas (mouse / touch / stylus).
 * All high-frequency input stays in refs — React never re-renders while drawing.
 */
export const HandwritingCanvas = forwardRef<CanvasHandle, Props>(function HandwritingCanvas(
  {
    character,
    charKey,
    hintMode,
    nextStroke,
    brushWidth,
    smoothing,
    showGrid,
    theme,
    animationSpeed,
    disabled,
    onStrokeChange,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const strokesRef = useRef<UserStroke[]>([]);
  const currentRef = useRef<Point[] | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const paletteRef = useRef<Palette>(paletteFor(theme));
  const drawingRef = useRef(false);
  const lastEmittedRef = useRef(0);

  const hintModeRef = useRef(hintMode);
  hintModeRef.current = hintMode;
  const nextStrokeRef = useRef(nextStroke);
  nextStrokeRef.current = nextStroke;
  const charRef = useRef(character);
  charRef.current = character;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const guideRef = useRef<{ active: boolean; start: number } | null>(null);
  const guideVisibleRef = useRef(false);
  const rafRef = useRef(0);

  const palette = paletteFor(theme);
  paletteRef.current = palette;

  const brushPx = () => Math.max(3, brushWidth * Math.min(sizeRef.current.w, sizeRef.current.h));
  const toPx = (p: Point): Point => ({ x: p.x * sizeRef.current.w, y: p.y * sizeRef.current.h });
  const toNorm = (x: number, y: number): Point => ({
    x: x / Math.max(1, sizeRef.current.w),
    y: y / Math.max(1, sizeRef.current.h),
  });

  /* ---------------------------- rendering ---------------------------- */

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { w, h } = sizeRef.current;
    const pad = Math.max(4, w * 0.02);
    const r = Math.max(6, w * 0.03);
    ctx.save();
    ctx.strokeStyle = paletteRef.current.grid;
    ctx.lineWidth = 1.4;
    roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, r);
    ctx.stroke();

    ctx.strokeStyle = paletteRef.current.gridFaint;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 7]);
    const midX = w / 2;
    const midY = h / 2;
    ctx.beginPath();
    ctx.moveTo(pad, midY);
    ctx.lineTo(w - pad, midY);
    ctx.moveTo(midX, pad);
    ctx.lineTo(midX, h - pad);
    ctx.moveTo(pad, pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.moveTo(w - pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.stroke();
    ctx.restore();
  }, []);

  const drawGhost = useCallback((ctx: CanvasRenderingContext2D) => {
    const char = charRef.current;
    if (!char?.data) return;
    const polys = polygonsFor(char);
    if (!polys.length) return;
    const scale = sizeRef.current.w / BOX;
    ctx.save();
    ctx.fillStyle = paletteRef.current.ghost;
    for (const poly of polys) {
      ctx.beginPath();
      poly.forEach((p, i) => {
        const x = p.x * scale;
        const y = p.y * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }, []);

  const drawMedian = useCallback(
    (ctx: CanvasRenderingContext2D, median: number[][], color: string, widthFactor: number, alpha = 1) => {
      if (!median.length) return;
      const scale = sizeRef.current.w / BOX;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, brushPx() * widthFactor);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      median.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * scale, y * scale);
        else ctx.lineTo(x * scale, y * scale);
      });
      ctx.stroke();
      ctx.restore();
    },
    // brushWidth changes are read live through brushPx()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brushWidth],
  );

  const drawHintStroke = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const char = charRef.current;
      const idx = nextStrokeRef.current;
      if (!char?.data || !idx) return;
      const median = char.data.medians[idx - 1];
      if (median) drawMedian(ctx, median, paletteRef.current.hint, 0.8, 0.75);
    },
    [drawMedian],
  );

  const drawStrokeSet = useCallback(
    (ctx: CanvasRenderingContext2D, strokes: UserStroke[], color: string) => {
      const { w, h } = sizeRef.current;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = brushPx();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.points.length < 2) {
          const p = toPx(stroke.points[0]);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, brushPx() / 2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        const pts = stroke.points;
        const first = { x: pts[0].x * w, y: pts[0].y * h };
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length - 1; i += 1) {
          const a = { x: pts[i].x * w, y: pts[i].y * h };
          const b = { x: pts[i + 1].x * w, y: pts[i + 1].y * h };
          ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        const last = { x: pts[pts.length - 1].x * w, y: pts[pts.length - 1].y * h };
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    // brushWidth changes are read live through brushPx()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brushWidth],
  );

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);

    if (showGrid) drawGrid(ctx);
    const mode = hintModeRef.current;
    if (mode === 'ghost' || mode === 'guide' || guideVisibleRef.current) drawGhost(ctx);
    if (mode === 'next') drawHintStroke(ctx);
    drawStrokeSet(
      ctx,
      strokesRef.current,
      disabledRef.current ? paletteRef.current.inkDisabled : paletteRef.current.ink,
    );
    const current = currentRef.current;
    if (current && current.length > 1) {
      drawStrokeSet(
        ctx,
        [{ points: current }],
        disabledRef.current ? paletteRef.current.inkDisabled : paletteRef.current.ink,
      );
    }
  }, [drawGrid, drawGhost, drawHintStroke, drawStrokeSet, showGrid]);

  /* ---------------------------- guide animation ---------------------------- */

  const stopGuide = useCallback(() => {
    guideRef.current = null;
    cancelAnimationFrame(rafRef.current);
  }, []);

  const playGuide = useCallback(() => {
    const char = charRef.current;
    if (!char?.data?.medians.length) return;
    stopGuide();
    guideVisibleRef.current = true;
    guideRef.current = { active: true, start: performance.now() };
    const strokeDur = 380 / Math.max(0.25, animationSpeed);
    const total = char.data.medians.length;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const frame = () => {
      const guide = guideRef.current;
      if (!guide) return;
      const elapsed = performance.now() - guide.start;
      const idx = Math.floor(elapsed / strokeDur);
      if (idx >= total) {
        guideRef.current = null;
        renderAll();
        return;
      }
      const t = Math.min(1, (elapsed - idx * strokeDur) / strokeDur);
      renderAll();
      // completed strokes
      for (let i = 0; i < idx; i += 1) {
        drawMedian(ctx, char.data!.medians[i], paletteRef.current.guide, 0.9, 0.9);
      }
      // active stroke, partially revealed
      const partial = partialPolyline(
        char.data!.medians[idx].map(([x, y]) => ({ x, y })),
        t,
      );
      if (partial.length > 1) {
        const scale = sizeRef.current.w / BOX;
        ctx.save();
        ctx.strokeStyle = paletteRef.current.guide;
        ctx.lineWidth = Math.max(2, brushPx() * 0.9);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        partial.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
        ctx.stroke();
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    // brushWidth changes are read live through brushPx()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationSpeed, drawMedian, renderAll, stopGuide]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      clear: () => {
        strokesRef.current = [];
        currentRef.current = null;
        guideVisibleRef.current = false;
        stopGuide();
        renderAll();
        onStrokeChange?.(0);
      },
      undo: () => {
        if (!strokesRef.current.length) return false;
        strokesRef.current.pop();
        renderAll();
        onStrokeChange?.(strokesRef.current.length);
        return true;
      },
      getStrokes: () => strokesRef.current,
      strokeCount: () => strokesRef.current.length,
      playGuide,
      stopGuide,
    }),
    [onStrokeChange, playGuide, renderAll, stopGuide],
  );

  /* ---------------------------- sizing ---------------------------- */

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      renderAll();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [renderAll]);

  // reset when moving to a new character
  useEffect(() => {
    strokesRef.current = [];
    currentRef.current = null;
    guideVisibleRef.current = false;
    stopGuide();
    renderAll();
    onStrokeChange?.(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charKey]);

  useEffect(() => {
    renderAll();
  }, [hintMode, nextStroke, showGrid, theme, disabled, renderAll]);

  /* ---------------------------- pointer input ---------------------------- */

  const emitCount = () => {
    const count = strokesRef.current.length;
    if (count !== lastEmittedRef.current) {
      lastEmittedRef.current = count;
      onStrokeChange?.(count);
    }
  };

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): Point =>
    toNorm(e.nativeEvent.offsetX, e.nativeEvent.offsetY);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabledRef.current) return;
    if (guideRef.current) stopGuide();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = pointerPos(e);
    currentRef.current = [p];
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = ctxRef.current;
    const points = currentRef.current;
    if (!ctx || !points) return;
    const raw = pointerPos(e);
    const prev = points[points.length - 1];
    const smoothingFactor = Math.min(0.92, Math.max(0, smoothing));
    const next: Point = {
      x: prev.x + (raw.x - prev.x) * (1 - smoothingFactor),
      y: prev.y + (raw.y - prev.y) * (1 - smoothingFactor),
    };
    const pixelGap = Math.hypot((next.x - prev.x) * sizeRef.current.w, (next.y - prev.y) * sizeRef.current.h);
    if (points.length > 1 && pixelGap < 1.4) return;
    points.push(next);

    if (points.length >= 3) {
      const n = points.length;
      const a = toPx(points[n - 3]);
      const b = toPx(points[n - 2]);
      const c = toPx(points[n - 1]);
      ctx.strokeStyle = paletteRef.current.ink;
      ctx.lineWidth = brushPx();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      ctx.stroke();
    } else if (points.length === 2) {
      const a = toPx(points[0]);
      const b = toPx(points[1]);
      ctx.strokeStyle = paletteRef.current.ink;
      ctx.lineWidth = brushPx();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    e.preventDefault();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    const points = currentRef.current;
    if (points && points.length > 0) {
      strokesRef.current.push({ points });
      currentRef.current = null;
      renderAll();
      emitCount();
    }
  };

  return (
    <div
      ref={wrapRef}
      className="hw-canvas-wrap"
      data-disabled={disabled ? 'true' : 'false'}
    >
      <canvas
        ref={canvasRef}
        className="hw-canvas"
        role="img"
        aria-label={
          character
            ? `Handwriting canvas for ${character.character}`
            : 'Handwriting canvas'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onPointerLeave={(e) => {
          if (drawingRef.current && e.buttons === 0) finishStroke(e);
        }}
      />
    </div>
  );
});

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
