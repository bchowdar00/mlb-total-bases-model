#!/usr/bin/env python3
"""
grade_results.py — box-score grader
===================================
Reads the day's projections from Postgres (the same database the Node server
writes to, via DATABASE_URL), pulls final batting lines for that date from the
free MLB Stats API (statsapi.mlb.com), records each batter's actual total bases,
and writes the graded rows back to Postgres.

A projection is counted a "quiet game" when the batter finished with fewer total
bases than the reference value (1 or fewer, i.e. actual TB < 1.5).

Usage:
  python3 grade_results.py 2026-04-02

Requires: DATABASE_URL set, and the `psycopg` package (see requirements.txt).
Output (stdout): JSON  { "date": ..., "graded": [...], "error": ... }
"""

import sys
import json
import datetime
import urllib.request


PDT = datetime.timezone(datetime.timedelta(hours=-7))

# Columns this grader reads from / writes to. Kept as explicit lists so they can
# be unit-tested against server/schema.ts without a live database.
PREDICTIONS_SELECT = ["player_name", "team", "game", "tb_line", "prob_under", "tier", "is_demo"]
PLAYER_RESULTS_COLUMNS = [
    "game_date", "player_name", "team", "game", "tb_line", "prob_under",
    "tier", "actual_tb", "hit", "graded_at", "is_demo",
]


def pdt_today() -> str:
    return datetime.datetime.now(PDT).strftime("%Y-%m-%d")


# ─── Postgres helpers ──────────────────────────────────────────────────────────
def _connect():
    """Open a Postgres connection using DATABASE_URL. psycopg is imported lazily
    so this module can be imported (and unit-tested) without the driver or a DB."""
    import os
    import psycopg  # psycopg 3 — see requirements.txt
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(url)


def skip_demo(rows):
    """Drop demo projections (seeded via /api/seed) so they are never graded."""
    return [r for r in rows if not r.get("is_demo")]


def load_predictions(conn, date_str):
    cols = ", ".join(PREDICTIONS_SELECT)
    with conn.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM predictions WHERE game_date = %s", (date_str,))
        rows = cur.fetchall()
    return skip_demo([dict(zip(PREDICTIONS_SELECT, r)) for r in rows])


def write_results(conn, date_str, graded):
    placeholders = ", ".join(["%s"] * len(PLAYER_RESULTS_COLUMNS))
    cols = ", ".join(PLAYER_RESULTS_COLUMNS)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM player_results WHERE game_date = %s", (date_str,))
        for g in graded:
            cur.execute(
                f"INSERT INTO player_results ({cols}) VALUES ({placeholders})",
                tuple(g[c] for c in PLAYER_RESULTS_COLUMNS),
            )
    conn.commit()


# ─── MLB Stats API helpers ─────────────────────────────────────────────────────
def mlb_fetch(url: str) -> dict:
    req = urllib.request.Request(
        url, headers={"User-Agent": "VantageEdge/1.0", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def get_games_for_date(date_str: str) -> list:
    url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={date_str}&hydrate=linescore"
    data = mlb_fetch(url)
    games = []
    for g in (data.get("dates") or [{}])[0].get("games", []):
        games.append({
            "gamePk": g["gamePk"],
            "status": g.get("status", {}).get("abstractGameState", "Preview"),
        })
    return games


def get_boxscore_batting(game_pk: int) -> dict:
    url = f"https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore"
    data = mlb_fetch(url)
    batter_stats = {}
    for side in ("away", "home"):
        players = data.get("teams", {}).get(side, {}).get("players", {})
        for pdata in players.values():
            name = pdata.get("person", {}).get("fullName", "")
            s = pdata.get("stats", {}).get("batting", {})
            if not name:
                continue
            batter_stats[name] = {
                "ab":      s.get("atBats", 0) or 0,
                "pa":      s.get("plateAppearances", 0) or 0,
                "h":       s.get("hits", 0) or 0,
                "tb":      s.get("totalBases", 0) or 0,
                "hr":      s.get("homeRuns", 0) or 0,
            }
    return batter_stats


def name_match(pred_name: str, batter_stats: dict):
    """Match a projection player name to box-score stats: exact → first-initial+last → last."""
    pred_lower = pred_name.lower().strip()
    for name, stats in batter_stats.items():
        if name.lower().strip() == pred_lower:
            return stats
    parts = pred_lower.split()
    if len(parts) >= 2:
        pred_key = f"{parts[0][0]} {parts[-1]}"
        for name, stats in batter_stats.items():
            nparts = name.lower().split()
            if len(nparts) >= 2 and f"{nparts[0][0]} {nparts[-1]}" == pred_key:
                return stats
    pred_last = pred_lower.split()[-1]
    candidates = [(n, s) for n, s in batter_stats.items() if n.lower().split()[-1] == pred_last]
    if len(candidates) == 1:
        return candidates[0][1]
    return None


def grade(date_str: str) -> dict:
    """Read projections from Postgres, grade against MLB box scores, write back."""
    try:
        conn = _connect()
    except Exception as e:
        return {"date": date_str, "graded": [], "error": f"DB connection failed: {e}"}

    try:
        pred_rows = load_predictions(conn, date_str)
        if not pred_rows:
            return {"date": date_str, "graded": [], "error": f"No projections found for {date_str}"}

        try:
            games = get_games_for_date(date_str)
        except Exception as e:
            return {"date": date_str, "graded": [], "error": f"Schedule fetch failed: {e}"}

        final_games = [g for g in games if g["status"] == "Final"]
        if not final_games:
            live = [g for g in games if g["status"] == "Live"]
            if live:
                return {"date": date_str, "graded": [], "error": f"{len(live)} game(s) still in progress."}
            return {"date": date_str, "graded": [], "error": f"No Final games for {date_str} (total {len(games)})."}

        all_batter_stats = {}
        for g in final_games:
            try:
                all_batter_stats.update(get_boxscore_batting(g["gamePk"]))
            except Exception as e:
                print(f"[grade] boxscore {g['gamePk']} failed: {e}", file=sys.stderr)

        if not all_batter_stats:
            return {"date": date_str, "graded": [], "error": "Could not fetch any box scores"}

        graded_now = datetime.datetime.utcnow().isoformat()
        graded_list = []
        for row in pred_rows:
            match = name_match(row["player_name"], all_batter_stats)
            if match is None:
                continue
            actual_tb = match["tb"]
            # Quiet game: fewer total bases than the reference value (1 or fewer).
            hit = 1 if actual_tb < row["tb_line"] else 0
            graded_list.append({
                "game_date":  date_str,
                "player_name": row["player_name"],
                "team":       row.get("team", ""),
                "game":       row.get("game", ""),
                "tb_line":    row["tb_line"],
                "prob_under": row["prob_under"],
                "tier":       row["tier"],
                "actual_tb":  actual_tb,
                "hit":        hit,
                "graded_at":  graded_now,
                "is_demo":    0,
            })

        write_results(conn, date_str, graded_list)
        return {"date": date_str, "graded": graded_list, "error": None}
    finally:
        conn.close()


if __name__ == "__main__":
    date_str = sys.argv[1] if len(sys.argv) > 1 else pdt_today()
    result = grade(date_str)
    print(json.dumps(result))
