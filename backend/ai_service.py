"""OpenRouter client and PDF-aware AI task helpers."""

import json
import os
import re
import time

import requests

import ai_settings

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
APP_TITLE = "PDFEdit"
MAX_CONTEXT_CHARS = 80_000
MODELS_CACHE_TTL = 3600

_models_cache = {"at": 0.0, "data": None, "raw": None}
VISION_OCR_TIMEOUT = 180
VISION_MODEL_HINT = "openai/gpt-4o or google/gemini-2.0-flash-001"

AI_NOT_CONFIGURED = "AI not configured. Open Settings and add your OpenRouter API key."


class AIServiceError(Exception):
    def __init__(self, message, status_code=502, detail=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail


def require_config():
    config = ai_settings.get_effective_config()
    if not config:
        raise AIServiceError(AI_NOT_CONFIGURED, status_code=503)
    return config


def _openrouter_headers(api_key):
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.environ.get("OPENROUTER_HTTP_REFERER", "http://127.0.0.1:5001"),
        "X-OpenRouter-Title": os.environ.get("OPENROUTER_APP_TITLE", APP_TITLE),
    }


def _parse_openrouter_error(resp):
    try:
        payload = resp.json()
        err = payload.get("error")
        if isinstance(err, dict):
            return err.get("message") or str(err)
        if isinstance(err, str):
            return err
    except Exception:
        pass
    return resp.text[:500] if resp.text else f"HTTP {resp.status_code}"


