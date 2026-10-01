#!/usr/bin/env python3
"""Generate golden vectors for the TS port of the model's normalize().

The reference is the model author's normalize.py (Ismantic/Handwritten):
threshold at 220 → bbox crop → PIL BILINEAR resize (long side → 56) →
center on 64×64 → white background. This script embeds that reference
implementation, runs it over deterministic synthetic bitmaps plus two real
glyph renders, and writes RLE-encoded (input, expected canvas) pairs to
src/services/handwriting/hcr/testdata/normalize-goldens.json.

Run from the repo root:  python3 scripts/hcr/make-goldens.py
Requires: pillow, numpy (any venv that can run the model tooling).
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CANVAS_SIZE = 64
CONTENT_SIZE = 56
FG_THRESHOLD = 220

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/services/handwriting/hcr/testdata/normalize-goldens.json"


def normalize(bitmap: np.ndarray) -> np.ndarray:
    """Author's normalize.py, verbatim in behavior (PIL resize included)."""
    if bitmap.ndim != 2:
        raise ValueError(f"expected 2D bitmap, got shape={bitmap.shape}")
    fg = bitmap < FG_THRESHOLD
    if not fg.any():
        return np.full((CANVAS_SIZE, CANVAS_SIZE), 255, dtype=np.uint8)
    ys, xs = np.where(fg)
    y0, y1 = ys.min(), ys.max() + 1
    x0, x1 = xs.min(), xs.max() + 1
    cropped = bitmap[y0:y1, x0:x1]
    h, w = cropped.shape
    scale = CONTENT_SIZE / max(h, w)
    new_h = max(1, int(round(h * scale)))
    new_w = max(1, int(round(w * scale)))
    pil = Image.fromarray(cropped, mode="L")
    pil = pil.resize((new_w, new_h), Image.BILINEAR)
    resized = np.asarray(pil, dtype=np.uint8)
    canvas = np.full((CANVAS_SIZE, CANVAS_SIZE), 255, dtype=np.uint8)
    off_y = (CANVAS_SIZE - new_h) // 2
    off_x = (CANVAS_SIZE - new_w) // 2
    canvas[off_y:off_y + new_h, off_x:off_x + new_w] = resized
    return canvas


def rle(arr: np.ndarray) -> list[int]:
    flat = arr.flatten().tolist()
    out: list[int] = []
    run_val = flat[0]
    run_len = 1
    for v in flat[1:]:
        if v == run_val:
            run_len += 1
        else:
            out.extend([run_val, run_len])
            run_val = v
            run_len = 1
    out.extend([run_val, run_len])
    return out


def derle(data: list[int], expected_len: int) -> np.ndarray:
    out: list[int] = []
    for i in range(0, len(data), 2):
        out.extend([data[i]] * data[i + 1])
    assert len(out) == expected_len, (len(out), expected_len)
    return np.array(out, dtype=np.uint8)


def rect(w: int, h: int, x0: int, y0: int, x1: int, y1: int, value: int) -> np.ndarray:
    a = np.full((h, w), 255, dtype=np.uint8)
    a[y0:y1, x0:x1] = value
    return a


def glyph(ch: str, size: int, width: int) -> np.ndarray:
    """Render a bundle median the way a person writes it (y flipped upright)."""
    bundle = json.loads((ROOT / "src/data/strokes/common.json").read_text(encoding="utf-8"))
    medians = bundle[ch]["medians"]
    img = Image.new("L", (size, size), 255)
    d = ImageDraw.Draw(img)
    for m in medians:
        pts = [(x / 1024 * size, (1024 - y) / 1024 * size) for x, y in m]
        d.line(pts, fill=0, width=width, joint="curve")
        r = width / 2
        for (x, y) in (pts[0], pts[-1]):
            d.ellipse([x - r, y - r, x + r, y + r], fill=0)
    return np.asarray(img, dtype=np.uint8)


def cases() -> dict[str, np.ndarray]:
    rng = random.Random(20261001)

    def full(w: int, h: int) -> np.ndarray:
        return np.full((h, w), 255, dtype=np.uint8)

    two_blobs = full(200, 150)
    two_blobs[20:80, 10:70] = 0
    two_blobs[110:140, 130:190] = 0

    threshold = full(220, 60)
    threshold[5:55, 5:80] = 219   # below 220 → ink, sets the bbox
    threshold[5:55, 130:190] = 220  # not ink, must be ignored

    frame = full(90, 90)
    frame[0:3, :] = 0
    frame[-3:, :] = 0
    frame[:, 0:3] = 0
    frame[:, -3:] = 0

    sparse = rect(512, 384, 60, 40, 90, 70, 0)
    sparse[300:330, 400:450] = 0

    out: dict[str, np.ndarray] = {
        "empty-100": full(100, 100),
        "all-ink-50": np.zeros((50, 50), dtype=np.uint8),
        "single-ink-pixel": np.zeros((1, 1), dtype=np.uint8),
        "single-white-pixel": full(1, 1),
        # 6*56/96 = 3.5 and 18*56/96 = 10.5 pin Python's round-half-even sizing
        "bar-6x96": rect(96, 6, 0, 1, 96, 5, 0),
        "bar-18x96": rect(96, 18, 0, 4, 96, 14, 0),
        "bar-96x6": rect(6, 96, 1, 0, 5, 96, 0),
        "hbar-10x100": rect(100, 10, 5, 0, 95, 10, 0),
        "vbar-100x10": rect(10, 100, 0, 5, 10, 95, 0),
        "two-blobs-200x150": two_blobs,
        "offcenter-small-300": rect(300, 300, 250, 250, 262, 262, 0),
        "threshold-219-vs-220": threshold,
        "wide-1024x32": rect(1024, 32, 100, 8, 900, 24, 0),
        "tall-32x1024": rect(32, 1024, 8, 100, 24, 900, 0),
        "aspect-33x88": rect(88, 33, 4, 4, 84, 29, 0),
        "sparse-512x384": sparse,
        "frame-90": frame,
        "noise-41x97": np.array(
            [[rng.randint(0, 255) for _ in range(97)] for _ in range(41)], dtype=np.uint8
        ),
        "noise-2x1000": np.array(
            [[rng.randint(0, 255) for _ in range(1000)] for _ in range(2)], dtype=np.uint8
        ),
        "gradient-64": np.tile(np.linspace(0, 255, 64, dtype=np.uint8), (64, 1)),
        "noise-150": np.array(
            [[rng.randint(0, 255) for _ in range(150)] for _ in range(150)], dtype=np.uint8
        ),
        "glyph-256-w10": glyph("为", 256, 10),
        "glyph-128-w6": glyph("中", 128, 6),
    }
    return out


def main() -> None:
    entries = []
    for name, bitmap in sorted(cases().items()):
        canvas = normalize(bitmap)
        assert canvas.shape == (CANVAS_SIZE, CANVAS_SIZE)
        # round-trip check for the RLE encoding itself
        assert (derle(rle(bitmap), bitmap.size) == bitmap.flatten()).all()
        assert (derle(rle(canvas), canvas.size) == canvas.flatten()).all()
        entries.append(
            {
                "name": name,
                "w": int(bitmap.shape[1]),
                "h": int(bitmap.shape[0]),
                "in": rle(bitmap),
                "out": rle(canvas),
            }
        )
        print(f"{name:24s} {bitmap.shape[1]}x{bitmap.shape[0]} -> ink={(canvas < 255).sum()}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"generatedBy": "scripts/hcr/make-goldens.py", "cases": entries}),
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(entries)} cases)")


if __name__ == "__main__":
    main()
