import io
import sys
from collections import Counter
from pathlib import Path

import fitz

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import _pdf_fill_for_rect, _sample_rect_background_rgb


def _invoice_like_pdf():
    """A4-ish page: green header band, white body (page corners are white)."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(0, 0, 595, 48))
    shape.finish(color=None, fill=(0.6, 0.85, 0.7))
    shape.commit()
    page.insert_text((40, 32), "INVOICE", fontsize=18, color=(0, 0, 0))
    words = page.get_text("words")
    assert words, "expected header text"
    orig_bbox = [words[0][0], words[0][1], words[0][2], words[0][3]]
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes, orig_bbox


def _dominant_nonglyph_colors(pix, ink_threshold=40, top_n=5):
    counts = Counter()
    samples = pix.samples
    for i in range(0, len(samples) - 2, 3):
        r, g, b = samples[i], samples[i + 1], samples[i + 2]
        if r < ink_threshold and g < ink_threshold and b < ink_threshold:
            continue
        counts[(r, g, b)] += 1
    return counts.most_common(top_n)


def test_sample_rect_background_on_colored_header():
    pdf_bytes, orig_bbox = _invoice_like_pdf()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    rgb = _sample_rect_background_rgb(page, fitz.Rect(*orig_bbox))
    assert rgb[1] > 150
    assert rgb[0] < 200

    fill = _pdf_fill_for_rect(page, fitz.Rect(*orig_bbox))
    assert fill[1] > 0.5
    corner = page.get_pixmap(clip=fitz.Rect(2, 800, 12, 810), alpha=False)
    assert corner.samples[0] > 240
    doc.close()


def test_edit_text_on_colored_background_keeps_color(app_client):
    client, token = app_client
    headers = {"X-PDFEdit-Token": token}

    pdf_bytes, orig_bbox = _invoice_like_pdf()
    original_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    original_pix = original_doc[0].get_pixmap(
        matrix=fitz.Matrix(3, 3),
        clip=fitz.Rect(0, 0, 220, 48),
        alpha=False,
    )
    original_green = _dominant_nonglyph_colors(original_pix)[0][0]
    original_doc.close()

    upload = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(pdf_bytes), "invoice.pdf")},
        headers=headers,
    )
    assert upload.status_code == 200
    session_id = upload.get_json()["session_id"]

    # New text is longer than "INVOICE"; editor sends the expanded fabric bounds.
    new_bbox = [orig_bbox[0], orig_bbox[1], orig_bbox[0] + 160, orig_bbox[3] + 2]

    save = client.post(
        f"/api/page/{session_id}/0/save",
        json={
            "elements": [{
                "type": "text",
                "text": "INVOICE005",
                "origin": "pdf",
                "originalPdfBbox": orig_bbox,
                "pdf_bbox": new_bbox,
                "fontFamily": "Helvetica",
                "fontSize": 36,
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
    saved_text = " ".join(out[0].get_text().split())
    assert "INVOICE005" in saved_text
    assert saved_text.count("INVOICE") == 1

    pix = out[0].get_pixmap(
        matrix=fitz.Matrix(3, 3),
        clip=fitz.Rect(0, 0, 220, 48),
        alpha=False,
    )
    out.close()

    top = _dominant_nonglyph_colors(pix, top_n=8)
    assert top, "expected header pixels"
    dominant = top[0][0]
    # Exact original vector green must remain (no second painted patch shade).
    assert dominant == original_green, f"header green changed: {dominant} vs {original_green}"

    near_original = [
        color for color, _count in top
        if abs(color[0] - original_green[0]) <= 3
        and abs(color[1] - original_green[1]) <= 3
        and abs(color[2] - original_green[2]) <= 3
    ]
    assert len(near_original) == 1, f"extra green patch shades detected: {top}"

    whites = sum(
        1
        for i in range(0, len(pix.samples) - 2, 3)
        if pix.samples[i] > 240 and pix.samples[i + 1] > 240 and pix.samples[i + 2] > 240
    )
    total = max(1, len(pix.samples) // 3)
    assert whites / total < 0.15, f"white redaction patch detected: whites={whites} total={total}"