def chat_completion(messages, *, model=None, temperature=0.5, max_tokens=4096, timeout=120):
    config = require_config()
    body = {
        "model": model or config["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        resp = requests.post(
            f"{OPENROUTER_BASE}/chat/completions",
            headers=_openrouter_headers(config["api_key"]),
            json=body,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise AIServiceError("Failed to reach OpenRouter", status_code=502, detail=str(exc)) from exc

    if resp.status_code == 401:
        raise AIServiceError("Invalid OpenRouter API key", status_code=401)
    if resp.status_code == 429:
        raise AIServiceError("OpenRouter rate limit exceeded. Try again later.", status_code=429)
    if not resp.ok:
        raise AIServiceError(
            _parse_openrouter_error(resp),
            status_code=resp.status_code if 400 <= resp.status_code < 600 else 502,
        )

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise AIServiceError("Empty response from OpenRouter", status_code=502)
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        content = "".join(parts)
    if not content:
        raise AIServiceError("No text in OpenRouter response", status_code=502)
    return content.strip()


def test_connection():
    content = chat_completion(
        [{"role": "user", "content": "Reply with exactly: OK"}],
        temperature=0,
        max_tokens=16,
    )
    return {"success": True, "reply": content[:200]}


def _refresh_models_cache():
    global _models_cache
    now = time.time()
    if _models_cache["data"] is not None and now - _models_cache["at"] < MODELS_CACHE_TTL:
        return

    config = require_config()
    try:
        resp = requests.get(
            f"{OPENROUTER_BASE}/models",
            headers=_openrouter_headers(config["api_key"]),
            timeout=60,
        )
    except requests.RequestException as exc:
        raise AIServiceError("Failed to fetch models", status_code=502, detail=str(exc)) from exc

    if not resp.ok:
        raise AIServiceError(_parse_openrouter_error(resp), status_code=resp.status_code)

    payload = resp.json()
    raw = payload.get("data") or []
    models = []
    for item in raw:
        model_id = item.get("id")
        if not model_id:
            continue
        arch = item.get("architecture") or {}
        input_modalities = arch.get("input_modalities") or []
        models.append({
            "id": model_id,
            "name": item.get("name") or model_id,
            "context_length": item.get("context_length"),
            "supports_vision": "image" in input_modalities,
        })
    models.sort(key=lambda m: m["id"])
    _models_cache = {"at": now, "data": {"models": models}, "raw": raw}


def list_models():
    _refresh_models_cache()
    return _models_cache["data"]


def model_supports_vision(model_id=None):
    """Return True/False if known; None if model id not in OpenRouter catalog."""
    config = require_config()
    model_id = (model_id or config["model"] or "").strip()
    if not model_id:
        return False
    try:
        _refresh_models_cache()
    except AIServiceError:
        return None
    for item in _models_cache.get("raw") or []:
        if item.get("id") == model_id:
            arch = item.get("architecture") or {}
            return "image" in (arch.get("input_modalities") or [])
    return None


def require_vision_model():
    config = require_config()
    model = config["model"]
    supported = model_supports_vision(model)
    if supported is False:
        raise AIServiceError(
            f"Model '{model}' does not support image input. "
            f"AI OCR requires a vision model (e.g. {VISION_MODEL_HINT}). "
            "Change the model in AI Settings.",
            status_code=400,
        )


def extract_document_text(doc, page_range=None, max_chars=MAX_CONTEXT_CHARS):
    pages = list(page_range) if page_range is not None else range(len(doc))
    chunks = []
    total = 0
    truncated = False

    for page_num in pages:
        if page_num < 0 or page_num >= len(doc):
            continue
        text = (doc[page_num].get_text("text") or "").strip()
        if not text:
            continue
        block = f"--- Page {page_num + 1} ---\n{text}"
        if total + len(block) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                chunks.append(block[:remaining] + "\n[... truncated ...]")
            truncated = True
            break
        chunks.append(block)
        total += len(block) + 2

    return {
        "text": "\n\n".join(chunks),
        "truncated": truncated,
        "page_count": len(pages),
    }


ASSISTANT_SYSTEM = """You are a PDF document assistant for PDFEdit.
Answer using ONLY the document context provided below.
If the answer is not in the context, say you cannot find it in the document.
Cite page numbers when relevant (e.g. "Page 3").
Be concise and accurate. Do not invent facts."""

TEXT_ACTION_PROMPTS = {
    "rewrite": "Rewrite the following text for clarity while preserving meaning. Return only the rewritten text, no quotes or explanation.",
    "translate": "Translate the following text to {target_lang}. Return only the translation.",
    "grammar": "Fix grammar and spelling in the following text. Return only the corrected text.",
    "shorten": "Shorten the following text while keeping key information. Return only the shortened text.",
    "expand": "Expand the following text with more detail while staying consistent. Return only the expanded text.",
}

METADATA_SYSTEM = """You suggest PDF document metadata from extracted text.
Respond with ONLY valid JSON (no markdown fences) using this schema:
{"title": string, "subject": string, "keywords": string (comma-separated), "summary": string (1-3 sentences)}"""

FORMS_SYSTEM = """You suggest values for PDF form fields based on document context.
Respond with ONLY valid JSON (no markdown fences): an object mapping field_name to suggested string value.
Only include fields from the provided list. Use empty string if unknown."""

OCR_SYSTEM = """You perform OCR on a PDF page image, including handwriting and scans.
Return ONLY valid JSON (no markdown fences).

Preferred format — array of objects (one per line or paragraph):
[{"text": "line of text", "x0": 72, "y0": 100, "x1": 400, "y1": 118,
  "bold": false, "italic": false, "color": "#333333"}]

Coordinate rules when providing x0,y0,x1,y1:
- PDF points; origin TOP-LEFT; y increases downward.
- Values must be within the page width/height given below.

Optional styling (only for crisp printed or computer-rendered text, not handwriting):
- bold, italic: booleans when visually obvious.
- color: text color as #rrggbb when readable.
Omit styling only for handwriting or when truly uncertain.

Write real UTF-8 characters in "text" (e.g. î, ă, ș, ț) — do NOT put \\u escape codes inside transcribed text.

If exact positions are uncertain, you MAY instead return:
{"lines": ["first line", "second line", ...]}
with every visible line of text transcribed accurately.

Transcribe ALL visible text. Do not return an empty array if text is present.

JSON escaping: inside string values, escape backslashes as \\\\ (e.g. Windows paths). Do not use incomplete \\u sequences."""

OCR_PLAIN_PROMPT = """Transcribe every word visible in this image exactly as written (printed or handwriting).
Return ONLY the transcribed plain text with one line per line of writing. No JSON, no commentary."""


def _strip_json_fences(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _fix_json_invalid_escapes(text):
    """Repair common invalid escapes in model-generated JSON (e.g. \\u in paths, lone \\)."""
    if not text:
        return text
    # \\u must be followed by exactly 4 hex digits in JSON
    text = re.sub(r"\\u(?![0-9a-fA-F]{4})", r"\\\\u", text)
    # Double backslashes that are not valid JSON escape starters
    text = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", text)
    return text


def _try_parse_json(text):
    for candidate in (text, _fix_json_invalid_escapes(text)):
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def parse_json_response(text):
    text = _strip_json_fences(text)
    parsed = _try_parse_json(text)
    if parsed is not None:
        return parsed
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if match:
        parsed = _try_parse_json(match.group(1))
        if parsed is not None:
            return parsed
    raise AIServiceError("AI returned invalid JSON", status_code=502, detail=text[:300])


def build_assistant_messages(scope, doc, page_num, user_messages, selection_text=None):
    if scope == "page":
        ctx = extract_document_text(doc, page_range=[page_num])
        scope_label = f"page {page_num + 1}"
    else:
        ctx = extract_document_text(doc)
        scope_label = "full document"

    context_block = ctx["text"] or "(No extractable text in this scope.)"
    if ctx["truncated"]:
        context_block += "\n\n[Note: document text was truncated due to length limits.]"

    system = (
        f"{ASSISTANT_SYSTEM}\n\n"
        f"Scope: {scope_label}\n\n"
        f"--- DOCUMENT CONTEXT ---\n{context_block}\n--- END CONTEXT ---"
    )
    if selection_text:
        system += f"\n\nUser selected text on canvas:\n{selection_text}"

    messages = [{"role": "system", "content": system}]
    for msg in user_messages or []:
        role = msg.get("role", "user")
        if role not in ("user", "assistant"):
            continue
        content = (msg.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    return messages, ctx.get("truncated", False)


def run_assistant_chat(scope, doc, page_num, user_messages, selection_text=None):
    messages, truncated = build_assistant_messages(
        scope, doc, page_num, user_messages, selection_text
    )
    reply = chat_completion(messages, temperature=0.6, max_tokens=4096)
    return {"reply": reply, "truncated": truncated}


def run_text_action(action, text, target_lang="English"):
    text = (text or "").strip()
    if not text:
        raise AIServiceError("No text provided", status_code=400)
    if action not in TEXT_ACTION_PROMPTS:
        raise AIServiceError(f"Unknown action: {action}", status_code=400)

    prompt = TEXT_ACTION_PROMPTS[action]
    if "{target_lang}" in prompt:
        prompt = prompt.format(target_lang=target_lang or "English")

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": text},
    ]
    result = chat_completion(messages, temperature=0.5, max_tokens=2048)
    return {"text": result}


def run_metadata_suggest(doc):
    ctx = extract_document_text(doc)
    messages = [
        {"role": "system", "content": METADATA_SYSTEM},
        {
            "role": "user",
            "content": f"Document text:\n\n{ctx['text'] or '(empty)'}",
        },
    ]
    raw = chat_completion(messages, temperature=0.2, max_tokens=1024)
    data = parse_json_response(raw)
    return {
        "title": str(data.get("title") or ""),
        "subject": str(data.get("subject") or ""),
        "keywords": str(data.get("keywords") or ""),
        "summary": str(data.get("summary") or ""),
        "truncated": ctx["truncated"],
    }


def run_forms_suggest(doc, page_num, fields):
    if not fields:
        raise AIServiceError("No form fields provided", status_code=400)

    page_ctx = extract_document_text(doc, page_range=[page_num], max_chars=40_000)
    doc_ctx = extract_document_text(doc, max_chars=40_000)

    field_desc = json.dumps(
        [
            {
                "field_name": f.get("field_name"),
                "label": f.get("field_label"),
                "kind": f.get("widget_kind"),
                "current_value": f.get("value"),
            }
            for f in fields
        ],
        indent=2,
    )

    messages = [
        {"role": "system", "content": FORMS_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Current page ({page_num + 1}) text:\n{page_ctx['text']}\n\n"
                f"Full document text (may be truncated):\n{doc_ctx['text']}\n\n"
                f"Fields to fill:\n{field_desc}"
            ),
        },
    ]
    raw = chat_completion(messages, temperature=0.2, max_tokens=2048)
    suggestions = parse_json_response(raw)
    if not isinstance(suggestions, dict):
        raise AIServiceError("Expected JSON object for form suggestions", status_code=502)
    return {"suggestions": suggestions}


def normalize_ocr_text_content(text):
    """Decode mangled escapes and fix common OCR JSON artifacts in transcribed text."""
    if not text:
        return text
    text = str(text)
    # Corrupted \\u00%cen-style artifacts (broken \\u00ee + n for Romanian în)
    text = re.sub(r"\\u00%ce?n\b", "în", text, flags=re.IGNORECASE)
    text = re.sub(r"\\u00%CE?N\b", "În", text)
    if "\\u" in text:

        def _unicode_repl(match):
            try:
                return chr(int(match.group(1), 16))
            except (ValueError, OverflowError):
                return match.group(0)

        text = re.sub(r"\\u([0-9a-fA-F]{4})", _unicode_repl, text)
    return text


def _coerce_block_item(item):
    if isinstance(item, str):
        return {"text": normalize_ocr_text_content(item.strip())}
    if isinstance(item, dict):
        text = (
            item.get("text")
            or item.get("content")
            or item.get("line")
            or item.get("value")
            or ""
        )
        merged = dict(item)
        merged["text"] = normalize_ocr_text_content(str(text).strip())
        return merged
    return {"text": normalize_ocr_text_content(str(item).strip())}


def blocks_have_text(blocks):
    return any(isinstance(b, dict) and (b.get("text") or "").strip() for b in (blocks or []))


def coerce_vision_blocks(parsed):
    """Normalize varied model JSON into a list of {text, optional coords, optional typography}."""
    if parsed is None:
        return []
    if isinstance(parsed, list):
        return [_coerce_block_item(item) for item in parsed if item is not None]
    if isinstance(parsed, dict):
        for key in ("blocks", "lines", "results", "text_blocks", "items", "data"):
            if key in parsed and isinstance(parsed[key], list):
                return [_coerce_block_item(item) for item in parsed[key]]
        text = parsed.get("text") or parsed.get("content") or parsed.get("transcription")
        if isinstance(text, list):
            return [_coerce_block_item(item) for item in text]
        if isinstance(text, str) and text.strip():
            return [_coerce_block_item(line) for line in text.splitlines() if line.strip()]
    if isinstance(parsed, str) and parsed.strip():
        return [_coerce_block_item(line) for line in parsed.splitlines() if line.strip()]
    return []


def _vision_messages(page_image_b64, page_width, page_height, prompt):
    return [{
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": f"{prompt}\n\nPage size in PDF points: width={page_width}, height={page_height}.",
            },
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{page_image_b64}"},
            },
        ],
    }]


