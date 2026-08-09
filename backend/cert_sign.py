"""PKCS#12 certificate signing for PDF documents (via pyHanko)."""

from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass
from datetime import datetime

import fitz
import tzlocal
from pyhanko.pdf_utils import content, generic
from pyhanko.pdf_utils.font.basic import SimpleFontEngine
from pyhanko.pdf_utils.generic import pdf_name
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko.stamp import BaseStamp, BaseStampStyle


class CertificateSignError(Exception):
    """Raised when certificate signing fails."""


_STAMP_BORDER = (0.72, 0.78, 0.84)
_STAMP_ACCENT = (0.051, 0.580, 0.533)
_STAMP_TITLE = (0.051, 0.580, 0.533)
_STAMP_TEXT = (0.12, 0.16, 0.22)
_STAMP_MUTED = (0.42, 0.47, 0.53)
_STAMP_FILL = (0.965, 0.972, 0.984)

def pymupdf_bbox_to_pyhanko_box(page, pdf_bbox):
    """Convert a PyMuPDF view bbox to pyHanko's bottom-left PDF box."""
    rect = fitz.Rect(pdf_bbox)
    if rect.is_empty or rect.width < 1 or rect.height < 1:
        raise CertificateSignError("Signature area is too small")

    if hasattr(page, "derotation_matrix"):
        rotation = getattr(page, "rotation", 0) or 0
        if rotation:
            rect = rect * page.derotation_matrix

    x0, y0, x1, y1 = rect.normalize()
    page_height = page.rect.height
    return (
        int(round(x0)),
        int(round(page_height - y1)),
        int(round(x1)),
        int(round(page_height - y0)),
    )


def _make_field_name(page_num):
    return f"Signature_p{page_num + 1}_{int(time.time() * 1000)}"


def _load_signer(cert_bytes, password):
    if not cert_bytes:
        raise CertificateSignError("Certificate file is empty")

    passphrase = (password or "").encode("utf-8") if password else None
    try:
        return signers.SimpleSigner.load_pkcs12_data(
            cert_bytes,
            other_certs=[],
            passphrase=passphrase,
        )
    except ValueError as exc:
        message = str(exc).lower()
        if "password" in message or "pkcs12" in message or "key material" in message:
            raise CertificateSignError("Invalid certificate file or password") from exc
        raise CertificateSignError(f"Could not load certificate: {exc}") from exc
    except Exception as exc:
        raise CertificateSignError(f"Could not load certificate: {exc}") from exc


def _parse_signer_subject(signer, contact_info=""):
    cert = getattr(signer, "signing_cert", None)
    if cert is None:
        raw = getattr(signer, "subject_name", None) or "Unknown"
        match = re.match(r"^(.*?)\s*<([^>]+)>$", raw.strip())
        if match:
            return match.group(1).strip(), match.group(2).strip()
        return raw.strip(), (contact_info or "").strip()

    native = cert.subject.native
    name = (
        native.get("common_name")
        or native.get("organization_name")
        or "Unknown"
    )
    email = native.get("email_address") or (contact_info or "").strip()
    return str(name).strip(), str(email).strip()


def _build_stamp_lines(*, signer_name, signer_email, timestamp, reason="", location=""):
    lines = [
        ("title", "DIGITALLY SIGNED"),
        ("spacer", ""),
        ("name", signer_name),
    ]
    if signer_email:
        lines.append(("email", signer_email))
    lines.append(("spacer", ""))
    lines.append(("date", timestamp))
    if reason:
        lines.append(("meta", f"Reason: {reason}"))
    if location:
        lines.append(("meta", f"Location: {location}"))
    return lines


@dataclass(frozen=True)
class ModernCertStampStyle(BaseStampStyle):
    """Centered card-style signature appearance."""

    reason: str = ""
    location: str = ""
    timestamp_format: str = "%Y-%m-%d %H:%M:%S %Z"

    def create_stamp(self, writer, box, text_params):
        return ModernCertStamp(
            writer=writer,
            style=self,
            box=box,
            text_params=text_params or {},
        )


