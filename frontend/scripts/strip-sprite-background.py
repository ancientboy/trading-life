#!/usr/bin/env python3
"""Remove baked-in checkerboard / gray matte from character PNG sprites."""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("需要 Pillow 与 numpy: pip install pillow numpy", file=sys.stderr)
    sys.exit(1)

CHROMA_MAX = 18
LIGHT_MIN = 195


def strip_checkerboard(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    rgb = arr[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    chroma = maxc - minc
    avg = (r + g + b) / 3.0
    bg = (chroma < CHROMA_MAX) & (avg > LIGHT_MIN)
    arr[bg, 3] = 0
    return Image.fromarray(arr)


def crop_to_content(im: Image.Image, pad: int = 2) -> Image.Image:
    alpha = np.array(im.split()[3])
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return im
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(im.width, int(xs.max()) + pad + 1)
    y1 = min(im.height, int(ys.max()) + pad + 1)
    return im.crop((x0, y0, x1, y1))


def process_file(path: Path) -> bool:
    before = path.stat().st_size
    im = Image.open(path)
    if im.mode == "RGBA":
        alpha = im.split()[3]
        lo, hi = alpha.getextrema()
        if lo == 0 and hi == 255:
            # already has real transparency
            corners = [
                im.getpixel((0, 0))[3],
                im.getpixel((im.width - 1, 0))[3],
                im.getpixel((0, im.height - 1))[3],
            ]
            if any(a < 128 for a in corners):
                print(f"skip (already transparent): {path}")
                return False
    out = crop_to_content(strip_checkerboard(im))
    out.save(path, optimize=True)
    after = path.stat().st_size
    print(f"ok {path.name}: {before // 1024}KB -> {after // 1024}KB, {out.size[0]}x{out.size[1]} RGBA")
    return True


def main() -> int:
    root = Path(__file__).resolve().parents[1] / "public" / "assets" / "characters"
    if len(sys.argv) > 1:
        targets = [Path(p) for p in sys.argv[1:]]
    else:
        targets = sorted(root.rglob("*.png"))
        targets = [p for p in targets if "preview" not in p.parts]
    if not targets:
        print("no PNG files found", file=sys.stderr)
        return 1
    n = sum(process_file(p) for p in targets)
    print(f"processed {n}/{len(targets)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
