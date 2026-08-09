import base64
import csv
import io
import json
import math
import os
import sys
import uuid
import zipfile

import fitz
from flask import Flask, jsonify, request, send_file, render_template
from flask_cors import CORS
from PIL import Image, ImageDraw

import desktop_config
import session_storage as store
import ai_settings
import ai_service
from ai_service import AIServiceError
from cert_sign import CertificateSignError, sign_pdf_bytes_with_pkcs12
from cert_generate import CertificateGenerateError, generate_self_signed_pkcs12

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

RENDER_SCALE = 2.0

sessions = {}
_app_initialized = False


def create_app():
    global _app_initialized
    if _app_initialized:
        return app

    origins = desktop_config.ALLOWED_ORIGINS or [
        f"http://{desktop_config.HOST}:{desktop_config.PORT}",
        f"http://127.0.0.1:{desktop_config.PORT}",
        f"http://localhost:{desktop_config.PORT}",
        "null",
    ]
    CORS(
        app,
        resources={r"/api/*": {"origins": origins}},
        supports_credentials=True,
        allow_headers=["Content-Type", "X-PDFEdit-Token", "X-AI-Settings-Token"],
    )

    desktop_config.ensure_runtime_dirs()
    desktop_config.configure_tesseract()
    store.ensure_data_dirs()
    store.migrate_legacy_sessions()
    store.cleanup_stale_sessions()

    @app.before_request
    def _require_auth_token():
        if request.method == "OPTIONS":
            return None
        if request.path in {"/", "/favicon.ico"} or request.path.startswith("/static/"):
            return None
        if request.path == "/api/health":
            return None
        provided = (request.headers.get("X-PDFEdit-Token") or "").strip()
        if provided != desktop_config.AUTH_TOKEN:
            return jsonify({"error": "Unauthorized"}), 401
        return None

    _app_initialized = True
    return app


create_app()

PAGE_SIZES = {
    "A4": (595, 842),
    "Letter": (612, 792),
    "Legal": (612, 1008),
    "A3": (842, 1191),
    "A5": (420, 595),
}

FONT_MAP = {
    "Helvetica": "helv",
    "Helvetica-Bold": "hebo",
    "Helvetica-Oblique": "heit",
    "Helvetica-BoldOblique": "hebi",
    "Times-Roman": "tiro",
    "Times-Bold": "tibo",
    "Times-Italic": "tiit",
    "Times-BoldItalic": "tibi",
    "Courier": "cour",
    "Courier-Bold": "cobo",
    "Courier-Oblique": "coit",
    "Courier-BoldOblique": "cobi",
}

WIDGET_KIND_MAP = {
    fitz.PDF_WIDGET_TYPE_TEXT: "text",
    fitz.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    fitz.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    fitz.PDF_WIDGET_TYPE_COMBOBOX: "choice",
    fitz.PDF_WIDGET_TYPE_LISTBOX: "listbox",
}

WIDGET_TYPE_MAP = {
    "text": fitz.PDF_WIDGET_TYPE_TEXT,
    "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
    "radio": fitz.PDF_WIDGET_TYPE_RADIOBUTTON,
    "choice": fitz.PDF_WIDGET_TYPE_COMBOBOX,
    "listbox": fitz.PDF_WIDGET_TYPE_LISTBOX,
}

STAMP_PRESETS = {
    "approved": "APPROVED",
    "draft": "DRAFT",
    "confidential": "CONFIDENTIAL",
    "void": "VOID",
    "rejected": "REJECTED",
    "copy": "COPY",
    "received": "RECEIVED",
    "sample": "SAMPLE",
    "reviewed": "REVIEWED",
    "original": "ORIGINAL",
    "urgent": "URGENT",
    "final": "FINAL",
    "cancelled": "CANCELLED",
    "not_for_distribution": "NOT FOR DISTRIBUTION",
}

STAMP_FALLBACK_LIBRARY = {
    "approved": {
        "preset": "approved", "text": "APPROVED", "shape": "rounded",
        "fill": "#15803d", "fillOpacity": 0.09, "stroke": "#15803d", "textColor": "#14532d",
        "strokeWidth": 2.5, "dashed": False, "doubleBorder": False, "cross": False,
        "checkmark": True, "strike": False, "defaultRotation": -8,
    },
    "draft": {
        "preset": "draft", "text": "DRAFT", "shape": "rect",
        "fill": "#2563eb", "fillOpacity": 0.11, "stroke": "#2563eb", "textColor": "#1d4ed8",
        "strokeWidth": 2, "dashed": True, "doubleBorder": False, "cross": False,
        "checkmark": False, "strike": False, "defaultRotation": 0,
    },
    "confidential": {
        "preset": "confidential", "text": "CONFIDENTIAL", "shape": "double",
        "fill": "#b91c1c", "fillOpacity": 0.1, "stroke": "#b91c1c", "textColor": "#991b1b",
        "strokeWidth": 2.5, "dashed": False, "doubleBorder": True, "cross": False,
        "checkmark": False, "strike": False, "defaultRotation": 0,
    },
    "void": {
        "preset": "void", "text": "VOID", "shape": "cross",
        "fill": "#374151", "fillOpacity": 0.07, "stroke": "#374151", "textColor": "#1f2937",
        "strokeWidth": 3.5, "dashed": False, "doubleBorder": False, "cross": True,
        "checkmark": False, "strike": True, "defaultRotation": -22,
    },
    "rejected": {
        "preset": "rejected", "text": "REJECTED", "shape": "rounded",
        "fill": "#dc2626", "fillOpacity": 0.12, "stroke": "#dc2626", "textColor": "#b91c1c",
        "strokeWidth": 3, "dashed": False, "doubleBorder": False, "cross": True,
        "checkmark": False, "strike": False, "defaultRotation": -8,
    },
    "copy": {
        "preset": "copy", "text": "COPY", "shape": "rect",
        "fill": "#64748b", "fillOpacity": 0.1, "stroke": "#475569", "textColor": "#334155",
        "strokeWidth": 2, "dashed": True, "doubleBorder": False, "cross": False,
        "checkmark": False, "strike": False, "defaultRotation": 0,
    },
    "received": {
        "preset": "received", "text": "RECEIVED", "shape": "rounded",
        "fill": "#0284c7", "fillOpacity": 0.12, "stroke": "#0284c7", "textColor": "#0369a1",
        "strokeWidth": 2.5, "dashed": False, "doubleBorder": False, "cross": False,
        "checkmark": False, "strike": False, "defaultRotation": 0,
    },
    "sample": {
        "preset": "sample", "text": "SAMPLE", "shape": "rect",
        "fill": "#ea580c", "fillOpacity": 0.12, "stroke": "#ea580c", "textColor": "#c2410c",
        "strokeWidth": 2, "dashed": True, "doubleBorder": False, "cross": False,
        "checkmark": False, "strike": False, "defaultRotation": 0,
    },
}


def stamp_config_for_key(stamp_key, stamp_text=None):
    """Build a stampConfig dict for legacy elements missing stampConfig."""
    key = (stamp_key or "approved").lower()
    base = dict(STAMP_FALLBACK_LIBRARY.get(key, STAMP_FALLBACK_LIBRARY["approved"]))
    label = stamp_text or STAMP_PRESETS.get(key, key.upper())
    base["text"] = str(label).upper()
    if key not in STAMP_FALLBACK_LIBRARY:
        base["preset"] = "approved"
    return base


def stamp_sign_column(rect):
    w = rect.width
    h = rect.height
    x0, y0 = rect.x0, rect.y0
    col_left = w * 0.07
    col_right = w * 0.36
    cx = x0 + (col_left + col_right) / 2.0
    cy = y0 + h / 2.0
    span = min(col_right - col_left, h * 0.52)
    return cx, cy, span


def stamp_resolve_sign(config):
    sign = (config or {}).get("sign")
    if sign:
        return str(sign).lower()
    if (config or {}).get("checkmark"):
        return "check"
    return "none"


def stamp_sign_offset(config):
    offset = (config or {}).get("signOffset") or (config or {}).get("checkmarkOffset") or {}
    try:
        return float(offset.get("x") or 0), float(offset.get("y") or 0)
    except (TypeError, ValueError):
        return 0.0, 0.0