class ModernCertStamp(BaseStamp):
    _MIN_FONT_SIZE = 4.5
    _STYLE_SPECS = {
        "title": {"font": "Helvetica-Bold", "size": 7, "avg_width": 0.56, "color": _STAMP_TITLE, "leading": 10},
        "name": {"font": "Helvetica-Bold", "size": 9, "avg_width": 0.52, "color": _STAMP_TEXT, "leading": 12},
        "email": {"font": "Helvetica", "size": 7, "avg_width": 0.48, "color": _STAMP_MUTED, "leading": 10},
        "date": {"font": "Helvetica", "size": 7, "avg_width": 0.48, "color": _STAMP_MUTED, "leading": 10},
        "meta": {"font": "Helvetica", "size": 7, "avg_width": 0.48, "color": _STAMP_MUTED, "leading": 10},
        "spacer": {"leading": 4},
    }

    def __init__(self, writer, style, text_params=None, box=None):
        super().__init__(box=box, style=style, writer=writer)
        self.text_params = text_params or {}
        self._font_counter = 0

    def _register_font(self, font_name, avg_width):
        self._font_counter += 1
        resource_name = f"F{self._font_counter}"
        engine = SimpleFontEngine(self.writer, font_name, avg_width)
        self.set_resource(
            category=content.ResourceType.FONT,
            name=pdf_name(f"/{resource_name}"),
            value=engine.as_resource(),
        )
        return resource_name

    def _render_background_card(self):
        width = self.box.width
        height = self.box.height
        topbar_h = self._topbar_height()
        commands = [
            b"q",
            b"%g %g %g rg 0 0 %g %g re f" % (*_STAMP_FILL, width, height),
            b"%g %g %g rg 0 %g %g %g re f" % (*_STAMP_ACCENT, height - topbar_h, width, topbar_h),
            b"%g %g %g RG 0.75 w 0.5 0.5 %g %g re S" % (*_STAMP_BORDER, width - 1, height - 1),
        ]

        badge_col = self._badge_column_width()
        if badge_col:
            commands.extend(self._render_badge_column(badge_col))

        commands.append(b"Q")
        return commands

    def _topbar_height(self):
        return max(3, min(6, self.box.height * 0.055))

    def _badge_column_width(self):
        width = self.box.width
        height = self.box.height
        if width < 96 or height < 42:
            return 0
        return min(max(width * 0.22, 26), min(82, width * 0.34))

    def _render_badge_column(self, badge_col):
        height = self.box.height
        topbar_h = self._topbar_height()
        content_height = max(height - topbar_h, 1)
        radius = min(badge_col * 0.22, content_height * 0.26, 18)
        cx = badge_col / 2
        cy = content_height / 2 - 1
        k = 0.5522847498

        commands = [
            b"0.925 0.980 0.972 rg 0 0 %g %g re f" % (badge_col, content_height),
            b"0.82 0.88 0.93 RG 0.4 w %g 8 m %g %g l S" % (badge_col, badge_col, max(content_height - 8, 8)),
            b"%g %g %g rg" % _STAMP_ACCENT,
            (
                b"%g %g m "
                b"%g %g %g %g %g %g c "
                b"%g %g %g %g %g %g c "
                b"%g %g %g %g %g %g c "
                b"%g %g %g %g %g %g c f"
            )
            % (
                cx + radius, cy,
                cx + radius, cy + k * radius, cx + k * radius, cy + radius, cx, cy + radius,
                cx - k * radius, cy + radius, cx - radius, cy + k * radius, cx - radius, cy,
                cx - radius, cy - k * radius, cx - k * radius, cy - radius, cx, cy - radius,
                cx + k * radius, cy - radius, cx + radius, cy - k * radius, cx + radius, cy,
            ),
            b"1 1 1 RG 2 w %g %g m %g %g l %g %g l S"
            % (
                cx - radius * 0.45, cy,
                cx - radius * 0.12, cy - radius * 0.35,
                cx + radius * 0.50, cy + radius * 0.38,
            ),
        ]
        return commands

    def _layout_scale(self, lines, text_width_available):
        base_total_height = 0
        max_base_width = 0
        for line_type, text in lines:
            spec = self._STYLE_SPECS[line_type]
            base_total_height += spec.get("leading", spec.get("size", 0))
            if line_type != "spacer":
                max_base_width = max(max_base_width, len(text) * spec["avg_width"] * spec["size"])

        content_height = max(self.box.height - self._topbar_height(), 1)
        vertical_padding = max(4, min(12, content_height * 0.12))
        height_scale = (content_height - (vertical_padding * 2)) / max(base_total_height, 1)
        width_scale = text_width_available / max(max_base_width, 1)
        return min(1, max(0.45, min(height_scale, width_scale)))

    def _render_inner_content(self):
        signer_name = self.text_params.get("signer_name") or self.text_params.get("signer") or "Unknown"
        signer_email = self.text_params.get("signer_email") or ""
        timestamp = self.text_params.get("ts") or datetime.now(tz=tzlocal.get_localzone()).strftime(
            self.style.timestamp_format
        )

        lines = _build_stamp_lines(
            signer_name=signer_name,
            signer_email=signer_email,
            timestamp=f"Date: {timestamp}",
            reason=self.style.reason,
            location=self.style.location,
        )

        badge_col = self._badge_column_width()
        horizontal_padding = max(6, min(16, self.box.width * 0.05))
        text_left = badge_col + horizontal_padding if badge_col else horizontal_padding
        text_width_available = max(self.box.width - text_left - horizontal_padding, 20)
        scale = self._layout_scale(lines, text_width_available)

        line_metrics = []
        total_height = 0
        for line_type, text in lines:
            if line_type == "spacer":
                leading = self._STYLE_SPECS["spacer"]["leading"] * scale
                line_metrics.append({"line_type": line_type, "leading": leading})
                total_height += leading
                continue

            spec = self._STYLE_SPECS[line_type]
            size = max(self._MIN_FONT_SIZE, spec["size"] * scale)
            line_width = len(text) * spec["avg_width"] * size
            if line_width > text_width_available:
                size = max(self._MIN_FONT_SIZE, size * (text_width_available / max(line_width, 1)))
                line_width = len(text) * spec["avg_width"] * size
            leading = max(size + 1, spec["leading"] * scale)
            line_metrics.append({
                "line_type": line_type,
                "text": text,
                "spec": spec,
                "size": size,
                "line_width": line_width,
                "leading": leading,
            })
            total_height += leading

        topbar_h = self._topbar_height()
        content_top = self.box.height - topbar_h
        content_height = max(content_top, 1)
        top_padding = max((content_height - total_height) / 2, 3)
        y_cursor = content_top - top_padding
        commands = self._render_background_card()

        for line in line_metrics:
            if line["line_type"] == "spacer":
                y_cursor -= line["leading"]
                continue

            text = line["text"]
            spec = line["spec"]
            font_name = self._register_font(spec["font"], spec["avg_width"])
            size = line["size"]
            leading = line["leading"]
            line_width = line["line_width"]
            x_pos = text_left + max((text_width_available - line_width) / 2, 0)
            y_pos = y_cursor - size
            color = spec["color"]

            text_stream = io.BytesIO()
            generic.TextStringObject(text).write_to_stream(text_stream)
            text_op = text_stream.getvalue() + b" Tj"

            commands.append(
                b"BT /%s %g Tf %g %g %g rg %g %g Td %s ET"
                % (
                    font_name.encode("ascii"),
                    size,
                    color[0], color[1], color[2],
                    x_pos, y_pos,
                    text_op,
                )
            )
            y_cursor -= leading

        return commands


