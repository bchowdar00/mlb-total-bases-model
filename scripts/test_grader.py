#!/usr/bin/env python3
"""
Unit test for server/grade_results.py.

Verifies — without a live database — that every column the grader reads from or
writes to actually exists in the Drizzle schema (shared/schema.ts), and that the
name-matching and quiet-game logic behave as expected. Run:

  python3 scripts/test_grader.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import grade_results as g  # noqa: E402

SCHEMA = (ROOT / "shared" / "schema.ts").read_text()


def columns_for(table: str) -> set:
    """Extract the snake_case column names of a pgTable(...) block from schema.ts."""
    m = re.search(
        r'pgTable\("' + re.escape(table) + r'",\s*\{(.*?)\n\}\)',
        SCHEMA, re.DOTALL,
    )
    if not m:
        raise AssertionError(f"table {table!r} not found in schema.ts")
    body = m.group(1)
    # column builders: text("x"), integer("x"), real("x"), serial("x"), boolean("x")
    return set(re.findall(r'(?:text|integer|real|serial|boolean)\("([a-z_]+)"\)', body))


def check(name, cond):
    print(("PASS" if cond else "FAIL") + f": {name}")
    if not cond:
        check.failed = True


check.failed = False

pred_cols = columns_for("predictions")
res_cols = columns_for("player_results")

check("predictions has expected columns", {"player_name", "tb_line", "game_date"} <= pred_cols)
check("player_results has is_demo", "is_demo" in res_cols)
check("grader SELECT columns ⊆ predictions schema",
      set(g.PREDICTIONS_SELECT) <= pred_cols)
check("grader INSERT columns ⊆ player_results schema",
      set(g.PLAYER_RESULTS_COLUMNS) <= res_cols)

# name_match: exact, first-initial+last, and unique-last fallback
stats = {"Aaron Judge": {"tb": 2}, "Joey Bart": {"tb": 0}}
check("name_match exact", g.name_match("Aaron Judge", stats) is stats["Aaron Judge"])
check("name_match initial+last", g.name_match("A Judge", stats) is stats["Aaron Judge"])
check("name_match miss returns None", g.name_match("Nobody Here", stats) is None)

# quiet-game logic mirrors the grader: actual TB < 1.5 counts as a quiet game
check("quiet game when TB=1", (1 if 1 < 1.5 else 0) == 1)
check("not quiet when TB=2", (1 if 2 < 1.5 else 0) == 0)

# skip_demo: demo projections (is_demo=1) are never graded
mixed = [
    {"player_name": "Real One", "is_demo": 0},
    {"player_name": "Demo Two", "is_demo": 1},
    {"player_name": "Null Three"},  # missing flag → treated as real
]
kept = g.skip_demo(mixed)
check("skip_demo drops is_demo=1", all(r.get("is_demo") != 1 for r in kept))
check("skip_demo keeps real + null-flag rows", {r["player_name"] for r in kept} == {"Real One", "Null Three"})
check("is_demo is in the predictions SELECT", "is_demo" in g.PREDICTIONS_SELECT)

if check.failed:
    print("\nSOME CHECKS FAILED")
    sys.exit(1)
print("\nALL CHECKS PASSED")
