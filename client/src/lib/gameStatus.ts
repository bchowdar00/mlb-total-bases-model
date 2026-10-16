/**
 * gameStatus.ts — Vantage Edge game status engine
 *
 * Parses "6:45 PM PDT" game time strings and computes whether a game is:
 *   upcoming  → more than 5 minutes before start
 *   live      → within 5 min before to 210 min (~3h30m) after start
 *   final     → more than 210 minutes after start
 *
 * All comparisons are in America/Los_Angeles (PDT/PST) time.
 */

export type GameStatus = "upcoming" | "live" | "final";

export interface GameStatusInfo {
  status: GameStatus;
  /** Minutes since game start. Negative = minutes until start. */
  minutesSinceStart: number;
  /** Short label: "6:45 PM", "IN PLAY", "FINAL" */
  label: string;
  /** Supporting info: "Starts in 45m", "1h 22m in", "" */
  subLabel: string;
}

/**
 * Parse a game time string and game date, return live status relative to now.
 * @param gameTime  e.g. "6:45 PM PDT" or "10:05 AM PDT"
 * @param gameDate  e.g. "2026-04-03" (YYYY-MM-DD)
 */
export function getGameStatus(gameTime: string, gameDate: string): GameStatusInfo {
  // Current time in PDT
  const nowPDT = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );

  // Parse "6:45 PM PDT" — extract hour, minute, AM/PM
  const match = gameTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) {
    return { status: "upcoming", minutesSinceStart: -999, label: gameTime, subLabel: "" };
  }

  let hour = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  // Build game start time in PDT on the correct date
  const [year, month, day] = gameDate.split("-").map(Number);
  const gameStart = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  gameStart.setFullYear(year, month - 1, day);
  gameStart.setHours(hour, min, 0, 0);

  const diffMs = nowPDT.getTime() - gameStart.getTime();
  const diffMin = Math.round(diffMs / 60000);

  // ── Upcoming ──────────────────────────────────────────────────────────────
  if (diffMin < -5) {
    const minsAway = Math.abs(diffMin);
    const hrs = Math.floor(minsAway / 60);
    const mins = minsAway % 60;
    const countdown = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    return {
      status: "upcoming",
      minutesSinceStart: diffMin,
      label: gameTime.replace(" PDT", "").replace(" PST", "").trim(),
      subLabel: `in ${countdown}`,
    };
  }

  // ── Live (up to ~3h30m after first pitch) ─────────────────────────────────
  if (diffMin <= 210) {
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    const elapsed = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    return {
      status: "live",
      minutesSinceStart: diffMin,
      label: "IN PLAY",
      subLabel: elapsed,
    };
  }

  // ── Final ─────────────────────────────────────────────────────────────────
  return {
    status: "final",
    minutesSinceStart: diffMin,
    label: "FINAL",
    subLabel: "",
  };
}

/** Format a minutes-since-start number as "1h 22m" or "45m" */
export function formatElapsed(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
