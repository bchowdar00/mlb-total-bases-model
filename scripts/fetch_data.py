#!/usr/bin/env python3
"""
Regenerate data/fangraphs_batters_2023_2025.csv from the public FanGraphs
leaders API. Standard library only; no third-party packages, no API key.

Usage:
  python3 scripts/fetch_data.py                # seasons 2023, 2024, 2025
  python3 scripts/fetch_data.py 2024 2025      # specific seasons

Covers every batter with at least 50 plate appearances in the season (FanGraphs
`qual=50`). The server projection engine (server/model_engine.py) reads the
columns Season, Name, Team, SLG, ISO, K%, BB% from this file. The CSV is
gitignored so large data is not committed; run this script once after cloning.
"""

import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_PATH = DATA_DIR / "fangraphs_batters_2023_2025.csv"
DEFAULT_SEASONS = [2023, 2024, 2025]
COLUMNS = ["Season", "Name", "Team", "PA", "SLG", "ISO", "K%", "BB%"]
PAGE_ITEMS = 500  # rows per API page; we paginate so nothing is silently truncated


def _strip_html(s):
    if not isinstance(s, str):
        return str(s) if s is not None else ""
    return re.sub(r"<[^>]+>", "", s).strip()


def _fetch_page(season, pagenum):
    url = (
        "https://www.fangraphs.com/api/leaders/major-league/data"
        f"?age=&pos=all&stats=bat&lg=all&qual=50&season={season}&season1={season}"
        f"&ind=0&team=0&pageitems={PAGE_ITEMS}&pagenum={pagenum}&type=8&month=0"
        "&sortcol=6&sortdir=default"
    )
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 VantageEdge/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def fetch_season(season):
    """Fetch every batter with >=50 PA for the season, paginating so a single
    PAGE_ITEMS-sized page can never silently truncate the result."""
    rows = []
    pagenum = 1
    expected_total = None
    while True:
        data = _fetch_page(season, pagenum)
        page = data.get("data", [])
        # FanGraphs reports the full count; capture it to assert completeness.
        for key in ("totalCount", "dataCount", "count"):
            if isinstance(data.get(key), int):
                expected_total = data[key]
                break
        for row in page:
            name = _strip_html(row.get("Name", ""))
            if not name:
                continue
            rows.append({
                "Season": season,
                "Name": name,
                "Team": _strip_html(row.get("Team", "")),
                "PA": row.get("PA", ""),
                "SLG": row.get("SLG", ""),
                "ISO": row.get("ISO", ""),
                "K%": row.get("K%", ""),
                "BB%": row.get("BB%", ""),
            })
        if len(page) < PAGE_ITEMS:
            break  # last page reached
        pagenum += 1
    if expected_total is not None and len(rows) < expected_total:
        raise RuntimeError(
            f"season {season}: fetched {len(rows)} rows but API reports {expected_total} — truncated"
        )
    return rows


def main():
    seasons = [int(a) for a in sys.argv[1:]] or DEFAULT_SEASONS
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    all_rows = []
    for s in seasons:
        print(f"[fetch] season {s}...")
        try:
            rows = fetch_season(s)
            print(f"[fetch]   {len(rows)} batters with >=50 PA")
            all_rows.extend(rows)
        except Exception as e:
            print(f"[fetch]   failed: {e}", file=sys.stderr)
    if not all_rows:
        print("[fetch] no rows fetched — nothing written", file=sys.stderr)
        return 1
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(all_rows)
    print(f"[fetch] wrote {len(all_rows)} rows to {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
