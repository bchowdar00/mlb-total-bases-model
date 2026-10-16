# Vantage Edge — MLB Total Bases Projections

A full-stack dashboard that projects MLB batters' **total bases** with a transparent, hand-tuned
rule-based scorer, tracks those projections against real box scores, and shows a live MLB scoreboard.

This is a portfolio project. The scorer is a **heuristic ranking, not a trained or calibrated model**,
and the app makes **no accuracy, hit-rate, or return claims** — see [What it does not claim](#what-it-does-not-claim).

---

## What it does

For every batter with at least 50 plate appearances in a FanGraphs season dataset, the engine computes a
score estimating the chance of a **quiet game** — a game in which the hitter records 1 or fewer total bases.
The score is used only to **rank** hitters; it is not a calibrated probability of any event.

- **Projections** — batters ranked by their quiet-game score, grouped into tiers, with the exact season
  signals that moved each score.
- **Live scoreboard** — today's games, scores, and status from the free, public MLB Stats API.
- **Results tracker** — a nightly grader pulls final box scores from the MLB Stats API and records each
  projected batter's actual total bases. It is empty until it runs and reports only what was graded. Rows
  inserted through the `/api/seed` route are sample data and are labeled **DEMO DATA** in the UI.
- **Methodology** — the scorer's rules, weights, tiers, data sources, and limitations, spelled out.

---

## The scorer

A transparent, hand-tuned rule-based scorer (`server/model_engine.py`). Each batter starts from a base
value of **0.65** and is nudged by fixed if/else adjustments:

| Signal | Rule | Score change |
|---|---|---|
| SLG | `< .360` / `.360–.400` | `+0.09` / `+0.04` |
| SLG | `.460–.510` / `.510+` | `−0.04` / `−0.09` |
| ISO | `< .130` / `> .240` | `+0.04` / `−0.04` |
| K% | `≥ 27%` | `+0.04` |
| BB% | `≥ 12%` with `SLG < .460` | `+0.03` |
| Park factor | `< 0.95` / `> 1.05` | `+0.04` / `−0.04` (only with a game context) |

The adjustments are summed and the final score is clamped to `0.40–0.95`, then assigned a tier
(Elite ≥ 0.80, Very High ≥ 0.75, High ≥ 0.70, Moderate ≥ 0.65, Low-Moderate ≥ 0.60, else Low).

The self-contained `local/` variant uses a slightly richer version of the same idea (adding wOBA and the
opposing starter's K/9, WHIP, and xFIP when a batter's team plays that day).

---

## What it does not claim

- **No accuracy or hit-rate figure is published.** The dataset (fetched by `scripts/fetch_data.py`, not
  committed) is season-aggregate rows (one per player-season) with no game-by-game outcomes, so no honest
  hit rate can be computed from it.
- **No money and no prediction-market data of any kind.** This projects a baseball statistic and ranks hitters — nothing more.
- The Results page is a **live tracker, not a benchmark** — it shows only box-score outcomes the grader has
  actually pulled.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Express 5 + Node.js |
| Database | Postgres via Drizzle ORM (Neon serverless in production) |
| Styling | Tailwind CSS + shadcn/ui |
| Projection engine | Python 3 — standard library only |
| Box-score grader | Python 3 + `psycopg` (reads/writes Postgres) |
| Box scores & schedule | MLB Stats API (`statsapi.mlb.com`) — free, no auth |
| Season stats | FanGraphs leaders API (fetched by `scripts/fetch_data.py`) |

---

## Project structure

```
mlb-total-bases-model/
├── client/                     # React frontend
│   └── src/pages/
│       ├── Projections.tsx     # ranked projections + live scoreboard
│       ├── Results.tsx         # box-score results tracker
│       └── Methodology.tsx     # how the scorer works
├── server/
│   ├── index.ts                # Express entry
│   ├── routes.ts               # API routes + scheduler
│   ├── storage.ts / db.ts      # Drizzle storage layer + schema init
│   ├── model_engine.py         # the rule-based projection scorer
│   ├── grade_results.py        # box-score grader (MLB Stats API)
│   └── mlbStream.ts            # SSE live-game streaming
├── shared/schema.ts            # Drizzle schema + Zod types
├── scripts/fetch_data.py       # regenerates the FanGraphs CSV (gitignored)
├── local/                      # self-contained Flask variant (no DB, live data)
└── data/                       # season CSV (gitignored; run fetch_data.py)
```

---

## Quick start

### Prerequisites

- Node.js 20+
- Python 3.10+

### Install and run

```bash
npm install
pip install -r requirements.txt       # psycopg, for the box-score grader
python3 scripts/fetch_data.py          # downloads data/fangraphs_batters_2023_2025.csv
export DATABASE_URL=postgres://…        # required — e.g. a free Neon database
npm run dev                            # http://localhost:5000
```

`DATABASE_URL` is **required**: the Node server and the Python grader both read and write that Postgres
database, and the server exits on startup if it is unset. `npm run build` then `npm start` runs the
production build. (The projection engine and `scripts/fetch_data.py` use only the standard library; the
`pip install` is for the grader's `psycopg`.)

### Local Flask variant (no database, live data)

```bash
cd local && pip install flask && python3 app.py   # http://localhost:5555
```

---

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required by the Node server) |
| `SEED_TOKEN` | Enables `POST /api/seed` for demo data. **If unset, the seed route is disabled** — there is no default token. |
| `MLB_DATA_DIR` | Override the directory containing the FanGraphs CSV |
| `MLB_PROJECTION_SEASON` | Season to project (default 2025) |

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/predictions` | Today's ranked projections |
| `POST` | `/api/refresh` | Recompute projections |
| `GET` | `/api/results/season` | Season-level graded counts |
| `GET` | `/api/results/players?date=YYYY-MM-DD` | Graded per-player results |
| `POST` | `/api/results/grade` | Grade a date against MLB box scores |
| `GET` | `/api/mlb/games?date=YYYY-MM-DD` | MLB schedule + scores |
| `GET` | `/api/mlb/live/:gamePk` | Live box-score lines for one game |
| `GET` | `/api/mlb/stream/:gamePk` | SSE stream of live game events |
| `GET` | `/api/schedule` | Scheduler status |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/seed` | Seed demo data (requires `SEED_TOKEN`) |

---

## License

MIT — see [LICENSE](LICENSE).
