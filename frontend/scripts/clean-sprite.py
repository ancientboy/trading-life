#!/usr/bin/env python3
"""Clean furniture sprite PNGs: remove bg/checkerboard with minimal edge damage."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def _edge_bg(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = mx - mn
    white = (mx > 250) & (sat < 8)
    checker = (mx > 234) & (mx < 249) & (sat < 10)
    return white | checker


def clean_sprite(src: Path, dst: Path) -> None:
    im = Image.open(src).convert('RGBA')
    arr = np.array(im).astype(np.float32)
    h, w = arr.shape[:2]
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    bg = _edge_bg(r, g, b)
    seen = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []

    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny, nx] and bg[ny, nx]:
                seen[ny, nx] = True
                stack.append((nx, ny))

    keep = ~seen
    labels, count = ndimage.label(keep)
    if count:
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        keep = labels == sizes.argmax()

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, 0] = r.astype(np.uint8)
    out[:, :, 1] = g.astype(np.uint8)
    out[:, :, 2] = b.astype(np.uint8)
    out[:, :, 3] = np.where(keep, 255, 0).astype(np.uint8)

    result = Image.fromarray(out)
    bbox = result.getbbox()
    if bbox:
        result = result.crop(bbox)
    result.save(dst, 'PNG')
    print(f'cleaned {src.name} -> {dst.name} ({result.size[0]}x{result.size[1]})')


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    sprite_dir = root / 'public' / 'assets' / 'sprite'
    assets = Path('/Users/leo/.cursor/projects/Users-leo-Documents-trading-life/assets')

    jobs = [
        (assets / '____Web________7_-98e134ec-9d10-40af-8e7e-f47e30800272.png', sprite_dir / 'massage-bed.png'),
        (assets / '____Web________4_-a3b54987-a2a3-4e8f-9d4e-41b3d42f44d7.png', sprite_dir / 'rest-sofa.png'),
    ]
    for src, dst in jobs:
        if not src.exists():
            print(f'missing {src}', file=sys.stderr)
            sys.exit(1)
        clean_sprite(src, dst)


if __name__ == '__main__':
    main()
