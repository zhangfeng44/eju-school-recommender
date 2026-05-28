#!/usr/bin/env python3
"""Discover admission / EJU related pages for schools listed in T2.docx catalog."""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "data" / "schools_catalog.json"
DOMAINS = Path(__file__).parent / "domains.json"
OUT = ROOT / "data" / "crawl_results"
RAW = ROOT / "data" / "raw"

USER_AGENT = "EJU-Recommender-Crawler/0.1 (+personal research; contact: local)"
REQUEST_DELAY = 1.2

# Keywords for finding relevant pages (Japanese + Chinese context)
LINK_KEYWORDS = [
    "留学生",
    "外国人",
    "私費",
    "私费",
    "入学",
    "入試",
    "入试",
    "募集",
    "要項",
    "要项",
    "出願",
    "出愿",
    "EJU",
    "日本留学試験",
    "日本留学试验",
    "admission",
    "international",
    "brochure",
    "application",
]

EJU_TEXT_KEYWORDS = LINK_KEYWORDS + [
    "物理",
    "化学",
    "生物",
    "数学",
    "日本語",
    "日语",
    "総合",
    "综合",
    "日本と世界",
]


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        text_parts: list[str] = []
        self._current = text_parts
        self.links.append((href, ""))
        self._last = text_parts

    def handle_data(self, data: str) -> None:
        if hasattr(self, "_last"):
            self._last.append(data)

    def close(self) -> None:
        fixed: list[tuple[str, str]] = []
        for href, _ in self.links:
            fixed.append((href, ""))
        # rebuild with text by reparsing simply below
        super().close()


def fetch(url: str, timeout: int = 20) -> tuple[int | None, str, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get_content_type()
            body = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
            try:
                text = body.decode(charset, errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")
            return resp.status, text, ctype
    except urllib.error.HTTPError as e:
        return e.code, "", None
    except Exception as e:  # noqa: BLE001
        return None, "", str(e)


def absolutize(base: str, href: str) -> str | None:
    href = href.strip()
    if not href or href.startswith("#") or href.lower().startswith("javascript:"):
        return None
    return urllib.parse.urljoin(base, href)


def extract_links(base_url: str, html: str) -> list[dict]:
    # simple regex approach robust enough for discovery pass
    results: list[dict] = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I | re.S):
        href = absolutize(base_url, m.group(1))
        if not href:
            continue
        text = re.sub(r"<[^>]+>", "", m.group(2))
        text = re.sub(r"\s+", " ", text).strip()
        results.append({"url": href, "text": text})
    return results


def score_link(item: dict) -> int:
    blob = f"{item.get('text', '')} {item.get('url', '')}".lower()
    score = 0
    for kw in LINK_KEYWORDS:
        if kw.lower() in blob:
            score += 3
    if blob.endswith(".pdf"):
        score += 2
    if "eju" in blob:
        score += 4
    return score


def score_page_text(text: str) -> int:
    score = 0
    lower = text.lower()
    for kw in EJU_TEXT_KEYWORDS:
        if kw.lower() in lower:
            score += 1
    return score


def discover_school(school: dict, domain_map: dict) -> dict:
    name = school["name"]
    base = domain_map.get(name)
    result = {
        "id": school["id"],
        "tier": school["tier"],
        "name": name,
        "nameJa": school.get("nameJa"),
        "domain": base,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
        "topLinks": [],
        "candidatePages": [],
        "errors": [],
    }

    if not base:
        result["status"] = "no_domain"
        result["errors"].append("未配置官网域名")
        return result

    status, html, meta = fetch(base)
    if status != 200 or not html:
        result["status"] = "fetch_failed"
        result["errors"].append(f"首页抓取失败: status={status}, meta={meta}")
        return result

    links = extract_links(base, html)
    scored = []
    seen = set()
    for link in links:
        url = link["url"]
        if url in seen:
            continue
        seen.add(url)
        s = score_link(link)
        if s <= 0:
            continue
        scored.append({**link, "score": s})

    scored.sort(key=lambda x: x["score"], reverse=True)
    result["topLinks"] = scored[:15]

    # probe top candidate pages for EJU-related text
    candidates = []
    for link in scored[:8]:
        time.sleep(REQUEST_DELAY)
        st, page, err = fetch(link["url"])
        if st != 200 or not page:
            continue
        text_score = score_page_text(page)
        snippet = re.sub(r"\s+", " ", page)
        snippet = snippet[:500]
        candidates.append(
            {
                "url": link["url"],
                "text": link.get("text", ""),
                "linkScore": link["score"],
                "textScore": text_score,
                "isPdf": link["url"].lower().endswith(".pdf"),
            }
        )

    candidates.sort(key=lambda x: (x["textScore"], x["linkScore"]), reverse=True)
    result["candidatePages"] = candidates[:5]
    result["status"] = "ok" if candidates else "no_candidates"
    return result


def main() -> int:
    limit = None
    if len(sys.argv) > 1:
        limit = int(sys.argv[1])

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    domain_map = json.loads(DOMAINS.read_text(encoding="utf-8"))

    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    schools = catalog if limit is None else catalog[:limit]
    results = []

    print(f"Discovering {len(schools)} schools...")
    for i, school in enumerate(schools, 1):
        print(f"[{i}/{len(schools)}] {school['tier']} {school['name']}")
        result = discover_school(school, domain_map)
        results.append(result)
        time.sleep(REQUEST_DELAY)

    out_file = OUT / f"discovery_{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"
    out_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {
        "total": len(results),
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "no_candidates": sum(1 for r in results if r["status"] == "no_candidates"),
        "failed": sum(1 for r in results if r["status"] in {"fetch_failed", "no_domain"}),
        "output": str(out_file.relative_to(ROOT)),
    }
    (OUT / "latest_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
