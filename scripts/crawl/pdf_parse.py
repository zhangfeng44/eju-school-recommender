"""Download and parse PDF documents for EJU-related content."""

from __future__ import annotations

import io
import re
import urllib.error
import urllib.request
from typing import Any

from extract import analyze_text

USER_AGENT = "EJU-Recommender-Crawler/0.2 (+personal research)"
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_PDF_PAGES = 20

PDF_URL_KEYWORDS = [
    "募集",
    "要項",
    "要项",
    "yobo",
    "boshu",
    "bosyu",
    "admission",
    "application",
    "eju",
    "入試",
    "入试",
    "留学生",
    "international",
    "guide",
    "brochure",
    "pdf",
]


def score_pdf_url(url: str, link_text: str = "") -> int:
    blob = f"{url} {link_text}".lower()
    score = 0
    for kw in PDF_URL_KEYWORDS:
        if kw.lower() in blob:
            score += 2
    if blob.endswith(".pdf"):
        score += 1
    if "eju" in blob or "留学試験" in blob or "留学试验" in blob:
        score += 4
    return score


def fetch_pdf_bytes(url: str, timeout: int = 30) -> tuple[int | None, bytes | None, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = (resp.headers.get_content_type() or "").lower()
            data = resp.read(MAX_PDF_BYTES + 1)
            if len(data) > MAX_PDF_BYTES:
                return resp.status, None, "pdf_too_large"
            if "pdf" not in ctype and not url.lower().split("?")[0].endswith(".pdf"):
                # still try if extension says pdf
                if not url.lower().split("?")[0].endswith(".pdf"):
                    return resp.status, None, f"not_pdf:{ctype}"
            return resp.status, data, None
    except urllib.error.HTTPError as e:
        return e.code, None, str(e)
    except Exception as e:  # noqa: BLE001
        return None, None, str(e)


def extract_text_from_pdf(data: bytes) -> tuple[str, int]:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise ImportError("pypdf is required: pip install pypdf") from e

    reader = PdfReader(io.BytesIO(data))
    pages = min(len(reader.pages), MAX_PDF_PAGES)
    chunks: list[str] = []
    for i in range(pages):
        try:
            t = reader.pages[i].extract_text() or ""
        except Exception:  # noqa: BLE001
            t = ""
        if t.strip():
            chunks.append(t)
    text = "\n".join(chunks)
    text = re.sub(r"\s+", " ", text).strip()
    return text, pages


def analyze_pdf(url: str) -> dict[str, Any]:
    status, data, err = fetch_pdf_bytes(url)
    base = {
        "url": url,
        "status": "failed",
        "error": err,
        "pagesParsed": 0,
        "textLength": 0,
        "ejuSnippets": [],
        "extractedScores": {},
        "pdfLinks": [],
    }
    if status != 200 or not data:
        return base

    try:
        text, pages = extract_text_from_pdf(data)
    except Exception as e:  # noqa: BLE001
        base["error"] = str(e)
        return base

    if len(text) < 30:
        base["error"] = "empty_or_unreadable_pdf"
        base["pagesParsed"] = pages
        return base

    analyzed = analyze_text(text)
    base.update(
        {
            "status": "ok",
            "error": None,
            "pagesParsed": pages,
            "textLength": len(text),
            "ejuSnippets": analyzed.get("ejuSnippets", []),
            "extractedScores": analyzed.get("extractedScores", {}),
        }
    )
    return base


def pick_pdf_urls(urls: list[str], limit: int = 2) -> list[str]:
    scored = sorted(((score_pdf_url(u), u) for u in urls), key=lambda x: x[0], reverse=True)
    picked = []
    for score, url in scored:
        if score <= 0 and picked:
            break
        if url not in picked:
            picked.append(url)
        if len(picked) >= limit:
            break
    if not picked and urls:
        picked = urls[:limit]
    return picked
