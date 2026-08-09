import sys
from pathlib import Path

import fitz

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import _pdf_fill_for_rect, _sample_rect_background_rgb


def test_sample_rect_background_on_colored_header():
    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(0, 0, 200, 40))
    shape.finish(color=None, fill=(0.6, 0.85, 0.7))
    shape.commit()
    page.insert_text((10, 25), "INVOICE", fontsize=14, color=(0, 0, 0))

    rgb = _sample_rect_background_rgb(page, fitz.Rect(8, 10, 80, 30))
    assert rgb[1] > 150
    assert rgb[0] < 200

    fill = _pdf_fill_for_rect(page, fitz.Rect(8, 10, 80, 30))
    assert fill[1] > 0.5
    doc.close()
