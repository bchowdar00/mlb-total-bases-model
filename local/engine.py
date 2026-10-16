"""
Vantage Edge — self-contained MLB total-bases projection engine (local variant)

Pulls everything live from free, public, no-auth sources:
  - FanGraphs API  → batter SLG, ISO, K%, BB%, wOBA (season)
  - FanGraphs API  → pitcher K/9, BB/9, WHIP, xFIP (season)
  - MLB Stats API  → today's schedule, probable pitchers, venue/park factor

For each batter with at least 50 plate appearances (FanGraphs qual=50) it
computes a transparent, hand-tuned "quiet game" score — the chance the hitter
records 1 or fewer total bases in a game. When the batter's team plays today the
score also uses that game's ballpark factor and opposing starter; otherwise it
is park-neutral.

This is a heuristic ranking, not a trained model and not a prediction of any
outcome. It involves no money and no prediction-market data.
"""

import json
import re
import urllib.request
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

PDT = timezone(timedelta(hours=-7))


def today_pdt():
    return datetime.now(PDT).strftime("%Y-%m-%d")


def _get(url, headers=None, timeout=20):
    h = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 VantageEdge/1.0"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# FanGraphs — batter + pitcher season stats
# ─────────────────────────────────────────────────────────────────────────────
def _strip_html(s):
    if not isinstance(s, str):
        return str(s) if s is not None else ""
    return re.sub(r"<[^>]+>", "", s).strip()


def fetch_fg_batters(season):
    url = (
        f"https://www.fangraphs.com/api/leaders/major-league/data"
        f"?age=&pos=all&stats=bat&lg=all&qual=50&season={season}&season1={season}"
        f"&ind=0&team=0&pageitems=500&pagenum=1&type=8&month=0&sortcol=6&sortdir=default"
    )
    data = _get(url)
    if not data:
        return {}
    result = {}
    for row in data.get("data", []):
        name = _strip_html(row.get("Name", ""))
        if not name:
            continue
        try:
            result[name.lower()] = {
                "name":   name,
                "slg":    float(row.get("SLG", 0) or 0),
                "iso":    float(row.get("ISO", 0) or 0),
                "k_pct":  float(row.get("K%", 0) or 0),
                "bb_pct": float(row.get("BB%", 0) or 0),
                "woba":   float(row.get("wOBA", 0) or 0),
                "team":   _strip_html(row.get("Team", "")),
            }
        except Exception:
            continue
    return result


def fetch_fg_pitchers(season):
    url = (
        f"https://www.fangraphs.com/api/leaders/major-league/data"
        f"?age=&pos=all&stats=pit&lg=all&qual=10&season={season}&season1={season}"
        f"&ind=0&team=0&pageitems=300&pagenum=1&type=8&month=0&sortcol=6&sortdir=default"
    )
    data = _get(url)
    if not data:
        return {}
    result = {}
    for row in data.get("data", []):
        name = _strip_html(row.get("Name", ""))
        if not name:
            continue
        try:
            result[name.lower()] = {
                "name": name,
                "k9":   float(row.get("K/9", 0) or 0),
                "whip": float(row.get("WHIP", 0) or 0),
                "xfip": float(row.get("xFIP", 0) or 0),
                "era":  float(row.get("ERA", 0) or 0),
                "team": _strip_html(row.get("Team", "")),
            }
        except Exception:
            continue
    return result


# ─────────────────────────────────────────────────────────────────────────────
# MLB Stats API — today's schedule, probable pitchers, venue park factor
# ─────────────────────────────────────────────────────────────────────────────
PARK_FACTORS = {
    1: 0.94, 2: 1.05, 3: 1.03, 4: 1.01, 5: 0.97, 12: 0.96, 14: 0.99, 17: 0.98,
    19: 0.93, 20: 0.97, 21: 1.02, 22: 0.98, 26: 1.00, 27: 0.99, 680: 1.01,
    2392: 0.99, 2394: 0.98, 2395: 0.99, 2396: 1.00, 2397: 0.97, 2398: 1.04,
    2602: 1.00, 2756: 1.00, 3289: 0.98, 3312: 0.94, 4169: 0.98, 5325: 1.02,
}


