"""Self-signed PKCS#12 certificate generation via OpenSSL."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile


class CertificateGenerateError(Exception):
    """Raised when certificate generation fails."""


_DN_FIELD_RE = re.compile(r"[/\\+=,#<>;\"]")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _escape_dn_value(value):
    text = str(value or "").strip()
    if not text:
        return ""
    return _DN_FIELD_RE.sub(lambda m: f"\\{m.group(0)}", text)


def _build_subject_dn(fields):
    parts = []
    mapping = (
        ("C", fields.get("country")),
        ("ST", fields.get("state")),
        ("L", fields.get("locality")),
        ("O", fields.get("organization")),
        ("OU", fields.get("organizational_unit")),
        ("CN", fields.get("common_name")),
        ("emailAddress", fields.get("email")),
    )
    for key, value in mapping:
        escaped = _escape_dn_value(value)
        if escaped:
            parts.append(f"{key}={escaped}")
    if not any(key == "CN" for key, value in mapping if _escape_dn_value(value)):
        raise CertificateGenerateError("Common Name (CN) is required")
    return "/" + "/".join(parts)


def _run_openssl(args, *, input_text=None):
    try:
        import desktop_config

        openssl = desktop_config.resolve_openssl()
    except Exception:
        openssl = shutil.which("openssl")
    if not openssl:
        raise CertificateGenerateError("OpenSSL is not installed on the server")

    try:
        result = subprocess.run(
            [openssl, *args],
            input=input_text,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise CertificateGenerateError(f"Could not run OpenSSL: {exc}") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if "password" in detail.lower() and "pkcs12" in detail.lower():
            raise CertificateGenerateError("Invalid export password for PKCS#12")
        raise CertificateGenerateError(detail or "OpenSSL command failed")
    return result


def generate_self_signed_pkcs12(
    *,
    common_name,
    email="",
    organization="",
    organizational_unit="",
    country="",
    state="",
    locality="",
    days=365,
    key_bits=4096,
    export_password="",
):
    """Generate a self-signed PKCS#12 certificate and return its bytes."""
    common_name = (common_name or "").strip()
    if not common_name:
        raise CertificateGenerateError("Common Name is required")

    email = (email or "").strip()
    if email and not _EMAIL_RE.match(email):
        raise CertificateGenerateError("Invalid email address")

    country = (country or "").strip().upper()
    if country and (len(country) != 2 or not country.isalpha()):
        raise CertificateGenerateError("Country must be a 2-letter code (e.g. US, RO)")

    try:
        days = int(days)
    except (TypeError, ValueError):
        raise CertificateGenerateError("Validity days must be a number") from None
    if days < 1 or days > 3650:
        raise CertificateGenerateError("Validity must be between 1 and 3650 days")

    try:
        key_bits = int(key_bits)
    except (TypeError, ValueError):
        raise CertificateGenerateError("Key size must be a number") from None
    if key_bits not in (2048, 3072, 4096):
        raise CertificateGenerateError("Key size must be 2048, 3072, or 4096")

    subject = _build_subject_dn({
        "common_name": common_name,
        "email": email,
        "organization": organization,
        "organizational_unit": organizational_unit,
        "country": country,
        "state": state,
        "locality": locality,
    })

    pass_arg = export_password or ""
    tmpdir = tempfile.mkdtemp(prefix="pdfedit-cert-")
    key_path = os.path.join(tmpdir, "private.key")
    crt_path = os.path.join(tmpdir, "certificate.crt")
    p12_path = os.path.join(tmpdir, "certificate.p12")

    try:
        _run_openssl([
            "req", "-x509", "-newkey", f"rsa:{key_bits}",
            "-keyout", key_path,
            "-out", crt_path,
            "-days", str(days),
            "-nodes",
            "-subj", subject,
        ])

        pkcs12_args = [
            "pkcs12", "-export",
            "-out", p12_path,
            "-inkey", key_path,
            "-in", crt_path,
            "-passout", f"pass:{pass_arg}",
        ]
        if not pass_arg:
            pkcs12_args.extend(["-legacy", "-nomac"])
        _run_openssl(pkcs12_args)

        with open(p12_path, "rb") as handle:
            p12_bytes = handle.read()
        if not p12_bytes:
            raise CertificateGenerateError("Generated certificate file is empty")

        safe_name = re.sub(r"[^\w\-]+", "_", common_name).strip("_") or "certificate"
        filename = f"{safe_name}.p12"
        return p12_bytes, filename, subject
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
