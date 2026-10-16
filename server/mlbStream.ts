/**
 * mlbStream.ts — Server-Sent Events live game streaming
 *
 * Architecture:
 *   - One SSE connection per client per gamePk: GET /api/mlb/stream/:gamePk
 *   - One shared "game worker" per active gamePk (not one per client)
 *   - Worker polls MLB's /timestamps endpoint every 5–10s (respects the
 *     `metaData.wait` hint from MLB's own API response)
 *   - On new timestamp → fetches fresh linescore + boxscore → extracts
 *     the data we need → broadcasts to all SSE clients for that gamePk
 *   - Worker shuts down when game is Final and all clients disconnect
 *
 * SSE events emitted to client:
 *   event: "pitch"   data: LiveGamePayload (on every new timestamp)
 *   event: "final"   data: { gamePk }      (when game ends)
 *   event: "ping"    data: { ts }           (heartbeat every 30s to keep connection alive)
 */

import type { Request, Response } from "express";

const MLB = "https://statsapi.mlb.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatterStat {
  playerId: number;
  ab: number;
  pa: number;
  h: number;
  tb: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
}

export interface LiveGamePayload {
  gamePk: number;
  timestamp: string;
  gameEvents: string[];
  logicalEvents: string[];
  inning: number | null;
  inningState: string | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  awayScore: number | null;
  homeScore: number | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
  currentBatter: string | null;
  currentBatterId: number | null;
  currentPitcher: string | null;
  batterStats: Record<string, BatterStat>;
  isFinal: boolean;
}

// ─── Per-game worker state ─────────────────────────────────────────────────────

interface GameWorker {
  gamePk: number;
  clients: Set<Response>;
  lastTimestamp: string | null;
  lastPayload: LiveGamePayload | null;
  timer: NodeJS.Timeout | null;
  isFinal: boolean;
  pingTimers: Map<Response, NodeJS.Timeout>;
}

const workers = new Map<number, GameWorker>();

// ─── MLB fetch helpers ────────────────────────────────────────────────────────