def draw_stamp_sign(page, rect, config, stroke, stroke_w):
    sign = stamp_resolve_sign(config)
    if sign in ("", "none"):
        return

    cx, cy, span = stamp_sign_column(rect)
    offset_x, offset_y = stamp_sign_offset(config)
    cx += offset_x
    cy += offset_y
    pad = span * 0.34
    width = max(1.5, stroke_w * 0.95)

    shape = page.new_shape()

    if sign == "check":
        points = stamp_checkmark_points(rect)
        if offset_x or offset_y:
            points = [fitz.Point(p.x + offset_x, p.y + offset_y) for p in points]
        shape.draw_polyline(points)
    elif sign == "x":
        shape.draw_line(fitz.Point(cx - pad, cy - pad), fitz.Point(cx + pad, cy + pad))
        shape.draw_line(fitz.Point(cx + pad, cy - pad), fitz.Point(cx - pad, cy + pad))
    elif sign == "star":
        points = []
        for i in range(10):
            angle = (-math.pi / 2.0) + (i * math.pi / 5.0)
            radius = pad * 1.05 if i % 2 == 0 else pad * 0.44
            points.append(fitz.Point(cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
        points.append(points[0])
        shape.draw_polyline(points)
    elif sign == "exclamation":
        shape.draw_line(
            fitz.Point(cx, cy - pad * 0.95),
            fitz.Point(cx, cy + pad * 0.15),
        )
        shape.finish(color=stroke, width=width, lineCap=1, lineJoin=1)
        page.draw_circle(fitz.Point(cx, cy + pad * 0.72), max(1.5, span * 0.08), color=stroke, fill=stroke)
        return
    elif sign == "arrow":
        shape.draw_line(fitz.Point(cx - pad * 0.85, cy), fitz.Point(cx + pad * 0.45, cy))
        shape.draw_line(fitz.Point(cx + pad * 0.05, cy - pad * 0.55), fitz.Point(cx + pad * 0.75, cy))
        shape.draw_line(fitz.Point(cx + pad * 0.75, cy), fitz.Point(cx + pad * 0.05, cy + pad * 0.55))
    elif sign == "info":
        shape.draw_circle(fitz.Point(cx, cy), pad * 0.95)
        shape.finish(color=stroke, width=max(1.0, width * 0.85))
        shape = page.new_shape()
        shape.draw_line(fitz.Point(cx, cy - pad * 0.35), fitz.Point(cx, cy + pad * 0.2))
        shape.finish(color=stroke, width=max(1.0, width * 0.8), lineCap=1, lineJoin=1)
        page.draw_circle(fitz.Point(cx, cy + pad * 0.58), max(1.5, span * 0.07), color=stroke, fill=stroke)
        return
    elif sign == "shield":
        top = cy - pad * 0.95
        bottom = cy + pad * 0.95
        points = [
            fitz.Point(cx, top),
            fitz.Point(cx + pad * 0.95, top + pad * 0.45),
            fitz.Point(cx + pad * 0.75, bottom),
            fitz.Point(cx, bottom - pad * 0.15),
            fitz.Point(cx - pad * 0.75, bottom),
            fitz.Point(cx - pad * 0.95, top + pad * 0.45),
        ]
        shape.draw_polyline(points + [points[0]])
    elif sign == "minus":
        shape.draw_line(fitz.Point(cx - pad * 0.85, cy), fitz.Point(cx + pad * 0.85, cy))
    else:
        return

    shape.finish(color=stroke, width=width, lineCap=1, lineJoin=1)


def stamp_text_offset(config):
    offset = (config or {}).get("textOffset") or {}
    try:
        return float(offset.get("x") or 0), float(offset.get("y") or 0)
    except (TypeError, ValueError):
        return 0.0, 0.0


def stamp_pdf_font_family(config):
    raw = (config or {}).get("fontFamily") or "Helvetica"
    return str(raw).split(",")[0].strip().strip('"').strip("'") or "Helvetica"
    try:
        weight = int(float(font_weight))
        return weight >= 600
    except (TypeError, ValueError):
        return str(font_weight or "").lower() in ("bold", "bolder", "600", "700", "800", "900")


def stamp_checkmark_points(rect):
    """Bold two-stroke approval check in the stamp's left column."""
    w = rect.width
    h = rect.height
    x0, y0 = rect.x0, rect.y0
    col_left = w * 0.07
    col_right = w * 0.36
    cx = x0 + (col_left + col_right) / 2.0
    cy = y0 + h / 2.0
    span = min(col_right - col_left, h * 0.52)
    return [
        fitz.Point(cx - span * 0.38, cy + span * 0.12),
        fitz.Point(cx - span * 0.08, cy + span * 0.38),
        fitz.Point(cx + span * 0.42, cy - span * 0.38),
    ]


def stamp_morph(rect, rotation_deg):
    if not rotation_deg:
        return None
    cx = (rect.x0 + rect.x1) / 2.0
    cy = (rect.y0 + rect.y1) / 2.0
    return fitz.Point(cx, cy), fitz.Matrix(rotation_deg)


def draw_stamp_from_config(page, rect, config):
    """Render a stamp from the editor's stampConfig payload."""
    if rect.is_empty or not config:
        return

    text = (config.get("text") or "STAMP").upper()
    shape = (config.get("shape") or "rounded").lower()
    if shape in ("circle", "triangle", "hexagon"):
        shape = "rounded"
    stroke = parse_color_input(config.get("stroke", "#cc0000")) or (0.8, 0, 0)
    text_color = parse_color_input(config.get("textColor", config.get("stroke", "#cc0000"))) or stroke
    fill_hex = config.get("fill", "#cc0000")
    fill_opacity = float(config.get("fillOpacity", 0.12) or 0.12)
    fill_rgb = parse_color_input(fill_hex) or (1.0, 1.0, 1.0)
    fill = (
        fill_rgb[0] * fill_opacity + (1 - fill_opacity),
        fill_rgb[1] * fill_opacity + (1 - fill_opacity),
        fill_rgb[2] * fill_opacity + (1 - fill_opacity),
    )
    stroke_w = float(config.get("strokeWidth", 2) or 2)
    dashed = bool(config.get("dashed"))
    cross = bool(config.get("cross")) or shape == "cross"
    double_border = bool(config.get("doubleBorder")) or shape == "double"
    rotation = float(config.get("angle") if config.get("angle") is not None else config.get("defaultRotation", 0))

    target = rect
    morph = stamp_morph(target, rotation) if rotation else None

    def commit_shape(shape_obj):
        if morph:
            shape_obj.commit(morph=morph)
        else:
            shape_obj.commit()

    dashes = "[6 3] 0" if dashed else None
    finish_kw = {"color": stroke, "fill": fill, "width": stroke_w}
    if dashes:
        finish_kw["dashes"] = dashes

    if shape == "ellipse":
        cx = (target.x0 + target.x1) / 2.0
        cy = (target.y0 + target.y1) / 2.0
        rx = target.width / 2.0
        ry = target.height / 2.0
        shape_obj = page.new_shape()
        shape_obj.draw_oval(fitz.Rect(cx - rx, cy - ry, cx + rx, cy + ry))
        shape_obj.finish(**finish_kw)
        commit_shape(shape_obj)
    elif shape != "cross":
        radius = 4 if shape == "rounded" else 0
        shape_obj = page.new_shape()
        draw_shape_rect(shape_obj, target, corner_radius=radius)
        shape_obj.finish(**finish_kw)
        commit_shape(shape_obj)

    if double_border:
        inset = max(3.0, min(target.width, target.height) * 0.08)
        inner = fitz.Rect(
            target.x0 + inset,
            target.y0 + inset,
            target.x1 - inset,
            target.y1 - inset,
        )
        inner_shape = page.new_shape()
        draw_shape_rect(inner_shape, inner)
        inner_shape.finish(color=stroke, fill=None, width=max(1.0, stroke_w * 0.6), dashes=dashes)
        commit_shape(inner_shape)

    if cross:
        pad = max(6.0, min(target.width, target.height) * 0.12)
        cross_shape = page.new_shape()
        cross_shape.draw_line(
            fitz.Point(target.x0 + pad, target.y0 + pad),
            fitz.Point(target.x1 - pad, target.y1 - pad),
        )
        cross_shape.draw_line(
            fitz.Point(target.x1 - pad, target.y0 + pad),
            fitz.Point(target.x0 + pad, target.y1 - pad),
        )
        cross_shape.finish(color=stroke, width=stroke_w * 0.9)
        commit_shape(cross_shape)

    draw_stamp_sign(page, target, config, stroke, stroke_w)

    has_sign = stamp_resolve_sign(config) not in ("", "none")
    text_offset_x, text_offset_y = stamp_text_offset(config)

    if has_sign:
        text_rect = fitz.Rect(
            target.x0 + target.width * 0.40 + text_offset_x,
            target.y0 + target.height * 0.2 + text_offset_y,
            target.x1 - target.width * 0.05 + text_offset_x,
            target.y1 - target.height * 0.2 + text_offset_y,
        )
        fontsize = float(config.get("fontSize") or 0) or max(9, min(17, target.height * 0.36))
    else:
        pad_x = target.width * 0.08
        pad_y = target.height * 0.18
        text_rect = fitz.Rect(
            target.x0 + pad_x + text_offset_x,
            target.y0 + pad_y + text_offset_y,
            target.x1 - pad_x + text_offset_x,
            target.y1 - pad_y + text_offset_y,
        )
        fontsize = float(config.get("fontSize") or 0) or max(9, min(22, target.height * 0.38))

    font_family = stamp_pdf_font_family(config)
    font_weight = config.get("fontWeight") or "bold"
    fontname = pdf_font_name(font_family, bold=stamp_font_is_bold(font_weight))

    page.insert_textbox(
        text_rect,
        text,
        fontname=fontname,
        fontsize=fontsize,
        color=text_color,
        align=fitz.TEXT_ALIGN_CENTER,
    )

    if config.get("strike"):
        strike_y = (text_rect.y0 + text_rect.y1) / 2.0 + (text_rect.height * 0.08)
        page.draw_line(
            fitz.Point(target.x0 + target.width * 0.14, strike_y),
            fitz.Point(target.x1 - target.width * 0.14, strike_y),
            color=text_color,
            width=1.4,
        )


def pdf_font_name(family, bold=False, italic=False):
    base = family or "Helvetica"
    if base in ("Arial", "Verdana", "Trebuchet MS", "Georgia", "Palatino", "Garamond", "Comic Sans MS"):
        base = "Helvetica"
    if base == "Helvetica":
        if bold and italic:
            return "hebi"
        if bold:
            return "hebo"
        if italic:
            return "heit"
        return "helv"
    if base in ("Times New Roman", "Times-Roman", "Times"):
        if bold and italic:
            return "tibi"
        if bold:
            return "tibo"
        if italic:
            return "tiit"
        return "tiro"
    if base in ("Courier", "Courier New"):
        if bold and italic:
            return "cobi"
        if bold:
            return "cobo"
        if italic:
            return "coit"
        return "cour"
    return "helv"


def pdf_text_align(align):
    mapping = {
        "left": fitz.TEXT_ALIGN_LEFT,
        "center": fitz.TEXT_ALIGN_CENTER,
        "right": fitz.TEXT_ALIGN_RIGHT,
        "justify": fitz.TEXT_ALIGN_JUSTIFY,
    }
    return mapping.get((align or "left").lower(), fitz.TEXT_ALIGN_LEFT)


def validate_pdf_magic(data):
    if len(data) < 5:
        return False
    return data[:5] == b"%PDF-"


def _sample_page_background(img, width, height):
    corners = [(2, 2), (width - 3, 2), (2, height - 3), (width - 3, height - 3)]
    samples = []
    for x, y in corners:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                sx = max(0, min(width - 1, x + dx))
                sy = max(0, min(height - 1, y + dy))
                samples.append(img.getpixel((sx, sy)))
    if not samples:
        return (255, 255, 255)
    samples.sort()
    return samples[len(samples) // 2]


def _quantize_rgb(color, step=8):
    return tuple(min(255, (channel // step) * step) for channel in color[:3])


def _sample_rect_background_rgb(page, rect, dpi_scale=3.0):
    """Estimate the local background color inside a PDF rect (RGB 0-255)."""
    if rect.is_empty:
        return (255, 255, 255)

    clip = fitz.Rect(rect)
    clip.normalize()
    if clip.is_empty:
        return (255, 255, 255)

    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(dpi_scale, dpi_scale), clip=clip, alpha=False)
    except Exception:
        return (255, 255, 255)

    if pix.width < 1 or pix.height < 1:
        return (255, 255, 255)

    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    counts = {}
    for pixel in img.getdata():
        key = _quantize_rgb(pixel)
        counts[key] = counts.get(key, 0) + 1

    if not counts:
        return (255, 255, 255)

    return max(counts.items(), key=lambda item: item[1])[0]


def _rgb255_to_pdf_fill(color):
    return (color[0] / 255.0, color[1] / 255.0, color[2] / 255.0)


def _pdf_fill_for_rect(page, rect):
    return _rgb255_to_pdf_fill(_sample_rect_background_rgb(page, rect))


def _page_background_pdf_fill(page, dpi_scale=2.0):
    """Match web editor masking: sample page corners for a consistent fill color."""
    mat = fitz.Matrix(dpi_scale, dpi_scale)
    pix = page.get_pixmap(matrix=mat, alpha=False, annots=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return _rgb255_to_pdf_fill(_sample_page_background(img, pix.width, pix.height))


def _cover_with_color(draw, page, bbox, dpi_scale, color, pad=4):
    view_bbox = page_rect_to_view(page, bbox)
    x0 = int(view_bbox[0] * dpi_scale)
    y0 = int(view_bbox[1] * dpi_scale)
    x1 = int(view_bbox[2] * dpi_scale)
    y1 = int(view_bbox[3] * dpi_scale)
    draw.rectangle(
        [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
        fill=color,
    )


def normalize_text_for_compare(text):
    return " ".join((text or "").split())


def bbox_area(bbox):
    if not bbox or len(bbox) < 4:
        return 0
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def bbox_overlap_ratio(bbox_a, bbox_b):
    if not bbox_a or not bbox_b or len(bbox_a) < 4 or len(bbox_b) < 4:
        return 0

    inter_x0 = max(bbox_a[0], bbox_b[0])
    inter_y0 = max(bbox_a[1], bbox_b[1])
    inter_x1 = min(bbox_a[2], bbox_b[2])
    inter_y1 = min(bbox_a[3], bbox_b[3])

    inter_w = max(0, inter_x1 - inter_x0)
    inter_h = max(0, inter_y1 - inter_y0)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0

    smallest_area = min(bbox_area(bbox_a), bbox_area(bbox_b))
    if smallest_area <= 0:
        return 0

    return inter_area / smallest_area


def append_unique_text_element(elements, candidate):
    candidate_text = normalize_text_for_compare(candidate.get("text", ""))
    if not candidate_text:
        return

    for idx, existing in enumerate(elements):
        if existing.get("type") != "text":
            continue
        if normalize_text_for_compare(existing.get("text", "")) != candidate_text:
            continue
        if bbox_overlap_ratio(existing.get("pdf_bbox"), candidate.get("pdf_bbox")) < 0.85:
            continue

        existing_area = bbox_area(existing.get("pdf_bbox"))
        candidate_area = bbox_area(candidate.get("pdf_bbox"))
        if candidate_area and (not existing_area or candidate_area < existing_area):
            elements[idx] = candidate
        return

    elements.append(candidate)


def normalized_page_rotation(page):
    return int(getattr(page, "rotation", 0) or 0) % 360


def rect_to_list(rect):
    return [rect.x0, rect.y0, rect.x1, rect.y1]


def page_rect_to_view(page, bbox):
    rect = fitz.Rect(bbox)
    if normalized_page_rotation(page):
        rect = rect * page.rotation_matrix
    return rect_to_list(rect)


def page_rect_to_pdf(page, bbox):
    rect = fitz.Rect(bbox)
    if normalized_page_rotation(page):
        rect = rect * page.derotation_matrix
    return rect_to_list(rect)


def page_point_to_view(page, point):
    pt = fitz.Point(point)
    if normalized_page_rotation(page):
        pt = pt * page.rotation_matrix
    return pt


def page_point_to_pdf(page, point):
    pt = fitz.Point(point)
    if normalized_page_rotation(page):
        pt = pt * page.derotation_matrix
    return pt


def scaled_view_bbox(page, bbox, scale):
    view_bbox = page_rect_to_view(page, bbox)
    return [coord * scale for coord in view_bbox]


def expand_text_redact_rect(page, rect, pad_x=2.0, pad_top=6.0, pad_bottom=3.0):
    """Pad a text bbox so redaction covers ascenders and minor coordinate drift."""
    if rect.is_empty:
        return rect
    page_rect = page.rect
    expanded = fitz.Rect(
        max(page_rect.x0, rect.x0 - pad_x),
        max(page_rect.y0, rect.y0 - pad_top),
        min(page_rect.x1, rect.x1 + pad_x),
        min(page_rect.y1, rect.y1 + pad_bottom),
    )
    return expanded if not expanded.is_empty else rect


def resolve_elem_pdf_bbox(page, elem, default_width, default_height):
    pdf_bbox = elem.get("pdf_bbox")
    if isinstance(pdf_bbox, list) and len(pdf_bbox) == 4:
        return page_rect_to_pdf(page, pdf_bbox)

    canvas_bbox = elem.get("bbox", elem.get("left", 0))
    if isinstance(canvas_bbox, list) and len(canvas_bbox) == 4:
        return page_rect_to_pdf(page, [c / 2.0 for c in canvas_bbox])

    left = elem.get("left", 0) / 2.0
    top = elem.get("top", 0) / 2.0
    width = float(elem.get("width", default_width)) / 2.0
    height = float(elem.get("height", default_height)) / 2.0
    return page_rect_to_pdf(page, [left, top, left + width, top + height])


def span_color_to_hex(span):
    color = span.get("color", 0)
    if isinstance(color, int):
        r = (color >> 16) & 0xFF
        g = (color >> 8) & 0xFF
        b = color & 0xFF
        return "#{:02x}{:02x}{:02x}".format(r, g, b)
    return "#000000"


def normalize_font_family(font_name):
    name = font_name or "Helvetica"
    if "Times" in name:
        return "Times New Roman"
    if "Courier" in name:
        return "Courier New"
    if "Arial" in name:
        return "Helvetica"
    return "Helvetica"


OCR_EDITOR_FONTS = frozenset({
    "Helvetica",
    "Times New Roman",
    "Courier New",
    "Arial",
    "Georgia",
    "Verdana",
    "Trebuchet MS",
    "Palatino",
    "Garamond",
    "Comic Sans MS",
})

def normalize_ocr_font_family(font_name):
    name = (font_name or "").strip()
    if name in OCR_EDITOR_FONTS:
        return name
    return "Helvetica"


def _ocr_bool_flag(value, true_tokens=()):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in ("true", "1", "yes", "on"):
        return True
    if text in ("false", "0", "no", "off", ""):
        return False
    return any(text == t or t in text for t in true_tokens)


def _ocr_fill_from_block(block):
    for key in ("color", "fill", "textColor", "text_color"):
        raw = block.get(key)
        if not raw:
            continue
        rgb = parse_color_input(str(raw).strip())
        if rgb:
            return color_to_hex(*rgb)
    return "#111111"


def ocr_style_from_block(block, line_h_pt, scale, font_family="Helvetica"):
    block = block if isinstance(block, dict) else {}
    line_h = max(float(line_h_pt or 12), 12.0)
    default_size = min(20.0, max(10.0, line_h * scale * 0.65))

    font_family = normalize_ocr_font_family(font_family)

    font_size = default_size
    for key in ("fontSize", "font_size", "size"):
        raw = block.get(key)
        if raw is None:
            continue
        try:
            candidate = float(raw)
        except (TypeError, ValueError):
            continue
        if 6.0 <= candidate <= 200.0:
            font_size = candidate
            break

    bold = _ocr_bool_flag(block.get("bold"), ("bold", "semibold", "heavy"))
    if not bold:
        weight = block.get("fontWeight") or block.get("font_weight")
        if weight is not None:
            try:
                bold = float(weight) >= 600
            except (TypeError, ValueError):
                bold = _ocr_bool_flag(weight, ("bold", "600", "700", "800", "900"))

    italic = _ocr_bool_flag(block.get("italic"), ("italic", "oblique"))
    if not italic:
        style = block.get("fontStyle") or block.get("font_style")
        if style:
            italic = _ocr_bool_flag(style, ("italic", "oblique"))

    return {
        "fontFamily": font_family,
        "fontSize": font_size,
        "fill": _ocr_fill_from_block(block),
        "bold": bold,
        "italic": italic,
    }


def union_bboxes(boxes):
    valid_boxes = [bbox for bbox in boxes if bbox and len(bbox) == 4]
    if not valid_boxes:
        return None
    return [
        min(bbox[0] for bbox in valid_boxes),
        min(bbox[1] for bbox in valid_boxes),
        max(bbox[2] for bbox in valid_boxes),
        max(bbox[3] for bbox in valid_boxes),
    ]


def drawing_bbox_from_items(items, stroke_width=1):
    points = []

    def append_payload_points(payload):
        if payload is None:
            return
        if hasattr(payload, "x") and hasattr(payload, "y"):
            points.append(payload)
            return
        if hasattr(payload, "x0") and hasattr(payload, "y0") and hasattr(payload, "x1") and hasattr(payload, "y1"):
            rect = fitz.Rect(payload)
            points.extend([rect.top_left, rect.top_right, rect.bottom_left, rect.bottom_right])
            return
        if isinstance(payload, (list, tuple)):
            for item in payload:
                append_payload_points(item)

    for item in items:
        for payload in item[1:]:
            append_payload_points(payload)

    if not points:
        return None

    pad = max(float(stroke_width or 1), 1.0) / 2.0
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    return fitz.Rect(min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def _detect_shape_type(items, fill_hex):
    curve_count = 0
    line_count = 0
    quad_count = 0
    rect_count = 0
    for item in items:
        op = item[0]
        if op == "c":
            curve_count += 1
        elif op in ("l",):
            line_count += 1
        elif op == "re":
            rect_count += 1
        elif op == "qu":
            quad_count += 1

    total = curve_count + line_count + rect_count + quad_count

    if rect_count > 0 and curve_count == 0 and line_count == 0 and quad_count == 0:
        return "rect"

    if curve_count == 4 and line_count == 0 and rect_count == 0 and quad_count == 0:
        return "ellipse"

    if fill_hex:
        return "rect"

    return "path"


def _build_path_items(items, page, scale):
    result = []
    for item in items:
        op = item[0]
        if op == "l":
            p1, p2 = item[1], item[2]
            p1_view = page_point_to_view(page, p1)
            p2_view = page_point_to_view(page, p2)
            result.append({
                "type": "L",
                "x1": p1_view.x * scale, "y1": p1_view.y * scale,
                "x2": p2_view.x * scale, "y2": p2_view.y * scale,
            })
        elif op == "c":
            p1, p2, p3, p4 = item[1], item[2], item[3], item[4]
            p1_view = page_point_to_view(page, p1)
            p2_view = page_point_to_view(page, p2)
            p3_view = page_point_to_view(page, p3)
            p4_view = page_point_to_view(page, p4)
            result.append({
                "type": "C",
                "x1": p1_view.x * scale, "y1": p1_view.y * scale,
                "x2": p2_view.x * scale, "y2": p2_view.y * scale,
                "x3": p3_view.x * scale, "y3": p3_view.y * scale,
                "x4": p4_view.x * scale, "y4": p4_view.y * scale,
            })
        elif op == "qu":
            p1, p2, p3 = item[1], item[2], item[3]
            p1_view = page_point_to_view(page, p1)
            p2_view = page_point_to_view(page, p2)
            p3_view = page_point_to_view(page, p3)
            result.append({
                "type": "Q",
                "x1": p1_view.x * scale, "y1": p1_view.y * scale,
                "x2": p2_view.x * scale, "y2": p2_view.y * scale,
                "x3": p3_view.x * scale, "y3": p3_view.y * scale,
            })
        elif op == "re":
            rect = item[1]
            x0 = rect.x0
            y0 = rect.y0
            x1 = rect.x1
            y1 = rect.y1
            tl = page_point_to_view(page, fitz.Point(x0, y0))
            tr = page_point_to_view(page, fitz.Point(x1, y0))
            br = page_point_to_view(page, fitz.Point(x1, y1))
            bl = page_point_to_view(page, fitz.Point(x0, y1))
            for p1, p2 in [(tl, tr), (tr, br), (br, bl), (bl, tl)]:
                result.append({
                    "type": "L",
                    "x1": p1.x * scale, "y1": p1.y * scale,
                    "x2": p2.x * scale, "y2": p2.y * scale,
                })
    return result


def _process_drawings(drawings, page, scale):
    elements = []
    for d in drawings:
        try:
            fill_color = d.get("fill")
            stroke_color = d.get("color")
            width = d.get("width") or 1
            items = d.get("items") or []
            fill_opacity = d.get("fill_opacity", 1.0) or 1.0
            stroke_opacity = d.get("stroke_opacity", 1.0) or 1.0

            rect = d.get("rect")
            if isinstance(rect, (tuple, list)):
                rect = fitz.Rect(rect)
            if rect is None:
                continue
            if rect.is_empty:
                rect = drawing_bbox_from_items(items, width)
                if rect is None or rect.is_empty:
                    continue

            fill_hex = None
            if fill_color:
                fill_hex = color_to_hex(fill_color[0], fill_color[1], fill_color[2])

            stroke_hex = None
            if stroke_color:
                stroke_hex = color_to_hex(stroke_color[0], stroke_color[1], stroke_color[2])

            shape_type = _detect_shape_type(items, fill_hex)
            overall_opacity = max(fill_opacity, stroke_opacity) if (fill_opacity < 1.0 or stroke_opacity < 1.0) else 1.0

            elem = {
                "pdf_bbox": [rect.x0, rect.y0, rect.x1, rect.y1],
                "bbox": scaled_view_bbox(page, [rect.x0, rect.y0, rect.x1, rect.y1], scale),
                "fill": fill_hex,
                "stroke": stroke_hex,
                "strokeWidth": (width * scale) if stroke_hex else 0,
                "opacity": overall_opacity,
                "origin": "pdf",
            }

            if shape_type == "ellipse":
                elem["type"] = "ellipse"
            elif shape_type == "path":
                elem["type"] = "path"
                elem["items"] = _build_path_items(items, page, scale)
            else:
                elem["type"] = "rect"

            elements.append(elem)
        except Exception as e:
            print(f"Drawing element error: {e}", file=sys.stderr, flush=True)
            continue
    return elements


def build_text_element_from_spans(page, spans, scale):
    if not spans:
        return None

    visible_spans = [span for span in spans if span.get("text", "").strip()]
    if not visible_spans:
        return None

    font_sizes = [span.get("size", 12) for span in visible_spans]
    font_size = max(set(font_sizes), key=font_sizes.count) if font_sizes else 12
    dominant_span = max(visible_spans, key=lambda span: len(span.get("text", "").strip()))
    font_name = dominant_span.get("font", "Helvetica")

    text_parts = []
    prev_bbox = None
    prev_size = font_size
    for span in visible_spans:
        raw_text = span.get("text", "")
        bbox = span.get("bbox")
        size = span.get("size", font_size)

        if text_parts and bbox and prev_bbox:
            gap = bbox[0] - prev_bbox[2]
            if gap > max(prev_size, size, 1) * 0.35:
                previous = text_parts[-1]
                if not previous.endswith(" ") and not raw_text.startswith(" "):
                    text_parts.append(" ")

        text_parts.append(raw_text)
        if bbox:
            prev_bbox = bbox
        prev_size = size

    text = "".join(text_parts).strip()
    if not text:
        return None

    elem_bbox = union_bboxes([span.get("bbox") for span in visible_spans])
    if not elem_bbox:
        return None

    bold = any("Bold" in span.get("font", "") or "bold" in span.get("font", "") for span in visible_spans)
    italic = any(
        "Italic" in span.get("font", "") or "Oblique" in span.get("font", "")
        for span in visible_spans
    )

    return {
        "type": "text",
        "text": text,
        "bbox": scaled_view_bbox(page, elem_bbox, scale),
        "pdf_bbox": list(elem_bbox),
        "fontFamily": normalize_font_family(font_name),
        "fontSize": font_size * scale,
        "fill": span_color_to_hex(dominant_span),
        "bold": bold,
        "italic": italic,
        "origin": "pdf",
    }


def _block_has_explicit_coords(block):
    if isinstance(block.get("bbox"), (list, tuple)) and len(block["bbox"]) >= 4:
        return True
    if isinstance(block.get("box"), (list, tuple)) and len(block["box"]) >= 4:
        return True
    for key in ("x0", "y0", "x1", "y1", "left", "top", "right", "bottom"):
        if key in block and block[key] is not None:
            return True
    return False


def normalize_vision_bbox(block, page_width, page_height, render_scale=RENDER_SCALE, stacked_index=0):
    """Map model bbox to PDF points (top-left origin, y increases downward)."""
    block = dict(block)
    bbox = block.get("bbox") or block.get("box")
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        block["x0"], block["y0"], block["x1"], block["y1"] = bbox[0], bbox[1], bbox[2], bbox[3]
    if "left" in block and "top" in block:
        block.setdefault("x0", block.get("left"))
        block.setdefault("y0", block.get("top"))
        block.setdefault("x1", block.get("right", block.get("left", 0) + 100))
        block.setdefault("y1", block.get("bottom", block.get("top", 0) + 14))

    if not _block_has_explicit_coords(block):
        margin = 72.0
        line_height = 18.0
        text = str(block.get("text") or "")
        y0 = margin + stacked_index * (line_height * 1.45)
        width = min(page_width - 2 * margin, max(len(text) * 5.5, 200.0))
        return margin, y0, margin + width, min(page_height, y0 + line_height)

    try:
        x0 = float(block.get("x0", 0))
        y0 = float(block.get("y0", 0))
        x1 = float(block.get("x1", x0 + 100))
        y1 = float(block.get("y1", y0 + 14))
    except (TypeError, ValueError):
        return None

    if x0 > x1:
        x0, x1 = x1, x0
    if y0 > y1:
        y0, y1 = y1, y0

    max_coord = max(abs(x0), abs(y0), abs(x1), abs(y1), 1.0)

    # 0–1 normalized (common from vision models)
    if max_coord <= 1.5:
        x0, x1 = x0 * page_width, x1 * page_width
        y0, y1 = y0 * page_height, y1 * page_height
    # 0–100 percent
    elif max_coord <= 100.0:
        x0, x1 = x0 / 100.0 * page_width, x1 / 100.0 * page_width
        y0, y1 = y0 / 100.0 * page_height, y1 / 100.0 * page_height
    # Rendered PNG pixel coords (page sent at render_scale)
    elif max(x1, y1) > max(page_width, page_height) * 1.15:
        x0, x1 = x0 / render_scale, x1 / render_scale
        y0, y1 = y0 / render_scale, y1 / render_scale

    x0 = max(0.0, min(x0, page_width))
    x1 = max(0.0, min(x1, page_width))
    y0 = max(0.0, min(y0, page_height))
    y1 = max(0.0, min(y1, page_height))

    if x1 <= x0:
        x1 = min(page_width, x0 + max(len(str(block.get("text") or "")) * 5, 48))
    if y1 <= y0:
        y1 = min(page_height, y0 + 14)

    return x0, y0, x1, y1


def ocr_full_text_from_result(lines, elements, blocks=None):
    """Best-effort full transcript for the AI OCR modal."""
    text = ai_service.normalize_ocr_text_content("\n".join(lines or []).strip())
    if text:
        return text
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        block_text = ai_service.normalize_ocr_text_content(
            (block.get("text") or block.get("content") or "").strip()
        )
        if block_text:
            return block_text
    parts = []
    for elem in elements or []:
        if elem.get("type") != "text":
            continue
        part = (elem.get("text") or "").strip()
        if part:
            parts.append(part)
    return "\n".join(parts).strip()


def extract_ocr_lines_from_blocks(blocks):
    """Flatten model output to unique lines in reading order (no duplicate paragraphs)."""
    raw_lines = []
    for block in blocks or []:
        if not isinstance(block, dict):
            if isinstance(block, str) and block.strip():
                raw_lines.append(block.strip())
            continue
        text = ai_service.normalize_ocr_text_content(
            (block.get("text") or block.get("content") or "").strip()
        )
        if not text:
            continue
        for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            line = line.strip()
            if line:
                raw_lines.append(line)

    if not raw_lines:
        return []

    # Drop consecutive duplicates
    deduped = []
    for line in raw_lines:
        if deduped and deduped[-1] == line:
            continue
        deduped.append(line)

    # If the model repeated the full letter in every block, keep one copy of each distinct line
    seen = set()
    unique = []
    for line in deduped:
        if line in seen:
            continue
        seen.add(line)
        unique.append(line)

    # Remove lines that are strict substrings of another line (keep shorter list readable)
    filtered = []
    for line in unique:
        if any(line != other and line in other for other in unique):
            continue
        filtered.append(line)

    return filtered if filtered else unique


def get_page_content_image_bboxes(page):
    """PDF bounding boxes of embedded images (scans, letter artwork, etc.)."""
    bboxes = []
    seen = set()

    def add_bbox(bbox):
        if not bbox or len(bbox) < 4:
            return
        try:
            coords = [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
        except (TypeError, ValueError):
            return
        if coords[2] <= coords[0] or coords[3] <= coords[1]:
            return
        key = tuple(round(c, 1) for c in coords)
        if key in seen:
            return
        seen.add(key)
        bboxes.append(coords)

    try:
        for img_info in page.get_images(full=True):
            try:
                rect = page.get_image_bbox(img_info)
                if rect.is_empty or rect.is_infinite:
                    continue
                add_bbox([rect.x0, rect.y0, rect.x1, rect.y1])
            except Exception:
                continue
    except Exception:
        pass

    try:
        preserve = getattr(fitz, "TEXT_PRESERVE_IMAGES", 0)
        flags = fitz.TEXTFLAGS_TEXT | preserve
        text_dict = page.get_text("dict", flags=flags)
        for block in text_dict.get("blocks", []):
            if block.get("type") != 1:
                continue
            bbox = block.get("bbox")
            if bbox:
                add_bbox(bbox)
    except Exception:
        pass

    return bboxes


def expand_pdf_bbox(page, bbox, pad=12.0):
    if not bbox or len(bbox) < 4:
        return bbox
    rect = page.rect
    x0 = max(rect.x0, float(bbox[0]) - pad)
    y0 = max(rect.y0, float(bbox[1]) - pad)
    x1 = min(rect.x1, float(bbox[2]) + pad)
    y1 = min(rect.y1, float(bbox[3]) + pad)
    return [x0, y0, x1, y1]


def render_page_with_white_masks(page, pdf_bboxes, dpi_scale=RENDER_SCALE):
    """Re-render page PNG with OCR/source regions painted white."""
    mat = fitz.Matrix(dpi_scale, dpi_scale)
    pix = page.get_pixmap(matrix=mat, alpha=False, annots=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    draw = ImageDraw.Draw(img)
    for bbox in pdf_bboxes or []:
        if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
            expanded = expand_pdf_bbox(page, bbox, pad=10.0)
            _cover_with_color(draw, page, expanded, dpi_scale, (255, 255, 255), pad=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def union_pdf_bboxes(bboxes):
    if not bboxes:
        return None
    x0 = min(b[0] for b in bboxes)
    y0 = min(b[1] for b in bboxes)
    x1 = max(b[2] for b in bboxes)
    y1 = max(b[3] for b in bboxes)
    return [x0, y0, x1, y1]


def _block_pdf_bbox(block):
    if not isinstance(block, dict):
        return None
    try:
        if all(k in block for k in ("x0", "y0", "x1", "y1")):
            return [
                float(block["x0"]),
                float(block["y0"]),
                float(block["x1"]),
                float(block["y1"]),
            ]
        raw = block.get("bbox") or block.get("rect")
        if isinstance(raw, (list, tuple)) and len(raw) >= 4:
            return [float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3])]
    except (TypeError, ValueError):
        return None
    return None


def _make_ocr_text_elements(page, block, pdf_bbox, scale, font_family="Helvetica", pad=3.0):
    """White mask + editable text element for one OCR block."""
    line_h = max(pdf_bbox[3] - pdf_bbox[1], 12.0)
    style = ocr_style_from_block(block, line_h, scale, font_family)
    mask_bbox = [
        pdf_bbox[0] - pad,
        pdf_bbox[1] - pad,
        pdf_bbox[2] + pad,
        pdf_bbox[3] + pad,
    ]
    text = ai_service.normalize_ocr_text_content(
        (block.get("text") or block.get("content") or "").strip()
    )
    return [
        {
            "type": "rect",
            "bbox": scaled_view_bbox(page, mask_bbox, scale),
            "pdf_bbox": mask_bbox,
            "fill": "#ffffff",
            "stroke": "transparent",
            "strokeWidth": 0,
            "origin": "ocr",
        },
        {
            "type": "text",
            "text": text,
            "bbox": scaled_view_bbox(page, pdf_bbox, scale),
            "pdf_bbox": pdf_bbox,
            "fontFamily": style["fontFamily"],
            "fontSize": style["fontSize"],
            "fill": style["fill"],
            "backgroundColor": "#ffffff",
            "bold": style["bold"],
            "italic": style["italic"],
            "origin": "ocr",
            "lineHeight": 1.15,
        },
    ]


def _ocr_blocks_dominant_color(blocks):
    """Return the most relevant text color from AI OCR blocks, or None."""
    if not blocks:
        return None
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if not (block.get("text") or "").strip():
            continue
        raw = block.get("color") or block.get("fill") or block.get("textColor") or block.get("text_color")
        if raw:
            return str(raw).strip()
    return None


def build_ocr_elements_for_source_regions(
    page, lines, source_bboxes, scale=RENDER_SCALE, blocks=None, font_family="Helvetica"
):
    """Mask real source regions (e.g. embedded images) and place text in their union box."""
    elements = []
    if not lines or not source_bboxes:
        return elements

    pad = 4.0
    full_text = "\n".join(lines)
    union = union_pdf_bboxes(source_bboxes)
    if not union:
        return elements

    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    ux0, uy0, ux1, uy1 = union
    text_bbox = [ux0, uy0, ux1, uy1]
    line_count = max(1, len(lines))
    region_h = max(uy1 - uy0, 17.0)
    canvas_font = min(22.0, max(10.0, (region_h / line_count) * scale * 0.42))

    font_family = normalize_ocr_font_family(font_family)
    fill_color = _ocr_blocks_dominant_color(blocks) or "#111111"

    for pdf_bbox in source_bboxes:
        mask_bbox = [
            pdf_bbox[0] - pad,
            pdf_bbox[1] - pad,
            pdf_bbox[2] + pad,
            pdf_bbox[3] + pad,
        ]
        elements.append({
            "type": "rect",
            "bbox": scaled_view_bbox(page, mask_bbox, scale),
            "pdf_bbox": mask_bbox,
            "fill": "#ffffff",
            "stroke": "transparent",
            "strokeWidth": 0,
            "origin": "ocr",
        })

    elements.append({
        "type": "text",
        "text": full_text,
        "bbox": scaled_view_bbox(page, text_bbox, scale),
        "pdf_bbox": text_bbox,
        "fontFamily": font_family,
        "fontSize": canvas_font,
        "fill": fill_color,
        "backgroundColor": "#ffffff",
        "bold": False,
        "italic": False,
        "origin": "ocr",
        "lineHeight": 1.15,
    })
    return elements


def build_ai_ocr_elements_from_blocks(page, blocks, scale=RENDER_SCALE, font_family="Helvetica"):
    """Build OCR overlays; use vision coordinates or embedded image regions when possible."""
    blocks = blocks or []
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    coord_blocks = []
    coord_index = 0
    for block in blocks:
        if not isinstance(block, dict):
            continue
        text = (block.get("text") or block.get("content") or "").strip()
        if not text or not _block_has_explicit_coords(block):
            continue
        normalized = normalize_vision_bbox(
            block, page_width, page_height, scale, stacked_index=coord_index
        )
        if not normalized:
            continue
        x0, y0, x1, y1 = normalized
        merged = dict(block)
        merged.update(x0=x0, y0=y0, x1=x1, y1=y1)
        coord_blocks.append(merged)
        coord_index += 1

    if coord_blocks:
        elements = []
        for block in coord_blocks:
            pdf_bbox = _block_pdf_bbox(block)
            if pdf_bbox:
                elements.extend(
                    _make_ocr_text_elements(page, block, pdf_bbox, scale, font_family)
                )
        return elements

    lines = extract_ocr_lines_from_blocks(blocks)
    image_bboxes = get_page_content_image_bboxes(page)
    if image_bboxes:
        return build_ocr_elements_for_source_regions(
            page, lines, image_bboxes, scale, blocks=blocks, font_family=font_family
        )
    return build_clean_ai_ocr_elements(
        page, lines, scale, blocks=blocks, font_family=font_family
    )


def build_clean_ai_ocr_elements(page, lines, scale=RENDER_SCALE, blocks=None, font_family="Helvetica"):
    """Place OCR as readable stacked lines with white masks over the scan."""
    elements = []
    if not lines:
        return elements

    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    margin_x = 54.0
    line_height = 17.0
    line_gap = 1.38
    pad = 3.0
    canvas_font = min(20.0, max(11.0, line_height * scale * 0.72))

    font_family = normalize_ocr_font_family(font_family)
    fill_color = _ocr_blocks_dominant_color(blocks) or "#111111"

    y = margin_x
    for line in lines:
        if y + line_height > page_height - margin_x:
            break
        x0 = margin_x
        x1 = page_width - margin_x
        text_bbox = [x0, y, x1, y + line_height]
        mask_bbox = [x0 - pad, y - pad, x1 + pad, y + line_height + pad]

        elements.append({
            "type": "rect",
            "bbox": scaled_view_bbox(page, mask_bbox, scale),
            "pdf_bbox": mask_bbox,
            "fill": "#ffffff",
            "stroke": "transparent",
            "strokeWidth": 0,
            "origin": "ocr",
        })
        elements.append({
            "type": "text",
            "text": line,
            "bbox": scaled_view_bbox(page, text_bbox, scale),
            "pdf_bbox": text_bbox,
            "fontFamily": font_family,
            "fontSize": canvas_font,
            "fill": fill_color,
            "backgroundColor": "#ffffff",
            "bold": False,
            "italic": False,
            "origin": "ocr",
            "lineHeight": 1.15,
        })
        y += line_height * line_gap

    return elements


def _ai_error_response(exc):
    if isinstance(exc, AIServiceError):
        payload = {"error": exc.message}
        if exc.detail:
            payload["detail"] = exc.detail
        return jsonify(payload), exc.status_code
    return jsonify({"error": str(exc)}), 502


def render_page_to_png(page, dpi_scale=2, hide_text=False, hide_editable=False, mask_elements=None):
    mat = fitz.Matrix(dpi_scale, dpi_scale)
    pix = page.get_pixmap(matrix=mat, alpha=False, annots=False)

    if hide_text or mask_elements:
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        draw = ImageDraw.Draw(img)

        bg_color = _sample_page_background(img, pix.width, pix.height)

        if hide_text:
            try:
                text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
                for block in text_dict.get("blocks", []):
                    if block.get("type") != 0:
                        continue
                    for line in block.get("lines", []):
                        spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
                        boxes = [span.get("bbox") for span in spans if span.get("bbox")]
                        if not boxes:
                            line_bbox = line.get("bbox") or block.get("bbox")
                            if line_bbox:
                                boxes = [line_bbox]

                        for bbox in boxes:
                            _cover_with_color(draw, page, bbox, dpi_scale, bg_color)
            except Exception:
                pass

        if mask_elements:
            try:
                for elem in mask_elements:
                    bbox = elem.get("pdf_bbox")
                    if not bbox or len(bbox) != 4:
                        continue
                    _cover_with_color(draw, page, bbox, dpi_scale, bg_color)
            except Exception:
                pass

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        img_data = buf.getvalue()
    else:
        img_data = pix.tobytes("png")

    return base64.b64encode(img_data).decode("utf-8")


def render_page_thumbnail(page, max_height=320):
    page_rect = page.rect
    scale = max_height / page_rect.height
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False, annots=False)
    img_data = pix.tobytes("png")
    return base64.b64encode(img_data).decode("utf-8")


def normalize_widget_choice_values(raw_values):
    if not raw_values:
        return []

    options = []
    for raw in raw_values:
        if isinstance(raw, (list, tuple)):
            if not raw:
                continue
            value = str(raw[0])
            label = str(raw[1] if len(raw) > 1 else raw[0])
        else:
            value = str(raw)
            label = str(raw)
        options.append({"value": value, "label": label})
    return options


def _coerce_widget_text_value(raw_value):
    if raw_value is None:
        return ""
    if isinstance(raw_value, (list, tuple)):
        if not raw_value:
            return ""
        return str(raw_value[0])
    return str(raw_value)


def make_default_widget_rect(page, widget_kind, index):
    base_top = 72 + (index * 44)
    max_top = max(72, page.rect.height - 72)
    top = min(base_top, max_top)
    left = 72

    if widget_kind == "text":
        return fitz.Rect(left, top, min(left + 220, page.rect.width - 72), top + 28)
    if widget_kind in ("choice", "listbox"):
        height = 82 if widget_kind == "listbox" else 28
        return fitz.Rect(left, top, min(left + 180, page.rect.width - 72), min(top + height, page.rect.height - 36))
    if widget_kind == "checkbox":
        return fitz.Rect(left, top, left + 18, top + 18)
    if widget_kind == "radio":
        return fitz.Rect(left, top, left + 18, top + 18)
    return fitz.Rect(left, top, min(left + 220, page.rect.width - 72), top + 28)


def create_form_widget(page, widget_kind):
    normalized_kind = (widget_kind or "text").strip().lower()
    if normalized_kind not in WIDGET_TYPE_MAP:
        raise ValueError("Unsupported form field type")

    existing_widgets = list(page.widgets() or [])
    widget_index = len(existing_widgets) + 1
    widget = fitz.Widget()
    widget.field_type = WIDGET_TYPE_MAP[normalized_kind]
    widget.field_name = f"{normalized_kind}_field_{page.number + 1}_{widget_index}"
    widget.field_label = {
        "text": f"Text Field {widget_index}",
        "checkbox": f"Checkbox {widget_index}",
        "radio": f"Radio {widget_index}",
        "choice": f"Dropdown {widget_index}",
        "listbox": f"List Box {widget_index}",
    }[normalized_kind]
    widget.rect = make_default_widget_rect(page, normalized_kind, len(existing_widgets))
    widget.border_color = (0.24, 0.39, 0.45)
    widget.fill_color = (1, 1, 1)
    widget.text_color = (0, 0, 0)
    widget.border_width = 1

    if normalized_kind in ("text", "choice", "listbox"):
        widget.text_font = "Helv"
        widget.text_fontsize = 0

    if normalized_kind in ("choice", "listbox"):
        widget.choice_values = ["Option 1", "Option 2", "Option 3"]
        if normalized_kind == "listbox":
            widget.field_value = ["Option 1"]
            widget.field_flags = int(getattr(widget, "field_flags", 0) or 0) | (1 << 21)
        else:
            widget.field_value = "Option 1"

    if normalized_kind in ("checkbox", "radio"):
        widget.text_font = "ZaDb"
        widget.text_fontsize = 0
        widget.field_value = False

    page.add_widget(widget)
    return refresh_page_handle(page.parent, page, page.number)


def duplicate_widget_rect(page, source_rect):
    rect = fitz.Rect(source_rect)
    offset_y = min(max(rect.height + 8, 20), 44)
    offset_x = min(max(rect.width * 0.08, 12), 24)
    page_rect = page.rect
    margin = 36

    def _shifted(dx, dy):
        next_rect = fitz.Rect(rect)
        next_rect.x0 += dx
        next_rect.y0 += dy
        next_rect.x1 += dx
        next_rect.y1 += dy
        return next_rect

    candidates = [
        _shifted(offset_x, offset_y),
        _shifted(0, offset_y),
        _shifted(offset_x, 0),
        _shifted(-offset_x, offset_y),
        _shifted(offset_x, -offset_y),
    ]

    for candidate in candidates:
        if (
            candidate.x0 >= margin
            and candidate.y0 >= margin
            and candidate.x1 <= page_rect.width - margin
            and candidate.y1 <= page_rect.height - margin
        ):
            return candidate

    clamped = _shifted(offset_x, offset_y)
    clamped.x0 = max(margin, min(clamped.x0, page_rect.width - margin - rect.width))
    clamped.y0 = max(margin, min(clamped.y0, page_rect.height - margin - rect.height))
    clamped.x1 = clamped.x0 + rect.width
    clamped.y1 = clamped.y0 + rect.height
    return clamped


def duplicate_form_widget(page, source_xref, source_snapshot=None):
    source = page.load_widget(source_xref)
    if not source:
        raise ValueError("Form field not found")

    snapshot = source_snapshot if isinstance(source_snapshot, dict) else {}

    existing_widgets = list(page.widgets() or [])
    widget_index = len(existing_widgets) + 1
    field_type = int(snapshot.get("field_type") or source.field_type or 0)
    widget_kind = snapshot.get("widget_kind") or WIDGET_KIND_MAP.get(field_type, "text")

    fallback_bbox = rect_to_list(source.rect)
    source_pdf_bbox = resolve_widget_pdf_bbox(page, snapshot, fallback_bbox)
    source_rect = fitz.Rect(source_pdf_bbox) if source_pdf_bbox else fitz.Rect(source.rect)

    widget = fitz.Widget()
    widget.field_type = field_type

    base_name = (snapshot.get("field_name") or source.field_name or f"{widget_kind}_field").strip()
    widget.field_name = f"{base_name}_copy_{widget_index}"

    source_label = (snapshot.get("field_label") or source.field_label or source.field_name or "").strip()
    widget.field_label = f"{source_label} Copy" if source_label else f"Field {widget_index}"

    widget.rect = duplicate_widget_rect(page, source_rect)
    widget.border_color = normalize_pdf_color(getattr(source, "border_color", None), (0.24, 0.39, 0.45))
    widget.fill_color = normalize_pdf_color(getattr(source, "fill_color", None), (1, 1, 1))
    widget.text_color = normalize_pdf_color(getattr(source, "text_color", None), (0, 0, 0))
    try:
        widget.border_width = max(0.5, float(getattr(source, "border_width", 1) or 1))
    except (TypeError, ValueError):
        widget.border_width = 1.0

    source_font = snapshot.get("text_font") or getattr(source, "text_font", None)
    if source_font:
        widget.text_font = source_font
    try:
        fontsize = snapshot.get("text_fontsize", getattr(source, "text_fontsize", 0))
        widget.text_fontsize = float(fontsize or 0)
    except (TypeError, ValueError):
        widget.text_fontsize = 0

    if field_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
        if isinstance(snapshot.get("choice_values"), list):
            widget.choice_values = [
                [opt["value"], opt["label"]]
                for opt in normalize_widget_choice_values(snapshot["choice_values"])
            ]
        else:
            widget.choice_values = getattr(source, "choice_values", None) or []
        if field_type == fitz.PDF_WIDGET_TYPE_LISTBOX:
            widget.field_flags = int(getattr(source, "field_flags", 0) or 0) | (1 << 21)
            widget.field_value = []
        else:
            choice_options = normalize_widget_choice_values(widget.choice_values)
            widget.field_value = choice_options[0]["value"] if choice_options else ""
    elif field_type == fitz.PDF_WIDGET_TYPE_TEXT:
        widget.field_value = ""
    elif field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
        if widget_kind == "radio":
            widget.text_font = "ZaDb"
            widget.text_fontsize = 0
        widget.field_value = False
    else:
        widget.field_value = getattr(source, "field_value", "")

    page.add_widget(widget)
    new_xref = int(widget.xref)
    page = refresh_page_handle(page.parent, page, page.number)
    return page, new_xref


def extract_page_widgets(page, scale=RENDER_SCALE):
    widgets = []

    try:
        page_widgets = list(page.widgets() or [])
    except Exception as exc:
        print(f"Widgets extraction error: {exc}", file=sys.stderr, flush=True)
        return widgets

    for widget in page_widgets:
        try:
            rect = widget.rect
            bbox = [rect.x0, rect.y0, rect.x1, rect.y1]
            field_type = int(widget.field_type or 0)
            if field_type == fitz.PDF_WIDGET_TYPE_LISTBOX:
                widget_kind = "listbox"
            elif field_type == fitz.PDF_WIDGET_TYPE_COMBOBOX:
                widget_kind = "choice"
            else:
                widget_kind = WIDGET_KIND_MAP.get(field_type, "unknown")
            choice_values = normalize_widget_choice_values(getattr(widget, "choice_values", None))
            on_value = None
            button_states = None

            if field_type in (fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON):
                try:
                    on_value = widget.on_state()
                except Exception:
                    on_value = True if field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX else None
                try:
                    button_states = widget.button_states()
                except Exception:
                    button_states = None

                raw_value = widget.field_value
                value = raw_value == on_value or raw_value is True
            else:
                if field_type == fitz.PDF_WIDGET_TYPE_LISTBOX:
                    raw_value = widget.field_value
                    if isinstance(raw_value, (list, tuple)):
                        value = [str(item) for item in raw_value]
                    elif raw_value in (None, ""):
                        value = []
                    else:
                        value = [str(raw_value)]
                else:
                    value = _coerce_widget_text_value(widget.field_value)

            widgets.append({
                "type": "widget",
                "widget_kind": widget_kind,
                "field_type": field_type,
                "field_type_string": widget.field_type_string or widget_kind.title(),
                "field_name": widget.field_name or f"Field {widget.xref}",
                "field_label": widget.field_label or widget.field_name or f"Field {widget.xref}",
                "value": value,
                "choice_values": choice_values,
                "on_value": on_value,
                "button_states": button_states,
                "text_font": getattr(widget, "text_font", None),
                "text_fontsize": getattr(widget, "text_fontsize", 0),
                "bbox": scaled_view_bbox(page, bbox, scale),
                "pdf_bbox": bbox,
                "xref": int(widget.xref),
                "origin": "pdf",
            })
        except Exception as exc:
            print(f"Widget parse error: {exc}", file=sys.stderr, flush=True)

    return widgets


def get_widget_pdf_bboxes(page):
    try:
        widgets = list(page.widgets() or [])
    except Exception:
        return []

    boxes = []
    for widget in widgets:
        try:
            rect = fitz.Rect(widget.rect)
        except Exception:
            continue
        if rect.is_empty:
            continue
        boxes.append([rect.x0, rect.y0, rect.x1, rect.y1])
    return boxes


def overlaps_widget_bbox(candidate_bbox, widget_bboxes, threshold=0.65):
    if not candidate_bbox or len(candidate_bbox) != 4 or not widget_bboxes:
        return False

    return any(bbox_overlap_ratio(candidate_bbox, widget_bbox) >= threshold for widget_bbox in widget_bboxes)


def _apply_single_widget_value(widget, value):
    field_type = int(widget.field_type or 0)

    if field_type == fitz.PDF_WIDGET_TYPE_TEXT:
        val = "" if value is None else str(value)
        widget.field_value = val
        
        val_lower = val.strip().lower()
        is_default = (
            val_lower == (widget.field_label or "").strip().lower() or
            val_lower == (widget.field_name or "").strip().lower() or
            val_lower.startswith("text field") or
            val_lower.startswith("field") or
            val_lower in [
                "nume", "prenume", "name", "surname", "first name", "last name", 
                "email", "telefon", "phone", "adresa", "address", "cnp", "cui", 
                "iban", "data", "date", "semnatura", "signature"
            ]
        )
        
        if is_default and val:
            escaped_val = val.replace('\\', '\\\\').replace('"', '\\"')
            widget.script_focus = f'if (event.value === "{escaped_val}") event.value = "";'
            widget.script_blur = f'if (event.value === "") event.value = "{escaped_val}";'
        else:
            widget.script_focus = None
            widget.script_blur = None
            
        return True

    if field_type == fitz.PDF_WIDGET_TYPE_COMBOBOX:
        choice_values = normalize_widget_choice_values(getattr(widget, "choice_values", None))
        value_text = "" if value is None else str(value)
        allowed_values = {item["value"] for item in choice_values}
        if allowed_values and value_text not in allowed_values and value_text != "":
            return False
        widget.field_value = value_text
        return True

    if field_type == fitz.PDF_WIDGET_TYPE_LISTBOX:
        choice_values = normalize_widget_choice_values(getattr(widget, "choice_values", None))
        allowed_values = {item["value"] for item in choice_values}
        raw_values = value if isinstance(value, list) else ([] if value in (None, "") else [value])
        selected_values = [str(item) for item in raw_values]
        if allowed_values:
            selected_values = [item for item in selected_values if item in allowed_values]
        widget.field_value = selected_values
        return True

    if field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        widget.field_value = widget.on_state() if bool(value) else False
        return True

    if field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
        widget.field_value = widget.on_state() if bool(value) else False
        return True

    return False


def resolve_widget_pdf_bbox(page, widget_update, fallback_bbox=None, scale=RENDER_SCALE):
    bbox = widget_update.get("bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        try:
            view_bbox = [float(coord) / float(scale) for coord in bbox]
        except (TypeError, ValueError, ZeroDivisionError):
            view_bbox = None

        if view_bbox:
            rect = fitz.Rect(page_rect_to_pdf(page, view_bbox))
            if not rect.is_empty:
                return rect_to_list(rect)

    pdf_bbox = widget_update.get("pdf_bbox")
    if isinstance(pdf_bbox, list) and len(pdf_bbox) == 4:
        try:
            rect = fitz.Rect([float(coord) for coord in pdf_bbox])
        except (TypeError, ValueError):
            rect = None

        if rect and not rect.is_empty:
            return rect_to_list(rect)

    return fallback_bbox


def apply_form_updates(doc, page_num, form_updates):
    if not form_updates:
        return doc[page_num]

    page = doc[page_num]
    radio_groups = {}
    non_radio_updates = []

    for item in form_updates:
        try:
            xref = int(item.get("xref"))
        except (TypeError, ValueError):
            continue

        widget = page.load_widget(xref)
        if not widget:
            continue

        widget_rect = resolve_widget_pdf_bbox(page, item, rect_to_list(widget.rect))
        if widget_rect:
            next_rect = fitz.Rect(widget_rect)
            current_rect = fitz.Rect(widget.rect)
            if not next_rect.is_empty and list(next_rect) != list(current_rect):
                widget.rect = next_rect
                widget.update()
                page = refresh_page_handle(doc, page, page_num)
                widget = page.load_widget(xref) or widget

        # Update metadata properties (field_name, field_label, choice_values) if changed
        updated_meta = False
        if "field_name" in item:
            new_name = str(item["field_name"])
            if widget.field_name != new_name:
                widget.field_name = new_name
                updated_meta = True
        if "field_label" in item:
            new_label = str(item["field_label"])
            if widget.field_label != new_label:
                widget.field_label = new_label
                updated_meta = True
        if "choice_values" in item and isinstance(item["choice_values"], list):
            new_choices = [[str(opt.get("value", "")), str(opt.get("label", ""))] for opt in item["choice_values"]]
            current_choices = [
                [choice["value"], choice["label"]]
                for choice in normalize_widget_choice_values(getattr(widget, "choice_values", None))
            ]
            if current_choices != new_choices:
                widget.choice_values = new_choices
                updated_meta = True

        if updated_meta:
            widget.update()
            page = refresh_page_handle(doc, page, page_num)
            widget = page.load_widget(xref) or widget

        field_type = int(widget.field_type or 0)
        if field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
            group_name = widget.field_name or f"radio-{xref}"
            radio_groups.setdefault(group_name, {})[xref] = bool(item.get("value"))
        else:
            non_radio_updates.append((xref, item.get("value")))

    for xref, value in non_radio_updates:
        widget = page.load_widget(xref)
        if not widget:
            continue
        if _apply_single_widget_value(widget, value):
            widget.update()
            page = refresh_page_handle(doc, page, page_num)

    for states in radio_groups.values():
        selected_xref = next((xref for xref, selected in states.items() if selected), None)
        for xref in states:
            widget = page.load_widget(xref)
            if not widget:
                continue
            if _apply_single_widget_value(widget, xref == selected_xref):
                widget.update()
                page = refresh_page_handle(doc, page, page_num)

    return page


def refresh_page_handle(doc, page, page_num=None):
    try:
        return doc.reload_page(page)
    except Exception:
        fallback_page_num = page_num if page_num is not None else getattr(page, "number", 0)
        return doc[int(fallback_page_num)]


def normalize_pdf_color(color_value, fallback=None):
    if isinstance(color_value, (list, tuple)) and len(color_value) >= 3:
        try:
            return tuple(max(0.0, min(1.0, float(channel))) for channel in color_value[:3])
        except (TypeError, ValueError):
            return fallback
    return fallback


def widget_is_checked(widget):
    try:
        on_value = widget.on_state()
    except Exception:
        on_value = True
    raw_value = getattr(widget, "field_value", False)
    return raw_value == on_value or raw_value is True


def resolve_flattened_widget_fontsize(widget, rect):
    try:
        widget_size = float(getattr(widget, "text_fontsize", 0) or 0)
    except (TypeError, ValueError):
        widget_size = 0

    if widget_size > 0:
        return widget_size

    return max(8, min(rect.height * 0.58, 14))


def draw_widget_flattened_value(page, widget):
    rect = fitz.Rect(widget.rect)
    if rect.is_empty:
        return

    field_type = int(widget.field_type or 0)
    border_color = normalize_pdf_color(getattr(widget, "border_color", None), (0.24, 0.39, 0.45))
    fill_color = normalize_pdf_color(getattr(widget, "fill_color", None), (1.0, 1.0, 1.0))
    text_color = normalize_pdf_color(getattr(widget, "text_color", None), (0.0, 0.0, 0.0))

    try:
        border_width = max(0.5, float(getattr(widget, "border_width", 1) or 1))
    except (TypeError, ValueError):
        border_width = 1.0

    if field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
        center = fitz.Point((rect.x0 + rect.x1) / 2.0, (rect.y0 + rect.y1) / 2.0)
        outer_radius = max(1.5, min(rect.width, rect.height) / 2.0 - border_width)
        page.draw_circle(center, outer_radius, color=border_color, fill=fill_color, width=border_width)
        if widget_is_checked(widget):
            inner_radius = max(1.0, outer_radius * 0.45)
            page.draw_circle(center, inner_radius, color=text_color, fill=text_color, width=1)
        return

    page.draw_rect(rect, color=border_color, fill=fill_color, width=border_width)

    if field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        if widget_is_checked(widget):
            inset = max(2.5, min(rect.width, rect.height) * 0.22)
            page.draw_line(
                fitz.Point(rect.x0 + inset, rect.y0 + inset),
                fitz.Point(rect.x1 - inset, rect.y1 - inset),
                color=text_color,
                width=max(1.2, border_width + 0.4),
            )
            page.draw_line(
                fitz.Point(rect.x0 + inset, rect.y1 - inset),
                fitz.Point(rect.x1 - inset, rect.y0 + inset),
                color=text_color,
                width=max(1.2, border_width + 0.4),
            )
        return

    if field_type not in (
        fitz.PDF_WIDGET_TYPE_TEXT,
        fitz.PDF_WIDGET_TYPE_COMBOBOX,
        fitz.PDF_WIDGET_TYPE_LISTBOX,
    ):
        return

    text_value = _coerce_widget_text_value(getattr(widget, "field_value", ""))
    if not text_value:
        return

    padding = max(2.0, border_width + 2.0)
    text_rect = fitz.Rect(rect.x0 + padding, rect.y0 + padding, rect.x1 - padding, rect.y1 - padding)
    if text_rect.is_empty:
        return

    font_name = getattr(widget, "text_font", None) or "Helv"
    font_size = resolve_flattened_widget_fontsize(widget, text_rect)
    inserted = page.insert_textbox(
        text_rect,
        text_value,
        fontname=font_name,
        fontsize=font_size,
        color=text_color,
        align=fitz.TEXT_ALIGN_LEFT,
    )

    if inserted < 0 and font_size > 8:
        page.insert_textbox(
            text_rect,
            text_value,
            fontname=font_name,
            fontsize=max(8, font_size * 0.85),
            color=text_color,
            align=fitz.TEXT_ALIGN_LEFT,
        )


def flatten_form_widgets(doc):
    for page_num in range(len(doc)):
        page = doc[page_num]
        widgets = list(page.widgets() or [])
        if not widgets:
            continue

        widget_xrefs = []
        for widget in widgets:
            draw_widget_flattened_value(page, widget)
            try:
                widget_xrefs.append(int(widget.xref))
            except (AttributeError, TypeError, ValueError):
                continue

        for xref in widget_xrefs:
            widget = page.load_widget(xref)
            if not widget:
                continue
            page.delete_widget(widget)
            page = refresh_page_handle(doc, page, page_num)


def build_export_doc(doc, from_page=None, to_page=None):
    export_doc = fitz.open()
    if from_page is None or to_page is None:
        export_doc.insert_pdf(doc)
    else:
        export_doc.insert_pdf(doc, from_page=from_page, to_page=to_page)
    return export_doc


def build_flattened_export_doc(doc, from_page=None, to_page=None):
    export_doc = build_export_doc(doc, from_page=from_page, to_page=to_page)
    flatten_form_widgets(export_doc)

    try:
        export_doc.bake(annots=False)
    except TypeError:
        export_doc.bake()

    return export_doc


def extract_page_elements(doc, page, scale=2.0, include_widgets=False):
    elements = []
    widget_bboxes = get_widget_pdf_bboxes(page)

    try:
        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue

            block_lines = block.get("lines", [])
            if not block_lines:
                continue
            for line in block_lines:
                line_spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
                if not line_spans:
                    continue

                current_cluster = []
                prev_bbox = None
                prev_size = None

                for span in line_spans:
                    bbox = span.get("bbox")
                    size = span.get("size", 12)

                    if current_cluster and bbox and prev_bbox:
                        gap = bbox[0] - prev_bbox[2]
                        if gap > max(prev_size or 0, size, 1) * 1.1:
                            candidate = build_text_element_from_spans(page, current_cluster, scale)
                            if candidate and not overlaps_widget_bbox(candidate.get("pdf_bbox"), widget_bboxes):
                                append_unique_text_element(elements, candidate)
                            current_cluster = []

                    current_cluster.append(span)
                    if bbox:
                        prev_bbox = bbox
                    prev_size = size

                candidate = build_text_element_from_spans(page, current_cluster, scale)
                if candidate and not overlaps_widget_bbox(candidate.get("pdf_bbox"), widget_bboxes):
                    append_unique_text_element(elements, candidate)
    except Exception as e:
        print(f"Text extraction error: {e}", file=sys.stderr, flush=True)

    try:
        images = page.get_images(full=True)
        for img_info in images:
            xref = img_info[0]
            try:
                bbox = page.get_image_bbox(img_info)
                if bbox.is_empty or bbox.is_infinite:
                    continue
                pdf_bbox = [bbox.x0, bbox.y0, bbox.x1, bbox.y1]
                if overlaps_widget_bbox(pdf_bbox, widget_bboxes):
                    continue

                base_item = {
                    "type": "image",
                    "bbox": scaled_view_bbox(page, pdf_bbox, scale),
                    "pdf_bbox": pdf_bbox,
                    "origin": "pdf",
                }

                pix = fitz.Pixmap(doc, xref)
                if pix.n >= 5:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                img_bytes = pix.tobytes("png")
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                base_item["src"] = f"data:image/png;base64,{b64}"
                elements.append(base_item)
            except Exception:
                continue
    except Exception as e:
        print(f"Images extraction error: {e}", file=sys.stderr, flush=True)

    drawings = []
    try:
        drawings = page.get_drawings(extended=True)
        elements.extend(
            [
                elem for elem in _process_drawings(drawings, page, scale)
                if not overlaps_widget_bbox(elem.get("pdf_bbox"), widget_bboxes)
            ]
        )
    except Exception as e:
        print(f"Drawings extraction error: {e}", file=sys.stderr, flush=True)

    if not drawings:
        try:
            cdrawings = page.get_cdrawings()
            elements.extend(
                [
                    elem for elem in _process_drawings(cdrawings, page, scale)
                    if not overlaps_widget_bbox(elem.get("pdf_bbox"), widget_bboxes)
                ]
            )
        except AttributeError:
            pass
        except Exception as e2:
            print(f"CDrawings extraction error: {e2}", file=sys.stderr, flush=True)

    try:
        for annot in page.annots():
            annot_type = annot.type
            annot_rect = annot.rect
            content = annot.info.get("content", "")
            a_color = annot.colors.get("stroke")
            fill_a = annot.colors.get("fill")

            a_fill_hex = None
            if fill_a:
                a_fill_hex = color_to_hex(fill_a[0], fill_a[1], fill_a[2])

            a_stroke_hex = None
            if a_color:
                a_stroke_hex = color_to_hex(a_color[0], a_color[1], a_color[2])

            elem = {
                "annot_type": annot_type[0] if isinstance(annot_type, (list, tuple)) else annot_type,
                "bbox": scaled_view_bbox(page, [annot_rect.x0, annot_rect.y0, annot_rect.x1, annot_rect.y1], scale),
                "pdf_bbox": [annot_rect.x0, annot_rect.y0, annot_rect.x1, annot_rect.y1],
                "fill": a_fill_hex,
                "stroke": a_stroke_hex,
                "content": content,
                "origin": "pdf",
            }

            annot_type_num = annot_type[0] if isinstance(annot_type, (list, tuple)) else annot_type
            if annot_type_num == 8:
                elem["type"] = "highlight"
                if not elem["fill"]:
                    elem["fill"] = "#ffff00"
                elem["opacity"] = 0.3
            elif annot_type_num == 20:
                elem["type"] = "sticky"
                elem["text"] = content or "Note"
                elem["fill"] = "#000000"
                elem["stickyColor"] = "#fff9c4"
                elem["fontSize"] = 14 * scale
                elem["fontFamily"] = "Helvetica"
                if not elem["fill"]:
                    elem["fill"] = "#000000"
            elif annot_type_num == 14:
                elem["type"] = "rect"
            elif annot_type_num == 15:
                elem["type"] = "ellipse"
            elif annot_type_num == 16:
                elem["type"] = "path"
            elif annot_type_num == 5:
                elem["type"] = "rect"
                elem["fill"] = "#000000"
            else:
                elem["type"] = "rect"

            elements.append(elem)
    except Exception as e:
        print(f"Annotations extraction error: {e}", file=sys.stderr, flush=True)

    if include_widgets:
        elements.extend(extract_page_widgets(page, scale))

    return elements


def color_to_hex(r, g, b):
    return "#{:02x}{:02x}{:02x}".format(
        int(r * 255) if isinstance(r, float) and r <= 1.0 else int(r),
        int(g * 255) if isinstance(g, float) and g <= 1.0 else int(g),
        int(b * 255) if isinstance(b, float) and b <= 1.0 else int(b),
    )


def parse_linestyle_dashes(elem, stroke_w):
    linestyle = (elem.get("lineStyle") or elem.get("linestyle") or "").lower()
    if linestyle == "dashed":
        return [max(stroke_w * 3, 1), max(stroke_w * 2, 1)]
    if linestyle == "dotted":
        return [max(stroke_w, 0.5), max(stroke_w, 0.5)]
    dash_array = elem.get("strokeDashArray")
    if isinstance(dash_array, (list, tuple)) and len(dash_array) >= 2:
        scale = 0.5
        return [max(0.5, float(d) * scale) for d in dash_array[:2]]
    return None


def shape_finish_kwargs(stroke_color, fill_color, stroke_w, elem=None, fill=None):
    kwargs = {"color": stroke_color, "fill": fill if fill is not None else fill_color, "width": stroke_w}
    if elem is not None:
        dashes = parse_linestyle_dashes(elem, stroke_w)
        if dashes:
            kwargs["dashes"] = dashes
    return kwargs


def table_stroke_width_pdf(elem):
    """Map canvas stroke width to PDF line width; hairline (0) uses a minimal visible width."""
    raw = float(elem.get("strokeWidth", 1) or 0)
    stroke_color = parse_color_input(elem.get("stroke", "#333333"))
    if not stroke_color:
        return 0.0
    if raw <= 0:
        return 0.25
    return raw / 2.0


def draw_shape_rect(shape_obj, rect, corner_radius=0):
    radius = float(corner_radius or 0)
    if radius > 0:
        try:
            shape_obj.draw_rect(rect, corners=radius)
            return
        except TypeError:
            pass
    shape_obj.draw_rect(rect)


def apply_text_markup_annots(page, rect, text, elem):
    if not text or rect.is_empty:
        return
    try:
        quads = page.search_for(text, quads=True, clip=rect)
    except Exception:
        quads = []
    if not quads:
        return
    color = parse_color_input(elem.get("fill", "#000000")) or (0, 0, 0)
    try:
        if elem.get("underline"):
            for quad in quads:
                page.add_underline_annot([quad])
        if elem.get("strikeout"):
            for quad in quads:
                page.add_strikeout_annot([quad])
        if elem.get("squiggly"):
            for quad in quads:
                page.add_squiggly_annot([quad])
    except Exception:
        pass


def parse_export_request():
    body = request.get_json(silent=True) or {}
    flatten = body.get("flatten", False)
    if isinstance(flatten, str):
        flatten = flatten.lower() in ("1", "true", "yes")
    from_page = body.get("from_page")
    to_page = body.get("to_page")
    if from_page is not None:
        from_page = int(from_page)
    if to_page is not None:
        to_page = int(to_page)
    return {
        "flatten": bool(flatten),
        "from_page": from_page,
        "to_page": to_page,
        "user_password": (body.get("user_password") or "").strip() or None,
        "owner_password": (body.get("owner_password") or "").strip() or None,
        "split_pages": bool(body.get("split_pages", False)),
    }


def build_export_output_doc(source_doc, options):
    from_page = options.get("from_page")
    to_page = options.get("to_page")
    if options.get("flatten"):
        export_doc = build_flattened_export_doc(source_doc, from_page=from_page, to_page=to_page)
    else:
        export_doc = build_export_doc(source_doc, from_page=from_page, to_page=to_page)
    return export_doc


def save_export_doc_to_buffer(doc, options):
    save_kwargs = {"garbage": 4, "deflate": True}
    user_pw = options.get("user_password")
    owner_pw = options.get("owner_password")
    if user_pw or owner_pw:
        save_kwargs["encryption"] = fitz.PDF_ENCRYPT_AES_256
        save_kwargs["user_pw"] = user_pw or ""
        save_kwargs["owner_pw"] = owner_pw or user_pw or ""
    buf = io.BytesIO()
    doc.save(buf, **save_kwargs)
    doc.close()
    buf.seek(0)
    return buf


def open_uploaded_pdf(data, password=None):
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        if not password:
            doc.close()
            return None, "password_required"
        if not doc.authenticate(password):
            doc.close()
            return None, "invalid_password"
    return doc, None


def toc_to_json(doc):
    try:
        toc = doc.get_toc(simple=False) or []
    except TypeError:
        toc = doc.get_toc() or []
    items = []
    for entry in toc:
        if len(entry) >= 3:
            level, title, page = entry[0], entry[1], entry[2]
            items.append({"level": level, "title": title, "page": max(0, int(page) - 1)})
    return items


def json_to_toc(items):
    toc = []
    for item in items or []:
        level = int(item.get("level", 1))
        title = str(item.get("title", "")).strip()
        page = int(item.get("page", 0)) + 1
        if title:
            toc.append([level, title, page])
    return toc


def link_from_to_pdf_bbox(link_from):
    if link_from is None:
        return None
    try:
        if isinstance(link_from, fitz.Rect):
            rect = link_from
        elif isinstance(link_from, fitz.Quad):
            rect = link_from.rect
        elif isinstance(link_from, (list, tuple)) and len(link_from) >= 4:
            rect = fitz.Rect([float(link_from[i]) for i in range(4)])
        else:
            rect = fitz.Rect(link_from)
        rect.normalize()
        if rect.is_empty or rect.is_infinite:
            return None
        return [rect.x0, rect.y0, rect.x1, rect.y1]
    except Exception:
        return None


def normalize_link_uri(uri):
    uri = (uri or "").strip()
    if not uri:
        return ""
    lowered = uri.lower()
    if lowered.startswith(("http://", "https://", "mailto:", "tel:", "file://", "ftp://")):
        return uri
    if "@" in uri and not lowered.startswith("mailto:"):
        return f"mailto:{uri}"
    if uri.replace("+", "").replace("-", "").replace(" ", "").isdigit():
        return f"tel:{uri}"
    return f"https://{uri}"


def extract_page_links(page, scale=RENDER_SCALE, page_num=None):
    links = []
    try:
        page_links = page.get_links() or []
    except Exception as exc:
        print(f"Links extraction error: {exc}", file=sys.stderr, flush=True)
        return links

    link_goto = getattr(fitz, "LINK_GOTO", 1)

    for raw_index, link in enumerate(page_links):
        try:
            pdf_bbox = link_from_to_pdf_bbox(link.get("from"))
            if not pdf_bbox:
                continue

            kind_num = int(link.get("kind", 0) or 0)
            link_type_name = str(link.get("type", "") or "").lower()
            is_goto = kind_num == link_goto or link_type_name == "goto"

            page_target = link.get("page")
            if page_target is not None:
                try:
                    page_target = int(page_target)
                except (TypeError, ValueError):
                    page_target = None

            uri = link.get("uri")
            if uri is not None:
                uri = str(uri)

            entry = {
                "index": raw_index,
                "bbox": scaled_view_bbox(page, pdf_bbox, scale),
                "pdf_bbox": pdf_bbox,
                "kind": kind_num,
                "link_type": "goto" if is_goto else "uri",
                "uri": uri,
                "page": page_target,
            }
            if page_num is not None:
                entry["page_num"] = page_num
            links.append(entry)
        except Exception as exc:
            print(f"Link parse error: {exc}", file=sys.stderr, flush=True)
            continue

    return links


def get_raw_page_link(page, index):
    links = page.get_links() or []
    if index < 0 or index >= len(links):
        return None
    return links[index]


def delete_page_link_at_index(page, index):
    link = get_raw_page_link(page, index)
    if link is None:
        raise ValueError("Link index out of range")
    page.delete_link(link)


def insert_page_link(page, doc, pdf_coords, link_kind, uri=None, target_page=None):
    rect = fitz.Rect(pdf_coords)
    rect.normalize()
    if rect.is_empty or rect.width < 1 or rect.height < 1:
        raise ValueError("Link area is too small")

    if link_kind == "goto" and target_page is not None:
        target = int(target_page)
        if target < 0 or target >= len(doc):
            raise ValueError("Target page out of range")
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": rect,
            "page": target,
            "to": fitz.Point(0, 0),
        })
    else:
        uri = normalize_link_uri(uri)
        if not uri:
            raise ValueError("URL is required")
        page.insert_link({
            "kind": fitz.LINK_URI,
            "from": rect,
            "uri": uri,
        })


def _parse_form_bbox(raw):
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)) and len(raw) == 4:
        return [float(v) for v in raw]
    text = str(raw).strip()
    if not text:
        return None
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list) and len(parsed) == 4:
                return [float(v) for v in parsed]
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    parts = [part.strip() for part in text.split(",")]
    if len(parts) == 4:
        try:
            return [float(v) for v in parts]
        except (TypeError, ValueError):
            return None
    return None


def link_rect_from_body(page, body):
    canvas_bbox = body.get("bbox")
    pdf_bbox = body.get("pdf_bbox")

    if canvas_bbox and len(canvas_bbox) == 4:
        view_bbox = [float(canvas_bbox[i]) / RENDER_SCALE for i in range(4)]
        return page_rect_to_pdf(page, view_bbox)
    if pdf_bbox and len(pdf_bbox) == 4:
        return page_rect_to_pdf(page, [float(v) for v in pdf_bbox])
    return None


def parse_color_input(color_str):
    if not color_str or color_str == "transparent":
        return None
    if color_str.startswith("rgba"):
        parts = color_str.strip("rgba() ").split(",")
        r, g, b = int(float(parts[0])), int(float(parts[1])), int(float(parts[2]))
        return (r / 255.0, g / 255.0, b / 255.0)
    if color_str.startswith("rgb"):
        parts = color_str.strip("rgb() ").split(",")
        r, g, b = int(float(parts[0])), int(float(parts[1])), int(float(parts[2]))
        return (r / 255.0, g / 255.0, b / 255.0)
    if color_str.startswith("#"):
        hex_color = color_str.lstrip("#")
        if len(hex_color) == 6:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return (r / 255.0, g / 255.0, b / 255.0)
    return None


def _session_doc_path(session_id, entry=None):
    if entry and entry.get("doc_path"):
        return entry["doc_path"]
    return store.document_path(session_id)


def get_session(session_id):
    if session_id not in sessions:
        if not store.session_exists(session_id):
            return None
        path = store.document_path(session_id)
        try:
            doc = fitz.open(path)
            meta = store.read_meta(session_id) or {}
            sessions[session_id] = {
                "doc": doc,
                "doc_path": path,
                "page_count": len(doc),
                "password": meta.get("password"),
            }
        except Exception as e:
            print(f"Error restoring session {session_id}: {e}", file=sys.stderr, flush=True)
            return None

    entry = sessions[session_id]
    if isinstance(entry["doc"], str):
        doc = fitz.open(entry["doc"])
        entry["doc"] = doc
    return entry


def _reopen_session_doc(path, entry):
    doc = fitz.open(path)
    password = entry.get("password")
    if doc.needs_pass and password:
        doc.authenticate(password)
    entry["doc"] = doc
    return doc


def replace_session_document(session_id, pdf_bytes):
    """Replace the in-memory session PDF with new bytes (e.g. after cert signing)."""
    entry = get_session(session_id)
    if not entry:
        raise ValueError("Session not found")

    path = _session_doc_path(session_id, entry)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.cert-sign.tmp"

    try:
        with open(tmp_path, "wb") as handle:
            handle.write(pdf_bytes)
        try:
            if entry.get("doc") and not entry["doc"].is_closed:
                entry["doc"].close()
        except Exception:
            pass
        os.replace(tmp_path, path)
        doc = _reopen_session_doc(path, entry)
        entry["doc_path"] = path
        store.write_meta(session_id, {"page_count": len(doc)})
        return doc
    finally:
        if os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def save_session_doc(session_id):
    entry = sessions.get(session_id)
    if not entry:
        return None
    doc = entry["doc"]
    if not doc or doc.is_closed:
        return None
    path = _session_doc_path(session_id, entry)
    entry["doc_path"] = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        if os.path.isfile(path):
            doc.saveIncr()
        else:
            doc.save(path)
    except Exception as exc:
        print(f"Incremental save failed ({exc}); rewriting {path}", file=sys.stderr, flush=True)
        tmp_path = f"{path}.rewrite.tmp"
        try:
            doc.save(tmp_path, garbage=4, deflate=True)
        except Exception:
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)
            raise
        doc.close()
        os.replace(tmp_path, path)
        doc = _reopen_session_doc(path, entry)
    store.write_meta(session_id, {"page_count": len(doc)})
    return path


def page_size_payload(page):
    rect = page.rect
    return {"width": rect.width, "height": rect.height}


@app.route("/")
def index():
    return render_template("index.html", auth_token=desktop_config.AUTH_TOKEN)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "version": "1.0.0",
        "data_dir": str(desktop_config.DATA_DIR),
        "openssl": bool(desktop_config.resolve_openssl()),
        "tesseract": bool(desktop_config.TESSERACT_CMD or desktop_config.TESSDATA_PREFIX),
    })


@app.route("/favicon.ico")
def favicon():
    return "", 204


@app.route("/api/upload", methods=["POST"])
def upload_pdf():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No filename"}), 400

    data = file.read()
    if not validate_pdf_magic(data):
        return jsonify({"error": "Invalid PDF file"}), 400

    password = (request.form.get("password") or "").strip() or None
    try:
        doc, auth_error = open_uploaded_pdf(data, password=password)
        if auth_error == "password_required":
            return jsonify({"error": "Password required", "password_required": True}), 401
        if auth_error == "invalid_password":
            return jsonify({"error": "Invalid password", "password_required": True}), 401
        if doc is None:
            return jsonify({"error": "Failed to open PDF"}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to open PDF: {str(e)}"}), 400

    session_id = str(uuid.uuid4())
    doc.close()

    store.create_session_from_bytes(session_id, data, {
        "original_filename": file.filename,
        "password": password,
        "source": "upload",
    })

    doc = fitz.open(store.document_path(session_id))

    page_sizes = []
    for i in range(len(doc)):
        rect = doc[i].rect
        page_sizes.append({"width": rect.width, "height": rect.height})

    sessions[session_id] = {
        "doc": doc,
        "doc_path": store.document_path(session_id),
        "page_count": len(doc),
        "password": password,
    }
    store.write_meta(session_id, {"page_count": len(doc)})

    return jsonify({
        "session_id": session_id,
        "page_count": len(doc),
        "page_sizes": page_sizes,
        "original_filename": file.filename,
        "metadata": dict(doc.metadata or {}),
        "bookmarks": toc_to_json(doc),
    })


@app.route("/api/session/<session_id>/merge", methods=["POST"])
def merge_pdf(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    data = file.read()
    if not validate_pdf_magic(data):
        return jsonify({"error": "Invalid PDF file"}), 400

    password = (request.form.get("password") or "").strip() or None
    try:
        merge_doc, auth_error = open_uploaded_pdf(data, password=password)
        if auth_error:
            return jsonify({"error": "Password required" if auth_error == "password_required" else "Invalid password", "password_required": True}), 401
    except Exception as e:
        return jsonify({"error": f"Failed to open PDF: {str(e)}"}), 400

    doc = entry["doc"]
    position = request.form.get("position", "end")
    insert_at = len(doc) if position != "start" else 0
    doc.insert_pdf(merge_doc, start_at=insert_at)
    merge_doc.close()

    entry["page_count"] = len(doc)
    save_session_doc(session_id)

    page_sizes = [page_size_payload(doc[i]) for i in range(len(doc))]
    return jsonify({
        "page_count": len(doc),
        "page_sizes": page_sizes,
    })


@app.route("/api/session/<session_id>/metadata", methods=["GET", "PUT"])
def session_metadata(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if request.method == "GET":
        return jsonify({"metadata": dict(doc.metadata or {})})

    body = request.get_json(silent=True) or {}
    metadata = body.get("metadata") or {}
    for key in ("title", "author", "subject", "keywords", "creator", "producer"):
        if key in metadata:
            doc.set_metadata({key: str(metadata.get(key) or "")})
    save_session_doc(session_id)
    return jsonify({"metadata": dict(doc.metadata or {})})


@app.route("/api/session/<session_id>/bookmarks", methods=["GET", "PUT"])
def session_bookmarks(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if request.method == "GET":
        return jsonify({"bookmarks": toc_to_json(doc)})

    body = request.get_json(silent=True) or {}
    doc.set_toc(json_to_toc(body.get("bookmarks", [])))
    save_session_doc(session_id)
    return jsonify({"bookmarks": toc_to_json(doc)})


@app.route("/api/session/<session_id>/search", methods=["GET"])
def search_document(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "Search query required"}), 400

    page_filter = request.args.get("page")
    doc = entry["doc"]
    results = []
    pages = [int(page_filter)] if page_filter is not None else range(len(doc))

    for page_num in pages:
        if page_num < 0 or page_num >= len(doc):
            continue
        page = doc[page_num]
        try:
            rects = page.search_for(query, quads=True)
        except Exception:
            rects = page.search_for(query)
        for hit in rects:
            if isinstance(hit, fitz.Quad):
                rect = hit.rect
            else:
                rect = fitz.Rect(hit)
            results.append({
                "page": page_num,
                "bbox": scaled_view_bbox(page, [rect.x0, rect.y0, rect.x1, rect.y1], RENDER_SCALE),
                "pdf_bbox": [rect.x0, rect.y0, rect.x1, rect.y1],
            })

    return jsonify({"query": query, "results": results, "count": len(results)})


@app.route("/api/new", methods=["POST"])
def new_pdf():
    body = request.get_json(silent=True) or {}
    size_name = body.get("size", "A4")
    if size_name in PAGE_SIZES:
        w, h = PAGE_SIZES[size_name]
    else:
        w = float(body.get("width", 595))
        h = float(body.get("height", 842))

    doc = fitz.open()
    doc.new_page(width=w, height=h)

    session_id = str(uuid.uuid4())
    store.ensure_data_dirs()
    os.makedirs(store.session_dir(session_id), exist_ok=True)
    doc_path = store.document_path(session_id)
    doc.save(doc_path)
    doc.close()

    doc = fitz.open(doc_path)

    sessions[session_id] = {
        "doc": doc,
        "doc_path": doc_path,
        "page_count": 1,
    }
    store.write_meta(session_id, {
        "page_count": 1,
        "source": "new",
        "page_size": size_name,
        "original_filename": "untitled.pdf",
    })

    page_sizes = [{"width": w, "height": h}]
    return jsonify({
        "session_id": session_id,
        "page_count": 1,
        "page_sizes": page_sizes,
        "original_filename": "untitled.pdf",
    })


@app.route("/api/page/<session_id>/<int:page_num>/masked-preview", methods=["POST"])
def page_masked_preview(session_id, page_num):
    """Re-render page PNG with given PDF regions covered (removes scan/image source)."""
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    body = request.get_json(silent=True) or {}
    pdf_bboxes = body.get("pdf_bboxes") or []
    mask_elements = []
    for bbox in pdf_bboxes:
        if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
            mask_elements.append({"pdf_bbox": [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]})

    page = doc[page_num]
    pdf_bbox_list = [
        elem["pdf_bbox"] for elem in mask_elements if elem.get("pdf_bbox")
    ]
    b64 = render_page_with_white_masks(page, pdf_bbox_list)
    rect = page.rect

    return jsonify({
        "image": f"data:image/png;base64,{b64}",
        "width": rect.width * RENDER_SCALE,
        "height": rect.height * RENDER_SCALE,
        "pdf_width": rect.width,
        "pdf_height": rect.height,
    })


@app.route("/api/page/<session_id>/<int:page_num>/source-regions", methods=["GET"])
def page_source_regions(session_id, page_num):
    """Return PDF bboxes of image/scanned content on the page."""
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    bboxes = get_page_content_image_bboxes(page)
    return jsonify({"pdf_bboxes": bboxes, "count": len(bboxes)})


@app.route("/api/page/<session_id>/<int:page_num>", methods=["GET"])
def get_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    mask_editable = request.args.get("mask_editable", "1").lower() not in ("0", "false", "no")
    mask_elements = extract_page_elements(doc, page, include_widgets=mask_editable) if mask_editable else None
    b64 = render_page_to_png(page, mask_elements=mask_elements)
    rect = page.rect

    return jsonify({
        "image": f"data:image/png;base64,{b64}",
        "width": rect.width * 2,
        "height": rect.height * 2,
        "pdf_width": rect.width,
        "pdf_height": rect.height,
    })


@app.route("/api/page/<session_id>/<int:page_num>/elements", methods=["GET"])
def get_page_elements(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    elements = extract_page_elements(doc, page)
    return jsonify({"elements": elements})


@app.route("/api/page/<session_id>/<int:page_num>/forms", methods=["GET", "POST"])
def get_page_forms(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]

    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        widget_kind = body.get("kind", "text")
        try:
            page = create_form_widget(page, widget_kind)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            print(f"Form creation error: {exc}", file=sys.stderr, flush=True)
            return jsonify({"error": "Failed to create form field"}), 500

        try:
            save_session_doc(session_id)
        except Exception as exc:
            print(f"Form save error: {exc}", file=sys.stderr, flush=True)
            return jsonify({"error": "Failed to save form field"}), 500

        page = entry["doc"][page_num]
        forms = extract_page_widgets(page)
        created_form = forms[-1] if forms else None
        thumbnail = render_page_thumbnail(page)
        return jsonify({
            "success": True,
            "form": created_form,
            "forms": forms,
            "thumbnail": f"data:image/png;base64,{thumbnail}",
        })

    forms = extract_page_widgets(page)
    return jsonify({"forms": forms})


@app.route("/api/page/<session_id>/<int:page_num>/forms/<int:xref>/duplicate", methods=["POST"])
def duplicate_page_form(session_id, page_num, xref):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    body = request.get_json(silent=True) or {}
    source_snapshot = body.get("field")
    try:
        if isinstance(source_snapshot, dict):
            page = apply_form_updates(doc, page_num, [source_snapshot])
        page, new_xref = duplicate_form_widget(page, xref, source_snapshot)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        print(f"Form duplicate error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "Failed to duplicate form field"}), 500

    try:
        save_session_doc(session_id)
    except Exception as exc:
        print(f"Form duplicate save error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "Failed to save after duplicating form field"}), 500

    page = entry["doc"][page_num]
    forms = extract_page_widgets(page)
    duplicated_form = next((form for form in forms if form.get("xref") == new_xref), forms[-1] if forms else None)
    thumbnail = render_page_thumbnail(page)
    return jsonify({
        "success": True,
        "form": duplicated_form,
        "forms": forms,
        "thumbnail": f"data:image/png;base64,{thumbnail}",
    })


@app.route("/api/page/<session_id>/<int:page_num>/forms/<int:xref>", methods=["DELETE"])
def delete_page_form(session_id, page_num, xref):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    widget = page.load_widget(xref)
    if not widget:
        return jsonify({"error": "Form field not found"}), 404

    page.delete_widget(widget)
    try:
        save_session_doc(session_id)
    except Exception as exc:
        print(f"Form delete save error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "Failed to save after deleting form field"}), 500

    page = entry["doc"][page_num]
    forms = extract_page_widgets(page)
    thumbnail = render_page_thumbnail(page)
    return jsonify({
        "success": True,
        "forms": forms,
        "thumbnail": f"data:image/png;base64,{thumbnail}",
    })


@app.route("/api/page/<session_id>/<int:page_num>/save", methods=["POST"])
def save_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    body = request.get_json(silent=True) or {}
    elements = body.get("elements", [])
    deleted_originals = body.get("deleted_originals", [])
    form_updates = body.get("forms", [])

    page = doc[page_num]

    if form_updates:
        page = apply_form_updates(doc, page_num, form_updates)

    # (rect, cover) — cover=True paints a fill (OCR/scan masks). cover=False removes
    # text only so underlying vector backgrounds (colored headers, bars) stay intact.
    areas_to_redact = []

    for orig in deleted_originals:
        pdf_bbox = orig.get("pdf_bbox")
        if pdf_bbox and len(pdf_bbox) == 4:
            orig_type = (orig.get("type") or "").lower()
            cover = orig_type in ("ocr_mask", "image", "cover") or bool(orig.get("cover"))
            areas_to_redact.append((fitz.Rect(pdf_bbox), cover))

    new_elements = []
    for elem in elements:
        if elem.get("origin") == "pdf":
            orig_bbox = elem.get("originalPdfBbox") or elem.get("pdf_bbox")
            if orig_bbox and len(orig_bbox) == 4:
                areas_to_redact.append((fitz.Rect(orig_bbox), False))

        etype = elem.get("type", "rect")
        if etype in ("text", "textbox"):
            try:
                text_rect = fitz.Rect(resolve_elem_pdf_bbox(page, elem, 200, 40))
                if not text_rect.is_empty:
                    areas_to_redact.append((expand_text_redact_rect(page, text_rect), False))
            except Exception:
                pass

        new_elements.append(elem)

    redact_jobs = []
    for area, cover in areas_to_redact:
        if area.is_empty:
            continue
        if cover:
            try:
                fill = _pdf_fill_for_rect(page, area)
            except Exception:
                fill = _page_background_pdf_fill(page)
            redact_jobs.append((area, fill))
        else:
            # No painted patch — keeps exact original header/bar colors.
            redact_jobs.append((area, False))

    for area, fill in redact_jobs:
        page.add_redact_annot(area, fill=fill)

    if redact_jobs:
        try:
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_NONE,
                graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
        except TypeError:
            try:
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=0)
            except Exception:
                try:
                    page.apply_redactions()
                except Exception:
                    pass
        except Exception:
            try:
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=0)
            except Exception:
                try:
                    page.apply_redactions()
                except Exception:
                    pass

    redactions = []
    highlights = []
    shapes = []
    texts = []
    images_list = []
    paths_list = []
    stickies = []
    stamps = []
    tables = []
    freetexts = []
    inks = []

    for elem in new_elements:
        etype = elem.get("type", "rect")
        if etype == "redaction":
            redactions.append(elem)
        elif etype == "highlight":
            highlights.append(elem)
        elif etype in ("text", "textbox", "freetext"):
            if etype == "freetext":
                freetexts.append(elem)
            else:
                texts.append(elem)
        elif etype == "sticky":
            stickies.append(elem)
        elif etype == "table":
            tables.append(elem)
        elif etype == "image":
            images_list.append(elem)
        elif etype == "stamp":
            stamps.append(elem)
        elif etype == "ink":
            inks.append(elem)
        elif etype == "path" or etype == "line":
            paths_list.append(elem)
        else:
            shapes.append(elem)

    for elem in shapes:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, elem.get("width", 100), elem.get("height", 100))

        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue

        fill_color = parse_color_input(elem.get("fill", ""))
        stroke_color = parse_color_input(elem.get("stroke", ""))
        stroke_w = float(elem.get("strokeWidth", 1)) / 2.0
        opacity = float(elem.get("opacity", 1))

        corner_radius = float(elem.get("cornerRadius", elem.get("rx", 0)) or 0) / 2.0
        finish_kw = shape_finish_kwargs(stroke_color, fill_color, stroke_w, elem)

        etype = elem.get("type", "rect")
        if etype == "ellipse":
            shape_obj = page.new_shape()
            shape_obj.draw_oval(rect)
            shape_obj.finish(**finish_kw)
            shape_obj.commit()
        elif etype == "rect":
            shape_obj = page.new_shape()
            draw_shape_rect(shape_obj, rect, corner_radius)
            shape_obj.finish(**finish_kw)
            shape_obj.commit()
        elif etype == "star":
            import math
            cx = (rect.x0 + rect.x1) / 2
            cy = (rect.y0 + rect.y1) / 2
            rx = (rect.x1 - rect.x0) / 2
            ry = (rect.y1 - rect.y0) / 2
            
            points = []
            spikes = 5
            rot = (math.pi / 2) * 3
            step = math.pi / spikes
            
            for i in range(spikes):
                x = cx + math.cos(rot) * rx
                y = cy + math.sin(rot) * ry
                points.append(fitz.Point(x, y))
                rot += step
                
                x = cx + math.cos(rot) * (rx * 0.4)
                y = cy + math.sin(rot) * (ry * 0.4)
                points.append(fitz.Point(x, y))
                rot += step
            
            points.append(points[0])
            
            shape_obj = page.new_shape()
            shape_obj.draw_polyline(points)
            shape_obj.finish(**finish_kw)
            shape_obj.commit()
        elif etype == "line":
            line_finish = shape_finish_kwargs(stroke_color, None, stroke_w, elem)
            shape_obj = page.new_shape()
            p1 = fitz.Point(rect.x0, rect.y0)
            p2 = fitz.Point(rect.x1, rect.y1)
            shape_obj.draw_line(p1, p2)
            shape_obj.finish(**line_finish)
            shape_obj.commit()
            has_arrow = elem.get("arrow", False)
            if has_arrow:
                arrow_len = 8
                dx = p2.x - p1.x
                dy = p2.y - p1.y
                length = max((dx ** 2 + dy ** 2) ** 0.5, 0.001)
                ux = dx / length
                uy = dy / length
                ax = p2.x - ux * arrow_len - uy * arrow_len * 0.5
                ay = p2.y - uy * arrow_len + ux * arrow_len * 0.5
                bx = p2.x - ux * arrow_len + uy * arrow_len * 0.5
                by = p2.y - uy * arrow_len - ux * arrow_len * 0.5
                shape_obj = page.new_shape()
                shape_obj.draw_polyline([p2, fitz.Point(ax, ay), fitz.Point(bx, by)])
                shape_obj.finish(color=stroke_color, fill=stroke_color, width=stroke_w)
                shape_obj.commit()

    for elem in paths_list:
        pdf_bbox = elem.get("pdf_bbox")
        path_data = elem.get("pathData", elem.get("items", []))

        if isinstance(pathData := elem.get("path"), str) and pathData:
            points = []
            parts = pathData.split()
            i = 0
            while i < len(parts):
                if parts[i] in ("M", "L"):
                    if i + 2 < len(parts):
                        try:
                            x = float(parts[i + 1]) / 2.0
                            y = float(parts[i + 2]) / 2.0
                            points.append(page_point_to_pdf(page, fitz.Point(x, y)))
                        except ValueError:
                            pass
                        i += 3
                    else:
                        i += 1
                elif parts[i] == "Q":
                    if i + 4 < len(parts):
                        try:
                            x = float(parts[i + 3]) / 2.0
                            y = float(parts[i + 4]) / 2.0
                            points.append(page_point_to_pdf(page, fitz.Point(x, y)))
                        except ValueError:
                            pass
                        i += 5
                    else:
                        i += 1
                elif parts[i] == "C":
                    if i + 6 < len(parts):
                        try:
                            x = float(parts[i + 5]) / 2.0
                            y = float(parts[i + 6]) / 2.0
                            points.append(page_point_to_pdf(page, fitz.Point(x, y)))
                        except ValueError:
                            pass
                        i += 7
                    else:
                        i += 1
                else:
                    i += 1

            if len(points) >= 2:
                stroke_color = parse_color_input(elem.get("stroke", ""))
                stroke_w = float(elem.get("strokeWidth", 1)) / 2.0
                use_ink = elem.get("useInkAnnot", True)
                if use_ink and len(points) >= 2:
                    try:
                        annot = page.add_ink_annot([points])
                        if stroke_color:
                            annot.set_colors(stroke=stroke_color)
                        annot.set_border(width=stroke_w)
                        annot.update()
                        continue
                    except Exception:
                        pass
                shape_obj = page.new_shape()
                shape_obj.draw_polyline(points)
                shape_obj.finish(**shape_finish_kwargs(stroke_color, None, stroke_w, elem))
                shape_obj.commit()
        elif isinstance(path_data, list) and len(path_data) > 0:
            stroke_color = parse_color_input(elem.get("stroke", ""))
            stroke_w = float(elem.get("strokeWidth", 1)) / 2.0
            points = []
            for item in path_data:
                if isinstance(item, dict):
                    item_type = item.get("type", "L")
                    if item_type in ("C", "c"):
                        x = float(item.get("x4", item.get("x2", item.get("x", 0)))) / 2.0
                        y = float(item.get("y4", item.get("y2", item.get("y", 0)))) / 2.0
                    elif item_type in ("Q", "q"):
                        x = float(item.get("x3", item.get("x2", item.get("x", 0)))) / 2.0
                        y = float(item.get("y3", item.get("y2", item.get("y", 0)))) / 2.0
                    else:
                        x = float(item.get("x2", item.get("x", 0))) / 2.0
                        y = float(item.get("y2", item.get("y", 0))) / 2.0
                    points.append(page_point_to_pdf(page, fitz.Point(x, y)))
            if len(points) >= 2:
                use_ink = elem.get("useInkAnnot", True)
                if use_ink:
                    try:
                        annot = page.add_ink_annot([points])
                        if stroke_color:
                            annot.set_colors(stroke=stroke_color)
                        annot.set_border(width=stroke_w)
                        annot.update()
                        continue
                    except Exception:
                        pass
                shape_obj = page.new_shape()
                shape_obj.draw_polyline(points)
                shape_obj.finish(**shape_finish_kwargs(stroke_color, None, stroke_w, elem))
                shape_obj.commit()

    for elem in tables:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 180, 120)
        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue

        rows = max(1, min(20, int(elem.get("rows", 3) or 3)))
        cols = max(1, min(20, int(elem.get("cols", 3) or 3)))
        raw_row_heights = elem.get("rowHeights") or []
        raw_col_widths = elem.get("colWidths") or []
        row_heights = []
        col_widths = []
        if isinstance(raw_row_heights, list) and len(raw_row_heights) >= rows:
            vals = [max(float(v or 0), 1.0) for v in raw_row_heights[:rows]]
            total = sum(vals) or 1.0
            row_heights = [rect.height * v / total for v in vals]
        else:
            row_heights = [rect.height / rows for _ in range(rows)]
        if isinstance(raw_col_widths, list) and len(raw_col_widths) >= cols:
            vals = [max(float(v or 0), 1.0) for v in raw_col_widths[:cols]]
            total = sum(vals) or 1.0
            col_widths = [rect.width * v / total for v in vals]
        else:
            col_widths = [rect.width / cols for _ in range(cols)]
        fill_color = parse_color_input(elem.get("fill", "#ffffff"))
        stroke_color = parse_color_input(elem.get("stroke", "#333333"))
        stroke_w = table_stroke_width_pdf(elem)
        finish_kw = shape_finish_kwargs(stroke_color, fill_color, stroke_w, elem)

        shape_obj = page.new_shape()
        shape_obj.draw_rect(rect)
        shape_obj.finish(**finish_kw)
        shape_obj.commit()

        if stroke_color and stroke_w > 0:
            line_finish_kw = shape_finish_kwargs(stroke_color, None, stroke_w, elem)
            y = rect.y0
            for row_idx in range(1, rows):
                y += row_heights[row_idx - 1]
                line_obj = page.new_shape()
                line_obj.draw_line(fitz.Point(rect.x0, y), fitz.Point(rect.x1, y))
                line_obj.finish(**line_finish_kw)
                line_obj.commit()
            x = rect.x0
            for col_idx in range(1, cols):
                x += col_widths[col_idx - 1]
                line_obj = page.new_shape()
                line_obj.draw_line(fitz.Point(x, rect.y0), fitz.Point(x, rect.y1))
                line_obj.finish(**line_finish_kw)
                line_obj.commit()

        cells = elem.get("cells") or []
        row_tops = [rect.y0]
        for h in row_heights[:-1]:
            row_tops.append(row_tops[-1] + h)
        col_lefts = [rect.x0]
        for w in col_widths[:-1]:
            col_lefts.append(col_lefts[-1] + w)
        for row_idx in range(rows):
            row = cells[row_idx] if row_idx < len(cells) else []
            if not isinstance(row, list):
                continue
            for col_idx in range(cols):
                cell = row[col_idx] if col_idx < len(row) else {}
                if isinstance(cell, str):
                    cell_text = cell
                    cell_image = None
                    cell_font_size = 12
                    cell_fill = "#000000"
                    cell_align = "left"
                elif isinstance(cell, dict):
                    cell_text = cell.get("text", "")
                    cell_image = cell.get("image")
                    cell_font_size = float(cell.get("fontSize", 12))
                    cell_fill = cell.get("fill", "#000000")
                    cell_align = cell.get("textAlign", "left")
                else:
                    continue

                cell_rect = fitz.Rect(
                    col_lefts[col_idx],
                    row_tops[row_idx],
                    col_lefts[col_idx] + col_widths[col_idx],
                    row_tops[row_idx] + row_heights[row_idx],
                )
                if cell_rect.is_empty:
                    continue

                if cell_image and isinstance(cell_image, str) and cell_image.startswith("data:"):
                    try:
                        b64_part = cell_image.split(",", 1)[1]
                        img_bytes = base64.b64decode(b64_part)
                        page.insert_image(cell_rect, stream=img_bytes, keep_proportion=True)
                    except Exception:
                        pass

                if cell_text:
                    text_color = parse_color_input(cell_fill) or (0, 0, 0)
                    text_align = pdf_text_align(cell_align)
                    font_size = max(cell_font_size / 2.0, 4)
                    inset = fitz.Rect(
                        cell_rect.x0 + 2,
                        cell_rect.y0 + 2,
                        cell_rect.x1 - 2,
                        cell_rect.y1 - 2,
                    )
                    try:
                        page.insert_textbox(
                            inset,
                            cell_text,
                            fontname="helv",
                            fontsize=font_size,
                            color=text_color,
                            align=text_align,
                        )
                    except Exception:
                        pass

    for elem in inks:
        points_raw = elem.get("inkPoints") or elem.get("points") or []
        if not points_raw:
            continue
        points = []
        for pt in points_raw:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                points.append(fitz.Point(float(pt[0]), float(pt[1])))
        if len(points) >= 2:
            try:
                stroke_color = parse_color_input(elem.get("stroke", "#000000"))
                stroke_w = float(elem.get("strokeWidth", 2)) / 2.0
                annot = page.add_ink_annot([points])
                if stroke_color:
                    annot.set_colors(stroke=stroke_color)
                annot.set_border(width=stroke_w)
                annot.update()
            except Exception:
                pass

    for elem in texts:
        text = elem.get("text", "")
        if not text:
            continue

        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 200, 30)

        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty or rect.height < 1 or rect.width < 1:
            continue

        font_family = elem.get("fontFamily", "Helvetica")
        fw = elem.get("fontWeight", "")
        bold = elem.get("bold", False) or fw == "bold" or (isinstance(fw, (int, float)) and fw >= 700)
        italic = elem.get("italic", False) or elem.get("fontStyle", "") == "italic"
        pdf_font = pdf_font_name(font_family, bold, italic)
        text_align = pdf_text_align(elem.get("textAlign", "left"))

        font_size = float(elem.get("fontSize", 14)) / 2.0
        color_hex = elem.get("fill", "#000000")
        color_val = parse_color_input(color_hex)
        if color_val is None:
            color_val = (0, 0, 0)

        bg_hex = elem.get("backgroundColor", "")
        bg_color = parse_color_input(bg_hex) if bg_hex else None

        opacity = float(elem.get("opacity", 1))

        ascender_pad = max(2.0, font_size * 0.2)
        draw_rect = fitz.Rect(
            rect.x0,
            max(page.rect.y0, rect.y0 - ascender_pad),
            rect.x1,
            rect.y1,
        )

        if bg_color:
            shape_obj = page.new_shape()
            shape_obj.draw_rect(draw_rect)
            shape_obj.finish(color=None, fill=bg_color)
            shape_obj.commit()

        min_height = font_size * 2.5
        if draw_rect.height < min_height:
            draw_rect = fitz.Rect(draw_rect.x0, draw_rect.y0, draw_rect.x1, draw_rect.y0 + min_height)

        html_mode = elem.get("html") or elem.get("richHtml")
        inserted = False
        if html_mode:
            try:
                html = text if "<" in text else f"<p>{text}</p>"
                page.insert_htmlbox(draw_rect, html)
                inserted = True
            except Exception:
                inserted = False

        if not inserted:
            try:
                rc = page.insert_textbox(
                    draw_rect,
                    text,
                    fontname=pdf_font,
                    fontsize=max(font_size, 4),
                    color=color_val,
                    align=text_align,
                )
                if rc < 0:
                    expanded = fitz.Rect(draw_rect.x0, draw_rect.y0, draw_rect.x1, draw_rect.y1 + abs(rc) + font_size)
                    page.insert_textbox(
                        expanded,
                        text,
                        fontname=pdf_font,
                        fontsize=max(font_size, 4),
                        color=color_val,
                        align=text_align,
                    )
            except Exception:
                try:
                    page.insert_textbox(
                        draw_rect,
                        text,
                        fontname="helv",
                        fontsize=max(font_size, 4),
                        color=color_val,
                    )
                except Exception:
                    pass

        apply_text_markup_annots(page, draw_rect, text, elem)

    for elem in freetexts:
        text = elem.get("text", "")
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 200, 40)
        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue
        try:
            annot = page.add_freetext_annot(
                rect,
                text or "",
                fontsize=float(elem.get("fontSize", 14)) / 2.0,
                fontname=pdf_font_name(elem.get("fontFamily", "Helvetica")),
                text_color=parse_color_input(elem.get("fill", "#000000")) or (0, 0, 0),
                fill_color=parse_color_input(elem.get("backgroundColor", "#ffffff")) or (1, 1, 1),
            )
            annot.update()
        except Exception:
            pass

    for elem in stamps:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 120, 40)
        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue
        stamp_key = (elem.get("stampType") or elem.get("stamp") or "approved").lower()
        stamp_text = elem.get("text") or STAMP_PRESETS.get(stamp_key, stamp_key.upper())
        stamp_config = elem.get("stampConfig")
        try:
            if isinstance(stamp_config, dict) and stamp_config:
                merged = dict(stamp_config)
                merged.setdefault("text", stamp_text)
            else:
                merged = stamp_config_for_key(stamp_key, stamp_text)
            if "angle" in elem:
                merged["angle"] = elem["angle"]
            draw_stamp_from_config(page, rect, merged)
        except Exception:
            try:
                page.insert_textbox(
                    rect,
                    stamp_text,
                    fontname="hebo",
                    fontsize=14,
                    color=(0.8, 0, 0),
                    align=fitz.TEXT_ALIGN_CENTER,
                )
            except Exception:
                pass

    for elem in stickies:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 30, 36)
        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue
        text = elem.get("text", "")
        try:
            annot_point = fitz.Point(rect.x0, rect.y0)
            page.add_text_annot(annot_point, text or "Note", icon="Note")
        except Exception:
            pass

    for elem in images_list:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 100, 100)

        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue

        src = elem.get("src", "")
        if src.startswith("data:"):
            try:
                b64_part = src.split(",", 1)[1]
                img_bytes = base64.b64decode(b64_part)
                page.insert_image(rect, stream=img_bytes)
            except Exception:
                pass
        elif src:
            try:
                page.insert_image(rect, filename=src)
            except Exception:
                pass

    for elem in highlights:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 100, 20)

        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue

        quad = fitz.Quad(rect.top_left, rect.top_right, rect.bottom_left, rect.bottom_right)
        try:
            page.add_highlight_annot([quad])
        except Exception:
            try:
                shape_obj = page.new_shape()
                shape_obj.draw_rect(rect)
                fill_c = parse_color_input(elem.get("fill", "#ffff00")) or (1.0, 1.0, 0.0)
                shape_obj.finish(color=None, fill=fill_c)
                shape_obj.commit()
            except Exception:
                pass

    for elem in redactions:
        pdf_bbox = resolve_elem_pdf_bbox(page, elem, 100, 20)

        rect = fitz.Rect(pdf_bbox)
        if rect.is_empty:
            continue

        page.add_redact_annot(rect, fill=(0, 0, 0))

    if redactions:
        try:
            page.apply_redactions()
        except Exception:
            pass

    doc_path = save_session_doc(session_id)
    saved_path = None
    if doc_path:
        try:
            saved_path = store.sync_working_copy_to_saved(session_id)
        except OSError as err:
            print(f"Saved copy failed for {session_id}: {err}", file=sys.stderr, flush=True)

    drafts = store.read_drafts(session_id) or {}
    page_states = drafts.get("pageStates") or {}
    page_states.pop(str(page_num), None)
    store.write_drafts(session_id, {**drafts, "pageStates": page_states})

    thumbnail = render_page_thumbnail(page)

    payload = {
        "success": True,
        "thumbnail": f"data:image/png;base64,{thumbnail}",
    }
    if saved_path:
        payload["saved_path"] = saved_path
    return jsonify(payload)


