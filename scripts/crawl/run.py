#!/usr/bin/env python3
"""Full crawl pipeline: discover pages, extract EJU info, write data/latest.json."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# Allow importing sibling modules
sys.path.insert(0, str(Path(__file__).resolve().parent))

from discover import (  # noqa: E402
    DOMAINS,
    CATALOG,
    OUT,
    RAW,
    REQUEST_DELAY,
    discover_school,
    fetch,
)
from extract import analyze_page, analyze_text  # noqa: E402
from pdf_parse import analyze_pdf, pick_pdf_urls  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LATEST = ROOT / "data" / "latest.json"
TZ = ZoneInfo("Asia/Shanghai")


def deep_extract(result: dict) -> dict:
    """Fetch best candidate pages and extract EJU snippets / score hints."""
    pages = result.get("candidatePages") or []
    if not pages and result.get("topLinks"):
        pages = [{"url": result["topLinks"][0]["url"], "text": result["topLinks"][0].get("text", "")}]

    extracted_pages = []
    extracted_pdfs = []
    all_pdfs: list[str] = []
    merged_scores: dict[str, int | None] = {
        "japanese": None,
        "math": None,
        "physics": None,
        "chemistry": None,
        "biology": None,
        "japanWorld": None,
    }
    all_snippets: list[str] = []

    delay = float(os.environ.get("CRAWL_DELAY", REQUEST_DELAY))
    max_pdfs = int(os.environ.get("MAX_PDFS_PER_SCHOOL", "2"))

    def merge_analysis(info: dict) -> None:
        for snip in info.get("ejuSnippets", []):
            if snip not in all_snippets:
                all_snippets.append(snip)
        for k, v in (info.get("extractedScores") or {}).items():
            if v is not None and merged_scores.get(k) is None:
                merged_scores[k] = v

    for page in pages[:3]:
        url = page.get("url")
        if not url or page.get("isPdf"):
            if url and url.lower().split("?")[0].endswith(".pdf"):
                if url not in all_pdfs:
                    all_pdfs.append(url)
            continue
        time.sleep(delay)
        status, html, _ = fetch(url)
        if status != 200 or not html:
            continue
        info = analyze_page(url, html)
        extracted_pages.append(info)
        for pdf in info.get("pdfLinks", []):
            if pdf not in all_pdfs:
                all_pdfs.append(pdf)
        merge_analysis(info)

    # Also collect PDF links discovered on homepage
    for link in result.get("topLinks") or []:
        url = link.get("url", "")
        if url.lower().split("?")[0].endswith(".pdf") and url not in all_pdfs:
            all_pdfs.append(url)

    for pdf_url in pick_pdf_urls(all_pdfs, limit=max_pdfs):
        time.sleep(delay)
        pdf_info = analyze_pdf(pdf_url)
        extracted_pdfs.append(
            {
                "url": pdf_url,
                "status": pdf_info.get("status"),
                "pagesParsed": pdf_info.get("pagesParsed", 0),
                "snippetCount": len(pdf_info.get("ejuSnippets") or []),
                "error": pdf_info.get("error"),
            }
        )
        if pdf_info.get("status") == "ok":
            merge_analysis(pdf_info)

    best_url = None
    if pages:
        best_url = pages[0].get("url")
    elif result.get("topLinks"):
        best_url = result["topLinks"][0].get("url")

    has_eju = bool(all_snippets or any(v is not None for v in merged_scores.values()))
    pdf_parsed_ok = sum(1 for p in extracted_pdfs if p.get("status") == "ok" and p.get("snippetCount", 0) > 0)
    crawl_status = result.get("status", "pending")
    if crawl_status == "ok" and has_eju:
        enrich_status = "extracted"
    elif crawl_status == "ok" and pdf_parsed_ok:
        enrich_status = "extracted"
    elif crawl_status == "ok":
        enrich_status = "links_only"
    else:
        enrich_status = crawl_status

    return {
        **result,
        "bestAdmissionUrl": best_url,
        "pdfLinks": all_pdfs[:15],
        "ejuSnippets": all_snippets[:8],
        "extractedScores": merged_scores,
        "extractedPages": [
            {"url": p["url"], "snippetCount": len(p.get("ejuSnippets", [])), "pdfCount": len(p.get("pdfLinks", []))}
            for p in extracted_pages
        ],
        "extractedPdfs": extracted_pdfs,
        "enrichStatus": enrich_status,
    }


def build_latest(schools: list[dict]) -> dict:
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(TZ)
    summary = {
        "total": len(schools),
        "extracted": sum(1 for s in schools if s.get("enrichStatus") == "extracted"),
        "linksOnly": sum(1 for s in schools if s.get("enrichStatus") == "links_only"),
        "failed": sum(
            1
            for s in schools
            if s.get("enrichStatus") in {"fetch_failed", "no_domain", "no_candidates", "pending"}
        ),
        "withPdf": sum(1 for s in schools if s.get("pdfLinks")),
        "withPdfParsed": sum(
            1
            for s in schools
            if any(p.get("status") == "ok" and p.get("snippetCount", 0) > 0 for p in (s.get("extractedPdfs") or []))
        ),
        "withScores": sum(
            1
            for s in schools
            if any(v is not None for v in (s.get("extractedScores") or {}).values())
        ),
    }
    return {
        "updatedAt": now_utc.isoformat(),
        "updatedAtLocal": now_local.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "Asia/Shanghai",
        "summary": summary,
        "schools": schools,
    }


def update_catalog(schools: list[dict]) -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in schools}
    for item in catalog:
        hit = by_id.get(item["id"])
        if not hit:
            continue
        item["domain"] = hit.get("domain")
        item["admissionUrl"] = hit.get("bestAdmissionUrl")
        item["crawlStatus"] = hit.get("enrichStatus")
        item["lastCrawledAt"] = hit.get("checkedAt")
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    limit = None
    if len(sys.argv) > 1 and sys.argv[1].strip():
        limit = int(sys.argv[1])

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    domain_map = json.loads(DOMAINS.read_text(encoding="utf-8"))

    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    targets = catalog if limit is None else catalog[:limit]
    results: list[dict] = []

    print(f"Crawling {len(targets)} schools...")
    for i, school in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}] {school['tier']} {school['name']}", flush=True)
        base = discover_school(school, domain_map)
        enriched = deep_extract(base)
        results.append(enriched)
        time.sleep(float(os.environ.get("CRAWL_DELAY", REQUEST_DELAY)))

    latest = build_latest(results)
    LATEST.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    archive = OUT / f"crawl_{day}.json"
    archive.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    (OUT / "latest_summary.json").write_text(
        json.dumps({**latest["summary"], "updatedAtLocal": latest["updatedAtLocal"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    update_catalog(results)

    print(json.dumps(latest["summary"], ensure_ascii=False, indent=2))
    print(f"Wrote {LATEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
