#!/usr/bin/env python3
"""
MLB Total Bases projection engine
==================================
A transparent, hand-tuned rule-based scorer. For each batter with at least 50
plate appearances in the FanGraphs season dataset (fetched by
scripts/fetch_data.py, not committed to the repo) it estimates a "quiet game"
score — the chance the hitter records 1 or fewer total bases in a game — from
the batter's season profile.

This is a heuristic, not a trained or calibrated model. The score starts from a
base value and is nudged by fixed if/else adjustments on a handful of signals
(SLG, ISO, K%, BB%, plus an optional ballpark factor when a game context is
supplied). The output is a ranked list of projections, emitted as JSON.

Usage:
  python3 model_engine.py [YYYY-MM-DD]
"""
import sys, json, csv, math, os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# DATA_DIR: defaults to <repo_root>/data, overrideable via MLB_DATA_DIR env var.
_script_dir = Path(__file__).resolve().parent  # server/
_default_data_dir = _script_dir.parent / 'data'  # <repo_root>/data
DATA_DIR = Path(os.environ.get('MLB_DATA_DIR', str(_default_data_dir)))
PDT = timezone(timedelta(hours=-7))

# Season whose profile we project. Override with MLB_PROJECTION_SEASON.
SEASON = int(os.environ.get('MLB_PROJECTION_SEASON', '2025'))

# Approximate multi-year ballpark factors (1.0 = neutral). Only applied when a
# home-park abbreviation is supplied; the default season projection is park-neutral.
PARK_FACTORS = {
    'COL': 1.21, 'CIN': 1.12, 'PHI': 1.10, 'BOS': 1.04, 'OAK': 1.09, 'ATH': 1.09,
    'LAA': 1.05, 'DET': 1.06, 'MIN': 1.04, 'MIL': 1.01, 'TEX': 1.03,
    'NYY': 0.97, 'HOU': 0.98, 'ATL': 0.98, 'TOR': 1.00, 'CWS': 0.99, 'CHW': 0.99,
    'KC': 1.01, 'KCR': 1.01, 'WSH': 1.00, 'WSN': 1.00, 'BAL': 0.97, 'TB': 0.99, 'TBR': 0.99,
    'CLE': 0.97, 'MIA': 1.06, 'NYM': 0.96, 'PIT': 0.97, 'ARI': 1.01, 'CHC': 0.92,
    'LAD': 0.97, 'SDP': 0.93, 'SD': 0.93, 'STL': 0.97, 'SFG': 0.94, 'SF': 0.94, 'SEA': 0.83,
    'AZ': 1.01,
}


def parse_pct(v):
    if v is None:
        return float('nan')
    if isinstance(v, (int, float)):
        return float(v)
    try:
        s = str(v)
        return float(s.replace('%', '')) / 100 if '%' in s else float(s)
    except Exception:
        return float('nan')


def load_fg_stats():
    """Load the batters for SEASON from the FanGraphs CSV (>=50 PA each).

    The CSV is produced by scripts/fetch_data.py and is not committed to the
    repo. Returns a list of dict rows (stdlib csv — no third-party dependency),
    or None if the file is missing.
    """
    path = DATA_DIR / 'fangraphs_batters_2023_2025.csv'
    try:
        with open(path, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            return [r for r in reader if str(r.get('Season')) == str(SEASON)]
    except FileNotFoundError:
        return None
    except Exception:
        return None


def score_batter(row, park_factor=1.0):
    """Return a projection dict for one batter row from the FanGraphs CSV.

    base_p is the hand-picked starting value; `adj` accumulates fixed deltas.
    """
    nan = float('nan')
    base_p = 0.65
    adj = 0.0
    signals = []

    def getf(key):
        try:
            return float(row.get(key))
        except Exception:
            return nan

    slg = getf('SLG')
    iso = getf('ISO')
    kpct = parse_pct(row.get('K%'))
    bbpct = parse_pct(row.get('BB%'))

    if not math.isnan(slg):
        if slg < 0.360:
            adj += 0.09; signals.append(f'Low SLG ({slg:.3f})')
        elif slg < 0.400:
            adj += 0.04; signals.append(f'Below-avg SLG ({slg:.3f})')
        elif slg < 0.460:
            pass
        elif slg < 0.510:
            adj -= 0.04; signals.append(f'Above-avg SLG ({slg:.3f})')
        else:
            adj -= 0.09; signals.append(f'High SLG ({slg:.3f})')

    if not math.isnan(iso):
        if iso < 0.130:
            adj += 0.04; signals.append(f'Low ISO ({iso:.3f})')
        elif iso > 0.240:
            adj -= 0.04; signals.append(f'High ISO ({iso:.3f})')

    if not math.isnan(kpct):
        if kpct >= 0.27:
            adj += 0.04; signals.append(f'High K% ({kpct:.1%})')

    if not math.isnan(bbpct) and not math.isnan(slg):
        if bbpct >= 0.12 and slg < 0.460:
            adj += 0.03; signals.append(f'High walk rate (BB%={bbpct:.1%})')

    if park_factor < 0.95:
        adj += 0.04; signals.append(f'Pitcher park (PF={park_factor:.2f})')
    elif park_factor > 1.05:
        adj -= 0.04; signals.append(f'Hitter park (PF={park_factor:.2f})')

    prob = max(0.40, min(0.95, base_p + adj))

    if prob >= 0.80:
        tier = 'Elite'
    elif prob >= 0.75:
        tier = 'Very High'
    elif prob >= 0.70:
        tier = 'High'
    elif prob >= 0.65:
        tier = 'Moderate'
    elif prob >= 0.60:
        tier = 'Low-Moderate'
    else:
        tier = 'Low'

    team = str(row.get('Team') or '').strip()
    return {
        'player_name': str(row.get('Name') or '').strip(),
        'team': team,
        'opponent': '',
        'home_team': '',
        'game': '',
        'game_time': '',
        'tb_line': 1.5,
        'prob_under': round(prob, 3),
        'tier': tier,
        'park_factor': round(park_factor, 3),
        'key_signals': signals,
        'slg_2025': round(slg, 3) if not math.isnan(slg) else None,
        'iso_2025': round(iso, 3) if not math.isnan(iso) else None,
        'k_pct': round(kpct, 4) if not math.isnan(kpct) else None,
        'bb_pct': round(bbpct, 4) if not math.isnan(bbpct) else None,
    }


def run_engine(today_str=None):
    if today_str is None:
        today_str = datetime.now(PDT).strftime('%Y-%m-%d')

    result = {
        'date': today_str,
        'generated_at': datetime.now(PDT).strftime('%Y-%m-%d %H:%M PDT'),
        'season': SEASON,
        'predictions': [],
        'total_projected': 0,
        'error': None,
    }

    fg = load_fg_stats()
    if fg is None or len(fg) == 0:
        result['error'] = (
            f'No batter data for season {SEASON}. Expected '
            f"{DATA_DIR / 'fangraphs_batters_2023_2025.csv'}. "
            'Run scripts/fetch_data.py to download it.'
        )
        return result

    scored = [score_batter(row) for row in fg]
    scored = [s for s in scored if s['player_name']]
    scored.sort(key=lambda x: x['prob_under'], reverse=True)

    result['predictions'] = scored
    result['total_projected'] = len(scored)
    return result


if __name__ == '__main__':
    today = sys.argv[1] if len(sys.argv) > 1 else datetime.now(PDT).strftime('%Y-%m-%d')
    out = run_engine(today)
    print(json.dumps(out, indent=2))
