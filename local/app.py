"""
Vantage Edge — Local App
Run: python app.py
Opens your browser at http://localhost:5555

A self-contained MLB total-bases projection dashboard. Fetches FanGraphs season
stats and today's MLB schedule live, scores every batter with at least 50 PA with the
rule-based scorer in engine.py, and serves the ranked projections. No accounts,
no API keys, no money. Just Python + flask.
"""

import os, sys, threading, webbrowser, time
from flask import Flask, jsonify, send_from_directory

# ── Always run from this script's directory ──────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from engine import run_engine

# ── Flask ────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=HERE, static_url_path="")

# ── Cache ────────────────────────────────────────────────────────────────────
_cache = {"result": None, "loading": True, "error": None}


def _run():
    try:
        result = run_engine()
        _cache.update({"result": result, "loading": False, "error": None})
        print(f"[app] Ready — {len(result['predictions'])} projections")
    except Exception as e:
        _cache.update({"loading": False, "error": str(e)})
        print(f"[app] Engine error: {e}")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.route("/api/projections")
def projections():
    if _cache["loading"]:
        return jsonify({"loading": True})
    if _cache["error"]:
        return jsonify({"error": _cache["error"]}), 500
    r = _cache["result"]
    return jsonify({
        "date":            r.get("date"),
        "season":          r.get("season"),
        "generated_at":    r.get("generated_at"),
        "total_projected": r.get("total_projected", 0),
        "predictions":     r.get("predictions", []),
    })


@app.route("/api/refresh", methods=["POST"])
def refresh():
    _cache.update({"loading": True, "error": None})
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"status": "refreshing"})


# ── Launch ────────────────────────────────────────────────────────────────────
def _open_browser():
    time.sleep(1.5)
    webbrowser.open("http://localhost:5555")


if __name__ == "__main__":
    print("=" * 50)
    print("  Vantage Edge — Local App")
    print("  http://localhost:5555")
    print("  Fetching stats and scoring (10-20 seconds)...")
    print("=" * 50)
    threading.Thread(target=_run, daemon=True).start()
    threading.Thread(target=_open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=5555, debug=False, use_reloader=False)
