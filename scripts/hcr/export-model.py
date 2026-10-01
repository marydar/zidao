#!/usr/bin/env python3
"""Reproduce public/models/hcr-mbv2.onnx + labels.json from the source checkpoint.

Provenance
----------
Model:   Ismantic/Handwritten (HuggingFace), Apache-2.0
         MobileNetV2, 3755 GB2312 level-1 classes, 64x64 grayscale input,
         trained on CASIA-HWDB1.1 (paper metrics: top-1 95.47%, top-10 99.58%).
Source:  release checkpoint best.pt (sha256 recorded in release_metadata.json),
         architecture code model.py and charset charset.json from the release.

Usage
-----
    # needs torch + onnxruntime + numpy (e.g. a venv); network only to fetch the source
    python3 scripts/hcr/export-model.py --source-dir /path/to/Handwritten
    python3 scripts/hcr/export-model.py --source-dir ... --write   # update repo files

The script always verifies that the committed repo artifacts match the source
checkpoint semantically (output parity + identical labels). --write copies the
freshly exported artifacts over the committed ones.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
COMMITTED_ONNX = REPO / "public" / "models" / "hcr-mbv2.onnx"
COMMITTED_LABELS = REPO / "src" / "services" / "handwriting" / "hcr" / "labels.json"

# From the model release's release_metadata.json
EXPECTED_BEST_PT_SHA256 = "151f32b03c49dbed77f3b8076035d28ce050d70a1a102e12581274a44cb10460"
EXPECTED_CLASSES = 3755


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_net(source_dir: Path):
    import torch

    sys.path.insert(0, str(source_dir))
    import model as model_mod  # author's architecture code from the release

    ckpt = torch.load(source_dir / "best.pt", map_location="cpu", weights_only=False)
    sd = ckpt["model"] if "model" in ckpt else ckpt
    num_classes = sd["classifier.1.weight"].shape[0]
    last = sd["features.18.0.weight"].shape[0]
    net = model_mod._build_mobilenet_v2_hccr(num_classes, 1, last)
    missing, unexpected = net.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise SystemExit(f"state_dict mismatch: missing={missing} unexpected={unexpected}")
    net.eval()
    return net, num_classes


def export_onnx(net, out_path: Path) -> None:
    import torch

    x = torch.zeros(1, 1, 64, 64)
    torch.onnx.export(
        net,
        (x,),
        str(out_path),
        input_names=["input"],
        output_names=["logits"],
        opset_version=17,
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        dynamo=False,
    )


def export_labels(source_dir: Path) -> dict:
    charset = json.loads((source_dir / "charset.json").read_text(encoding="utf-8"))
    c2i = charset["char_to_idx"]
    labels: list[str | None] = [None] * len(c2i)
    for ch, i in c2i.items():
        labels[i] = ch
    if any(l is None for l in labels) or len(labels) != EXPECTED_CLASSES:
        raise SystemExit(f"charset produced {len(labels)} labels with holes")
    return {"num_classes": len(labels), "labels": labels}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-dir", type=Path, required=True, help="dir with best.pt, charset.json, model.py")
    ap.add_argument("--write", action="store_true", help="overwrite the committed artifacts in the repo")
    args = ap.parse_args()

    src: Path = args.source_dir
    for name in ("best.pt", "charset.json", "model.py"):
        if not (src / name).is_file():
            raise SystemExit(f"missing {name} in {src}")

    digest = sha256(src / "best.pt")
    print(f"best.pt sha256: {digest}")
    if digest != EXPECTED_BEST_PT_SHA256:
        raise SystemExit("best.pt sha256 does not match the recorded release checksum")

    import numpy as np
    import onnxruntime as ort
    import torch

    net, num_classes = build_net(src)
    print(f"classes: {num_classes}")
    if num_classes != EXPECTED_CLASSES:
        raise SystemExit("unexpected class count")

    with tempfile.TemporaryDirectory() as tmp:
        fresh_onnx = Path(tmp) / "hcr-mbv2.onnx"
        export_onnx(net, fresh_onnx)

        # 1. fresh export vs torch
        rng = np.random.default_rng(0)
        xs = rng.standard_normal((8, 1, 64, 64), dtype=np.float32)
        with torch.no_grad():
            yt = net(torch.from_numpy(xs)).numpy()
        sess_fresh = ort.InferenceSession(str(fresh_onnx), providers=["CPUExecutionProvider"])
        yf = sess_fresh.run(None, {"input": xs})[0]
        diff_fresh = float(np.abs(yt - yf).max())
        print(f"torch vs fresh-onnx: max|diff|={diff_fresh:.3e} argmax_agree={bool((yt.argmax(1) == yf.argmax(1)).all())}")
        if diff_fresh > 1e-3 or not (yt.argmax(1) == yf.argmax(1)).all():
            raise SystemExit("fresh ONNX export parity failed")

        # 2. committed repo artifact vs fresh export (semantic check; bytes may
        #    differ across torch/onnx versions, so compare outputs, not sha256)
        if not COMMITTED_ONNX.is_file():
            raise SystemExit(f"committed model missing: {COMMITTED_ONNX}")
        sess_commit = ort.InferenceSession(str(COMMITTED_ONNX), providers=["CPUExecutionProvider"])
        yc = sess_commit.run(None, {"input": xs})[0]
        diff_commit = float(np.abs(yf - yc).max())
        print(f"committed vs fresh-onnx: max|diff|={diff_commit:.3e} argmax_agree={bool((yf.argmax(1) == yc.argmax(1)).all())}")
        print(f"committed sha256: {sha256(COMMITTED_ONNX)}")
        if diff_commit > 1e-3 or not (yf.argmax(1) == yc.argmax(1)).all():
            raise SystemExit("committed model does not match the source checkpoint")

        # 3. labels
        labels = export_labels(src)
        committed_labels = json.loads(COMMITTED_LABELS.read_text(encoding="utf-8"))
        if labels != committed_labels:
            raise SystemExit("labels.json does not match charset.json from the source release")
        print(f"labels: {labels['num_classes']} classes, first: {labels['labels'][:5]}")

        if args.write:
            shutil.copyfile(fresh_onnx, COMMITTED_ONNX)
            COMMITTED_LABELS.write_text(json.dumps(labels, ensure_ascii=False), encoding="utf-8")
            print(f"wrote {COMMITTED_ONNX} and {COMMITTED_LABELS}")

    print("OK: committed artifacts verified against the source checkpoint")


if __name__ == "__main__":
    main()