@app.route("/api/cert/generate", methods=["POST"])
def generate_certificate():
    body = request.get_json(silent=True) or {}
    try:
        p12_bytes, filename, subject = generate_self_signed_pkcs12(
            common_name=body.get("common_name"),
            email=body.get("email"),
            organization=body.get("organization"),
            organizational_unit=body.get("organizational_unit"),
            country=body.get("country"),
            state=body.get("state"),
            locality=body.get("locality"),
            days=body.get("days", 365),
            key_bits=body.get("key_bits", 4096),
            export_password=body.get("export_password") or "",
        )
    except CertificateGenerateError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"Certificate generate error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "Certificate generation failed"}), 500

    return jsonify({
        "success": True,
        "filename": filename,
        "subject": subject,
        "certificate_base64": base64.b64encode(p12_bytes).decode("ascii"),
    })


@app.route("/api/session/<session_id>/cert-sign", methods=["POST"])
def cert_sign_session(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    cert_file = request.files.get("certificate")
    if not cert_file or not cert_file.filename:
        return jsonify({"error": "Certificate file is required (.p12 or .pfx)"}), 400

    filename = cert_file.filename.lower()
    if not filename.endswith((".p12", ".pfx")):
        return jsonify({"error": "Certificate must be a .p12 or .pfx file"}), 400

    try:
        page_num = int(request.form.get("page_num", "0"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid page number"}), 400

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    pdf_bbox = link_rect_from_body(page, {
        "pdf_bbox": _parse_form_bbox(request.form.get("pdf_bbox")),
        "bbox": _parse_form_bbox(request.form.get("bbox")),
    })
    if not pdf_bbox:
        return jsonify({"error": "Signature placement area is required"}), 400

    password = request.form.get("password") or ""
    reason = (request.form.get("reason") or "").strip()
    location = (request.form.get("location") or "").strip()
    contact_info = (request.form.get("contact_info") or "").strip()
    appearance_text = (request.form.get("appearance_text") or "").strip() or None

    try:
        cert_bytes = cert_file.read()
        buf = io.BytesIO()
        doc.save(buf, garbage=0, deflate=False)
        pdf_bytes = buf.getvalue()

        signed_bytes = sign_pdf_bytes_with_pkcs12(
            pdf_bytes,
            cert_bytes,
            password,
            page_num,
            pdf_bbox,
            reason=reason,
            location=location,
            contact_info=contact_info,
            appearance_text=appearance_text,
        )
        replace_session_document(session_id, signed_bytes)
    except CertificateSignError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"Certificate sign error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "Certificate signing failed"}), 500

    entry = get_session(session_id)
    page = entry["doc"][page_num]
    thumbnail = render_page_thumbnail(page)
    return jsonify({
        "success": True,
        "page_num": page_num,
        "page_count": len(entry["doc"]),
        "thumbnail": f"data:image/png;base64,{thumbnail}",
        "message": "Document signed with certificate",
    })


@app.route("/api/export/<session_id>", methods=["POST"])
def export_pdf(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    options = parse_export_request()
    source_doc = entry["doc"]

    if options.get("split_pages"):
        from_page = options.get("from_page") or 0
        to_page = options.get("to_page")
        if to_page is None:
            to_page = len(source_doc) - 1
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for pno in range(from_page, to_page + 1):
                if pno < 0 or pno >= len(source_doc):
                    continue
                single = build_export_output_doc(source_doc, {**options, "from_page": pno, "to_page": pno, "split_pages": False})
                page_buf = io.BytesIO()
                single.save(page_buf, garbage=4, deflate=True)
                single.close()
                zf.writestr(f"page-{pno + 1}.pdf", page_buf.getvalue())
        zip_buf.seek(0)
        return send_file(
            zip_buf,
            mimetype="application/zip",
            as_attachment=True,
            download_name="pages.zip",
        )

    export_doc = build_export_output_doc(source_doc, options)
    buf = save_export_doc_to_buffer(export_doc, options)
    pdf_bytes = buf.getvalue()

    meta = store.read_meta(session_id) or {}
    download_name = meta.get("original_filename") or "edited.pdf"
    if not download_name.lower().endswith(".pdf"):
        download_name = f"{download_name}.pdf"

    try:
        store.save_export_copy(session_id, pdf_bytes, suggested_name=download_name)
    except OSError as err:
        print(f"Export archive failed: {err}", file=sys.stderr, flush=True)

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=download_name,
    )


@app.route("/api/export/<session_id>/<int:page_num>", methods=["POST"])
def export_single_page_pdf(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    source_doc = entry["doc"]
    if page_num < 0 or page_num >= len(source_doc):
        return jsonify({"error": "Page out of range"}), 400

    options = parse_export_request()
    options["from_page"] = page_num
    options["to_page"] = page_num
    single_doc = build_export_output_doc(source_doc, options)
    buf = save_export_doc_to_buffer(single_doc, options)

    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"page-{page_num + 1}.pdf",
    )


@app.route("/api/export/<session_id>/<int:page_num>/png", methods=["POST"])
def export_page_png(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    body = request.get_json(silent=True) or {}
    dpi = float(body.get("dpi", 150))
    page = doc[page_num]
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72))
    buf = io.BytesIO(pix.tobytes("png"))
    buf.seek(0)
    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=True,
        download_name=f"page-{page_num + 1}.png",
    )


@app.route("/api/page/<session_id>/<int:page_num>/links", methods=["GET", "POST"])
def page_links(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    if request.method == "GET":
        try:
            page = doc[page_num]
            links = extract_page_links(page, page_num=page_num)
            return jsonify({"links": links, "page": page_num})
        except Exception as exc:
            print(f"GET links error: {exc}", file=sys.stderr, flush=True)
            return jsonify({"links": [], "warning": f"Failed to load links: {exc}"}), 200

    page = doc[page_num]
    body = request.get_json(silent=True) or {}
    pdf_coords = link_rect_from_body(page, body)
    if not pdf_coords:
        return jsonify({"error": "bbox or pdf_bbox required"}), 400

    link_kind = body.get("kind", "uri")
    try:
        insert_page_link(
            page,
            doc,
            pdf_coords,
            link_kind,
            uri=body.get("uri"),
            target_page=body.get("page"),
        )
        try:
            save_session_doc(session_id)
        except Exception as save_exc:
            print(f"Link save warning: {save_exc}", file=sys.stderr, flush=True)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"Link insert error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": f"Failed to create link: {exc}"}), 500

    page = doc[page_num]
    links = extract_page_links(page, page_num=page_num)
    return jsonify({"success": True, "links": links, "link": links[-1] if links else None})


