import io
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


def test_edit_text_on_colored_background_keeps_color(app_client):
    client, token = app_client
    headers = {"X-PDFEdit-Token": token}

    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(0, 0, 200, 40))
    shape.finish(color=None, fill=(0.6, 0.85, 0.7))
    shape.commit()
    page.insert_text((10, 25), "INVOICE", fontsize=14, color=(0, 0, 0))
    text_rect = page.get_text("words")[0]
    orig_bbox = [text_rect[0], text_rect[1], text_rect[2], text_rect[3]]
    pdf_bytes = doc.tobytes()
    doc.close()

    upload = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(pdf_bytes), "invoice.pdf")},
        headers=headers,
    )
    assert upload.status_code == 200
    session_id = upload.get_json()["session_id"]

    save = client.post(
        f"/api/page/{session_id}/0/save",
        json={
            "elements": [{
                "type": "text",
                "text": "INVOICE009",
                "origin": "pdf",
                "originalPdfBbox": orig_bbox,
                "pdf_bbox": orig_bbox,
                "fontFamily": "Helvetica",
                "fontSize": 28,
                "fill": "#000000",
            }],
            "deleted_originals": [],
            "forms": [],
        },
        headers=headers,
    )
    assert save.status_code == 200

    exported = client.post(
        f"/api/export/{session_id}",
        json={"flatten": False},
        headers=headers,
    )
    assert exported.status_code == 200

    out = fitz.open(stream=exported.data, filetype="pdf")
    pix = out[0].get_pixmap(matrix=fitz.Matrix(3, 3), clip=fitz.Rect(*orig_bbox), alpha=False)
    out.close()

    colors = pix.samples
    # Sample a few pixels; background should stay greenish, not pure white.
    greens = [colors[i + 1] for i in range(0, min(len(colors), 300), 3)]
    assert max(greens) > 150
    assert sum(1 for g in greens if g > 200) > len(greens) * 0.3
