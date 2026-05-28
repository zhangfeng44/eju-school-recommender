"""Extract EJU-related text and score hints from HTML/plain text."""

from __future__ import annotations

import re
from typing import Any

EJU_SECTION_KEYWORDS = [
    "日本留学試験",
    "日本留学试验",
    "EJU",
    "eju",
    "留学試験",
    "私費外国人",
    "外国人留学生",
    "留学生特別",
    "募集要項",
    "出願",
    "入試要項",
]

SUBJECT_PATTERNS = {
    "japanese": [
        r"日本語[^。\n]{0,40}?(\d{2,3})\s*点",
        r"日本語[^。\n]{0,40}?(\d{2,3})",
        r"読解[^。\n]{0,30}?(\d{2,3})",
    ],
    "math": [
        r"数学[^。\n]{0,40}?(\d{2,3})\s*点",
        r"数学[^。\n]{0,40}?コース\s*[12][^。\n]{0,20}?(\d{2,3})",
        r"数学[^。\n]{0,40}?(\d{2,3})",
    ],
    "physics": [
        r"物理[^。\n]{0,40}?(\d{2,3})\s*点",
        r"物理[^。\n]{0,40}?(\d{2,3})",
    ],
    "chemistry": [
        r"化学[^。\n]{0,40}?(\d{2,3})\s*点",
        r"化学[^。\n]{0,40}?(\d{2,3})",
    ],
    "biology": [
        r"生物[^。\n]{0,40}?(\d{2,3})\s*点",
        r"生物[^。\n]{0,40}?(\d{2,3})",
        r"生物[^。\n]{0,40}?(\d{2,3})",
    ],
    "japanWorld": [
        r"日本と世界[^。\n]{0,40}?(\d{2,3})",
        r"総合科目[^。\n]{0,40}?(\d{2,3})",
    ],
}


def html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ")
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def extract_pdf_links(html: str, base_url: str) -> list[str]:
    from urllib.parse import urljoin

    links = []
    for m in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, re.I):
        links.append(urljoin(base_url, m.group(1)))
    # dedupe preserve order
    seen = set()
    out = []
    for u in links:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out[:20]


def extract_eju_snippets(text: str, max_snippets: int = 5) -> list[str]:
    snippets: list[str] = []
    # split by sentence/line
    parts = re.split(r"[\n。．!！?？]", text)
    for part in parts:
        p = part.strip()
        if len(p) < 12:
            continue
        if not any(kw in p for kw in EJU_SECTION_KEYWORDS):
            continue
        if not any(k in p for k in ["日本語", "日语", "数学", "物理", "化学", "生物", "EJU", "留学試験", "留学试验"]):
            continue
        snippets.append(p[:300])
        if len(snippets) >= max_snippets:
            break
    return snippets


def extract_scores(text: str) -> dict[str, int | None]:
    scores: dict[str, int | None] = {}
    for subject, patterns in SUBJECT_PATTERNS.items():
        val = None
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                n = int(m.group(1))
                # sanity bounds
                if subject == "japanese" and 200 <= n <= 450:
                    val = n
                    break
                if subject == "math" and 80 <= n <= 200:
                    val = n
                    break
                if subject in {"physics", "chemistry", "biology", "japanWorld"} and 30 <= n <= 100:
                    val = n
                    break
        scores[subject] = val
    return scores


def analyze_page(url: str, html: str) -> dict[str, Any]:
    text = html_to_text(html)
    return {
        "url": url,
        "pdfLinks": extract_pdf_links(html, url),
        "ejuSnippets": extract_eju_snippets(text),
        "extractedScores": extract_scores(text),
        "textLength": len(text),
    }