@app.route("/api/page/<session_id>/<int:page_num>/links/<int:link_index>", methods=["PUT", "DELETE"])
def page_link_item(session_id, page_num, link_index):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    if get_raw_page_link(page, link_index) is None:
        return jsonify({"error": "Link not found"}), 404

    if request.method == "DELETE":
        try:
            delete_page_link_at_index(page, link_index)
            save_session_doc(session_id)
        except Exception as exc:
            print(f"Link delete error: {exc}", file=sys.stderr, flush=True)
            return jsonify({"error": f"Failed to delete link: {exc}"}), 500

        page = doc[page_num]
        links = extract_page_links(page, page_num=page_num)
        return jsonify({"success": True, "links": links})

    body = request.get_json(silent=True) or {}
    old_link = get_raw_page_link(page, link_index)
    pdf_bbox = link_from_to_pdf_bbox(old_link.get("from")) if old_link else None
    new_coords = link_rect_from_body(page, body)
    if new_coords:
        pdf_bbox = new_coords
    if not pdf_bbox:
        return jsonify({"error": "Could not resolve link area"}), 400

    link_kind = body.get("kind")
    if link_kind is None:
        kind_num = int(old_link.get("kind", 0) or 0)
        link_kind = "goto" if kind_num == getattr(fitz, "LINK_GOTO", 1) else "uri"

    uri = body.get("uri", old_link.get("uri") if old_link else None)
    target_page = body.get("page", old_link.get("page") if old_link else None)

    try:
        delete_page_link_at_index(page, link_index)
        insert_page_link(page, doc, pdf_bbox, link_kind, uri=uri, target_page=target_page)
        save_session_doc(session_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        print(f"Link update error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": f"Failed to update link: {exc}"}), 500

    page = doc[page_num]
    links = extract_page_links(page, page_num=page_num)
    updated = next((l for l in links if l.get("pdf_bbox") == pdf_bbox), links[-1] if links else None)
    return jsonify({"success": True, "links": links, "link": updated})


