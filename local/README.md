# Vantage Edge — Local App

A standalone MLB total-bases projection dashboard that runs entirely on your laptop.
No data files to manage, no accounts, no API keys — just Python, flask, and an internet connection.

---

## Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| **Python** | **3.10+** | Get it at [python.org](https://www.python.org/downloads/) |
| **Internet** | Required | Fetches season stats from FanGraphs and today's schedule from the MLB Stats API |
| **flask** | 3.0+ | The only dependency — the launcher installs it automatically |

---

## Quick Start

### Mac / Linux

```bash
cd path/to/mlb-total-bases-model/local
pip3 install flask
python3 app.py
```

### Windows (Command Prompt)

```bat
cd path\to\mlb-total-bases-model\local
python -m pip install flask
python app.py
```

Your browser opens automatically at **http://localhost:5555**.

---

## What it does at startup

| Step | Source | What it gets |
|---|---|---|
| 1 | **FanGraphs API** | Season batting stats: SLG, ISO, K%, BB%, wOBA for batters with at least 50 PA |
| 2 | **FanGraphs API** | Season pitcher stats: K/9, WHIP, xFIP |
| 3 | **MLB Stats API** | Today's schedule, probable starters, venue/park factor |
| 4 | Engine | Scores every batter with at least 50 PA and ranks them |

First results appear in ~10–20 seconds. When a batter's team plays today, the score also uses that game's
ballpark factor and opposing starter; otherwise it is park-neutral.

---

## The scoring model

`engine.py` scores each batter with a transparent, hand-tuned set of weighted signals. It is a **heuristic
ranking, not a trained or calibrated model**, and it makes **no accuracy, hit-rate, or performance claims**.

| Signal | Direction | Logic |
|---|---|---|
| **SLG** (slugging) | lower ⇒ higher quiet-game score | weighted most heavily |
| **ISO** (isolated power) | lower ⇒ higher quiet-game score | power-less hitters have quiet games more often |
| **K%** (strikeout rate) | higher ⇒ higher quiet-game score | strikeouts produce 0 total bases |
| **wOBA** (overall offense) | lower ⇒ higher quiet-game score | weaker hitters overall |
| **BB%** (walk rate) | high, with low SLG ⇒ higher | walks produce 0 total bases |
| **Opposing starter K/9, WHIP, xFIP** | tougher SP ⇒ higher | only when the team plays today |
| **Ballpark factor** | pitcher-friendly ⇒ higher | only when the team plays today |

The score starts from a base value, sums the adjustments, and is clamped to 0.45–0.95, then grouped into
tiers (Elite ≥ 0.80, Very High ≥ 0.75, High ≥ 0.65, Moderate ≥ 0.60, Low otherwise).

---

## Files

```
local/
├── engine.py        Self-contained scorer — fetches live data, ranks batters
├── app.py           Flask server — runs the engine, serves /api/projections
├── index.html       Single-page UI
├── requirements.txt Just flask>=3.0.0
├── run.bat          Windows launcher
├── run.ps1          Windows PowerShell launcher
└── README.md        This file
```

---

## Troubleshooting

- **`ModuleNotFoundError: No module named 'engine'`** — run `app.py` from inside the `local/` folder.
- **`ModuleNotFoundError: No module named 'flask'`** — `python -m pip install flask`.
- **`Address already in use` (port 5555)** — another instance is running; stop it, or change the port in `app.py`.
- **No batters load** — the FanGraphs API may be briefly rate-limited; wait ~30s and click Recompute. The engine
  falls back to the previous season if the current one returns nothing.

---

## Data sources (all free, no auth required)

| Source | URL |
|---|---|
| FanGraphs | `fangraphs.com/api/leaders/major-league/data` |
| MLB Stats API | `statsapi.mlb.com/api/v1/schedule` |