def build_modern_stamp_style(*, reason="", location=""):
    return ModernCertStampStyle(
        border_width=0,
        border_color=None,
        background=None,
        background_opacity=1.0,
        reason=reason,
        location=location,
    )


def sign_pdf_bytes_with_pkcs12(
    pdf_bytes,
    cert_bytes,
    password,
    page_num,
    pdf_bbox,
    *,
    reason="",
    location="",
    contact_info="",
    field_name=None,
    appearance_text=None,
):
    """Return a new signed PDF as bytes."""
    if not pdf_bytes:
        raise CertificateSignError("PDF document is empty")

    if page_num < 0:
        raise CertificateSignError("Page number out of range")

    signer = _load_signer(cert_bytes, password)
    field_name = (field_name or _make_field_name(page_num)).strip() or _make_field_name(page_num)

    with fitz.open(stream=pdf_bytes, filetype="pdf") as probe:
        if page_num >= len(probe):
            raise CertificateSignError("Page number out of range")
        page = probe[page_num]
        box = pymupdf_bbox_to_pyhanko_box(page, pdf_bbox)

    signer_name, signer_email = _parse_signer_subject(signer, contact_info)
    stamp_style = build_modern_stamp_style(reason=reason, location=location)

    appearance_params = {
        "signer_name": signer_name,
        "signer_email": signer_email,
    }

    output = io.BytesIO()
    try:
        reader = io.BytesIO(pdf_bytes)
        writer = IncrementalPdfFileWriter(reader)
        fields.append_signature_field(
            writer,
            sig_field_spec=fields.SigFieldSpec(
                field_name,
                on_page=page_num,
                box=box,
            ),
        )

        meta = signers.PdfSignatureMetadata(
            field_name=field_name,
            reason=reason or None,
            location=location or None,
            contact_info=contact_info or None,
        )
        pdf_signer = signers.PdfSigner(
            meta,
            signer=signer,
            stamp_style=stamp_style,
        )
        pdf_signer.sign_pdf(
            writer,
            output=output,
            appearance_text_params=appearance_params,
        )
    except CertificateSignError:
        raise
    except Exception as exc:
        raise CertificateSignError(f"Signing failed: {exc}") from exc

    signed = output.getvalue()
    if not signed:
        raise CertificateSignError("Signing produced an empty document")
    return signed