@app.route("/api/session/<session_id>/links", methods=["GET"])
def document_links(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    all_links = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        all_links.extend(extract_page_links(page, page_num=page_num))

    return jsonify({"links": all_links, "count": len(all_links)})


@app.route("/api/page/<session_id>/<int:page_num>/ocr", methods=["POST"])
def ocr_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    body = request.get_json(silent=True) or {}
    language = body.get("language", "eng")
    page = doc[page_num]

    try:
        ocr_kwargs = {"language": language}
        if desktop_config.TESSERACT_CMD:
            ocr_kwargs["tesseract"] = desktop_config.TESSERACT_CMD
        textpage = page.get_textpage_ocr(**ocr_kwargs)
        text = page.get_text("text", textpage=textpage)
    except Exception as exc:
        return jsonify({
            "error": "OCR unavailable. Install Tesseract OCR and language data on the server.",
            "detail": str(exc),
        }), 503

    elements = []
    try:
        text_dict = page.get_text("dict", textpage=textpage, flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                line_spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
                if not line_spans:
                    continue
                candidate = build_text_element_from_spans(page, line_spans, RENDER_SCALE)
                if candidate:
                    candidate["origin"] = "ocr"
                    elements.append(candidate)
    except Exception:
        pass

    return jsonify({
        "success": True,
        "text": text,
        "elements": elements,
        "language": language,
    })


@app.route("/api/page/<session_id>/<int:page_num>/tables", methods=["GET"])
def page_tables(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    tables_out = []

    try:
        finder = page.find_tables()
        tables = getattr(finder, "tables", finder) or []
        for idx, table in enumerate(tables):
            bbox = table.bbox
            pdf_bbox = [bbox.x0, bbox.y0, bbox.x1, bbox.y1]
            rows = []
            try:
                rows = table.extract()
            except Exception:
                pass
            markdown = ""
            try:
                markdown = table.to_markdown()
            except Exception:
                pass
            tables_out.append({
                "index": idx,
                "bbox": scaled_view_bbox(page, pdf_bbox, RENDER_SCALE),
                "pdf_bbox": pdf_bbox,
                "row_count": getattr(table, "row_count", len(rows)),
                "col_count": getattr(table, "col_count", 0),
                "rows": rows,
                "markdown": markdown,
            })
    except Exception as exc:
        return jsonify({"error": f"Table detection failed: {exc}"}), 500

    return jsonify({"tables": tables_out, "count": len(tables_out)})


@app.route("/api/page/<session_id>/<int:page_num>/tables/export", methods=["GET"])
def export_page_tables_csv(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    buf = io.StringIO()
    writer = csv.writer(buf)

    index_arg = request.args.get("index")
    selected_index = None
    if index_arg is not None and str(index_arg).strip() != "":
        try:
            selected_index = int(index_arg)
        except ValueError:
            return jsonify({"error": "Invalid table index"}), 400
        if selected_index < 0:
            return jsonify({"error": "Table index out of range"}), 400

    try:
        finder = page.find_tables()
        tables = getattr(finder, "tables", finder) or []
        found = False
        for idx, table in enumerate(tables):
            if selected_index is not None and idx != selected_index:
                continue
            writer.writerow([f"--- Table {idx + 1} ---"])
            try:
                for row in table.extract():
                    writer.writerow(row)
            except Exception:
                pass
            writer.writerow([])
            found = True
            if selected_index is not None:
                break
    except Exception as exc:
        return jsonify({"error": f"Table export failed: {exc}"}), 500

    if selected_index is not None and not found:
        return jsonify({"error": "Table index out of range"}), 404

    data = buf.getvalue().encode("utf-8")
    out = io.BytesIO(data)
    out.seek(0)
    suffix = f"-table-{selected_index + 1}" if selected_index is not None else "-tables"
    return send_file(
        out,
        mimetype="text/csv; charset=utf-8",
        as_attachment=True,
        download_name=f"page-{page_num + 1}{suffix}.csv",
    )


@app.route("/api/page/<session_id>/<int:page_num>/duplicate", methods=["POST"])
def duplicate_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    duplicate_doc = fitz.open()
    duplicate_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)
    insert_at = page_num + 1
    doc.insert_pdf(duplicate_doc, start_at=insert_at)
    duplicate_doc.close()

    entry["page_count"] = len(doc)
    save_session_doc(session_id)

    duplicated_page = doc[insert_at]
    return jsonify({
        "page_count": len(doc),
        "page_num": insert_at,
        "page_size": page_size_payload(duplicated_page),
        "thumbnail": f"data:image/png;base64,{render_page_thumbnail(duplicated_page)}",
    })


@app.route("/api/page/<session_id>/<int:page_num>/text", methods=["GET"])
def extract_page_text(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    text = doc[page_num].get_text("text")
    buf = io.BytesIO(text.encode("utf-8"))
    buf.seek(0)

    return send_file(
        buf,
        mimetype="text/plain; charset=utf-8",
        as_attachment=True,
        download_name=f"page-{page_num + 1}.txt",
    )


@app.route("/api/page/<session_id>/add", methods=["POST"])
def add_page(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json(silent=True) or {}
    position = body.get("position", -1)
    size_name = body.get("size", "A4")

    if size_name in PAGE_SIZES:
        w, h = PAGE_SIZES[size_name]
    else:
        w = float(body.get("width", 595))
        h = float(body.get("height", 842))

    doc = entry["doc"]

    if position < 0 or position >= len(doc):
        page = doc.new_page(width=w, height=h)
    else:
        page = doc.new_page(pno=position, width=w, height=h)

    entry["page_count"] = len(doc)
    save_session_doc(session_id)

    return jsonify({
        "page_count": len(doc),
        "page_num": doc.page_count - 1 if position < 0 else position,
    })


@app.route("/api/page/<session_id>/<int:page_num>", methods=["DELETE"])
def delete_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if len(doc) <= 1:
        return jsonify({"error": "Cannot delete the only page"}), 400
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    doc.delete_page(page_num)
    entry["page_count"] = len(doc)
    save_session_doc(session_id)

    return jsonify({"page_count": len(doc)})


@app.route("/api/page/<session_id>/move", methods=["POST"])
def move_page(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json(silent=True) or {}
    from_page = int(body.get("from_page", -1))
    to_page = int(body.get("to_page", -1))

    doc = entry["doc"]
    page_count = len(doc)
    if from_page < 0 or from_page >= page_count or to_page < 0 or to_page >= page_count:
        return jsonify({"error": "Page out of range"}), 400

    if from_page != to_page:
        order = list(range(page_count))
        page = order.pop(from_page)
        order.insert(to_page, page)
        doc.select(order)
        save_session_doc(session_id)

    return jsonify({"page_count": len(doc)})


@app.route("/api/page/<session_id>/<int:page_num>/rotate", methods=["POST"])
def rotate_page(session_id, page_num):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    body = request.get_json(silent=True) or {}
    degrees = int(body.get("degrees", 90))
    if degrees not in (90, 180, 270, -90, -180, -270):
        return jsonify({"error": "Invalid rotation angle"}), 400

    page = doc[page_num]
    page.set_rotation((normalized_page_rotation(page) + degrees) % 360)
    save_session_doc(session_id)

    elements = extract_page_elements(doc, page)
    b64 = render_page_to_png(page, mask_elements=elements)
    rect = page.rect

    return jsonify({
        "image": f"data:image/png;base64,{b64}",
        "width": rect.width * 2,
        "height": rect.height * 2,
        "pdf_width": rect.width,
        "pdf_height": rect.height,
        "thumbnail": f"data:image/png;base64,{render_page_thumbnail(page)}",
    })


@app.route("/api/session/<session_id>", methods=["GET"])
def get_session_info(session_id):
    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    page_sizes = [page_size_payload(doc[i]) for i in range(len(doc))]
    meta = store.read_meta(session_id) or {}
    return jsonify({
        "session_id": session_id,
        "page_count": len(doc),
        "page_sizes": page_sizes,
        "metadata": dict(doc.metadata or {}),
        "bookmarks": toc_to_json(doc),
        "original_filename": meta.get("original_filename"),
        "storage": {
            "unsaved_dir": store.session_dir(session_id),
            "document": store.DOCUMENT_NAME,
        },
    })


@app.route("/api/session/<session_id>/drafts", methods=["GET", "PUT"])
def session_drafts(session_id):
    if not store.session_exists(session_id) and session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404

    if request.method == "GET":
        drafts = store.read_drafts(session_id)
        if not drafts:
            return jsonify({"pageStates": {}, "pageFormStates": {}, "currentPage": 0})
        return jsonify(drafts)

    body = request.get_json(silent=True) or {}
    store.write_drafts(session_id, {
        "pageStates": body.get("pageStates") or {},
        "pageFormStates": body.get("pageFormStates") or {},
        "currentPage": body.get("currentPage", 0),
    })
    return jsonify({"success": True})


@app.route("/api/ai/settings", methods=["GET", "PUT"])
def ai_settings_route():
    if request.method == "GET":
        return jsonify(ai_settings.get_public_settings())

    if not ai_settings.check_settings_token(request.headers):
        return jsonify({"error": "Unauthorized"}), 403

    body = request.get_json(silent=True) or {}
    api_key = body.get("api_key")
    model = body.get("model")
    if api_key is not None and not str(api_key).strip():
        api_key = None
    try:
        public = ai_settings.save_settings(api_key=api_key, model=model)
        return jsonify(public)
    except OSError as exc:
        return jsonify({"error": f"Failed to save settings: {exc}"}), 500


@app.route("/api/ai/settings/test", methods=["POST"])
def ai_settings_test():
    try:
        return jsonify(ai_service.test_connection())
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/models", methods=["GET"])
def ai_models():
    try:
        return jsonify(ai_service.list_models())
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    scope = (body.get("scope") or "page").lower()
    if scope not in ("page", "document"):
        return jsonify({"error": "scope must be page or document"}), 400

    page_num = int(body.get("page_num", 0))
    doc = entry["doc"]
    if scope == "page" and (page_num < 0 or page_num >= len(doc)):
        return jsonify({"error": "Page out of range"}), 400

    messages = body.get("messages") or []
    selection_text = (body.get("selection_text") or "").strip() or None

    try:
        result = ai_service.run_assistant_chat(
            scope, doc, page_num, messages, selection_text=selection_text
        )
        return jsonify(result)
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/text-action", methods=["POST"])
def ai_text_action():
    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip().lower()
    text = body.get("text") or ""
    target_lang = body.get("target_lang") or "English"

    try:
        return jsonify(ai_service.run_text_action(action, text, target_lang=target_lang))
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/metadata/suggest", methods=["POST"])
def ai_metadata_suggest():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    try:
        return jsonify(ai_service.run_metadata_suggest(entry["doc"]))
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/forms/suggest", methods=["POST"])
def ai_forms_suggest():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id")
    page_num = int(body.get("page_num", 0))
    fields = body.get("fields") or []

    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    if not fields:
        fields = extract_page_widgets(doc[page_num])

    try:
        return jsonify(ai_service.run_forms_suggest(doc, page_num, fields))
    except AIServiceError as exc:
        return _ai_error_response(exc)


@app.route("/api/ai/ocr", methods=["POST"])
def ai_ocr_page():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id")
    page_num = int(body.get("page_num", 0))

    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    entry = get_session(session_id)
    if not entry:
        return jsonify({"error": "Session not found"}), 404

    doc = entry["doc"]
    if page_num < 0 or page_num >= len(doc):
        return jsonify({"error": "Page out of range"}), 400

    page = doc[page_num]
    rect = page.rect

    ocr_font = normalize_ocr_font_family(body.get("font_family") or body.get("fontFamily"))

    try:
        image_b64 = render_page_to_png(page, dpi_scale=RENDER_SCALE)
        blocks = ai_service.run_vision_ocr_with_fallback(image_b64, rect.width, rect.height)
        lines = extract_ocr_lines_from_blocks(blocks)
        elements = build_ai_ocr_elements_from_blocks(
            page, blocks, RENDER_SCALE, font_family=ocr_font
        )
        source_pdf_bboxes = get_page_content_image_bboxes(page)
        if not source_pdf_bboxes:
            source_pdf_bboxes = [
                e.get("pdf_bbox")
                for e in elements
                if e.get("type") == "rect" and e.get("pdf_bbox")
            ]
        full_text = ocr_full_text_from_result(lines, elements, blocks)
        text_count = sum(1 for e in elements if e.get("type") == "text")
        return jsonify({
            "success": True,
            "text": full_text,
            "elements": elements,
            "element_count": text_count,
            "line_count": len(lines),
            "block_count": len(blocks) if isinstance(blocks, list) else 0,
            "source_pdf_bboxes": source_pdf_bboxes,
            "language": "auto",
            "source": "ai",
            "layout": "clean",
        })
    except AIServiceError as exc:
        return _ai_error_response(exc)
    except Exception as exc:
        print(f"AI OCR error: {exc}", file=sys.stderr, flush=True)
        return jsonify({"error": "AI OCR failed", "detail": str(exc)}), 502


@app.route("/api/session/<session_id>", methods=["DELETE"])
def cleanup_session(session_id):
    entry = sessions.pop(session_id, None)
    if entry:
        doc = entry.get("doc")
        if doc and not doc.is_closed:
            doc.close()
    store.delete_session_workspace(session_id)
    return jsonify({"success": True})


@app.errorhandler(413)
def file_too_large(e):
    return jsonify({"error": "File too large. Maximum size is 50MB."}), 413


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    from server_entry import main

    raise SystemExit(main())