def fetch_today_games(date_str):
    url = (
        f"https://statsapi.mlb.com/api/v1/schedule"
        f"?sportId=1&date={date_str}&hydrate=probablePitcher,team,venue"
    )
    data = _get(url)
    if not data:
        return []
    games_out = []
    for game in (data.get("dates") or [{}])[0].get("games", []):
        away_team = game["teams"]["away"]["team"]
        home_team = game["teams"]["home"]["team"]
        away_sp = game["teams"]["away"].get("probablePitcher", {})
        home_sp = game["teams"]["home"].get("probablePitcher", {})
        venue_id = game.get("venue", {}).get("id", 0)
        away_abbr = away_team.get("abbreviation", "UNK").upper()
        home_abbr = home_team.get("abbreviation", "UNK").upper()
        games_out.append({
            "away_abbr":    away_abbr,
            "home_abbr":    home_abbr,
            "away_sp_name": away_sp.get("fullName", ""),
            "home_sp_name": home_sp.get("fullName", ""),
            "park_factor":  PARK_FACTORS.get(venue_id, 1.00),
            "game_title":   f"{away_abbr} @ {home_abbr}",
        })
    return games_out


# ─────────────────────────────────────────────────────────────────────────────
# Fuzzy name matching
# ─────────────────────────────────────────────────────────────────────────────
def _normalize(name):
    name = name.lower().strip()
    for src, dst in {
        "á": "a", "à": "a", "ä": "a", "â": "a", "ã": "a", "é": "e", "è": "e",
        "ë": "e", "ê": "e", "í": "i", "ì": "i", "ï": "i", "î": "i", "ó": "o",
        "ò": "o", "ö": "o", "ô": "o", "õ": "o", "ú": "u", "ù": "u", "ü": "u",
        "û": "u", "ñ": "n", "ç": "c", "ý": "y",
    }.items():
        name = name.replace(src, dst)
    return re.sub(r"[^a-z\s]", "", name).strip()


def _match_name(target, lookup_dict, threshold=0.72):
    if not target:
        return None
    norm_target = _normalize(target)
    best_score, best_key = 0.0, None
    for key in lookup_dict:
        norm_key = _normalize(key)
        if norm_key == norm_target:
            return lookup_dict[key]
        score = SequenceMatcher(None, norm_target, norm_key).ratio()
        if score > best_score:
            best_score, best_key = score, key
    return lookup_dict[best_key] if best_score >= threshold and best_key else None


# ─────────────────────────────────────────────────────────────────────────────
# Scoring engine — hand-tuned weighted signals
# ─────────────────────────────────────────────────────────────────────────────
LEAGUE_AVG = {"slg": 0.400, "iso": 0.150, "k_pct": 0.225, "woba": 0.310}
SP_AVG = {"k9": 8.5, "whip": 1.30, "xfip": 4.10}


def score_batter(batter, sp_stats, park_factor):
    """Return (score 0.40-0.95, tier, signals, features)."""
    BASE = 0.63
    adj = 0.0
    signals = []
    features = {"slg": None, "iso": None, "k_pct": None, "bb_pct": None,
                "woba": None, "sp_k9": None, "sp_whip": None, "park_factor": park_factor}

    slg, iso = batter["slg"], batter["iso"]
    k_pct, bb_pct, woba = batter["k_pct"], batter["bb_pct"], batter["woba"]
    features.update({"slg": slg, "iso": iso, "k_pct": k_pct, "bb_pct": bb_pct, "woba": woba})

    adj += (LEAGUE_AVG["slg"] - slg) * 1.8
    if slg < 0.330:
        signals.append(f"Low SLG ({slg:.3f})")
    elif slg < 0.370:
        signals.append(f"Below-avg SLG ({slg:.3f})")
    elif slg > 0.520:
        signals.append(f"High SLG ({slg:.3f})"); adj -= 0.05

    adj += (LEAGUE_AVG["iso"] - iso) * 1.4
    if iso < 0.090:
        signals.append(f"Low ISO ({iso:.3f})")
    elif iso > 0.220:
        signals.append(f"High ISO ({iso:.3f})"); adj -= 0.04

    adj += (k_pct - LEAGUE_AVG["k_pct"]) * 0.9
    if k_pct > 0.280:
        signals.append(f"High K% ({k_pct:.1%})")
    elif k_pct < 0.150:
        signals.append(f"Low K% ({k_pct:.1%})"); adj -= 0.02

    adj += (LEAGUE_AVG["woba"] - woba) * 0.8
    if woba < 0.270:
        signals.append(f"Low wOBA ({woba:.3f})")

    if bb_pct > 0.130 and slg < 0.460:
        adj += 0.025
        signals.append(f"High BB% ({bb_pct:.1%})")

    if sp_stats:
        k9, whip, xfip = sp_stats["k9"], sp_stats["whip"], sp_stats["xfip"] or sp_stats["era"]
        features["sp_k9"], features["sp_whip"] = k9, whip
        adj += (k9 - SP_AVG["k9"]) * 0.025
        if k9 > 10.0:
            signals.insert(0, f"Facing high-K/9 starter ({k9:.1f})")
        adj += (SP_AVG["whip"] - whip) * 0.08
        if whip < 1.10:
            signals.append(f"Low SP WHIP ({whip:.2f})")
        if xfip > 0:
            adj -= (xfip - SP_AVG["xfip"]) * 0.02

    adj += (1.0 - park_factor) * 0.25
    if park_factor <= 0.95:
        signals.append(f"Pitcher-friendly park (PF={park_factor:.2f})")
    elif park_factor >= 1.04:
        signals.append(f"Hitter-friendly park (PF={park_factor:.2f})"); adj -= 0.02

    score = max(0.45, min(0.95, BASE + adj))
    if score >= 0.80:
        tier = "Elite"
    elif score >= 0.75:
        tier = "Very High"
    elif score >= 0.65:
        tier = "High"
    elif score >= 0.60:
        tier = "Moderate"
    else:
        tier = "Low"
    return score, tier, signals[:5], features


