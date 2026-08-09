#!/usr/bin/env python3
"""Prepare app icons for Electron and electron-builder.

Usage:
  python3 build/generate-icon.py
  python3 build/generate-icon.py path/to/your-icon.png
  python3 build/generate-icon.py --brand

Default behavior uses assets/icons/icon.png when present. Writes:
  - build/icon.png (1024x1024 master)
  - build/icons/{size}x{size}.png (Linux icon set)
  - desktop/icon.png (bundled into the app for the window icon)

--brand regenerates assets/icons/icon.png from the in-app toolbar brand mark
(document + pencil) and refreshes all derived icons.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS_ICON = ROOT / "assets" / "icons" / "icon.png"
BUILD_ICON = ROOT / "build" / "icon.png"
BUILD_ICONS_DIR = ROOT / "build" / "icons"
DESKTOP_ICON = ROOT / "desktop" / "icon.png"
SIZE = 1024
LINUX_SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)

# Match backend/static/style.css light theme brand colors.
PRIMARY = (1, 105, 111, 255)
SURFACE = (249, 248, 245, 255)
SURFACE_2 = (251, 251, 249, 255)
# brand-mark tint: primary mixed ~9% into surface
MARK_BG = (227, 240, 240, 255)


def _rounded_rect(draw: ImageDraw.ImageDraw, box, radius: int, fill, outline=None, width: int = 1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def _scale_point(x: float, y: float, origin: float, scale: float) -> tuple[float, float]:
    return (origin + x * scale, origin + y * scale)


def _scale_points(points, origin: float, scale: float):
    return [_scale_point(x, y, origin, scale) for x, y in points]


def generate_brand_icon() -> Image.Image:
    """Render the toolbar brand mark (document + pencil) as a 1024 app icon."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Soft outer plate (matches .brand-mark look, sized for dock readability)
    pad = 48
    _rounded_rect(
        draw,
        (pad, pad, SIZE - pad, SIZE - pad),
        196,
        fill=MARK_BG,
        outline=PRIMARY,
        width=28,
    )

    # SVG artboard is 36x36; place glyph with padding inside the plate.
    glyph_pad = 170
    scale = (SIZE - 2 * glyph_pad) / 36.0
    origin = float(glyph_pad)

    def P(x: float, y: float) -> tuple[float, float]:
        return _scale_point(x, y, origin, scale)

    stroke = max(10, int(round(1.5 * scale)))

    # Document body
    doc = [P(11, 8.5), P(19, 8.5), P(24, 13.5), P(24, 26.5), P(22.5, 28), P(11, 28), P(9.5, 26.5), P(9.5, 10)]
    # Approximate rounded doc with polygon fill + outline paths
    doc_poly = [
        P(11, 8.5),
        P(19, 8.5),
        P(24, 13.5),
        P(24, 26.5),
        P(22.5, 28),
        P(11, 28),
        P(9.5, 26.5),
        P(9.5, 10),
        P(11, 8.5),
    ]
    draw.polygon(doc_poly, fill=SURFACE_2, outline=PRIMARY)
    # Fold corner
    draw.polygon([P(19, 8.5), P(24, 13.5), P(19, 13.5)], fill=SURFACE, outline=PRIMARY)
    draw.line([P(19, 8.5), P(19, 13.5), P(24, 13.5)], fill=PRIMARY, width=stroke, joint="curve")

    # Document outer stroke reinforcement
    draw.line([P(11, 8.5), P(19, 8.5)], fill=PRIMARY, width=stroke)
    draw.line([P(19, 8.5), P(24, 13.5)], fill=PRIMARY, width=stroke)
    draw.line([P(24, 13.5), P(24, 26.5)], fill=PRIMARY, width=stroke)
    draw.line([P(24, 26.5), P(11, 28)], fill=PRIMARY, width=stroke)
    draw.line([P(11, 28), P(9.5, 10), P(11, 8.5)], fill=PRIMARY, width=stroke)

    # Pencil body (diamond-ish tip path from SVG)
    pencil = [P(14, 22.6), P(21.8, 14.8), P(23.9231, 16.9231), P(16.1, 24.7), P(12.8, 25.4), P(13.5, 22.1)]
    draw.polygon(pencil, fill=SURFACE, outline=PRIMARY)
    for a, b in zip(pencil, pencil[1:] + pencil[:1]):
        draw.line([a, b], fill=PRIMARY, width=stroke)

    # Pencil tip highlight line
    draw.line([P(19.9, 16.7), P(22, 18.8)], fill=PRIMARY, width=stroke)

    return img


def normalize_icon(image: Image.Image) -> Image.Image:
    icon = image.convert("RGBA")
    if icon.size != (SIZE, SIZE):
        icon = icon.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return icon


def write_icon_set(image: Image.Image) -> None:
    icon = normalize_icon(image)

    BUILD_ICON.parent.mkdir(parents=True, exist_ok=True)
    BUILD_ICONS_DIR.mkdir(parents=True, exist_ok=True)
    DESKTOP_ICON.parent.mkdir(parents=True, exist_ok=True)

    icon.save(BUILD_ICON, format="PNG")
    icon.save(DESKTOP_ICON, format="PNG")
    print(f"Wrote {BUILD_ICON}")
    print(f"Wrote {DESKTOP_ICON}")

    for size in LINUX_SIZES:
        out = BUILD_ICONS_DIR / f"{size}x{size}.png"
        resized = icon if size == SIZE else icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(out, format="PNG")
        print(f"Wrote {out}")


def write_assets_and_build(image: Image.Image) -> None:
    ASSETS_ICON.parent.mkdir(parents=True, exist_ok=True)
    icon = normalize_icon(image)
    icon.save(ASSETS_ICON, format="PNG")
    print(f"Wrote {ASSETS_ICON}")
    write_icon_set(icon)


def main(argv: list[str]) -> int:
    force_brand = "--brand" in argv
    args = [a for a in argv[1:] if a != "--brand"]

    if args:
        source = Path(args[0]).expanduser().resolve()
        if not source.is_file():
            print(f"Source icon not found: {source}", file=sys.stderr)
            return 1
        write_assets_and_build(Image.open(source))
        return 0

    if force_brand or not ASSETS_ICON.is_file():
        write_assets_and_build(generate_brand_icon())
        return 0

    write_icon_set(Image.open(ASSETS_ICON))
    print(f"Using existing icon from {ASSETS_ICON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
