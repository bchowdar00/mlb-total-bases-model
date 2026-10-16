import type { Express } from "express";
import type { Server } from "http";
import { spawn } from "child_process";
import path from "path";
import cron from "node-cron";
import { storage } from "./storage";
import { handleMLBStream, getWorkerCount } from "./mlbStream";
import { initDB } from "./db";

const PYTHON = process.platform === "win32" ? "python" : "python3";
const ENGINE_PATH = path.join(process.cwd(), "server/model_engine.py");

function getPDTDate(): string {
  const now = new Date();
  const pdt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pdt.toISOString().split("T")[0];
}

async function runModelEngine(dateStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [ENGINE_PATH, dateStr], { timeout: 60000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (!stdout.trim()) {
        reject(new Error(`Engine error (code ${code}): ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Parse error: ${stdout.slice(0, 200)}`));
      }
    });
    proc.on("error", reject);
  });
}

async function runRefresh(dateStr: string): Promise<any> {
  const start = Date.now();
  const result = await runModelEngine(dateStr);
  const durationMs = Date.now() - start;
  const now = new Date().toISOString();

  const effectiveDate = result.date || dateStr;

  // Store projections — only if engine returned new data
  if (result.predictions?.length) {
    const preds = result.predictions.map((p: any) => ({
      refreshedAt: now,
      gameDate: effectiveDate,
      playerName: p.player_name,
      team: p.team || "",
      opponent: p.opponent || "",
      homeTeam: p.home_team || "",
      game: p.game || "",
      gameTime: p.game_time || "",
      lineupPos: p.lineup_pos || null,
      tbLine: p.tb_line,
      probUnder: p.prob_under,
      tier: p.tier,
      slg2025: p.slg_2025 || null,
      iso2025: p.iso_2025 || null,
      kPct: p.k_pct || null,
      bbPct: p.bb_pct || null,
      parkFactor: p.park_factor || null,
      oppSpName: p.opp_sp_name || null,
      keySignals: JSON.stringify(p.key_signals || []),
    }));
    await storage.upsertPredictions(preds);
  }

  await storage.insertRefreshLog({
    refreshedAt: now,
    gameDate: effectiveDate,
    totalProjected: result.total_projected || 0,
    totalPredictions: result.predictions?.length || 0,
    source: "auto",
    durationMs,
  });

  return result;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// The scorer reads a static season-stats dataset, so recomputing is deterministic.
// We recompute once each morning and grade the previous night's projections.
// All cron expressions are UTC (Render runs UTC; PDT = UTC-7).

function startAllCrons(): void {
  // 10:00 AM PDT = 17:00 UTC — recompute today's projections
  cron.schedule("0 17 * * *", async () => {
    const d = getPDTDate();
    try {
      const r = await runRefresh(d);
      console.log(`[cron] projections recomputed: ${r.predictions?.length || 0} for ${d}`);
    } catch (e) { console.error("[cron:refresh]", e); }
  }, { timezone: "UTC" });

  // 11:30 PM PDT = 06:30 UTC — nightly grader against MLB box scores
  cron.schedule("30 6 * * *", async () => {
    const d = getPDTDate();
    try {
      await runGraderAndStore(d);
    } catch (e) { console.error("[cron:grader]", e); }
  }, { timezone: "UTC" });

  console.log("[scheduler] Armed: 10AM recompute | 11:30PM grade");
}

export async function registerRoutes(httpServer: Server, app: Express) {
  await initDB();
  const initDate = getPDTDate();
  console.log(`[startup] date ${initDate}`);

  runRefresh(initDate)
    .then((r) => console.log(`[startup] ${r.predictions?.length || 0} projections for ${initDate}`))
    .catch((e) => console.error("[startup] refresh failed:", e));

  startAllCrons();

  // GET today's projections
  app.get("/api/predictions", async (_req, res) => {
    const dateStr = getPDTDate();
    const latest = await storage.getLatestRefresh();
    const preds = await storage.getPredictions(dateStr);
    res.json({
      date: dateStr,
      season: Number(process.env.MLB_PROJECTION_SEASON) || 2025,
      refreshedAt: latest?.refreshedAt || null,
      totalProjected: latest?.totalProjected || 0,
      predictions: preds.map((p) => ({
        ...p,
        keySignals: JSON.parse(p.keySignals || "[]"),
      })),
    });
  });

  // POST manual refresh — recompute projections
  app.post("/api/refresh", async (_req, res) => {
    try {
      const dateStr = getPDTDate();
      const result = await runRefresh(dateStr);
      res.json({
        success: true,
        date: dateStr,
        totalProjected: result.total_projected || 0,
        predictionsCount: result.predictions?.length || 0,
        error: result.error || null,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET refresh logs
  app.get("/api/refresh-logs", async (_req, res) => {
    res.json(await storage.getRefreshLogs(10));
  });

  // POST seed — inject projections / graded results for development or demos.
  // Protected by the SEED_TOKEN env var. If SEED_TOKEN is not set, the route is
  // disabled (no default token) so a deployment can never be seeded by a guessable value.
  app.post("/api/seed", async (req, res) => {
    const expected = process.env.SEED_TOKEN;
    if (!expected) {
      return res.status(503).json({ error: "Seed route disabled: SEED_TOKEN is not set." });
    }
    const provided = (req.headers["x-seed-token"] as string) || "";
    if (provided !== expected) {
      return res.status(401).json({ error: "Unauthorized: invalid x-seed-token" });
    }
    try {
      const {
        game_date,
        predictions: preds,
        graded_results: gradedIn,
      } = (req.body ?? {}) as {
        game_date: string;
        predictions?: any[];
        graded_results?: any[];
      };
      if (!game_date) {
        return res.status(400).json({ error: "game_date required" });
      }
      if (!preds?.length && !gradedIn?.length) {
        return res.status(400).json({ error: "predictions or graded_results required" });
      }
      const now = new Date().toISOString();

      if (gradedIn?.length) {
        const gradedRows = gradedIn.map((r: any) => ({
          gameDate:   r.game_date || game_date,
          playerName: r.player_name,
          team:       r.team || "",
          game:       r.game || "",
          tbLine:     r.tb_line ?? 1.5,
          probUnder:  r.prob_under ?? 0.75,
          tier:       r.tier || "Very High",
          actualTb:   r.actual_tb,
          hit:        r.hit,
          gradedAt:   now,
          isDemo:     1,  // seeded via /api/seed → labeled DEMO DATA in the UI
        }));
        await storage.upsertPlayerResults(gradedRows);
        rebuildSeasonStats();
      }

      if (!preds?.length) {
        res.json({ success: true, seeded: 0, graded: gradedIn?.length || 0, date: game_date });
        return;
      }

      const seedPreds = preds.map((p: any) => ({
        refreshedAt: now,
        gameDate: game_date,
        playerName: p.player_name,
        team: p.team || "",
        opponent: p.opponent || "",
        homeTeam: p.home_team || "",
        game: p.game || "",
        gameTime: p.game_time || "",
        lineupPos: null,
        tbLine: p.tb_line,
        probUnder: p.prob_under,
        tier: p.tier,
        slg2025: p.slg_2025 || null,
        iso2025: p.iso_2025 || null,
        kPct: p.k_pct || null,
        bbPct: p.bb_pct || null,
        parkFactor: p.park_factor || null,
        oppSpName: null,
        keySignals: JSON.stringify(p.key_signals || []),
        isDemo: 1,  // seeded via /api/seed → labeled DEMO DATA in the UI, excluded from totals
      }));
      await storage.upsertPredictions(seedPreds);
      res.json({ success: true, seeded: seedPreds.length, graded: gradedIn?.length || 0, date: game_date });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET schedule status — what runs and when
  app.get("/api/schedule", async (_req, res) => {
    const latest = await storage.getLatestRefresh();
    res.json({
      currentTime: {
        utc: new Date().toISOString(),
        pdt: new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false }),
      },
      recompute: {
        scheduledAt: "10:00 AM PDT (17:00 UTC) daily",
        description: "Recomputes projections from the season-stats dataset.",
        lastRefresh: latest?.refreshedAt || null,
      },
      nightlyGrader: {
        scheduledAt: "11:30 PM PDT (06:30 UTC) daily",
        description: "Pulls final box scores from the MLB Stats API and grades the day's projections.",
      },
    });
  });

  app.get("/api/health", async (_req, res) => {
    const latest = await storage.getLatestRefresh();
    res.json({
      status: "ok",
      lastRefresh: latest?.refreshedAt,
      date: getPDTDate(),
      activeStreams: getWorkerCount(),
      db: process.env.DATABASE_URL ? "postgres" : "unconfigured",
    });
  });

  // ─── MLB Stats API: live scoreboard + box scores ─────────────────────────────
  // These endpoints proxy the free, public MLB Stats API (statsapi.mlb.com).

  app.get("/api/mlb/stream/:gamePk", handleMLBStream);

  const mlbCache = new Map<string, { data: any; ts: number }>();
  const MLB_CACHE_TTL = 25_000;

  async function fetchMLB(url: string): Promise<any> {
    const cached = mlbCache.get(url);
    if (cached && Date.now() - cached.ts < MLB_CACHE_TTL) return cached.data;
    const res = await fetch(url, {
      headers: { "User-Agent": "VantageEdge/1.0", "Accept": "application/json" },
    });
    if (!res.ok) throw new Error(`MLB API ${res.status}: ${url}`);
    const data = await res.json();
    mlbCache.set(url, { data, ts: Date.now() });
    return data;
  }

  // GET /api/mlb/games?date=YYYY-MM-DD — schedule with scores + status
  app.get("/api/mlb/games", async (req, res) => {
    try {
      const date = (req.query.date as string) || getPDTDate();
      const data = await fetchMLB(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`
      );
      const games = (data?.dates?.[0]?.games || []).map((g: any) => ({
        gamePk:      g.gamePk,
        status:      g.status?.detailedState,
        abstractGameState: g.status?.abstractGameState,
        away:        g.teams?.away?.team?.name,
        awayAbbr:    g.teams?.away?.team?.abbreviation,
        awayScore:   g.teams?.away?.score,
        home:        g.teams?.home?.team?.name,
        homeAbbr:    g.teams?.home?.team?.abbreviation,
        homeScore:   g.teams?.home?.score,
        inning:      g.linescore?.currentInning,
        inningState: g.linescore?.inningState,
        outs:        g.linescore?.outs,
      }));
      res.json({ date, games });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/mlb/live/:gamePk — linescore + batter box-score lines for one game
  app.get("/api/mlb/live/:gamePk", async (req, res) => {
    const { gamePk } = req.params;
    try {
      const [boxscore, linescore, liveFeed] = await Promise.all([
        fetchMLB(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`),
        fetchMLB(`https://statsapi.mlb.com/api/v1/game/${gamePk}/linescore`),
        fetchMLB(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live?fields=liveData,linescore,defense,offense,batter,pitcher,fullName,id`),
      ]);

      const batterStats: Record<string, any> = {};
      for (const side of ["away", "home"]) {
        const players = boxscore?.teams?.[side]?.players || {};
        for (const pdata of Object.values(players) as any[]) {
          const name: string = pdata?.person?.fullName || "";
          const s = pdata?.stats?.batting || {};
          if (!name) continue;
          batterStats[name] = {
            playerId:  pdata?.person?.id,
            ab:        s.atBats        ?? 0,
            pa:        s.plateAppearances ?? 0,
            h:         s.hits          ?? 0,
            tb:        s.totalBases    ?? 0,
            doubles:   s.doubles       ?? 0,
            triples:   s.triples       ?? 0,
            hr:        s.homeRuns      ?? 0,
            rbi:       s.rbi           ?? 0,
          };
        }
      }

      const ls = linescore || {};
      const liveLinescore = liveFeed?.liveData?.linescore || {};
      const currentBatter  = liveLinescore?.offense?.batter?.fullName  || null;
      const currentBatterId = liveLinescore?.offense?.batter?.id       || null;
      const currentPitcher = liveLinescore?.defense?.pitcher?.fullName || null;

      res.json({
        gamePk: Number(gamePk),
        inning:         ls.currentInning,
        inningState:    ls.inningState,
        outs:           ls.outs,
        balls:          ls.balls,
        strikes:        ls.strikes,
        awayScore:      ls.teams?.away?.runs,
        homeScore:      ls.teams?.home?.runs,
        awayHits:       ls.teams?.away?.hits,
        homeHits:       ls.teams?.home?.hits,
        currentBatter,
        currentBatterId,
        currentPitcher,
        batterStats,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Results tracking ────────────────────────────────────────────────────────

  // GET season-level tracking (counts only — no performance claims)
  app.get("/api/results/season", async (_req, res) => {
    const year = new Date().getFullYear();
    const stats = await storage.getSeasonStats(year);
    const daily = await storage.getDailyResultsSummary(60);
    res.json({
      season: year,
      stats: stats || null,
      dailySummary: daily,
    });
  });

  // GET player-level results (all or by date)
  app.get("/api/results/players", async (req, res) => {
    const date = (req.query.date as string) || undefined;
    const results = await storage.getPlayerResults(date, 200);
    res.json({ results });
  });

  // POST grade a date — run the Python grader against MLB box scores
  app.post("/api/results/grade", async (req, res) => {
    try {
      const { date } = (req.body ?? {}) as { date?: string };
      const dateStr = date || getPDTDate();
      const result = await runGrader(dateStr);

      if (result.error && !result.graded?.length) {
        return res.status(500).json({ success: false, error: result.error });
      }

      // The grader persists graded rows to Postgres itself; refresh tallies only.
      if (result.graded?.length) {
        await rebuildSeasonStats();
      }

      res.json({
        success: true,
        date: dateStr,
        graded: result.graded?.length || 0,
        error: result.error || null,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}

// ─── Grader helpers ─────────────────────────────────────────────────────────

const GRADER_PATH = path.join(process.cwd(), "server/grade_results.py");

async function runGrader(dateStr: string): Promise<any> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [GRADER_PATH, dateStr], { timeout: 90000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (!stdout.trim()) {
        resolve({ date: dateStr, graded: [], error: stderr.slice(0, 300) || `Exit ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve({ date: dateStr, graded: [], error: `Parse error: ${stdout.slice(0, 200)}` });
      }
    });
    proc.on("error", (e) => resolve({ date: dateStr, graded: [], error: e.message }));
  });
}

async function runGraderAndStore(dateStr: string): Promise<void> {
  // The Python grader writes graded rows to Postgres itself; we only refresh
  // the season tallies from what it wrote.
  const result = await runGrader(dateStr);
  if (result.graded?.length) {
    await rebuildSeasonStats();
    console.log(`[grader] Graded ${result.graded.length} projections for ${dateStr}`);
  } else {
    console.log(`[grader] 0 graded: ${result.error || result.note || "no data"}`);
  }
}

async function rebuildSeasonStats(): Promise<void> {
  const year = new Date().getFullYear();
  const allResults = await storage.getPlayerResults(undefined, 5000);
  // Season totals exclude demo rows seeded via /api/seed.
  const yearResults = allResults.filter(
    (r) => r.gameDate?.startsWith(String(year)) && r.isDemo !== 1
  );
  if (!yearResults.length) return;

  const graded = yearResults.filter((r) => r.hit !== null);
  const hits = graded.filter((r) => r.hit === 1);
  const elite = graded.filter((r) => r.tier === "Elite");
  const eliteHits = elite.filter((r) => r.hit === 1);
  const veryHigh = graded.filter((r) => r.tier === "Very High");
  const vhHits = veryHigh.filter((r) => r.hit === 1);

  await storage.upsertSeasonStats({
    season: year,
    totalPredictions: yearResults.length,
    totalGraded: graded.length,
    totalHits: hits.length,
    elitePredictions: elite.length,
    eliteHits: eliteHits.length,
    veryHighPredictions: veryHigh.length,
    veryHighHits: vhHits.length,
    updatedAt: new Date().toISOString(),
  });
}