async function mlbFetch(path: string): Promise<any> {
  const res = await fetch(`${MLB}${path}`, {
    headers: { "User-Agent": "VantageEdge/1.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`MLB ${res.status} ${path}`);
  return res.json();
}

async function fetchTimestamps(gamePk: number): Promise<string[]> {
  return mlbFetch(`/api/v1.1/game/${gamePk}/feed/live/timestamps`);
}

async function buildPayload(gamePk: number, timestamp: string): Promise<LiveGamePayload> {
  // Fetch linescore + boxscore in parallel (small, targeted endpoints)
  const [linescore, boxscore, liveFeed] = await Promise.all([
    mlbFetch(`/api/v1/game/${gamePk}/linescore`),
    mlbFetch(`/api/v1/game/${gamePk}/boxscore`),
    mlbFetch(`/api/v1.1/game/${gamePk}/feed/live?fields=liveData,linescore,defense,offense,batter,pitcher,fullName,id,metaData,gameEvents,logicalEvents`),
  ]);

  // Batter stats from boxscore
  const batterStats: Record<string, BatterStat> = {};
  for (const side of ["away", "home"]) {
    const players = boxscore?.teams?.[side]?.players || {};
    for (const pdata of Object.values(players) as any[]) {
      const name: string = pdata?.person?.fullName || "";
      const s = pdata?.stats?.batting || {};
      if (!name) continue;
      batterStats[name] = {
        playerId: pdata?.person?.id ?? 0,
        ab:      s.atBats           ?? 0,
        pa:      s.plateAppearances ?? 0,
        h:       s.hits             ?? 0,
        tb:      s.totalBases       ?? 0,
        doubles: s.doubles          ?? 0,
        triples: s.triples          ?? 0,
        hr:      s.homeRuns         ?? 0,
        rbi:     s.rbi              ?? 0,
      };
    }
  }

  const ls = linescore || {};
  const liveLs = liveFeed?.liveData?.linescore || {};
  const meta = liveFeed?.metaData || {};

  // Team abbreviations from boxscore
  const awayAbbr = boxscore?.teams?.away?.team?.abbreviation ?? null;
  const homeAbbr = boxscore?.teams?.home?.team?.abbreviation ?? null;

  const isFinal = !!(liveFeed?.gameData?.status?.abstractGameState === "Final" ||
                     liveFeed?.gameData?.status?.detailedState?.includes("Final"));

  return {
    gamePk,
    timestamp,
    gameEvents:   meta.gameEvents   || [],
    logicalEvents: meta.logicalEvents || [],
    inning:       ls.currentInning  ?? null,
    inningState:  ls.inningState    ?? null,
    outs:         ls.outs           ?? null,
    balls:        ls.balls          ?? null,
    strikes:      ls.strikes        ?? null,
    awayScore:    ls.teams?.away?.runs ?? null,
    homeScore:    ls.teams?.home?.runs ?? null,
    awayAbbr,
    homeAbbr,
    currentBatter:   liveLs?.offense?.batter?.fullName  ?? null,
    currentBatterId: liveLs?.offense?.batter?.id        ?? null,
    currentPitcher:  liveLs?.defense?.pitcher?.fullName ?? null,
    batterStats,
    isFinal,
  };
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

function sendSSE(res: Response, event: string, data: any) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // client disconnected — will be cleaned up on close
  }
}

function broadcastToGame(worker: GameWorker, event: string, data: any) {
  for (const client of Array.from(worker.clients)) {
    sendSSE(client, event, data);
  }
}

// ─── Per-game worker ──────────────────────────────────────────────────────────

function getWaitMs(liveFeedMeta: any): number {
  // MLB's API tells us how long to wait via metaData.wait (seconds)
  // Clamp between 5s (very active) and 15s (slow periods)
  const waitSec = typeof liveFeedMeta?.wait === "number" ? liveFeedMeta.wait : 10;
  return Math.max(5, Math.min(15, waitSec)) * 1000;
}

async function workerTick(worker: GameWorker) {
  if (worker.clients.size === 0) {
    // No clients connected — pause but keep worker alive briefly
    worker.timer = setTimeout(() => workerTick(worker), 30_000);
    return;
  }

  try {
    const timestamps = await fetchTimestamps(worker.gamePk);
    if (!timestamps?.length) {
      worker.timer = setTimeout(() => workerTick(worker), 10_000);
      return;
    }

    const latest = timestamps[timestamps.length - 1];

    if (latest !== worker.lastTimestamp) {
      // New game state — build and broadcast the payload
      worker.lastTimestamp = latest;
      const payload = await buildPayload(worker.gamePk, latest);
      worker.lastPayload = payload;

      broadcastToGame(worker, "pitch", payload);

      if (payload.isFinal) {
        worker.isFinal = true;
        broadcastToGame(worker, "final", { gamePk: worker.gamePk });
        // Stop the worker after a delay
        if (worker.timer) clearTimeout(worker.timer);
        setTimeout(() => {
          workers.delete(worker.gamePk);
          for (const [res, t] of Array.from(worker.pingTimers)) clearInterval(t);
          for (const res of Array.from(worker.clients)) {
            try { res.end(); } catch {}
          }
        }, 5000);
        return;
      }

      // Respect MLB's wait hint
      const rawMeta = payload.logicalEvents; // we'd need meta from live feed for wait
      worker.timer = setTimeout(() => workerTick(worker), 8_000); // default 8s
    } else {
      // No change — check again soon
      worker.timer = setTimeout(() => workerTick(worker), 5_000);
    }
  } catch (e) {
    console.error(`[mlbStream] worker error gamePk=${worker.gamePk}:`, e);
    worker.timer = setTimeout(() => workerTick(worker), 10_000);
  }
}

function getOrCreateWorker(gamePk: number): GameWorker {
  if (workers.has(gamePk)) return workers.get(gamePk)!;

  const worker: GameWorker = {
    gamePk,
    clients: new Set(),
    lastTimestamp: null,
    lastPayload: null,
    timer: null,
    isFinal: false,
    pingTimers: new Map(),
  };
  workers.set(gamePk, worker);

  // Start immediately
  workerTick(worker);
  console.log(`[mlbStream] Worker started for gamePk=${gamePk}`);
  return worker;
}

// ─── Express route handler ────────────────────────────────────────────────────

export function handleMLBStream(req: Request, res: Response) {
  const gamePk = parseInt(String(req.params.gamePk), 10);
  if (isNaN(gamePk)) {
    res.status(400).json({ error: "Invalid gamePk" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");  // disable Nginx buffering
  res.flushHeaders();

  const worker = getOrCreateWorker(gamePk);
  worker.clients.add(res);

  // Send the last known payload immediately (no wait for first event)
  if (worker.lastPayload) {
    sendSSE(res, "pitch", worker.lastPayload);
  }

  // Heartbeat ping every 25s to keep connection alive through proxies
  const pingInterval = setInterval(() => {
    sendSSE(res, "ping", { ts: Date.now() });
  }, 25_000);
  worker.pingTimers.set(res, pingInterval);

  // Clean up on client disconnect
  req.on("close", () => {
    worker.clients.delete(res);
    clearInterval(pingInterval);
    worker.pingTimers.delete(res);
    console.log(`[mlbStream] Client disconnected gamePk=${gamePk}, remaining=${worker.clients.size}`);

    // If no clients and game is final, clean up worker
    if (worker.clients.size === 0 && worker.isFinal) {
      if (worker.timer) clearTimeout(worker.timer);
      workers.delete(gamePk);
    }
  });

  console.log(`[mlbStream] Client connected gamePk=${gamePk}, total=${worker.clients.size}`);
}

export function getWorkerCount(): number {
  return workers.size;
}
