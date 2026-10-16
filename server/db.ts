import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@shared/schema";

// ---------------------------------------------------------------------------
// Persistence: Neon Serverless Postgres — free forever, never expires
// https://neon.tech — 0.5GB storage, no credit card, scales to zero
//
// Set DATABASE_URL env var to your Neon connection string:
//   postgresql://neondb_owner:<pw>@ep-xxx.aws.neon.tech/neondb?sslmode=require
//
// Without DATABASE_URL the server will crash on startup — this is intentional
// so a misconfigured deploy fails loudly rather than silently losing data.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "[db] DATABASE_URL is not set. " +
    "Set it to your Neon connection string in Render → Environment Variables. " +
    "Get it from: https://console.neon.tech"
  );
}

// postgres.js connection pool — Neon recommends max:1 on serverless
export const sql = postgres(DATABASE_URL, {
  max: 3,           // small pool — Render free tier has limited connections
  idle_timeout: 20, // close idle connections quickly (Neon scales to zero)
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });

// Raw SQL helper for the few places that need direct parameterised queries.
export async function runSQL(query: string, params: unknown[] = []): Promise<any[]> {
  return sql.unsafe(query, params as any);
}

// Create tables on startup (idempotent — IF NOT EXISTS)
export async function initDB(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      refreshed_at TEXT NOT NULL,
      game_date TEXT NOT NULL,
      player_name TEXT NOT NULL,
      team TEXT NOT NULL,
      opponent TEXT NOT NULL,
      home_team TEXT NOT NULL,
      game TEXT NOT NULL,
      game_time TEXT,
      lineup_pos INTEGER,
      tb_line REAL NOT NULL,
      prob_under REAL NOT NULL,
      tier TEXT NOT NULL,
      slg_2025 REAL,
      iso_2025 REAL,
      k_pct REAL,
      bb_pct REAL,
      park_factor REAL,
      opp_sp_name TEXT,
      key_signals TEXT,
      is_demo INTEGER DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS refresh_log (
      id SERIAL PRIMARY KEY,
      refreshed_at TEXT NOT NULL,
      game_date TEXT NOT NULL,
      total_projected INTEGER,
      total_predictions INTEGER,
      source TEXT DEFAULT 'auto',
      duration_ms INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS player_results (
      id SERIAL PRIMARY KEY,
      game_date TEXT NOT NULL,
      player_name TEXT NOT NULL,
      team TEXT NOT NULL,
      game TEXT NOT NULL,
      tb_line REAL NOT NULL,
      prob_under REAL NOT NULL,
      tier TEXT NOT NULL,
      actual_tb INTEGER,
      hit INTEGER,
      graded_at TEXT,
      is_demo INTEGER DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS season_stats (
      id SERIAL PRIMARY KEY,
      season INTEGER NOT NULL,
      total_predictions INTEGER NOT NULL DEFAULT 0,
      total_graded INTEGER NOT NULL DEFAULT 0,
      total_hits INTEGER NOT NULL DEFAULT 0,
      elite_predictions INTEGER NOT NULL DEFAULT 0,
      elite_hits INTEGER NOT NULL DEFAULT 0,
      very_high_predictions INTEGER NOT NULL DEFAULT 0,
      very_high_hits INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  // Idempotent column migrations for databases created before is_demo existed.
  await sql`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS is_demo INTEGER DEFAULT 0`;
  await sql`ALTER TABLE player_results ADD COLUMN IF NOT EXISTS is_demo INTEGER DEFAULT 0`;

  // Dedup migration: remove duplicate predictions, keep highest prob_under per player per date
  await sql`
    DELETE FROM predictions
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM predictions
      GROUP BY game_date, LOWER(player_name)
    )
  `;

  console.log("[db] Neon Postgres ready");
}
