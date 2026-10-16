/**
 * useLiveGame.ts
 *
 * Hooks for the live MLB scoreboard, backed by the free public MLB Stats API
 * (proxied through this app's /api/mlb/* routes).
 *
 *   useGameSchedule(date) — today's games with scores and status
 *   useLiveGame(gamePk)   — linescore + per-batter box-score lines for one game
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

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

export interface LiveGameData {
  gamePk: number;
  inning: number | null;
  inningState: string | null;   // "Top" | "Bottom" | "Middle" | "End"
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  awayScore: number | null;
  homeScore: number | null;
  awayHits: number | null;
  homeHits: number | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
  currentBatter: string | null;
  currentBatterId: number | null;
  currentPitcher: string | null;
  batterStats: Record<string, BatterStat>;
  error?: string;
}

export interface GameInfo {
  gamePk: number;
  status: string;
  abstractGameState: string; // "Live" | "Final" | "Preview"
  away: string;
  awayAbbr: string;
  awayScore: number;
  home: string;
  homeAbbr: string;
  homeScore: number;
  inning: number | null;
  inningState: string | null;
  outs: number | null;
}

/** Fetch the game schedule for a date (scores + status), refreshed every 60s. */
export function useGameSchedule(date: string) {
  return useQuery<{ date: string; games: GameInfo[] }>({
    queryKey: ["/api/mlb/games", date],
    queryFn: () =>
      apiRequest("GET", `/api/mlb/games?date=${date}`).then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Fetch live data for a single game, polling every 25s when it is live. */
export function useLiveGame(gamePk: number | null | undefined, isLive: boolean) {
  return useQuery<LiveGameData>({
    queryKey: ["/api/mlb/live", gamePk],
    queryFn: () =>
      apiRequest("GET", `/api/mlb/live/${gamePk}`).then((r) => r.json()),
    enabled: !!gamePk,
    refetchInterval: isLive ? 25_000 : false,
    staleTime: 20_000,
  });
}
