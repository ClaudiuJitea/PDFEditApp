#!/usr/bin/env python3
"""Generate the app icon PNG used by Electron and electron-builder.

Usage:
  python3 build/generate-icon.py
  python3 build/generate-icon.py path/to/your-icon.png

If a custom source image is provided, it is resized to 1024x1024 and copied
to assets/icons/icon.png and build/icon.png.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS_ICON = ROOT / "assets" / "icons" / "icon.png"
BUILD_ICON = ROOT / "build" / "icon.png"
SIZE = 1024


def _rounded_rect(draw: ImageDraw.ImageDraw, box, radius: int, fill, outline=None, width: int = 1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def generate_brand_icon() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    bg = (1, 105, 111, 255)
    paper = (249, 248, 245, 255)
    accent = (1, 105, 111, 255)
    shadow = (0, 0, 0, 35)

    _rounded_rect(draw, (112, 112, 912, 912), 180, fill=shadow)
    _rounded_rect(draw, (96, 96, 896, 896), 180, fill=bg)

    _rounded_rect(draw, (250, 220, 760, 780), 72, fill=paper, outline=accent, width=18)
    draw.polygon([(520, 220), (760, 220), (760, 420), (520, 420)], fill=(243, 240, 236, 255))
    draw.line([(520, 220), (760, 420)], fill=accent, width=16)
    draw.line([(520, 220), (760, 220)], fill=accent, width=16)
    draw.line([(760, 220), (760, 420)], fill=accent, width=16)

    draw.line([(330, 620), (500, 450), (560, 510), (700, 360)], fill=accent, width=28)
    draw.line([(500, 450), (560, 510)], fill=accent, width=28)
    draw.ellipse((680, 330, 740, 390), outline=accent, width=20)

    return img


def write_icons(image: Image.Image) -> None:
    ASSETS_ICON.parent.mkdir(parents=True, exist_ok=True)
    BUILD_ICON.parent.mkdir(parents=True, exist_ok=True)
    icon = image.convert("RGBA")
    if icon.size != (SIZE, SIZE):
        icon = icon.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    icon.save(ASSETS_ICON, format="PNG")
    icon.save(BUILD_ICON, format="PNG")
    print(f"Wrote {ASSETS_ICON}")
    print(f"Wrote {BUILD_ICON}")


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        source = Path(argv[1]).expanduser().resolve()
        if not source.is_file():
            print(f"Source icon not found: {source}", file=sys.stderr)
            return 1
        write_icons(Image.open(source))
        return 0

    write_icons(generate_brand_icon())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