def run_vision_ocr_plain(page_image_b64, page_width, page_height):
    require_vision_model()
    messages = _vision_messages(page_image_b64, page_width, page_height, OCR_PLAIN_PROMPT)
    return chat_completion(
        messages, temperature=0.1, max_tokens=8192, timeout=VISION_OCR_TIMEOUT
    )


def run_vision_ocr(page_image_b64, page_width, page_height):
    require_vision_model()
    messages = _vision_messages(page_image_b64, page_width, page_height, OCR_SYSTEM)
    raw = chat_completion(
        messages, temperature=0.1, max_tokens=8192, timeout=VISION_OCR_TIMEOUT
    )
    try:
        parsed = parse_json_response(raw)
    except (AIServiceError, json.JSONDecodeError):
        parsed = raw
    return coerce_vision_blocks(parsed)


def run_vision_ocr_with_fallback(page_image_b64, page_width, page_height):
    """Structured OCR first (layout); plain transcription if no text found."""
    structured = run_vision_ocr(page_image_b64, page_width, page_height)
    if blocks_have_text(structured):
        return structured
    plain = run_vision_ocr_plain(page_image_b64, page_width, page_height)
    blocks = coerce_vision_blocks(plain)
    if blocks_have_text(blocks):
        return blocks
    return structured
