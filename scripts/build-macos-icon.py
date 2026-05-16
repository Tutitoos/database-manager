#!/usr/bin/env python3
"""Wrap a flat source PNG into a macOS Big Sur-style icon template.

Output canvas: 1024x1024 transparent.
Safe area: 824x824 squircle centered (100px margin all sides).
Squircle = rounded rectangle with 185px corner radius (matches Apple's tooling
close enough for dock rendering).

Usage:
  python3 scripts/build-macos-icon.py src-tauri/icons/source.png \
                                      src-tauri/icons/icon.png
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

CANVAS = 1024
SAFE = 824
MARGIN = (CANVAS - SAFE) // 2  # 100
RADIUS = 185


def squircle_mask(size: int, radius: int) -> Image.Image:
    """Return an L-mode mask of a rounded rectangle (squircle approximation)."""
    # Render larger then downscale for antialiased edges.
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(big)
    draw.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return big.resize((size, size), Image.LANCZOS)


def main(src_path: str, dst_path: str) -> None:
    src = Image.open(src_path).convert("RGBA")
    # Fit source into SAFE x SAFE preserving aspect.
    src.thumbnail((SAFE, SAFE), Image.LANCZOS)
    # Background squircle filled with source's edge color (or just use source's
    # average bg). Easier: drop source straight into a SAFE-sized canvas, fill
    # remaining area with the source's top-left pixel (assumed BG).
    bg_canvas = Image.new("RGBA", (SAFE, SAFE), src.getpixel((1, 1)))
    # Center the (possibly smaller) src on bg_canvas.
    off = ((SAFE - src.width) // 2, (SAFE - src.height) // 2)
    bg_canvas.alpha_composite(src, dest=off)
    # Apply squircle mask.
    mask = squircle_mask(SAFE, RADIUS)
    masked = Image.new("RGBA", (SAFE, SAFE), (0, 0, 0, 0))
    masked.paste(bg_canvas, (0, 0), mask=mask)
    # Place onto 1024x1024 transparent canvas at MARGIN offset.
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.alpha_composite(masked, dest=(MARGIN, MARGIN))
    Path(dst_path).parent.mkdir(parents=True, exist_ok=True)
    out.save(dst_path, "PNG")
    print(f"wrote {dst_path}  ({CANVAS}x{CANVAS}, squircle {SAFE}px, margin {MARGIN}px)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