# ─────────────────────────────────────────────────────────────────────────────
# Main engine
# ─────────────────────────────────────────────────────────────────────────────
def run_engine(date_str=None, season=2025):
    if date_str is None:
        date_str = today_pdt()
    now_str = datetime.now(PDT).isoformat()

    print("[engine] Loading FanGraphs batter stats...")
    fg_batters = fetch_fg_batters(season)
    if not fg_batters:
        print("[engine] current season unavailable, trying previous season...")
        season -= 1
        fg_batters = fetch_fg_batters(season)
    print(f"[engine] {len(fg_batters)} batters loaded")

    if not fg_batters:
        return {
            "date": date_str, "generated_at": now_str, "season": season,
            "predictions": [], "total_projected": 0,
            "error": "Could not load FanGraphs batter stats. Check your connection and retry.",
        }

    fg_pitchers = fetch_fg_pitchers(season)
    print(f"[engine] {len(fg_pitchers)} pitchers loaded")

    games = fetch_today_games(date_str)
    print(f"[engine] {len(games)} games scheduled today")

    # Map team abbreviation -> (park_factor, opposing SP) for today
    team_ctx = {}
    for g in games:
        team_ctx[g["away_abbr"]] = (g["park_factor"], g["home_sp_name"])
        team_ctx[g["home_abbr"]] = (g["park_factor"], g["away_sp_name"])

    predictions = []
    for batter in fg_batters.values():
        team = (batter.get("team") or "").upper()
        park_factor, sp_name = team_ctx.get(team, (1.00, ""))
        sp_stats = _match_name(sp_name, fg_pitchers) if sp_name else None

        score, tier, signals, features = score_batter(batter, sp_stats, park_factor)
        predictions.append({
            "player_name": batter["name"],
            "team":        batter.get("team", ""),
            "game":        next((g["game_title"] for g in games
                                 if team in (g["away_abbr"], g["home_abbr"])), ""),
            "game_date":   date_str,
            "tb_line":     1.5,
            "prob_under":  round(score, 4),
            "tier":        tier,
            "park_factor": park_factor,
            "key_signals": signals,
            "slg_2025":    round(features["slg"], 3) if features["slg"] is not None else None,
            "iso_2025":    round(features["iso"], 3) if features["iso"] is not None else None,
            "k_pct":       round(features["k_pct"], 3) if features["k_pct"] is not None else None,
            "bb_pct":      round(features["bb_pct"], 3) if features["bb_pct"] is not None else None,
        })

    predictions.sort(key=lambda x: -x["prob_under"])
    print(f"[engine] Complete: {len(predictions)} projections")
    return {
        "date": date_str, "generated_at": now_str, "season": season,
        "predictions": predictions, "total_projected": len(predictions), "error": None,
    }


if __name__ == "__main__":
    result = run_engine()
    print(f"\nDate: {result['date']}  Season: {result['season']}")
    print(f"Projections: {len(result['predictions'])}")
    print("\nTop 5 (most likely quiet game):")
    for p in result["predictions"][:5]:
        print(f"  {p['player_name']:<25} {p['tier']:<12} {p['prob_under']*100:.0f}  {p.get('game','')}")
